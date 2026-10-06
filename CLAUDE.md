# CLAUDE.md

Atrous: a browser multiplayer movement shooter. Think CS:GO Combat Surf with bhop, surf, slide and wallrun, AWP-only, on Ghibli-style sky islands. It's a prototype that will evolve a lot. Player-facing docs are in README.md.

## Priorities (in order)

1. **Momentum is sacred.** Movement must feel like CS:GO bhop. Never add anything that eats speed on its own: no air friction, no friction on the jump tick, no "redirect" mechanics. Air jumps and shot-recoil push were removed for exactly this.
2. **Keep it simple.** Small files, plain code, few dependencies. Delete dead code rather than leaving it switched off. If a feature is off by default and nobody uses it, remove it.
3. **Fun and silly.** Googly-eyed beans, flung corpses, YEET popups. Keep that tone.
4. **Ghibli look.** Soft cel shading, warm painterly palette, and procedural textures (no image assets). Gameplay readability comes first: floors, walls, cover, pads, slide ramps and surf ramps must each look distinct.

## Commands

```bash
npm run dev        # server (tsx watch, :3001) + Vite client (:5173, proxies /ws)
npm test           # node:test via tsx; files are listed explicitly in package.json
npm run typecheck  # tsc --noEmit (strict, noUnusedLocals/Parameters)
npm run build      # typecheck + vite build -> dist/
npm start          # production: server serves dist/ and /ws on :3001
npm run smoke      # tests/lobby.smoke.ts against a running server
npx knip           # dead-code sweep; should report nothing
```

Environment: Node **18.18**, so Vite is pinned to 6 and concurrently to 9 (newer majors need Node 20+). TypeScript is 5.9. Development is on Windows: npm scripts don't expand globs, so add each new test file to the `test` script by name.

## Layout

```
src/shared/   runs on client AND server. No three.js, no DOM. Deterministic.
  constants.ts  every tunable: TICK_DT, NET, PLAYER, MOVE (CS:GO values in Hammer units), WEAPON
  math.ts       tiny {x,y,z} helpers (yaw 0 looks down -Z, three.js convention)
  movement.ts   stepPlayer(): the 128 Hz player sim (bhop, air-strafe, slide, wallrun, pads)
  collision.ts  AABB boxes + wedge ramps + non-solid Triggers: move-and-slide, probes, raycasts
  map.ts        the "Windward" map as data (boxes, triggers, decor, spawns), built from helpers; one half mirrored
  protocol.ts   JSON wire types (ClientMsg / ServerMsg), StateFlag bits
src/server/   index.ts (http static + ws, lobby codes), lobby.ts (room, 20 Hz snapshots, kills, respawns)
src/client/
  main.ts       boots the menu router; loading screen; starts a Game (practice or online)
  menu/         one file per screen (title, practice, host, join, lobby room, help) + router.ts + ui.ts
  settings.ts   saved player settings (name, sensitivity, auto-bhop) in localStorage
  game.ts       the Game: loop, fixed-tick sim + render interpolation, weapon state, remotes, net, camera
  world.ts      renders MAP by box.kind (+ sky, clouds, scenery). textures.ts = procedural canvas textures
  viewmodel.ts  first-person rifle + hands, all animation keyframed in code
  weapon/       awp.ts (procedural AWP + optional GLB loader/fitter), hands.ts (Arm)
  avatar.ts     remote player beans + flung corpses. hud.ts, input.ts, net.ts, sfx.ts (synth audio)
dev/viewmodel.html  dev-only lab for tuning the rifle/hands (Vite serves it; not part of the build)
public/models/      optional awp.glb (see README)
tests/        movement.test.ts + slide.test.ts (map-agnostic physics), map.test.ts (ramps + every Windward route)
              lobby.smoke.ts runs manually against a server
docs/         MAP_PLAN.md (map design), MENU_PLAN.md (menu UX), DEPLOYMENT.md (free hosting + prod multiplayer plan)
```

## How things work

