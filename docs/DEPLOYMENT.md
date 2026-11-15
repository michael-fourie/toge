# Deployment: Cloudflare, all-in-one, free tier

One Worker serves the built client (static assets) and the multiplayer backend. No VM, no separate hosting.

```
browser ── https://kanjo.win/            → static assets (dist/client), free and unmetered
        ── GET  /api/races              → Worker → Directory DO "race" (open race lobbies)
        ── /api/me, /api/login, ...     → Worker → Accounts DO "all" (accounts, garages, best times, friends)
        ── WS   /ws?game=race&code=ABCD → Worker → RaceRoom DO "ABCD" (one per race)
        ── WS   /ws?game=race           → Worker asks Directory for a fresh code, creates RaceRoom near the host
```

- `src/server/worker.ts`: routing, origin check, region hint (`locationHint` from the host's continent), admin routes.
- `src/kanjo/server/raceroom.ts`: the `RaceRoom` Durable Object, wrapping `race.ts` (runtime-agnostic). It exists while someone is connected.
- `src/server/directory.ts`: the `Directory` DO: allocates 4-letter codes, lists lobbies, expires entries that stop sending heartbeats.
- `src/server/accounts.ts`: the `Accounts` DO (one, named "all"): users, sessions, garages, best times, boards, ghosts, friends.
- `wrangler.jsonc`: Worker name, assets, bindings, the migration. Classes must be `new_sqlite_classes` to be allowed on the free plan.

## Dev and deploy

```bash
npm run dev       # vite + the Cloudflare plugin runs the Worker and DOs locally (workerd) on :5173; needs Node 20+
npm run deploy    # typecheck, vite build, wrangler deploy
```

## Going live (one-time setup, about 15 minutes)

1. **Create the Worker from this repo.** Cloudflare dashboard, Workers & Pages, Create, Import a repository, pick
   `michael-fourie/toge`. Build command `npm run build`, deploy command `npx wrangler deploy` (the defaults it
   suggests). The Worker is named `kanjo` (`wrangler.jsonc`); it comes up at `https://kanjo.<account>.workers.dev`.
2. **Production branch = `production`.** The Worker, Settings, Build, Branch control: set the production branch to
   `production`, and untick builds for non-production branches (each preview uses 3 Durable Object namespaces, and
   the free plan allows 100 per account, which Gambol's previews already use most of). Then run the "Deploy to
   production" Action once by hand (tick "even if people are playing") to create `production` and ship it.
3. **Admin key.** `openssl rand -hex 32`, then the Worker, Settings, Variables and Secrets, Add, type Secret, name
   `ADMIN_KEY` (or `npx wrangler secret put ADMIN_KEY`). The admin routes don't exist without it.
4. **GitHub settings** (repo, Settings, Secrets and variables, Actions): variable `SITE_URL` = the live site (the
   workers.dev URL now, kanjo.win later), used by the nightly deploy to see if anyone is racing.
5. **Copy the accounts from Gambol** (below), then **add the domain** (Custom domain, below).

## Moving the accounts over from Gambol (one time)

Everything signed-in players have lives in one Durable Object, `Accounts` "all", on Gambol's Worker (atrous):
usernames and password hashes, garages (cars, upgrades, cosmetics, race money, the battle pass, drivers), best times,
the all-time boards and record ghosts, "your time was beaten" notices and friend lists. The copy moves every key of it
across unchanged, so everyone signs in on the new site with the same username and password and finds everything
where they left it. (Guests keep their garage in their browser, per site, so a guest's garage can't come along: tell
guests to make an account on Gambol before the move.)

How: Gambol has a read-only `POST /api/admin/export` and this site has `POST /api/admin/import`, both behind each
site's own `ADMIN_KEY`. `tools/copy-accounts.mjs` reads Gambol page by page (50 keys at a time), empties this site's
Accounts object, writes every page, then reads this site back and checks that every key and value is identical (it
fails loudly if not). Each run starts from empty, so run it again right before you switch players over and the last
run wins.

1. Gambol needs the export route live (atrous PR "Admin export route", merged 2026-11-14; it ships with the next
   nightly deploy, or run atrous's "Deploy to production" Action) and its `ADMIN_KEY` secret set.
2. Here: secrets `FROM_ADMIN_KEY` (Gambol's key) and `TO_ADMIN_KEY` (this Worker's key), variable `TO_URL` (this
   site; `FROM_URL` defaults to `https://gambol.lol`).
3. Actions, "Copy accounts from Gambol", Run workflow with "Only read" ticked: it counts accounts, garages, best times
   and so on without writing. Then run it again unticked: it copies and prints "Copy matches exactly".

Or from a terminal: `FROM=https://gambol.lol FROM_KEY=... TO=https://... TO_KEY=... node tools/copy-accounts.mjs`
(`DRY_RUN=1` to only count). Anything players do on Gambol after the last run isn't copied, so do the final run when
you announce the move (or put a notice on Gambol's TŌGE channel pointing at the new domain).

## When deploys happen (why races used to "crash" at random)

Every deploy restarts all Durable Objects, and a restart closes every WebSocket: everyone in a race is dropped at the
same moment. When Workers Builds deployed every push to master, a day of merges looked like the game crashing at random.

So production deploys from its own branch, `production`, and `.github/workflows/deploy.yml` moves it to master:

- every hour from 09:00 to 14:00 UTC (1-6 am Pacific), only when master has something new and `/api/races` shows
  nobody racing (solo time trials count);
- by hand: GitHub, Actions, "Deploy to production", Run workflow (tick "even if people are playing" to skip the check),
  or `git push origin master:production` for an urgent fix.

## Custom domain (domain registered at Namecheap)

1. Cloudflare dashboard, Add a site, enter the domain, choose the Free plan.
2. Namecheap, Domain List, Manage, Nameservers, "Custom DNS": enter the two Cloudflare nameservers. Propagation takes minutes to a few hours.
3. The `kanjo` Worker, Settings, Domains & Routes, Add, Custom domain: pick `kanjo.win` (and `www.kanjo.win`). Cloudflare creates DNS and TLS automatically.

## Free-plan budget (limits as of writing; check Cloudflare's pricing page)

- Static asset requests are free and unlimited.
- Worker + DO requests: 100k/day. Inbound WebSocket messages count 1:20, so a racer sending 20 Hz state is about 3.6k requests per hour, roughly 28 racer-hours per day. The Race page polls the lobby list every 3 s while it's open.
- DO duration: 13k GB-s/day. A room costs 0.125 GB × wall-clock while anyone is connected, about 29 room-hours per day.
- If a limit is hit, new requests fail until the daily reset. The $5/mo Workers Paid plan lifts all of this.

## Accounts (username + password)

Accounts are deliberately simple, for a group of friends. One global `Accounts` Durable Object (`src/server/accounts.ts`, logic in `accountStore.ts`) stores users and sessions in its own storage, so there is no database to set up and it works on the free plan.

- `POST /api/register`, `POST /api/login`, `POST /api/logout`, `GET /api/me`. Same-origin JSON only.
- Passwords: PBKDF2-SHA256, 100k iterations (the workerd maximum), a random salt per user. Hashing runs inside the Durable Object because a free-plan Worker only gets about 10 ms of CPU per request and a Durable Object gets far more.
- Sessions: a random 256-bit token in an HttpOnly, SameSite=Lax cookie (`kanjo_session`, Secure on https), 30 days. Only a hash of the token is stored. Five wrong passwords lock that username for 30 seconds.
- In a race lobby the Worker looks the cookie up: signed in means you play as your username whatever the client sends; a guest who types a registered name becomes "name (guest)".
- Usernames are 3-16 letters, numbers, `_` or `-`, unique ignoring case. Passwords are 6-72 characters.
- The `Accounts` class is in migration `v1` in `wrangler.jsonc`. Nothing is lost on later deploys.
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
curl -X POST https://<your site>/api/admin/reset-password \
  -H "Authorization: Bearer <ADMIN_KEY>" -d '{"username":"their-name"}'
# {"ok":true,"name":"TheirName","password":"xjptxvq9c2bg"}
```

Send them the temporary password; they sign in and change it under Account -> Change password. The reset signs the account out everywhere and keeps everything else (garage, race money, friends, best times). Locally, put `ADMIN_KEY=...` in `.dev.vars` (gitignored) and use `http://localhost:5173`.

### Clearing KANJO best times set in races

Since 2026-11-06 (still on Gambol's site) only time trials and hill climbs keep best times. Times from before that don't say which mode they came from, so the same key can wipe every best time, all-time board and record ghost on Kōri Pass, Saltwind Cliffs and Red Mesa Rally (`CLEAR_TRACKS` in src/server/accounts.ts, Michael's pick); every other track keeps its times. Preview first, then apply:

```bash
curl -X POST https://<your site>/api/admin/clear-race-records -H "Authorization: Bearer <ADMIN_KEY>"
# {"ok":true,"applied":false,"tracks":[...],"bests":[{"user":"mike","tracks":["koripass"]}],"boards":{...},"ghosts":[...]}
curl -X POST https://<your site>/api/admin/clear-race-records -H "Authorization: Bearer <ADMIN_KEY>" -d '{"apply":true}'
```

Guests' own bests live in their browsers and aren't touched (they never reach the boards).
