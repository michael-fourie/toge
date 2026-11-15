# CLAUDE.md

This repo (`kanjo`, private, default branch `master`) is **KANJO**: mountain-pass and circuit racing in the browser,
against AI or friends, with a garage economy (cars, upgrades from crates, cosmetic cases, a battle pass), best times
and all-time boards, friends, Grand Prix cups, battle royale and a free-roam open world. Player-facing docs: `README.md`.

KANJO grew up as a channel of the Gambol game site (github.com/michael-fourie/atrous) and was moved here on 2026-11-14
with its full git history (so `git log` before that date also shows Gambol's shooter and plug-in games, which were
removed in the move commit). Here KANJO is the whole site: the garage is the home page.

## Read the guide for the area you're touching

| Area | Guide |
|---|---|
| The game, all of it: physics, tracks, cars, garage, modes, races, rendering (`src/kanjo`) | `src/kanjo/CLAUDE.md` (and `src/kanjo/client/CLAUDE.md`) |
| The look: menus, brand, colours, type, components | `src/kanjo/DESIGN.md` (the design system; follow it for any screen) |
| The page shell: boot, router, account screen, pad, touch, graphics setting (`src/client`) | `src/client/CLAUDE.md` |
| Pure code shared with the Worker (`src/shared`) | `src/shared/CLAUDE.md` |
| Worker, Durable Objects, netcode, accounts, admin routes, security rules (`src/server`, `src/kanjo/server`) | `src/server/CLAUDE.md` |
| Hosting, deploys, the domain, the account copy from Gambol | `docs/DEPLOYMENT.md` |
| Drivers (Blender pipeline) and the driver creator | `docs/DRIVERS.md`, `docs/DRIVER_CREATOR.md` |
| Tests | `tests/CLAUDE.md` |

## Architecture

```
browser (Vite-built SPA, TypeScript + three.js WebGL)
  src/client/main.ts ── screen router ── garage/home (src/kanjo/client/hub.ts), race lobby (lobby.ts), account
                     └─ ctx.drive() ── src/kanjo/client/racegame.ts (120 Hz car sim, racenet.ts)
        │  imports pure rules from src/kanjo/shared and src/shared (also used by the server)
        │
        │ HTTPS /api/*  +  WebSocket /ws
        ▼
Cloudflare Worker  src/server/worker.ts  (one Worker also serves dist/ as static assets)
  ├─ Directory DO   race lobby codes and the open-lobby list ("race")
  ├─ RaceRoom DO    one per race: src/kanjo/server (race.ts)
  └─ Accounts DO    users, sessions, garages, best times, boards, record ghosts, friends, notices
```

- **`src/kanjo/shared/` is the contract.** Physics, tracks, cars, the economy, game modes and the wire protocol are
  pure, deterministic TypeScript (no three.js, no DOM) used by both sides. Put logic there and test it there.
  `src/shared` holds the few pure pieces the shell and the platform server use (account rules, friends).
- **Layers:** `src/shared` imports neither the game nor the browser shell, and `src/kanjo/shared` never imports three.js
  or browser code (`tests/boundaries.test.ts`).
- **Authority:** driving is client-side (the server sanity-checks it). Race timing, results, best times and every
  payout for signed-in players are server-side. Guests keep their garage in localStorage and run the same shared
  rules locally.
- **Rendering:** plain `THREE.WebGLRenderer` with a bloom/grade post chain. A WebGPU rewrite was tried and reverted
  (too slow): don't bring it back.
- **Hosting:** Cloudflare Workers + Durable Objects on the free plan (`wrangler.jsonc`, `docs/DEPLOYMENT.md`).
  Production deploys from the `production` branch, which `.github/workflows/deploy.yml` moves to master at night when
  nobody is racing: a deploy restarts every Durable Object and drops every live race, so merging to master doesn't deploy.

## Driving mechanics are locked

**Michael locked KANJO's driving on 2026-11-12: "The driving mechanics are perfect right now. Let's lock them so no
other devs change them."** Don't change how any car drives, whoever asks, unless Michael himself asks for that exact
change. That covers handling, grip, drifting, braking, acceleration and gearing, steering, reversing, wall scraping and
hits, the slipstream and slingshot, boost pads, crash damage's effect on driving, car stats/upgrades/tuning effects, and
the pedal curves: `src/kanjo/shared/vehicle.ts`, `draft.ts`, `boost.ts`, `damage.ts`, `carSpec` and the `CARS` numbers
in `cars.ts`, `padPedals`/`trigger` in `src/kanjo/client/input.ts`, and the driving part of the tick in `racegame.ts`.

