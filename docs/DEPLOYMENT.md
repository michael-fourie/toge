# Deployment: Cloudflare, all-in-one, free tier

One Worker serves the built client (static assets) and the multiplayer backend. No VM, no separate hosting.

```
browser ── https://<domain>/            → static assets (dist/client), free and unmetered
        ── GET /api/lobbies             → Worker → Directory DO (registry of open lobbies)
        ── WS  /ws?name=..&code=ABCD    → Worker → LobbyRoom DO "ABCD" (one per match, runs the 20 Hz tick)
        ── WS  /ws?name=..              → Worker asks Directory for a fresh code, creates LobbyRoom near the host
```

- `src/server/worker.ts`: routing, origin check, region hint (`locationHint` from the host's continent).
- `src/server/room.ts`: the `LobbyRoom` Durable Object. Wraps `lobby.ts` (the game logic, runtime-agnostic). It exists while someone is connected.
- `src/server/directory.ts`: one global `Directory` DO: allocates codes, lists lobbies, expires entries that stop sending heartbeats.
- `wrangler.jsonc`: assets, bindings, and the migration. Classes must be `new_sqlite_classes` to be allowed on the free plan.

## Dev and deploy

```bash
npm run dev       # vite + the Cloudflare plugin runs the Worker and DOs locally (workerd); needs Node 20+
npm run deploy    # typecheck, vite build, wrangler deploy
BASE=https://your.domain npx tsx tests/lobby.smoke.ts   # two bots, join/shoot/kill/leave, against a deployment
```

First time: `npx wrangler login`, then `npm run deploy`. That publishes to `https://atrous.<account>.workers.dev`.

## Custom domain (domain registered at Namecheap)

1. Cloudflare dashboard, Add a site, enter the domain, choose the Free plan.
2. Namecheap, Domain List, Manage, Nameservers, "Custom DNS": enter the two Cloudflare nameservers. Propagation takes minutes to a few hours.
3. Worker, Settings, Domains & Routes, Add, Custom domain: pick `domain.com` (and `www`). Cloudflare creates DNS and TLS automatically.

## Free-plan budget (limits as of writing; check Cloudflare's pricing page)

- Static asset requests are free and unlimited.
- Worker + DO requests: 100k/day. Inbound WebSocket messages count 1:20, so one player sending 30 Hz state is about 5.4k requests per hour, roughly 18 player-hours per day.
- DO duration: 13k GB-s/day. A room costs 0.125 GB × wall-clock while anyone is connected, about 29 room-hours per day.
- If a limit is hit, new requests fail until the daily reset. The $5/mo Workers Paid plan lifts all of this.
- Cheap wins when needed: lower the client send rate in `constants.ts`, batch inputs, switch JSON to binary.

## Not done yet

- Accounts (Google sign-in) and a player database (D1). See the plan in the conversation/README roadmap.
- Server-authoritative movement. Netcode is still client-authoritative (see CLAUDE.md).
- Rate limiting and Turnstile on lobby creation. A bot could spam `/ws` host requests; each one reserves a code for ~90 s.
