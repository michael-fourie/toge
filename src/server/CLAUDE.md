# src/server: Cloudflare Worker + Durable Objects (every game's server)

One Worker (`worker.ts`) serves the API and WebSockets; the built client is served as static assets by
Cloudflare (`wrangler.jsonc`: `assets.directory ./dist`, SPA fallback, and `run_worker_first: ["/ws", "/api/*"]`,
so only those paths ever reach the Worker). Everything runs on the Cloudflare free plan. Deploying: `docs/DEPLOYMENT.md`.
Security model and open gaps: `docs/SECURITY.md`.

This guide covers the server side of every game. The files are split by owner:

- `src/server/` (the platform): `worker.ts` (routing, `Env`), `directory.ts`, `accounts.ts` + `accountStore.ts`,
  `limiter.ts`, `party.ts` + `partyroom.ts` (plug-in rooms), `rooms.ts` (`Socket` and `HEARTBEAT_SECONDS`, which
  every game's room uses).
- `src/gambol/server/`: `room.ts` (LobbyRoom), `lobby.ts`, `survival.ts`, `workshop.ts`, `royale.ts`, `stashStore.ts`.
- `src/toge/server/`: `raceroom.ts` (RaceRoom), `race.ts`, `garageStore.ts`.

All of them are typechecked by `tsconfig.worker.json` (Workers types, no DOM). They may import `src/shared` and the
`shared/` folders of the games, never a `client/` folder. The platform files wire the games in; a game's server never
imports the other game's (`tests/boundaries.test.ts`).

## Routing (`worker.ts`)

| Route | Handled by |
|---|---|
| `GET /api/lobbies` | Directory `"all"` `.list()` (shooter lobbies) |
| `/api/races` | Directory `"race"` `.listRaces()` |
| `/api/parties?game=<id>` | Directory `"party:<id>"` `.listParties()` (`isGameId` checked) |
| `/api/me`, `POST /api/register`, `/api/login`, `/api/logout`, `/api/password` (change, signed in) | Accounts `"all"` (`accountApi`; cookie `gambol_session`) |
| `POST /api/admin/reset-password` (`Authorization: Bearer <ADMIN_KEY>`, `{username}`) | Accounts `"all"` `.resetPassword` (`adminReset`; 404 unless the `ADMIN_KEY` secret is set; how-to in docs/DEPLOYMENT.md) |
| `/api/stash`, `/api/garage` (GET reads, POST applies one action) | Accounts `"all"`. `GET /api/garage` also returns your TŌGE best times; `?u=<name>` returns a friend's TŌGE profile instead (null unless you've added them) |
| `/api/leaderboard` (GET, open to anyone) | Accounts `"all"`: TŌGE's all-time boards. No params: every track's record; `?t=<track>`: that track's board (one row per account) |
| `/api/friends` (GET your list, POST `{a: 'add' \| 'remove', name}`) | Accounts `"all"` (`friendStore.ts`; rules in `src/shared/friends.ts`) |
| WS `/ws?game=race` | Directory `"race"` hands out a code, then RaceRoom `<code>` |
| WS `/ws?game=party&kind=<id>` | Directory `"party:<kind>"`, then PartyRoom `<kind>:<code>` |
| WS `/ws` (anything else) | the shooter: Directory `"all"`, then LobbyRoom `<code>` |

