# Security: what's checked where

A racing game for a group of friends, on Cloudflare's free plan. The rule of thumb: anything that is saved or that another
player sees is decided or checked by the server; anything the server can't check yet is listed under "Still open".

## Money, cases and the battle pass

- **Signed in:** the garage (cars, upgrades, cosmetics, race money, the battle pass, drivers) lives in the `Accounts`
  Durable Object (`kanjo/server/garageStore.ts`, key `g:<user>`). The browser only asks: `/api/garage` GET reads it,
  POST runs one `GarageAction` through `kanjo/shared/garage.ts` with the server's dice and clock.
- **Guests** keep the garage in localStorage and run the same rules in the browser. It's only ever their own.
- A race prize is paid once per account per race.
  - Cosmetic cases (`{a:'case'}` on `/api/garage`) are rolled on the server with `crypto.getRandomValues`, paid for
    and granted (or refunded as a duplicate) in the same write. `equip` refuses items the garage doesn't own or that
    belong in another slot, and a stored garage never wears an item it doesn't own (`cleanGarage`).
  - What other racers see: an account's race car code has unowned cosmetics stripped by the Accounts DO, at join (the
    Worker) and on every `car` message (RaceRoom). Guests' codes are only checked to name real items. Plate text is
    `[A-Z0-9 ]`, at most 8 characters, and is only ever drawn on a canvas.
  - The battle pass (`src/kanjo/shared/pass.ts`) is bought with garage money on the server (`{a:'pass'}`, 50,000) and its
    XP is paid with the prize: by the race room for online races (`ResultRow.xp`, worked out from the room's own
    places and clamped drift) and by the `solo` action, under the same once per `SOLO_GAP_MS` limit. Tiers are handed
    over by the server (`givePass`: money and cosmetics, each tier once, tracked by `given`); a stored garage keeps
    only pass items, backgrounds and titles its pass has unlocked. Pass driver metals and gear are refused by the
    `rider` action until unlocked and stripped from an account's driver on every `rider` message (RaceRoom).

## Input from clients

- Every race message is shape-checked before it's used or relayed (`Race.handle` in race.ts): a non-number coordinate compares
  false against every bound, so numbers are checked with `Number.isFinite`.
- Messages per client are rate-limited in race rooms (60/s; poses are relayed at once).
- **Custom maps** (the map builder, `src/kanjo/shared/custommap.ts`) come from players. Every path that takes one
  (`/api/maps`, the room's `map` message, a `load` / `room` on another client, a share code) runs `cleanMap`: numbers
  clamped and rounded, text stripped of markup and control characters and capped, at most `MAP.maxPoints` points,
  `MAP.maxDeco` pieces of scenery (known kinds only) and `MAP.maxBytes` of JSON (the race room takes messages up to
  20 KB for it); the room also runs `checkMap` (the road must build) and takes it only from the host, in the
  lobby, once per 1.5 s. Its name reaches the page only through `esc()`. A custom map pays nothing (prize, drift bonus
  and XP are 0, the solo `solo` action is skipped), keeps no best times and fetches no record ghost, so a map built to
  be easy can't farm anything. Scenery is looks only (never solid); the cones, barrels and bales a player puts on the
  road are ordinary props, and `checkMap` refuses a map whose barrels and bales close the road. Accounts keep at most `MAP.maxSaved` (20 changes at once, then one per 2 s).
- Typed (guest) names lose markup, quote, control, invisible and direction-flipping characters on the server
  (`cleanName`). Screens escape names as well.

## Accounts and hosting

- Passwords: PBKDF2-SHA256 (100k iterations), per-user salt, constant-time compare, 5 misses lock a username for 30 s.
- Changing a password (`/api/password`) needs the session and the current password (same lockout and per-address limit
  as sign-in), and signs out every older session (`pwAt` on the user record).
- Admin reset (`/api/admin/reset-password`): only exists when the `ADMIN_KEY` secret is set (32+ characters), compared
  in constant time. It's not same-origin only (it's for curl), so the key is the whole lock: keep it out of the repo
  and chats. It returns a random 12-character temporary password and signs the account out everywhere.
  `/api/admin/clear-race-records` sits behind the same key (a preview unless the body is `{"apply": true}`).
  So do `/api/admin/export` (read only: every stored key and value, password hashes included, a page at a time) and
  `/api/admin/import` (writes pages as they are; `wipe` empties the accounts first). They exist for the one-time copy
  from Gambol's site and for backups: treat the key like the database itself.