`tests/kanjo/drivinglock.test.ts` enforces it: it drives every car through a fixed set of moves with the real physics
and compares every number to `tests/kanjo/drivinglock.json`. If it fails, your change altered the driving: undo that
part. **Never regenerate the snapshot to make it pass** (`DRIVING_LOCK=update`) unless Michael asked for the change;
then say so in the PR and quote him. New tracks, modes, cars' looks, AI tweaks that leave the cars' physics alone, and
new cars (add the car, then regenerate only to add its entry, leaving every other car's numbers unchanged) are fine.
The `Driving lock` GitHub check runs the same test on every PR, and `.github/CODEOWNERS` asks Michael to review these files.

## Repo layout

```
src/kanjo/     the game: shared/ (physics, tracks, cars, garage, protocol), client/ (racegame.ts, hub.ts and friends),
              server/ (RaceRoom, race, the garage and record stores)
src/client/   the page shell: main.ts, menu/ (router, ui kit, account screen), account.ts, pad, touch, graphics
src/server/   the Worker and the platform Durable Objects (Directory, Accounts), rooms.ts, limiter.ts
src/shared/   pure code the shell and the server share (account rules, friends)
tests/        node:test files, run by an explicit list in package.json: kanjo/ for the game, the rest at the top
dev/          dev-only labs served by Vite: cars.html, cosmetics.html, drivers.html, race.html, scenery.html;
              backdrops.py paints the sky backdrops
tools/        drivers/ (the Blender driver pipeline, docs/DRIVERS.md); copy-accounts.mjs (the one-time copy from Gambol)
docs/         DEPLOYMENT, SECURITY, DRIVERS, DRIVER_CREATOR
public/       _headers (security headers), models/drivers (driver GLBs, built by tools/drivers), race/backdrops,
              draco/ (GLB decoder), favicon/icons/og-image.png/site.webmanifest (meta tags in index.html)
wrangler.jsonc  Worker config: name, assets, Durable Object bindings, migrations, previews
```

## Renaming the game

The game is called Kanjo (renamed from TŌGE; live at kanjo.win). The menus read it from `GAME` in `src/kanjo/client/brand.ts`
(logo, garage label, player card). Also change: `index.html` (title and meta tags), `public/site.webmanifest`,
`public/og-image.png` and the icons (the 峠 hanko), `README.md`, and if you like the Worker `name` in
`wrangler.jsonc` (a new name is a new Worker: do it before going live). In-world signage (trackside banners in
`scenery.ts`, car decals in `carparts.ts`, the "KANJO Works" sponsor decal in `cosmetics.ts`) says KANJO too; those are
props, change them if you want. localStorage keys are still `atrous.*` (per site, invisible to players): leave them.

## Commands

```bash
npm ci             # install (Node 20+, 22 recommended)
npm run dev        # Vite + Cloudflare plugin: client and Worker/Durable Objects locally on :5173
npm test           # node:test via tsx; files are listed explicitly in package.json
npm run typecheck  # tsc for client+shared (tsconfig.json) and for server+shared with Workers types (tsconfig.worker.json)
npm run build      # typecheck + vite build -> dist/
npm run deploy     # build + wrangler deploy (Michael's Cloudflare account; don't run it unless asked)
```

Vite is pinned to 6 for the Cloudflare plugin; TypeScript is 5.9. Development is mostly on Windows: npm scripts don't
expand globs, so add each new test file to the `test` script by name. GitHub runs `CI` (tests + build) and
`Driving lock` on every PR.

## Conventions

- Units are metres and seconds, Y up, yaw 0 looks down -Z (three.js convention).
- TypeScript is strict (`noUnused*` on). Match the surrounding style: short doc comments that explain *why*, and named
  constants. Every tunable lives in a constants block (`ARCADE`, `RACE`, `CPU`, …), not as a magic number in logic.
- No new dependencies without a strong reason. The runtime dep is `three`; wrangler and @cloudflare/vite-plugin are dev deps.
- Every physics change gets a test (and see the driving lock above).
- Never trust the client for anything that pays or decides a result; never put player names into HTML strings. Details: `src/server/CLAUDE.md`.
- Mobile styles and input live under `html.touch` / `IS_TOUCH` only; desktop paths never change for mobile.
- **Line endings are mixed.** Some files are CRLF (this file, many files in `src/kanjo/`, `worker.ts`, `wrangler.jsonc`, `package-lock.json`, …), most are LF. Keep each file's existing endings: tools that rewrite text (e.g. Python text mode) silently convert CRLF to LF and make whole-file diffs. Check with `git ls-files --eol <file>`.

## Contributing

Several people (and their Claudes) work on this at once. To keep that smooth:

1. **Branch from `master`**, one feature per branch, and open a PR against `master`. Don't push to `master` directly
   and don't commit unless the person you're working for asks.
2. **Stay in your lane.** Give each parallel task clear file ownership; keep each test area in its own file.
3. **Before opening a PR:** `npm test` and `npm run typecheck` green, and for anything visual, check it in the browser
   (`src/kanjo/CLAUDE.md`).
4. **Keep the docs true.** If you change how something works, update the CLAUDE.md for that area in the same PR, and
   `docs/` for deployment or security.
5. Prefer small, exact edits over rewrites; delete dead code instead of leaving it switched off.

## Status and known gaps

- **Security:** see `docs/SECURITY.md` for what's checked where and what's left (e.g. no `script-src` CSP).
- **Netcode is a prototype:** client-authoritative driving, JSON messages. The upgrade path is in `src/server/CLAUDE.md`.
- **Accounts** are username/password only. A forgotten password goes through the admin reset (docs/DEPLOYMENT.md).
- **Leftovers from Gambol:** `src/client/styles.css` still holds the old site's shell styles, most of them unused now
  (the KANJO screens bring their own CSS). Prune it when convenient; check the account screen and toasts after.
- **Tooling:** the Cloudflare Vite plugin is on Vite 6; Vite 8 is possible now that Node 20+ is required.
