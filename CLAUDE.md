# CLAUDE.md

This repo (`atrous`, private, default branch `master`) is **Gambol**: a browser game site for a group of friends.
The home page is a console-style **game chooser** with these channels:

1. **Gambol**: a multiplayer movement shooter. Think CS:GO Combat Surf with bhop, surf, slide, wallrun and a
   grapple, on Ghibli-style sky islands. Modes: Practice (bots), Battle (FFA/teams), King of the Hill, Battle Royale,
   and co-op zombie Survival in the Foundry. ("Atrous" was the shooter's working title; you'll still see it in names
   like `atrous.inventory`.)
2. **TŌGE**: mountain-pass and circuit racing against AI or friends, with a garage economy.
3. **Plug-in games** (`src/games/`): SNAP!, Royal Degeneracy, BEACON (a first-person parkour climb), and anything friends add.

It's a prototype that changes a lot. Player-facing docs: `README.md`.

## Read the CLAUDE.md for the area you're touching

| Area | Guide |
|---|---|
| Gambol: shooter rules, physics, maps, game modes (`src/gambol/shared`) | `src/gambol/shared/CLAUDE.md` |
| Gambol in the browser: rendering, viewmodel, HUD, its menu screens, mobile, browser verification (`src/gambol/client`) | `src/gambol/client/CLAUDE.md` |
| TŌGE racing, all of it (`src/toge`) | `src/toge/CLAUDE.md` (and `src/toge/client/CLAUDE.md`) |
| TŌGE's look: menus, brand, colours, type, components | `src/toge/DESIGN.md` (the design system; follow it for any TŌGE screen) |
| Site shell in the browser: boot, router, game chooser, account screen, pad, touch (`src/client`) | `src/client/CLAUDE.md` |
| Code shared by several games (`src/shared`) | `src/shared/CLAUDE.md` |
| Worker, Durable Objects, netcode, accounts, security rules: every game's server (`src/server`, `src/*/server`) | `src/server/CLAUDE.md` |
| Adding a new game to the chooser | `src/games/CLAUDE.md` + `docs/ADDING_A_GAME.md` |
| Royal Degeneracy | `src/games/royal-degeneracy/CLAUDE.md` |
| BEACON (parkour climb) | `src/games/beacon/CLAUDE.md` |
| Tests | `tests/CLAUDE.md` |

## Architecture

```
browser (Vite-built SPA, TypeScript + three.js WebGL)
  src/client/main.ts ── menu router ──┬─ Gambol:  src/gambol/client/game.ts  (128 Hz local sim, render, net.ts)
                                      ├─ TŌGE:    src/toge/client/racegame.ts (120 Hz car sim, racenet.ts)
                                      └─ plug-ins: menu/play.ts mounts src/games/<id>/channel.ts
        │  imports pure rules from src/gambol/shared, src/toge/shared, src/shared (also used by the server)
        │
        │ HTTPS /api/*  +  WebSocket /ws
        ▼
Cloudflare Worker  src/server/worker.ts  (one Worker also serves dist/ as static assets)
  ├─ Directory DO   lobby codes and lists ("all", "race", "party:<id>")
  ├─ LobbyRoom DO   one per shooter match: src/gambol/server (lobby.ts 20 Hz tick + survival.ts / workshop.ts / royale.ts)
  ├─ RaceRoom DO    one per TŌGE race: src/toge/server (race.ts)
  ├─ PartyRoom DO   one per plug-in game room: party.ts (roster + relay only)
  └─ Accounts DO    users, sessions, the shooter stash (coins, items, XP), the TŌGE garage
```

- **Each game's `shared/` is its contract.** Physics, maps, game-mode rules, the economy and the wire protocol are pure,
  deterministic TypeScript (no three.js, no DOM) used by both sides: `src/gambol/shared`, `src/toge/shared`. Put logic
  there and test it there. `src/shared` holds only what several games use (math, account rules, party wire types).
- **The games are separate.** Gambol (`src/gambol`) and TŌGE (`src/toge`) never import each other, and `src/shared`
  imports no game (`tests/boundaries.test.ts`). The site shell (`src/client`) and the platform server (`src/server`)
  wire the games in, so they import both. Code a second game needs moves to `src/shared` (pure) or `src/client` (browser).
