# Security: what's checked where

A game for a group of friends, on Cloudflare's free plan. The rule of thumb: anything that is saved or that another
player sees is decided or checked by the server; anything the server can't check yet is listed under "Still open".

## Coins, items, XP and the Casino

- **Signed in:** the stash (coins, owned items, what's equipped, XP) lives in the `Accounts` Durable Object
  (`gambol/server/stashStore.ts`, keys `i:<user>` and `t:<user>` for the Casino tables). The browser only asks: `/api/stash`
  GET reads it, POST runs one `StashAction` through `gambol/shared/stash.ts` with the server's dice and clock.
  - Cases are rolled on the server. Plinko is rolled on the server. Blackjack's shoe and hand are kept on the server
    and the dealer's hole card isn't sent until the hand is over. Crash's snap point is kept on the server; the client
    learns it only once the kite has snapped (`peek`), and a cash-out pays at most what the kite had reached by the
    server's clock.
  - Match pay is worked out by the room (`Lobby.pay` → `Lobby.bank` → `Accounts.reward`): Battle kills and wins,
    Survival rounds, the boss, zombie-kill XP, finished runs. The client floats the same numbers up on the HUD, but
    they're only for show; it reloads the real total when the match ends. Killing your own second tab pays nothing.
  - Workbench contraptions are charged by the server (`Accounts.spend`) after the spot checks out, and the spot is
    checked again after the charge; a refusal or a scrap pays back into the account.
  - The first time an account's stash is read after this moved to the server, the browser's old stash is adopted once:
    items and XP as they were, coins capped at `STASH_IMPORT_COINS` (5,000).
- **Guests** keep the stash in localStorage and run the same rules in the browser. It's only ever their own. Practice
  bots pay guests only.
- **TŌGE's garage** already worked this way for accounts. A race prize is now paid once per account per race.
  - Cosmetic cases (`{a:'case'}` on `/api/garage`) are rolled on the server with `crypto.getRandomValues`, paid for
    and granted (or refunded as a duplicate) in the same write. `equip` refuses items the garage doesn't own or that
    belong in another slot, and a stored garage never wears an item it doesn't own (`cleanGarage`).
  - What other racers see: an account's race car code has unowned cosmetics stripped by the Accounts DO, at join (the
    Worker) and on every `car` message (RaceRoom). Guests' codes are only checked to name real items. Plate text is
    `[A-Z0-9 ]`, at most 8 characters, and is only ever drawn on a canvas.
  - The battle pass (`src/toge/shared/pass.ts`) is bought with garage money on the server (`{a:'pass'}`, 50,000) and its
    XP is paid with the prize: by the race room for online races (`ResultRow.xp`, worked out from the room's own
    places and clamped drift) and by the `solo` action, under the same once per `SOLO_GAP_MS` limit. Tiers are handed
    over by the server (`givePass`: money and cosmetics, each tier once, tracked by `given`); a stored garage keeps
    only pass items, backgrounds and titles its pass has unlocked. Pass driver metals and gear are refused by the
    `rider` action until unlocked and stripped from an account's driver on every `rider` message (RaceRoom).

## Input from clients

- Every shooter `state` and `shoot` is shape-checked before it's used or relayed (`Lobby.handle`, `validShot`): a
  non-number coordinate used to slip past the distance checks (NaN compares false) and let a shot hit any zombie
  anywhere, or be relayed to everyone else's game.
- Messages per client are rate-limited in the shooter (100/s) and race rooms (60/s; poses are relayed at once). Plug-in
  game rooms already had one.
- Typed (guest) names lose markup, quote, control, invisible and direction-flipping characters on the server
  (`cleanName`), and the Survival use prompt now escapes its text. Screens escape names as well.

## Accounts and hosting

- Passwords: PBKDF2-SHA256 (100k iterations), per-user salt, constant-time compare, 5 misses lock a username for 30 s.
- Changing a password (`/api/password`) needs the session and the current password (same lockout and per-address limit
  as sign-in), and signs out every older session (`pwAt` on the user record).
- Admin reset (`/api/admin/reset-password`): only exists when the `ADMIN_KEY` secret is set (32+ characters), compared
  in constant time. It's not same-origin only (it's for curl), so the key is the whole lock: keep it out of the repo
  and chats. It returns a random 12-character temporary password and signs the account out everywhere.
  `/api/admin/clear-race-records` sits behind the same key (a preview unless the body is `{"apply": true}`).
- Per address: 10 sign-in attempts a minute and 5 new accounts (then one per 10 minutes); 10 new lobbies a minute
  (then one per 6 s). In memory, per Durable Object (`server/limiter.ts`), so they reset if it's evicted.
- Session cookie: random 256-bit token, HttpOnly, SameSite=Lax, Secure on https; only its hash is stored.
- API POSTs must be same-origin JSON; WebSockets must come from the same origin. A malformed `Origin` is refused
  instead of throwing.
- Static pages can't be framed (`public/_headers`: `X-Frame-Options`, `frame-ancestors`), with `nosniff` and a
  referrer policy.

## Still open

- **Movement and hits are client-authoritative** (see CLAUDE.md, Netcode). A cheat client can still teleport, aim for
  you, or farm kills on an alt account, and with them coins and XP. The fix is the planned server-side movement and
  hit checks.
- **TŌGE solo races** are paid from what the client reports (at most once per `SOLO_GAP_MS`); online finish times are
  checked against the server's clock within a window.
- **TŌGE drift bonus** (`src/toge/shared/drift.ts`) is scored on the client, since driving is. The server bounds it:
  online, a racer's drift total is capped at `DRIFT_MAX_RATE` × seconds since GO (only while racing, never after
  finishing). Either way drifting pays at most `DRIFT.payPerKm` per km of race, well under a win; solo pays its usual
  share and is still limited to one payout per `SOLO_GAP_MS`. A cheat client can max the cap, not exceed it. (There
  are no items any more, so nothing else in a race pays.)
- **TŌGE best times** (`src/toge/shared/records.ts`, kept per account as `b:<user>`) never pay anything. They only
  come from online time trials and hill climbs (`recordMode`), timed by the room (within the window above, at least
  `MIN_RACE_SECONDS`), and bounded: nothing quicker than the track's length at `RECORDS.maxAvgSpeed` (90 m/s
  average) or slower than an hour. Solo runs carry no time, so a client can't post a best on its own.
- **Friends** (`/api/friends`, `src/server/friendStore.ts`) are one way, like following: anyone signed in can add any
  username (20 adds or removes per account at once, then one per 3 s), which also tells them the name exists (as
  sign-up already does). Adding someone lets you open their TŌGE profile (`/api/garage?u=`): cars with their looks
  and cosmetics, driver, races, wins and best times, never money. Names reach the page only through `esc()`.
- **Plug-in games** (`PartyRoom`) relay players' messages unopened: each game must validate what it receives and
  render names with `textContent`.
- **No full Content-Security-Policy** yet (only `frame-ancestors`): a `script-src` policy needs a pass over inline
  styles and the asset loaders first.
- No password reset, no "sign out everywhere", sessions don't slide. No bot check (Turnstile) on sign-up or hosting.