**Movement (`movement.ts`)** is a port of Source `gamemovement`, ticked at 128 Hz.
- Order per tick: check jump *before* friction (a jump leaves the ground, so no friction that tick), then friction and accel, or air-accel with the 30 u/s cap, or slide, or wallrun.
- Gravity is split half before and half after the move.
- After the move, ground is classified: walkable means `normal.y >= 0.7`, and the snap-down is 18u.
- `MOVE` is mutable on purpose; the `` ` `` lil-gui panel edits it live. Every tunable belongs in `constants.ts`, not as a magic number in logic.
- Events come back as `s.events` bit flags (`Ev`) and drive sfx and camera effects.
- Triggers are applied after the move. A wind gate (`boost`) raises speed along its direction; a puffball (`bounce`) raises upward speed to `up` and horizontal speed along your current heading to `push` (standing still, it's straight up). Both only ever *raise* velocity ("set at least"), so they can't cost momentum and need no cooldowns. Keep it that way.

**Collision (`collision.ts`)**
- The world is a list of `Box`: axis-aligned boxes, plus wedges when `box.ramp` is set.
- Ramps of kind `'ramp'` are walkable slide slopes; kind `'surf'` is steeper than 45°, so you're airborne on it and ClipVelocity keeps your tangential speed.
- Moves are sub-stepped at `MAX_STEP` so high speeds never tunnel.
- Hitscan uses `rayWorld` / `rayBox` / `raySphere`.

**Map (`map.ts`)**
- Build geometry with the helpers: `box`, `span`, `wedge`, `surfFrame`, `padTo`, `shrine`, and `house` (multi-storey: walls with windows/doors, alternating stair ramps through floor holes, roof hatch + parapet, optional balcony; depth along Z must be ≥ 10). Build boosters with `gate` (wind gate) and `puff` (puffball: throw height + forward push).
- Box kinds: `floor` (grass island with a rock underside), `branch` (bark limb, no underside), `wall`, `trunk`, `cover`, `pad`, and `ramp`/`surf` for wedges. `decor` is visual only, e.g. the canopy.
- Use aimed pads (`padTo`) to reach branches and overhung ledges. Puffballs now throw you forward too, so they can hop you up onto a ledge you're running at, if it's far enough away that you clear its edge on the way up (test it). Mind wind gates along a puff's flight path: they'll catch you.
- Ramps have no step-up: you can only walk onto one from its low end, so leave a clear landing in front of it (`house` does).
- Author one half; `mirror()` rotates it 180° for the other side.
- Use `padTo(...)` for pads: it computes the launch from the live gravity, so retuning doesn't break pads.
- A new `BoxKind` needs rendering in `world.ts`.
- After map changes, check:
  - `map.test.ts`: spawns, every pad landing, and a scripted traversal of every route. Map-specific tests live only there.
  - `spawnDummies()` spots in `game.ts`.
  - `docs/MAP_PLAN.md`.

**Menu**
- Each screen in `menu/` is a function that renders into a root element. `router.ts` uses history, so browser Back, ← Back and Esc all match.
- The lobby room is client-side only: the server drops you into the match on join, and the room screen just shows the live roster before you enter.

**Netcode (deliberate prototype shortcuts)**
- Movement is **client-authoritative**: clients send state at 30 Hz and the server relays 20 Hz snapshots.
- Remote players render 100 ms in the past, interpolated.
- Hits are detected on the client (favour the shooter). The server only sanity-checks distance and uses `WEAPON.fireCooldown` as a rate limit.
- The planned upgrade path: send inputs instead, run the shared `stepPlayer` on the server, and add prediction plus reconciliation. Keep `src/shared` deterministic so that path stays open.
- Hosting and production multiplayer: see `docs/DEPLOYMENT.md`. Phase 0 is your own PC plus a Cloudflare quick tunnel; Phase 1 is an Oracle Always Free VM.

**Rendering**
- One WebGL renderer with Neutral tone mapping. The world renders first, then the depth buffer is cleared and the viewmodel's own scene renders on top, so the gun never clips into walls.
- Shared toon ramp: `toonRamp()`. World palette: `PALETTE` in `world.ts`.

**Viewmodel**
- Everything lives in "view" space (scaled by `VIEW_SCALE`).
- Gun space is metres with the barrel along -Z and the bolt on +X. Animations use `seg`/`hold` keyframe helpers over a normalised timeline.
- A GLB at `public/models/awp.glb` is auto-fitted, and its nodes matching `/bolt|reloader|charging|handle/` and `/mag/` are reparented into the animated pivots.
- Tune the pose in `/dev/viewmodel.html` (`lab.GUN_POS`, `lab.paused`, `lab.step(s)`).

## Conventions

- Units are metres and seconds, Y up. CS values are written as `250 * U` with Hammer units (`U = 0.0254`) so they trace back to the cvar.
- TypeScript is strict. Match the surrounding style: short doc comments that explain *why*, and named constants.
- No new dependencies without a strong reason. Current runtime deps: `three`, `ws`, `lil-gui`, `tsx`.
- Every movement or physics change gets a test. In particular, momentum must be preserved (see the "Momentum" block in `movement.test.ts`).
- Prefer small exact edits. When several agents or sessions work in parallel, give each one clear file ownership and keep each test area in its own file.
- Don't commit unless asked.

## Verifying in the browser

- In dev, `window.__game` is the running Game.
- Set `g.input.locked = true; g.hud.setPaused(false)` to play without pointer lock.
- Automation tabs are often **hidden**, which pauses rAF. Drive frames yourself: `let T = performance.now(); g.last = T; for (...) { T += 1000/60; g.frame(T); }`.
- Simulate keys with `document.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))`.
- **HMR gotcha:** after a hot update, the page uses `module.ts?t=…`, which is a different module instance from a fresh `import('/src/...')` in the console. State you inject (e.g. pushing boxes into `MAP`) won't reach the game. Reload the page first, or reach in through `window.__game`.
- An exception during `buildWorld` leaves the loading screen up forever. Check the console.