- **Authority:** movement and hit detection are client-side (prototype shortcuts; the server sanity-checks them).
  Match flow, zombies, Survival/Royale state, race timing and every coin/XP payout for signed-in players are
  server-side. Guests keep their stash/garage in localStorage and run the same shared rules locally.
- **Rendering:** plain `THREE.WebGLRenderer` everywhere, toon materials and canvas-painted textures in the shooter,
  a bloom/grade post chain in TŌGE. A WebGPU rewrite was merged and then reverted (too slow): don't bring it back.
- **Hosting:** Cloudflare Workers + Durable Objects on the free plan (`wrangler.jsonc`, `docs/DEPLOYMENT.md`).
  Branch pushes get Cloudflare preview builds. Production deploys from the `production` branch, which
  `.github/workflows/deploy.yml` moves to master at night when nobody is playing: a deploy restarts every Durable
  Object and drops every live game, so merging to master no longer deploys (docs/DEPLOYMENT.md).

## Repo layout

```
src/gambol/   Gambol, the shooter: shared/ (pure rules for client + server), client/ (game.ts and friends, weapon/,
              menu/ = its screens), server/ (LobbyRoom, lobby, Survival, Royale, the stash store)
src/toge/     TŌGE, the racer: shared/ (physics, tracks, cars, garage), client/ (racegame.ts and friends),
              server/ (RaceRoom, race, the garage store)
src/shared/   pure code several games use (math, account rules, party wire types)
src/client/   the site shell: main.ts, menu/ (router, ui kit, game chooser, account screen, plug-in host), pad, touch
src/server/   the Worker and the platform Durable Objects (Directory, Accounts, PartyRoom), rooms.ts
src/games/    plug-in games for the chooser (registry.ts finds <id>/channel.ts; _template/ to start)
tests/        node:test files, run by an explicit list in package.json: gambol/, toge/, the rest at the top
dev/          dev-only labs served by Vite: viewmodel.html (guns/hands), cars.html (TŌGE car models), scenery.html (TŌGE track scenery); backdrops.py paints TŌGE's sky backdrops
docs/         ADDING_A_GAME, DEPLOYMENT, FOUNDRY (Survival map), MAP_PLAN (Windward), MENU_PLAN, SECURITY
public/       _headers (security headers), models/ (optional awp.glb, see README), race/backdrops/ (TŌGE distant scenery, painted by dev/backdrops.py), favicon/icons/og-image.png/site.webmanifest (site icon and link preview; meta tags in index.html)
wrangler.jsonc  Worker config: assets, Durable Object bindings, migrations, previews
```

## Commands

```bash
npm ci             # install (Node 20+, 22 recommended)
npm run dev        # Vite + Cloudflare plugin: client and Worker/Durable Objects locally on :5173
npm test           # node:test via tsx; files are listed explicitly in package.json
npm run typecheck  # tsc for client+shared (tsconfig.json) and for server+shared with Workers types (tsconfig.worker.json)
npm run build      # typecheck + vite build -> dist/
npm run smoke      # tests/lobby.smoke.ts against a running server (BASE=https://...)
npm run deploy     # build + wrangler deploy (Michael's Cloudflare account; don't run it unless asked)
```

Vite is pinned to 6 for the Cloudflare plugin; TypeScript is 5.9. Development is mostly on Windows: npm scripts don't
expand globs, so add each new test file to the `test` script by name.

## Priorities for the shooter (in order)

1. **Momentum is sacred.** Movement must feel like CS:GO bhop. Never add anything that eats speed on its own: no air friction, no friction on the jump tick, no "redirect" mechanics. Shot-recoil push was removed for exactly this. Air jumps were removed once too and are back as the double jump and wall kick: they only raise vertical speed or add push, never touch horizontal momentum (tests in the "Air jumps" block).
2. **Keep it simple.** Small files, plain code, few dependencies. Delete dead code rather than leaving it switched off. If a feature is off by default and nobody uses it, remove it.
3. **Fun and silly.** Chibi anime snipers with streaming scarves and X_X faces when killed, flung corpses, YEET popups. Keep that tone.
4. **Ghibli look.** Soft cel shading, warm painterly palette, and procedural textures (no image assets). Gameplay readability comes first: floors, walls, cover, pads, slide ramps and surf ramps must each look distinct.

TŌGE's equivalent ("realistic sim with an arcade layer on top") is in `src/toge/CLAUDE.md`.

## Conventions

