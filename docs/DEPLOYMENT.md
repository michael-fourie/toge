# Deployment: Cloudflare, all-in-one, free tier

One Worker serves the built client (static assets) and the multiplayer backend. No VM, no separate hosting.

```
browser ── https://<domain>/            → static assets (dist/client), free and unmetered
        ── GET /api/lobbies             → Worker → Directory DO (registry of open lobbies)
        ── WS  /ws?name=..&code=ABCD    → Worker → LobbyRoom DO "ABCD" (one per match, runs the 20 Hz tick)
        ── WS  /ws?name=..              → Worker asks Directory for a fresh code, creates LobbyRoom near the host
```

- `src/server/worker.ts`: routing, origin check, region hint (`locationHint` from the host's continent).
- `src/gambol/server/room.ts`: the `LobbyRoom` Durable Object. Wraps `lobby.ts` (the game logic, runtime-agnostic). It exists while someone is connected.
- `src/server/directory.ts`: one global `Directory` DO: allocates codes, lists lobbies, expires entries that stop sending heartbeats.
- `wrangler.jsonc`: assets, bindings, and the migration. Classes must be `new_sqlite_classes` to be allowed on the free plan.

## Dev and deploy

```bash
npm run dev       # vite + the Cloudflare plugin runs the Worker and DOs locally (workerd); needs Node 20+
npm run deploy    # typecheck, vite build, wrangler deploy
BASE=https://your.domain npx tsx tests/lobby.smoke.ts   # two bots, join/shoot/kill/leave, against a deployment
```

First time: `npx wrangler login`, then `npm run deploy`. That publishes to `https://atrous.<account>.workers.dev`.

## When deploys happen (why games used to "crash" at random)

Every deploy restarts all Durable Objects, and a restart closes every WebSocket: everyone in a shooter match, a race
or a plug-in room is dropped at the same moment, whatever the game. When Workers Builds deployed every push to master,
a day of merges (33 deploys on 2026-11-02/03, one every ~12 minutes at the peak) looked like the games crashing at random.

So production deploys from its own branch, `production`, and `.github/workflows/deploy.yml` moves it to master:

- every hour from 09:00 to 14:00 UTC (1-6 am Pacific), only when master has something new and `/api/lobbies`,
  `/api/races` and `/api/parties?game=<id>` (every `src/games/<id>/channel.ts`) show nobody playing;
- by hand: GitHub, Actions, "Deploy to production", Run workflow (tick "even if people are playing" to skip the check),
  or `git push origin master:production` for an urgent fix.

One-time setup in Cloudflare: Workers & Pages, atrous, Settings, Build, Branch control: set the production branch to
`production`. While there, untick builds for non-production branches unless you want previews (each preview uses 5 of
the free plan's 100 Durable Object namespaces). The site to check is `https://gambol.lol` (override with an Actions
variable `SITE_URL`).

## Custom domain (domain registered at Namecheap)

1. Cloudflare dashboard, Add a site, enter the domain, choose the Free plan.
2. Namecheap, Domain List, Manage, Nameservers, "Custom DNS": enter the two Cloudflare nameservers. Propagation takes minutes to a few hours.
3. Worker, Settings, Domains & Routes, Add, Custom domain: pick `domain.com` (and `www`). Cloudflare creates DNS and TLS automatically.

## Free-plan budget (limits as of writing; check Cloudflare's pricing page)

- Static asset requests are free and unlimited.
- Worker + DO requests: 100k/day. Inbound WebSocket messages count 1:20, so one moving player sending 20 Hz state is about 3.6k requests per hour, roughly 28 player-hours per day. Standing still sends nothing, and the Join screen polls the lobby list every 5 s (about 1.4k requests/hour while open).
- DO duration: 13k GB-s/day. A room costs 0.125 GB × wall-clock while anyone is connected, about 29 room-hours per day.
- If a limit is hit, new requests fail until the daily reset. The $5/mo Workers Paid plan lifts all of this.
- Already done: 20 Hz send (the server only relays 20 Hz), no send when state is unchanged. Next if needed: binary encoding, batching, slower lobby polling.

## Not done yet

- Per-account stats / leaderboards (accounts themselves exist, see above).
- Server-authoritative movement. Netcode is still client-authoritative (see CLAUDE.md).
- Turnstile on lobby creation. Hosting is rate-limited per address (`Directory.allocate`), but a botnet could still reserve codes.

## Accounts (username + password)

Accounts are deliberately simple, for a group of friends. One global `Accounts` Durable Object (`src/server/accounts.ts`, logic in `accountStore.ts`) stores users and sessions in its own storage, so there is no database to set up and it works on the free plan.

- `POST /api/register`, `POST /api/login`, `POST /api/logout`, `GET /api/me`. Same-origin JSON only.
- Passwords: PBKDF2-SHA256, 100k iterations (the workerd maximum), a random salt per user. Hashing runs inside the Durable Object because a free-plan Worker only gets about 10 ms of CPU per request and a Durable Object gets far more.
- Sessions: a random 256-bit token in an HttpOnly, SameSite=Lax cookie (`gambol_session`, Secure on https), 30 days. Only a hash of the token is stored. Five wrong passwords lock that username for 30 seconds.
- In a lobby the Worker looks the cookie up: signed in means you play as your username whatever the client sends; a guest who types a registered name becomes "name (guest)".
- Usernames are 3-16 letters, numbers, `_` or `-`, unique ignoring case. Passwords are 6-72 characters.
- Adding the `Accounts` class is migration `v2` in `wrangler.jsonc`; the next deploy applies it. Nothing is lost on later deploys.
- `POST /api/password` (signed in, `{current, password}`): changes your password from the Account screen. Every other session is signed out; this browser gets a fresh one.
- Not built: email, stats per account.

### Resetting a friend's forgotten password

There's no email, so a reset goes through Michael. Once, set a long random admin key as a Worker secret (the route doesn't exist until you do, or if the key is under 32 characters):

```bash
openssl rand -hex 32               # copy the output
npx wrangler secret put ADMIN_KEY  # paste it (or Cloudflare dashboard -> the Worker -> Settings -> Variables and Secrets, type Secret)
```

Then, for a friend who forgot theirs:

```bash
curl -X POST https://gambol.lol/api/admin/reset-password \
  -H "Authorization: Bearer <ADMIN_KEY>" -d '{"username":"their-name"}'
# {"ok":true,"name":"TheirName","password":"xjptxvq9c2bg"}
```

Send them the temporary password; they sign in and change it under Account -> Change password. The reset signs the account out everywhere and keeps everything else (coins, garage, friends, best times). Locally, put `ADMIN_KEY=...` in `.dev.vars` (gitignored) and use `http://localhost:5173`.

### Clearing TŌGE best times set in races

Since 2026-11-06 only time trials and hill climbs keep best times. Times from before that don't say which mode they came from, so the same key can wipe every best time, all-time board and record ghost on every track a race can run (hill-climb tracks are kept: they only ever ran item-free). Preview first, then apply:

```bash
curl -X POST https://gambol.lol/api/admin/clear-race-records -H "Authorization: Bearer <ADMIN_KEY>"
# {"ok":true,"applied":false,"tracks":[...],"bests":[{"user":"mike","tracks":["koripass"]}],"boards":{...},"ghosts":[...]}
curl -X POST https://gambol.lol/api/admin/clear-race-records -H "Authorization: Bearer <ADMIN_KEY>" -d '{"apply":true}'
```

Guests' own bests live in their browsers and aren't touched (they never reach the boards).
