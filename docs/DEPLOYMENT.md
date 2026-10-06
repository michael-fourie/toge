# Deploying & running Atrous (for free)

> Plan, not implementation. Free-tier facts verified October 2026; they change often, so re-check the linked pages before committing to one.

## TL;DR

| | Recommendation | Cost |
| --- | --- | --- |
| **Phase 0: friends, today** | Run `npm run build && npm start` on your own PC and expose it with a **Cloudflare Tunnel**. Zero code changes. | $0 |
| **Phase 1: always-on public alpha** | One **Oracle Cloud Always Free** Arm VM running the existing Node server (client + `/ws`), behind a **Cloudflare Tunnel** (or Caddy) for TLS. Static client optionally on **Cloudflare Pages**. | $0 (plus ~$10/yr if you want your own domain) |
| **Fallback (no card / Oracle won't give you capacity)** | **Render free web service** with the binary protocol. Playtests only: 5 GB/month egress and ~1 min cold starts. | $0 |
| **Phase 2: scale / global** | Port `Lobby` to **Cloudflare Durable Objects** (one object per lobby) on Workers Paid, or add cheap VMs per region (e.g. Hetzner). | ~$5/mo + ~1–2¢ per full-lobby-hour |

**Why Oracle + Tunnel.** Our server is a long-lived, chatty WebSocket process with in-memory lobbies. That's the worst shape for "free PaaS": those platforms sleep, cap egress at a few GB, or bill per message. An always-on VM with **10 TB/month** egress fits the code as it is today. Cloudflare Tunnel gives TLS and WebSockets with no open ports and no egress bill.

**Main caveats:**
- Oracle needs a credit card for verification.
- Free Arm capacity is often "out of capacity" in popular regions.
- Free instances can be **reclaimed if idle**.
- The Always Free Arm allowance was **halved in June 2026** (now 2 OCPU / 12 GB).

---

## 1. What we're deploying

- **Client:** Vite static build (`dist/`, ~160 kB gzipped JS). Any static host works.
- **Server:** `src/server/index.ts`, a Node 18+ process on `PORT` (default 3001). It serves `dist/` *and* WebSockets at `/ws`. Lobbies live **in memory**, so one process holds all lobbies and a restart drops them.
- **Traffic shape** (from `NET` in `src/shared/constants.ts` and `src/shared/protocol.ts`):
  - Client → server: `state` messages at **30 Hz**.
  - Server → each client: `snapshot` at **20 Hz** (JSON, one entry per living player).
  - Up to **12 players per lobby**.
- The client connects to `` `${proto}://${location.host}/ws` `` (in `Net.open`, `src/client/net.ts`), so today client and server must share an origin.

### Bandwidth math (the number that decides hosting)

| Message | Approx. size (JSON) | Rate | Per player |
| --- | --- | --- | --- |
| `state` (client → server) | ~100 B incl. WS framing | 30 Hz | ~3 KB/s up |
| one player entry in `snapshot` | ~85 B (`{"id":3,"p":[x,y,z],"v":[…],"yaw":…,"pitch":…,"f":2}`) | n/a | n/a |
| `snapshot` for 12 players | ~1.05 KB | 20 Hz | **~21 KB/s down** |

- **Full 12-player lobby, server egress:** 12 × 21 KB/s ≈ **250 KB/s ≈ 0.9 GB per lobby-hour**.
- **With a binary snapshot** (u8 id, 3×f32 pos, 3×i16 vel, 2×i16 angles, u8 flags ≈ 24 B/player): 12 players ≈ 300 B → **~6 KB/s per client**, **~0.25 GB per full-lobby-hour** (3.5× less). Adding delta-compression later roughly halves it again.
- **CPU:** today the server only relays, which costs microseconds per message, and `broadcast()` already stringifies once per snapshot. Even with a server-authoritative sim (running `stepPlayer` at 64–128 Hz per player), a single modern core handles several hundred players. **Bandwidth runs out long before CPU.**

---

## 2. Hosting options compared

### Game server (long-lived WebSockets)

| Host | Actually free? | Sleeps? | WebSockets | Egress | Card | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **Oracle Cloud Always Free** ([limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm)) | Yes, permanent. Arm A1: **1,500 OCPU-h + 9,000 GB-h/mo ≈ 2 OCPU / 12 GB** (halved June 15 2026, [InfoQ](https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)). Plus 2× AMD E2.1.Micro (1/8 OCPU, 1 GB, 50 Mbps). | No, but **idle instances may be reclaimed**: over 7 days, 95th-percentile CPU < 20% *and* network < 20% *and* (A1) memory < 20%. | Full VM, anything goes | **10 TB/mo** | Required (verification) | ✅ **Primary.** Fits our code unchanged. Gotchas: home-region-only, A1 capacity shortages, idle reclaim, Oracle's own iptables rules on Ubuntu images. |
| **Render free web service** ([docs](https://render.com/docs/free)) | Yes. 750 instance-hours/workspace/month. | **Spins down after 15 min** without HTTP *or* WS messages (WS messages count since [Feb 2026](https://render.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages)). ~1 min spin-up. | Yes | **5 GB/mo** on Hobby since Aug 1 2026 ([review](https://jwatte.com/blog/render-com-platform-review.md)), then $0.15/GB or suspension | No | ⚠️ **Fallback / playtests.** ~5 lobby-hours/month with JSON, ~20 with binary. Restarts wipe lobbies. |
| **Koyeb free instance** ([instances](https://www.koyeb.com/docs/reference/instances), [scale-to-zero](https://www.koyeb.com/docs/run-and-scale/scale-to-zero)) | Yes, 1 per org: 512 MB, **0.1 vCPU**, Frankfurt or Washington only. | Scales to zero after **1 h** with no traffic. Open WebSockets keep it awake. 1–5 s wake. | Yes | Not clearly stated for the free instance | **Required** ($29 pre-auth) | ⚠️ OK for tiny sessions. 0.1 vCPU becomes tight once the server simulates movement. |
| **Google Cloud Run** ([WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)) | Free tier of 2M requests, 180k vCPU-s, 360k GiB-s per month. | Scales to zero (cold starts). | Yes, but **max 60 min per connection**; needs reconnect logic and session affinity. | ~1 GB/mo free (North America) ([comparison](https://flaviocopes.com/hosting-free-tiers.md)) | Required | ❌ An always-connected game burns the vCPU-seconds and the tiny egress fast. Multi-instance also breaks in-memory lobbies. |
| **Fly.io** | ❌ **No free allowance for new orgs**: 2 h / 7-day trial, then pay-as-you-go ([source](https://snapdeploy.dev/blog/leaving-flyio-after-free-tier)) | No (stopped machines cost $0) | Excellent, multi-region | Paid | Required | 💲 Best *paid* PaaS for multi-region game servers. ~$2/mo per 256 MB machine plus bandwidth. |
| **Railway** ([pricing](https://docs.railway.com/reference/pricing)) | $5 one-time trial, then a "Free" plan with **$1/mo of credit** (0.5 GB RAM) | No | Yes | Billed from credit | Trial: no | ❌ $1/month of credit isn't enough to run a 24/7 process. Hobby is $5/mo. |
| **Cloudflare Workers + Durable Objects** ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing)) | Free plan: **100k requests/day, 13k GB-s/day**. Paid ($5/mo): 1M requests + 400k GB-s/mo included. | Hibernates when idle (not while we tick at 20 Hz) | Yes, 1 DO = 1 lobby is a natural fit. **Outgoing messages are free**; incoming WS messages count as requests at 20:1. | **No egress fees** | Free: no | 🔁 **Phase 2 candidate.** Needs a port of `lobby.ts` (`setInterval` → alarm/tick, `ws` → `WebSocketPair`). The free plan only covers ~1–2 full lobby-hours/day. |
| **Deno Deploy** | Free: 1M requests, 100 GB egress/mo (figures vary by source) | Idle isolates shut down after ~20–30 s | Supported, but no long-lived in-memory state across isolates | n/a | No | ❌ Edge isolates don't fit a stateful tick loop. |
| **Home PC + Cloudflare Tunnel** ([Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)) | Yes | Only when your PC is off | Yes (Cloudflare proxies WebSockets on all plans) | Your home upload: ~2 Mbit/s per full 12-player lobby with JSON, ~0.6 Mbit/s with binary | No | ✅ **Phase 0.** Quick Tunnels need no account (random `*.trycloudflare.com` URL, 200 in-flight request cap, no SLA). Named tunnels need a domain on Cloudflare. |

### Static client (optional split)

The server already serves `dist/`, so a separate static host is **optional**. It's worth doing in Phase 1+ because then the menu loads instantly from a CDN even while the game server is waking up or restarting.

| Host | Free tier | Notes |
| --- | --- | --- |
| **Cloudflare Pages** | Unlimited static bandwidth, 500 builds/mo ([limits summary](https://temps.sh/blog/cloudflare-pages-free-tier-limits-2026)) | ✅ Recommended. Same account as the Tunnel and DNS. |
| GitHub Pages | Free for public repos | Fine. Needs a build workflow, and there are no custom headers. |
| Netlify / Vercel | Free (credit-based / 100 GB) | Fine, nothing extra gained. |

---

## 3. How multiplayer should work in production

### 3.1 Lobbies & matchmaking

- **Single instance first.** Keep the current model: 4-letter codes, an in-memory `Map<code, Lobby>`, and a lobby list from that map. With 10 TB of egress and ~0.25–0.9 GB per lobby-hour, one VM hosts **dozens of concurrent full lobbies**. Don't build distributed matchmaking before you need it.
- **Quick Play** (later): "join the fullest non-full public lobby, else create one". It's one function in `index.ts`.
- **Lobby settings** are owned by the host (map, max players, private/public). Store them on `Lobby` and send them in `joined`.
- **When scaling to more than one instance or region:**
  - Encode the region or instance in the lobby code, e.g. `F-ABCD` for Frankfurt. The client can then connect straight to the right host, and no shared state is needed for joins-by-code.
  - The lobby list becomes an aggregate. Each instance publishes `{code, players, region}` every few seconds to a tiny registry: a Durable Object, Upstash Redis free tier, or just an HTTP endpoint on a "directory" instance.
  - Show ping per region in the browser by timing a `GET /health` against each region.

### 3.2 Region & latency

- Oracle Always Free resources **must be in your home region**, and that choice is permanent. Pick the region closest to the expected players, e.g. `eu-frankfurt-1` for Europe or `us-ashburn-1` for the US East Coast.
- Movement feel is client-predicted, so up to ~120 ms RTT is playable. Hitscan fairness is what latency hurts; see lag compensation below.

### 3.3 Reconnection

- On `joined`, the server issues a random **session token**, and the client keeps it in `sessionStorage`.
- On socket drop, the server keeps the member for **~15 s** marked `disconnected`, so its slot, score and colour are kept.
- The client auto-reconnects with backoff (0.5 s, 1 s, 2 s, …) and sends `{t:'resume', token}`. The server reattaches it and sends a fresh `joined`.
- Also needed for Cloud Run's 60-min cap and for server deploys: send a "server restarting" notice and let clients reconnect to the new process.

### 3.4 Server-authoritative movement (roadmap)

The code is already built for this: `stepPlayer` in `src/shared/movement.ts` is deterministic and shared.

1. **Inputs, not positions.** The client sends `{seq, forward, right, jump, jumpPressed, slide, yaw, pitch}` per sim tick, batched 2–4 ticks per message, so a 128 Hz sim needs ~32–64 messages/s, which is tiny in binary.
2. **The server simulates.** Each member gets a `PlayerState` stepped with the same `TICK_DT` and map. The server tick runs at 64 or 128 Hz. Snapshots stay at **20–30 Hz** and include `lastProcessedSeq` per player.
3. **Prediction and reconciliation on the client.**
   - The local player keeps predicting exactly as now.
   - On each snapshot, the client resets to the server state for its own player and replays any unacknowledged inputs.
   - Small errors (< 5 cm) get smoothed rather than snapped.
4. **Remote players** stay interpolated 100 ms behind, as today.
5. **Tunables.** In online lobbies `MOVE` must come from the server (send it in `joined`), and the lil-gui panel becomes host-only or practice-only.

### 3.5 Lag compensation (hitscan)

- The server keeps a **ring buffer of player poses** (1 s of history, one entry per server tick).
- A `shoot` message carries the client's render time for remotes: `now - interpDelay`, expressed in server time via a clock offset from ping/pong.
- The server rewinds victims to that time (capped at 200–250 ms), then raycasts with the **shared** `rayWorld` / `raySphere` / `rayBox`. It's the same code the client uses today, so results agree.
- Until then, today's "favour the shooter with a distance sanity check" is acceptable for friends.

### 3.6 Anti-cheat basics (cheap and effective)

- Server-side fire rate (already present), **ammo and reload on the server**, and server-side respawn timing (already present).
- Before authoritative movement lands, clamp position deltas: reject teleports larger than `maxSpeed × dt × 1.5`.
- **Rate-limit messages** per socket (e.g. drop above 2× the expected Hz), set `maxPayload` on `WebSocketServer` (e.g. 4 KB), and validate every field's type and range (names are already sliced).
- Check the `Origin` header against an allow-list, and use a protocol version in `hello` to reject stale clients after a deploy.
- Never trust `victim`/`headshot` once lag compensation exists: the server decides.

### 3.7 Wire protocol & rates

- Move from JSON to a **binary `ArrayBuffer` protocol** in `src/shared/protocol.ts`: a `DataView` encoder/decoder pair shared by both sides, with a 1-byte message type. Keep JSON for rare messages (`joined`, `kill`, `error`) if convenient.
- Rates: client inputs at 64 Hz (batched), snapshots at 20 Hz now and 30 Hz once binary.
- **Interest management** isn't needed at 12 players. If lobbies grow, send far or occluded players at a lower rate, and delta-compress against the last acknowledged snapshot.

### 3.8 When a free host sleeps (wake-up UX)

This applies to Render/Koyeb fallbacks. Oracle never sleeps.

1. Host the client statically (Cloudflare Pages), so the menu always loads instantly.
2. When opening Host / Join / the lobby list, `fetch(SERVER/health)` with a 2 s timeout.
3. If it fails or is slow, show the existing storybook loader with a line like *"Waking the island spirits… (servers nap when nobody's playing, ~30–60 s)"*, retry with backoff, and enable buttons once `/health` returns `200`.
4. Optional: a free uptime pinger (e.g. UptimeRobot) prevents Render's 15-min sleep, but it also burns the 750 instance-hours (that's ~31 days, so one service can stay up all month). It does **not** fix the 5 GB egress cap.

---

## 4. Runbook: Phase 1 on Oracle Always Free

### 4.1 Small code changes needed (not made yet)

1. **Configurable server URL** (only for a split static/server deploy). In `src/client/net.ts`:
   ```ts
   const base = import.meta.env.VITE_SERVER_URL // e.g. "wss://play.example.com"
     ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
   const ws = new WebSocket(`${base}/ws`);
   ```
   And in `src/client/env.d.ts`:
   ```ts
   interface ImportMetaEnv { readonly VITE_SERVER_URL?: string }
   ```
   Build with `VITE_SERVER_URL=wss://play.example.com npm run build`. Unset, it behaves exactly as today.
2. **Health endpoint.** In `src/server/index.ts`, before static serving: if `url.pathname === '/health'`, respond `200` with `{ ok: true, lobbies, players, uptime }` and an `Access-Control-Allow-Origin` header.
3. **Hardening:**
   - `new WebSocketServer({ server: http, path: '/ws', maxPayload: 4096 })`.
   - An optional `ALLOWED_ORIGINS` env var checked in the connection handler.
   - A `SIGTERM` handler that tells lobbies "server restarting" before exit.

### 4.2 Create the VM

1. Sign up at Oracle Cloud. A card is needed for verification; Always Free resources are never billed. **Choose the home region carefully: it's permanent.**
2. Optional but recommended: upgrade the tenancy to **Pay As You Go**. Always Free resources stay $0, and the community widely reports that PAYG tenancies aren't subject to idle reclamation and get A1 capacity more easily. Verify this yourself, and set a **budget alert at $1**.
3. Compute → Create instance: **Ubuntu 24.04**, shape **VM.Standard.A1.Flex**, **2 OCPU / 12 GB** (or 1 / 6 to leave headroom). Upload your SSH key. If you get "Out of host capacity", retry another availability domain or later.
4. Networking: if you use Cloudflare Tunnel, **open no inbound ports** besides SSH (22). If you use Caddy instead, add ingress rules for TCP 80 and 443 to the subnet's Security List, **and** allow them in the VM's iptables, because Oracle's Ubuntu images ship restrictive rules:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

### 4.3 Install & run

```bash
# Node 22 LTS (lets you drop the Node 18 pins later)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs git
git clone https://github.com/<you>/atrous.git && cd atrous
npm ci && npm run build
```

`/etc/systemd/system/atrous.service`:

```ini
[Unit]
Description=Atrous game server
After=network-online.target

[Service]
WorkingDirectory=/home/ubuntu/atrous
Environment=PORT=3001
ExecStart=/usr/bin/npx tsx src/server/index.ts
Restart=always
RestartSec=2
User=ubuntu

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now atrous
journalctl -u atrous -f      # logs
```

### 4.4 TLS + domain

**Option A: Cloudflare Tunnel (recommended).** No open ports, hides the VM's IP, free TLS, and WebSockets just work.

```bash
# on the VM (arm64 build)
curl -L -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb
cloudflared tunnel login                     # needs a domain on your Cloudflare account
cloudflared tunnel create atrous
cloudflared tunnel route dns atrous play.example.com
# ~/.cloudflared/config.yml:
#   tunnel: atrous
#   credentials-file: /home/ubuntu/.cloudflared/<id>.json
#   ingress:
#     - hostname: play.example.com
#       service: http://localhost:3001
#     - service: http_status:404
sudo cloudflared service install
```

No domain yet? `cloudflared tunnel --url http://localhost:3001` gives a free random `*.trycloudflare.com` URL. It's good for Phase 0 or testing; the URL changes on every restart.

**Option B: Caddy.** Needs a domain or a free DuckDNS name pointed at the VM, plus ports 80/443 open. `/etc/caddy/Caddyfile`:

```
play.example.com {
  reverse_proxy localhost:3001
}
```

Caddy handles Let's Encrypt and WebSocket upgrades automatically.

### 4.5 Static client on Cloudflare Pages (optional split)

- Pages project → connect the GitHub repo.
- Build command: `npm run build`. Output: `dist`. Environment: `NODE_VERSION=22` and `VITE_SERVER_URL=wss://play.example.com`.
- Point `atrous.example.com` (or `*.pages.dev`) at it. The server keeps serving `dist/` too, so both entry points work.

### 4.6 CI/CD (GitHub Actions)

Actions minutes are unlimited for public repos and 2,000/month for private ones ([GitHub](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/)).

`.github/workflows/deploy.yml` (sketch):

```yaml
on: { push: { branches: [main] } }
jobs:
  test-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci && npm run build && npm test
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VM_HOST }}
          username: ubuntu
          key: ${{ secrets.VM_SSH_KEY }}
          script: cd atrous && git pull --ff-only && npm ci && npm run build && sudo systemctl restart atrous
```

With Cloudflare Tunnel and no SSH port open, either SSH through the tunnel (`cloudflared access ssh`) or use a self-hosted runner on the VM. Self-hosted runner minutes are free.

Restarts drop live lobbies. Until reconnection (§3.3) exists, deploy at quiet times or make the deploy step wait until `/health` reports 0 players.

### 4.7 Monitoring (free)

- **Uptime:** UptimeRobot (or Better Stack) free plan pinging `https://play.example.com/health` every 5 min. This also generates the network activity that helps against Oracle's idle-reclaim heuristics.
- **Logs:** `journalctl -u atrous`. Log one line per lobby create/close, plus a 1-minute summary of `{lobbies, players, bytesOut}`.
- **Budget:** an Oracle budget alert at $1, and a Cloudflare usage notification if you're on Workers.

---

## 5. Phased roadmap

| Phase | Goal | Setup | Code work | Cost |
| --- | --- | --- | --- | --- |
| **0: Friends, today** | Play tonight | Your PC: `npm run build && npm start` + `cloudflared tunnel --url http://localhost:3001`. Share the URL. | None | $0 |
| **1: Public alpha** | Always on, a shareable link | Oracle A1 VM + systemd + Cloudflare Tunnel, CI deploy, uptime monitor. Optional Pages for the client. | `/health`, `VITE_SERVER_URL`, `maxPayload`/origin checks, reconnection tokens, binary snapshots | $0 (domain ~$10/yr optional) |
| **1.5: Fair fights** | Trustworthy hits | Same | Server-authoritative movement + prediction/reconciliation, server ammo, lag-compensated hitscan, server-owned `MOVE` | $0 |
| **2: Scale / multi-region** | Many lobbies, players on several continents | **(a)** Port `Lobby` → Durable Objects (global, no egress fees, scales to zero) on Workers Paid, **or (b)** one VM per region + region-coded lobby codes + a tiny directory | Region in lobby codes, aggregated lobby list, ping display | (a) $5/mo + ~1–2¢/full-lobby-hour; (b) Oracle free in 1 region + e.g. [Hetzner CAX11](https://www.whtop.com/amp/plans/hetzner.com/144087) (~€4–6/mo, 20 TB EU traffic) per extra region |

Durable Objects cost estimate for 2(a), with a 12-player lobby, JSON at 30 Hz inbound, using the 20:1 inbound billing ratio:
- **Requests:** ~1.3M inbound messages per hour ≈ 65k billed requests ≈ **$0.01**.
- **Duration:** 128 MB × 3,600 s ≈ 450 GB-s ≈ **$0.006**.

Outgoing snapshots are free. Moving clients to a 20 Hz input rate cuts this further.

### When does it stop being free?

| Trigger | Fix | New cost |
| --- | --- | --- |
| Oracle reclaims the VM, or no A1 capacity | PAYG upgrade (still $0), or Render fallback for a while | $0 |
| More than ~10 TB/month egress (≈ 40k full lobby-hours with binary) | Not a near-term problem | n/a |
| Players on multiple continents complaining about ping | Second region (Hetzner/Fly) or Durable Objects | ~$5/mo |
| Need zero-ops, autoscaling | Durable Objects on Workers Paid | $5/mo base |

---

*Sources are linked inline. Treat free-tier numbers as a snapshot: Oracle halved A1 in June 2026 without notice, Render cut bandwidth 20× in August 2026, and Fly.io ended free allowances for new orgs.*