- `/ws` needs `Upgrade: websocket` and a same-origin `Origin`. `Accounts.identify(cookie, name)` settles the display
  name (a guest using an account's name plays as `"name (guest)"`). With `code=` the Directory must know it; without
  one, `dir.allocate(ip)` makes a code and the room is created near the host (`locationHint`).
- The Worker **rebuilds** the query it forwards. Shooter rooms get `code, name, user, mode (battle|survival), teams,
  map, koth, br, skin (≤24 chars), gear (≤120)`; race rooms get `car` (≤ `CAR_CODE_MAX` = 128 chars, cosmetics checked against an account's garage). A new socket parameter must be added here.
- Refusals go through `refuse()`: accept, send `{t:'error'}`, close.
- POST bodies go through `jsonBody` (POST only, `application/json`, same origin, size cap). There are no CORS headers:
  the API is same-origin only. Static-page security headers are in `public/_headers`.

## Durable Objects

| Class (file) | Role |
|---|---|
| `LobbyRoom` (`gambol/server/room.ts`, game logic in `lobby.ts`) | One per shooter match. Normalises params (`koth` forces teams, `br` forces FFA, `map` only for Battle). Messages ≤ 4096 B, `Limiter` 100 msg/s. `lobby.bank` pays/charges accounts via Accounts `reward` / `spend`. |
| `Directory` (`directory.ts`) | Registry per namespace (`"all"`, `"race"`, `"party:<id>"`): 4-letter codes, lobby lists, entries expire after 3 missed 30 s heartbeats. Rate-limits hosting per IP. |
| `Accounts` (`accounts.ts` + `accountStore.ts`, `friendStore.ts`, `gambol/server/stashStore.ts`, `toge/server/garageStore.ts` + `recordStore.ts`) | One global instance `"all"`: users, sessions, friends, the shooter stash, the TŌGE garage and best times. PBKDF2 runs here (the free-plan Worker only gets 10 ms CPU). |
| `RaceRoom` (`toge/server/raceroom.ts`, logic in `race.ts`) | One TŌGE race. Messages ≤ 2048 B, 60 msg/s. One prize per account per race. |
| `PartyRoom` (`partyroom.ts`, logic in `party.ts`) | Generic roster + relay for plug-in games in `src/games`; never reads payloads. Limits in `PARTY` (`src/shared/party.ts`). |

Rooms use `ws.accept()` (not the hibernation API) and keep state in memory; a room ends when it empties.
Rate limiters (`limiter.ts`, token bucket) and login lockouts are in memory too, so they reset if a DO is evicted.
Every deploy restarts all DOs and drops every live game (production deploys at night, docs/DEPLOYMENT.md). Room game
loops run through `guarded()` (rooms.ts) so a throwing tick is logged with its room code; Workers Logs are on
(`observability` in wrangler.jsonc), so look in the dashboard's Observability tab when games drop. The free plan's
100k requests a day (WebSocket messages count 1/20) runs out in a few hours of a full lobby: that drops everyone too.

The room *logic* (`lobby.ts`, `survival.ts`, `workshop.ts`, `royale.ts`, `race.ts`, `party.ts`) is plain TypeScript with
no Cloudflare imports; the DO classes are thin wrappers. Keep it that way: it's what makes the logic unit-testable.

## The shooter loop (`gambol/server/lobby.ts`)

`setInterval(tick, 1000/20)`: step Survival (zombies substep at 60 Hz, `SIM_DT`) and Royale, restart after
`matchOver`, respawn, step the hill (KotH), broadcast `snapshot {players, zombies, koth, zone}`, heartbeat the
Directory. Messages: `ClientMsg` / `ServerMsg` in `src/gambol/shared/protocol.ts`; flow is `welcome` → `joined` →
`playerJoined` → 20 Hz `snapshot` + `shot` / `kill` / `respawn` → `matchOver` → (`MATCH_OVER_SECONDS`) `matchStart`.
Survival (`survival.ts`), contraptions (`workshop.ts`) and Battle Royale (`royale.ts`) are described under
"Game modes" in `src/gambol/shared/CLAUDE.md`.

Survival owns everything with a price, server-authoritative and reset with the run: per-player `wallet` (points,
Juggernog, two gun slots), doors, window boards, the Mystery Box. Clients send `use {kind,id}` (the server re-checks
with `findUse`) and `equip`; the owner hears `me` (points, guns, which slots start full), everyone hears `world`
(open doors, boards per window, box state), others see `shot.w/up`.

Netcode shortcuts: clients send their state at 20 Hz (only when it changed) and the server relays 20 Hz snapshots;
remote players render 100 ms in the past, interpolated; hits are detected by the shooter's client (favour the
shooter) and the server sanity-checks distance and fire rate.

## Authority (what to trust)

- **Client-authoritative (prototype shortcuts):** movement (`state` is only checked for finite numbers, then
  relayed), hit detection (server checks with `validShot`: distance, per-gun cooldown, knife reach), TŌGE driving.
- **Server-authoritative:** scores and kills, match flow, respawns, teams, the hill, zombies, everything with a price
  in Survival (wallet, doors, box), contraptions (re-run `placeProblem`), Battle Royale (zone, loot, ammo, health),
  race timing (finishes under `MIN_RACE_SECONDS` are ignored; client time accepted within −2/+0.5 s of the server's),
  and **all coins/XP/money for signed-in players**.
- Netcode upgrade path: send inputs instead of state, run the shared `stepPlayer` on the server, add prediction and
  reconciliation. Keep each game's `shared/` (and `src/shared`) deterministic so that stays possible.

## Accounts and economy

- Usernames 3-16 `[A-Za-z0-9_-]`, passwords 6-72 (`checkCredentials`, shared). PBKDF2-SHA256, 100k iterations, 16-byte
  salt, constant-time compare; unknown names still hash (no timing leak); 5 misses lock a name for 30 s.
- Session token: 64 hex chars in an HttpOnly, SameSite=Lax cookie, 30 days, not sliding. Only `sha256(token)` is
  stored (`s:<hash>`). Users are `u:<lowercase name>`, stash `i:<user>` / `t:<user>`, garage `g:<user>`, TŌGE best
  times `b:<user>`, friends `f:<user>` (who they added) and `fi:<user>` (who added them), all lower-cased names.
- Friends are site-wide and one way (`FriendStore`): adding needs the account to exist, `FRIENDS_MAX` each, a
  per-account `Limiter`. A game decides what a friend sees; TŌGE shows `profileOf()` (no money).
- TŌGE cosmetic cases are a garage action like crates: the server rolls with `secureRandom` (crypto, garageStore.ts),
  charges, grants or refunds. `Accounts.raceCar(name, code)` strips cosmetics an account doesn't own from its race car
  code; the Worker runs it on `car=` when an account joins a race, RaceRoom on every `{t:'car'}` from an account.
- Guests keep stash and garage in localStorage and run the same pure rules (`applyStash` in `gambol/shared/stash.ts`,
  `applyAction` in `toge/shared/garage.ts`). Signed in, the server runs them with its own dice and clock.
- Paying: shooter rooms call `Lobby.pay` → `Accounts.reward` (only for `client.user`; killing your own second tab pays
  nothing). Races call `Accounts.raceReward`, and `Accounts.raceTime` for each account's finish (a new best comes back
  and the room tells everyone with `records`). A solo finish's `time` rides on the `solo` garage action. Amounts must match what the client floats up for guests.

## Rules for server changes

1. Never accept coins, XP, money, prices or results from the client for an account. Compute them here.
2. Validate every field of every message: types, `Number.isFinite` / `Number.isInteger` (NaN passes `<` checks),
   lengths, ids that must exist (`decodeGear`, `decodeSkin`, `cleanGarage`, `sanitize`). Relayed state reaches every player.
3. New POST route: through `jsonBody` with a size cap. New socket kind: a byte cap and a `Limiter`.
4. Never send hidden state early (e.g. the Blackjack hole card, the Crash point before the kite snaps).
5. **New message type:** add it to the union in `gambol/shared/protocol.ts` (or `toge/shared/protocol.ts`), handle it in
   `Lobby.handle` (or `Race`), keep it under the room's byte limit, add a test.
6. **New Durable Object:** export it from `worker.ts`, add it to `Env`, add the binding to **both** `durable_objects`
   and `previews.durable_objects` in `wrangler.jsonc` (branch preview builds fail without the latter), and append a
   new migration tag (`v5`, …) with `new_sqlite_classes` (required on the free plan). Never edit or reorder existing tags.
7. Update `docs/SECURITY.md` when you change what's checked where.

## Testing server code

Tests never import `cloudflare:workers`; they construct the logic classes with fake sockets (`{readyState: 1, send}`):

- `new Lobby('HILL', 'battle', true, 'windward', () => {}, () => {}, true)` (koth, survival, royale, security tests);
  drive time with `lobby['tick']()` and `remove()` every client so the interval stops.
- `new Race(..., () => now, false)` with a hand-wound clock and no interval (`tests/toge/raceroom.test.ts`).
- `new Party(..., () => now)` (`tests/party.test.ts`). Storage tests use a `Map` as KV (`tests/accounts.test.ts`).
- `npm run smoke` (`tests/lobby.smoke.ts`, `BASE=https://…`) runs two real bots against a running server.