- Per address: 10 sign-in attempts a minute and 5 new accounts (then one per 10 minutes); 10 new lobbies a minute
  (then one per 6 s). In memory, per Durable Object (`server/limiter.ts`), so they reset if it's evicted.
- Session cookie: random 256-bit token, HttpOnly, SameSite=Lax, Secure on https; only its hash is stored.
- API POSTs must be same-origin JSON; WebSockets must come from the same origin. A malformed `Origin` is refused
  instead of throwing.
- Static pages can't be framed (`public/_headers`: `X-Frame-Options`, `frame-ancestors`), with `nosniff` and a
  referrer policy.

## Still open

- **Driving is client-authoritative** (see CLAUDE.md, Netcode). A cheat client can drive impossibly; the server bounds
  what that earns (below). The fix is the planned server-side physics.
- **KANJO solo races** are paid from what the client reports (at most once per `SOLO_GAP_MS`); online finish times are
  checked against the server's clock within a window.
- **KANJO drift bonus** (`src/kanjo/shared/drift.ts`) is scored on the client, since driving is. The server bounds it:
  online, a racer's drift total is capped at `DRIFT_MAX_RATE` × seconds since GO (only while racing, never after
  finishing). Either way drifting pays at most `DRIFT.payPerKm` per km of race, well under a win; solo pays its usual
  share and is still limited to one payout per `SOLO_GAP_MS`. A cheat client can max the cap, not exceed it. (There
  are no items any more, so nothing else in a race pays.)
- **KANJO best times** (`src/kanjo/shared/records.ts`, kept per account as `b:<user>`) never pay anything. They only
  come from online time trials and hill climbs (`recordMode`), timed by the room (within the window above, at least
  `MIN_RACE_SECONDS`), and bounded: nothing quicker than the track's length at `RECORDS.maxAvgSpeed` (130 m/s
  average, above every car's top speed) or slower than an hour. Solo races carry no time, so a client can't post a best on its own.
  The Race page's solo **Time trial** is no exception: it opens a private room of one (`solo=1`, passed on by the
  Worker only to a new room, never to a code being joined; the room is always a time trial and full at one racer),
  so the room times the run exactly like an online time trial.
  `/api/ghost?t=<track>` (GET only) hands out the current track record's run (the same `Accounts.recordGhost` a race
  room uses: the holder's name, car code, driver and poses, all already public on the board and in races); it writes
  nothing.
  The medal table is counted from the boards themselves, and "time beaten" notices (`nt:<user>`) are only ever
  written by the server when a best it timed moves someone down a board. `/api/notices` reads and clears only the
  session's own account's (`seen` must be a number; it only drops notices up to it).
- **Friends** (`/api/friends`, `src/server/friendStore.ts`) are one way, like following: anyone signed in can add any
  username (20 adds or removes per account at once, then one per 3 s), which also tells them the name exists (as
  sign-up already does). Adding someone lets you open their KANJO profile (`/api/garage?u=`): cars with their looks
  and cosmetics, driver, races, wins and best times, never money. Names reach the page only through `esc()`.
- **No full Content-Security-Policy** yet (only `frame-ancestors`): a `script-src` policy needs a pass over inline
  styles and the asset loaders first.
- No password reset, no "sign out everywhere", sessions don't slide. No bot check (Turnstile) on sign-up or hosting.
