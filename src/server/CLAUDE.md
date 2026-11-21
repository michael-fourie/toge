# src/server: Cloudflare Worker + Durable Objects

One Worker (`worker.ts`) serves the API and WebSockets; the built client is served as static assets by
Cloudflare (`wrangler.jsonc`: `assets.directory ./dist`, SPA fallback, and `run_worker_first: ["/ws", "/api/*"]`,
so only those paths ever reach the Worker). Everything runs on the Cloudflare free plan. Deploying: `docs/DEPLOYMENT.md`.
Security model and open gaps: `docs/SECURITY.md`.

This guide covers the whole server side. The files:

- `src/server/` (the platform): `worker.ts` (routing, `Env`, admin routes), `directory.ts`, `accounts.ts` +
  `accountStore.ts` + `friendStore.ts` + `clubStore.ts`, `limiter.ts`, `rooms.ts` (`Socket` and `HEARTBEAT_SECONDS`).
- `src/kanjo/server/`: `raceroom.ts` (RaceRoom), `race.ts`, `garageStore.ts`, `recordStore.ts`.

All of them are typechecked by `tsconfig.worker.json` (Workers types, no DOM). They may import `src/shared` and
`src/kanjo/shared`, never a `client/` folder.

## Routing (`worker.ts`)

| Route | Handled by |
|---|---|
| `/api/races` | Directory `"race"` `.listRaces()` (open race lobbies with someone in them; solo time trials flagged `solo`) |
| `/api/me`, `POST /api/register`, `/api/login`, `/api/logout`, `/api/password` (change, signed in) | Accounts `"all"` (`accountApi`; cookie `kanjo_session`) |
| `POST /api/admin/reset-password` (`Authorization: Bearer <ADMIN_KEY>`, `{username}`) | Accounts `"all"` `.resetPassword` (`adminReset`; 404 unless the `ADMIN_KEY` secret is set; how-to in docs/DEPLOYMENT.md) |
| `POST /api/admin/clear-race-records` (same key; `{"apply": true}` to wipe, otherwise a preview) | Accounts `"all"` `.clearRaceRecords` (`adminClearRecords`): wipes bests, boards and ghosts on Kōri Pass, Saltwind and Red Mesa (`CLEAR_TRACKS`) |
| `POST /api/admin/export` (same key; `{"after": <key or null>}`) | Accounts `"all"` `.exportPage`: one page (50 keys) of every stored key and value, read only. Backups, and the check after the copy from Gambol |
| `POST /api/admin/import` (same key; `{"entries": [[key, value], ...], "wipe": bool}`, ≤ 24 MB) | Accounts `"all"` `.importPage`: writes an exported page as it is; `wipe` empties the object first. Used by `tools/copy-accounts.mjs` (docs/DEPLOYMENT.md) |
| `/api/garage` (GET reads, POST applies one action) | Accounts `"all"`. `GET` also returns your best times; `?u=<name>` returns a friend's profile instead (null unless you've added them) |
| `/api/leaderboard` (GET, open to anyone) | Accounts `"all"`: the all-time boards. No params: every track's record and the medal table (`medals`); `?t=<track>`: that track's board (one row per account) |
| `/api/notices` (GET your own; POST `{seen: <at>}`, ≤128 B) | Accounts `"all"` `.notices` / `.seenNotices`: "your time was beaten" notices for the session's account (null / false for guests) |
| `/api/friends` (GET your list, POST `{a: 'add' \| 'remove', name}`) | Accounts `"all"` (`friendStore.ts`; rules in `src/shared/friends.ts`) |
| `/api/clubs` (GET the clubs you're in, POST a `ClubAction`: `create` / `add` / `remove` / `disband`) | Accounts `"all"` (`clubStore.ts`; rules in `src/shared/clubs.ts`) |
| `/api/maps` (GET your saved maps, POST a `MapAction`: `save` / `delete`, ≤ `MAP.maxBytes` + 512 B) | Accounts `"all"` `.maps` / `.mapAct` (`src/kanjo/server/mapStore.ts`; rules in `src/kanjo/shared/custommap.ts` `applyMapAction`): the map builder's maps, null / an error for guests (they keep theirs in localStorage) |
| WS `/ws?game=race` | Directory `"race"` hands out a code (or checks `code=`), then RaceRoom `<code>` |

- `/ws` needs `Upgrade: websocket` and a same-origin `Origin`. `Accounts.identify(cookie, name)` settles the display
  name (a guest using an account's name plays as `"name (guest)"`). With `code=` the Directory must know it; without
  one, `dir.allocate(ip)` makes a code and the room is created near the host (`locationHint`).
- The Worker **rebuilds** the query it forwards: `code, name, user`, `car` (≤ `CAR_CODE_MAX` = 128 chars, cosmetics
  checked against an account's garage), `rider`, and `solo` (only when hosting: a fresh private time trial of one,
  the solo Time trial). A new socket parameter must be added here.
- Refusals go through `refuse()`: accept, send `{t:'error'}`, close.
- POST bodies go through `jsonBody` (POST only, `application/json`, same origin, size cap). There are no CORS headers:
  the API is same-origin only (the admin routes are for curl and the copy script: the key is their lock). Static-page
  security headers are in `public/_headers`.

## Durable Objects

| Class (file) | Role |
|---|---|
| `Directory` (`directory.ts`) | The `"race"` instance: 4-letter codes, the lobby list, entries expire after 3 missed 30 s heartbeats. Rate-limits hosting per IP. |
| `Accounts` (`accounts.ts` + `accountStore.ts`, `friendStore.ts`, `kanjo/server/garageStore.ts` + `recordStore.ts`) | One global instance `"all"`: users, sessions, friends, garages, best times, boards, ghosts, notices. PBKDF2 runs here (the free-plan Worker only gets 10 ms CPU). |
| `RaceRoom` (`kanjo/server/raceroom.ts`, logic in `race.ts`) | One race. Messages ≤ 2048 B, 60 msg/s. One prize per account per race. |

Rooms use `ws.accept()` (not the hibernation API) and keep state in memory; a room ends when it empties.
Rate limiters (`limiter.ts`, token bucket) and login lockouts are in memory too, so they reset if a DO is evicted.
Every deploy restarts all DOs and drops every live race (production deploys at night, docs/DEPLOYMENT.md). The race
loop runs through `guarded()` (rooms.ts) so a throwing tick is logged with its room code; Workers Logs are on
(`observability` in wrangler.jsonc), so look in the dashboard's Observability tab when races drop. The free plan's
100k requests a day (WebSocket messages count 1/20) runs out in a few hours of full lobbies: that drops everyone too.

The room *logic* (`race.ts`) is plain TypeScript with no Cloudflare imports; the DO class is a thin wrapper. Keep it
that way: it's what makes the logic unit-testable.

## Authority (what to trust)

- **Client-authoritative (prototype shortcuts):** driving (poses are checked for finite numbers, then relayed).
- **Server-authoritative:** race flow and timing (finishes under `MIN_RACE_SECONDS` are ignored; client time accepted
  within −2/+0.5 s of the server's), results, eliminations, best times and boards, and **all money and XP for
  signed-in players**.
- Netcode upgrade path: send inputs instead of state, run the shared physics on the server, add prediction and
  reconciliation. Keep `src/kanjo/shared` (and `src/shared`) deterministic so that stays possible.

## Accounts and economy

- Usernames 3-16 `[A-Za-z0-9_-]`, passwords 6-72 (`checkCredentials`, shared). PBKDF2-SHA256, 100k iterations, 16-byte
  salt, constant-time compare; unknown names still hash (no timing leak); 5 misses lock a name for 30 s.
- Session token: 64 hex chars in an HttpOnly, SameSite=Lax cookie, 30 days, not sliding. Only `sha256(token)` is
  stored (`s:<hash>`). Users are `u:<lowercase name>`, garage `g:<user>`, best times `b:<user>`, boards `lb:<track>`,
  record ghosts `gh:<track>`, notices `nt:<user>`, friends `f:<user>` (who they added) and `fi:<user>` (who added
  them), clubs `cl:<lower club name>` and `cm:<user>` (the clubs a user is in), custom maps `mp:<user>` (at most `MAP.maxSaved`), all lower-cased names. Accounts copied from Gambol also carry its shooter stash (`i:<user>`, `t:<user>`),
  which nothing here reads.
- Friends are one way (`FriendStore`): adding needs the account to exist, `FRIENDS_MAX` each, a per-account
  `Limiter`. A friend sees `profileOf()` (no money).
- Clubs (`ClubStore`): unique names, the owner alone adds (only their friends, via `FriendStore.has`), removes or disbands; the club's owner can't leave; `CLUBS_MAX` clubs per account, `CLUB_MEMBERS_MAX` members, a per-account `Limiter`.
- Cosmetic cases are a garage action like crates: the server rolls with `secureRandom` (crypto, garageStore.ts),
  charges, grants or refunds. `Accounts.raceCar(name, code)` strips cosmetics an account doesn't own from its race car
  code; the Worker runs it on `car=` when an account joins a race, RaceRoom on every `{t:'car'}` from an account.
- Guests keep their garage in localStorage and run the same pure rules (`applyAction` in `kanjo/shared/garage.ts`).
  Signed in, the server runs them with its own dice and clock.
- Paying: races call `Accounts.raceReward`, and `Accounts.raceTime` for each account's finish (a new best comes back
  and the room tells everyone with `records`), only for time trials and hill climbs (`recordMode`). Solo races keep no
  time (the solo Time trial is a room, so it does). Amounts must match what the client floats up for guests.

## Rules for server changes

1. Never accept money, XP, prices or results from the client for an account. Compute them here.
2. Validate every field of every message: types, `Number.isFinite` / `Number.isInteger` (NaN passes `<` checks),
   lengths, ids that must exist (`cleanGarage`, `decodeCar`, `cleanRider`). Relayed state reaches every racer.
3. New POST route: through `jsonBody` with a size cap. New socket kind: a byte cap and a `Limiter`.
4. Never send hidden state early.
5. **New message type:** add it to the union in `kanjo/shared/protocol.ts`, handle it in `Race`, keep it under the
   room's byte limit, add a test.
6. **New Durable Object:** export it from `worker.ts`, add it to `Env`, add the binding to **both** `durable_objects`
   and `previews.durable_objects` in `wrangler.jsonc` (branch preview builds fail without the latter), and append a
   new migration tag (`v2`, …) with `new_sqlite_classes` (required on the free plan). Never edit or reorder existing tags.
7. Update `docs/SECURITY.md` when you change what's checked where.

## Testing server code

Tests never import `cloudflare:workers`; they construct the logic classes with fake sockets (`{readyState: 1, send}`):

- `new Race(..., () => now, false)` with a hand-wound clock and no interval (`tests/kanjo/raceroom.test.ts`).
- Storage tests use a `Map` as KV (`tests/accounts.test.ts`, `tests/kanjo/garage.test.ts`, `records.test.ts`).
- The admin export/import pair and `tools/copy-accounts.mjs` were checked end to end against two local dev servers
  (`npm run dev` in both repos with `ADMIN_KEY` in `.dev.vars`): logins, garage and friends identical after the copy.