- Units are metres and seconds, Y up, yaw 0 looks down -Z (three.js convention). CS values are written as `250 * U` with Hammer units (`U = 0.0254`) so they trace back to the cvar.
- TypeScript is strict (`noUnused*` on). Match the surrounding style: short doc comments that explain *why*, and named constants. Every tunable lives in a constants block (`constants.ts`, `SURVIVAL`, `KOTH`, `ROYALE`, `ARCADE`, …), not as a magic number in logic.
- No new dependencies without a strong reason. Runtime deps are `three` and `lil-gui`; wrangler and @cloudflare/vite-plugin are dev deps.
- Every movement or physics change gets a test (shooter and TŌGE alike).
- Never trust the client for anything that pays or decides a result; never put player names into HTML strings. Details: `src/server/CLAUDE.md`.
- Mobile styles and input live under `html.touch` / `IS_TOUCH` only; desktop paths never change for mobile.
- **Line endings are mixed.** Some files are CRLF (this file, many files in `src/toge/`, `worker.ts`, `wrangler.jsonc`, `package-lock.json`, …), most are LF. Keep each file's existing endings: tools that rewrite text (e.g. Python text mode) silently convert CRLF to LF and make whole-file diffs. Check with `git ls-files --eol <file>`.

## Contributing

Several people (and their Claudes) work on this at once. To keep that smooth:

1. **Branch from `master`**, one feature per branch, and open a PR against `master`. Michael reviews and merges. Don't push to `master` directly and don't commit unless the person you're working for asks.
2. **Stay in your lane.** Give each parallel task clear file ownership; keep each test area in its own file. A new plug-in game stays inside its own `src/games/<id>/` folder (see `src/games/CLAUDE.md`).
3. **Before opening a PR:** `npm test` and `npm run typecheck` green, and for anything visual, check it in the browser (`src/gambol/client/CLAUDE.md`, "Verifying in the browser"; `src/toge/CLAUDE.md` for TŌGE). Cloudflare also builds a preview for every branch.
4. **Keep the docs true.** If you change how something works, update the CLAUDE.md for that area in the same PR, and the design docs in `docs/` for maps, menus, deployment or security.
5. Prefer small, exact edits over rewrites; delete dead code instead of leaving it switched off.

## Status and known gaps

A playable prototype covering practice and online lobbies. Everything listed in README works and is covered by tests or was checked in the browser. Known gaps, roughly in priority order:

- **Guests' loot is client-side:** a signed-in player's stash (coins, items, XP, the Casino's dice) lives on the server; a guest's lives in localStorage and is as trustworthy as their browser. Their Workbench builds can't be checked for payment, so contraptions stay capped (`WORKSHOP.perPlayer` / `perLobby`, a build cooldown). Kills are still client-detected, so a cheat client can farm kills, and with them coins.
- **Security:** see `docs/SECURITY.md` for what's checked where and what's left (e.g. equipped `gear=` is validated but not checked against ownership; no `script-src` CSP).
- **Netcode is a prototype:** client-authoritative movement, client-side hit detection, JSON messages. The upgrade path is in `src/server/CLAUDE.md`.
- **Accounts** are username/password only (Google sign-in was considered and dropped). Next ideas: D1 player stats, reconnection tokens.
- **Lobby room:** while you sit in the room, your bean is already in the live match, idle at spawn. The fix is a server "ready" flag.
- **Real AWP model:** the GLB loader has never run against the real Sketchfab file. That file needs a manual download (see README).
- **Viewmodel:** during the bolt cycle the right hand covers the knob.
- **Survival:** zombies navigate rooms and doorways (not a navmesh), so a tall wide obstacle can trap them (the room-sweep test guards it). A lone player can camp behind a shut door while zombies queue at it. No insta-kill drops yet. Practice has no Survival mode; host a lobby alone to play it solo.
- **Feats are local:** only the shooter sees the combo popup and the feat title in their killfeed. Sending feats in `shoot` would fix that.
- **Windward rendering:** every box is its own mesh (the Foundry and Wildmere already merge per material). Merge it too if frame rate becomes an issue. Grass tufts aren't scattered on ramps; house interiors have had little visual review.
- **Tooling:** the Cloudflare Vite plugin is on Vite 6; Vite 8 is possible now that Node 20+ is required. There is no dead-code tool configured (knip was used once; it isn't installed).
