# CLAUDE.md

Atrous: a browser multiplayer movement shooter. Think CS:GO Combat Surf with bhop, surf, slide and wallrun, AWP-only, on Ghibli-style sky islands. It's a prototype that will evolve a lot. Player-facing docs are in README.md.

## Priorities (in order)

1. **Momentum is sacred.** Movement must feel like CS:GO bhop. Never add anything that eats speed on its own: no air friction, no friction on the jump tick, no "redirect" mechanics. Shot-recoil push was removed for exactly this. Air jumps were removed once too and are back as the double jump and wall kick: they only raise vertical speed or add push, never touch horizontal momentum (tests in the "Air jumps" block).
2. **Keep it simple.** Small files, plain code, few dependencies. Delete dead code rather than leaving it switched off. If a feature is off by default and nobody uses it, remove it.
3. **Fun and silly.** Chibi anime snipers with streaming scarves and X_X faces when killed, flung corpses, YEET popups. Keep that tone.
4. **Ghibli look.** Soft cel shading, warm painterly palette, and procedural textures (no image assets). Gameplay readability comes first: floors, walls, cover, pads, slide ramps and surf ramps must each look distinct.

## Commands

```bash
npm run dev        # Vite + Cloudflare plugin: client and Worker/Durable Objects locally (:5173)
npm test           # node:test via tsx; files are listed explicitly in package.json
npm run typecheck  # tsc --noEmit for client+shared, and for src/server with Workers types (strict)
npm run build      # typecheck + vite build -> dist/
npm run deploy     # build + wrangler deploy to Cloudflare (docs/DEPLOYMENT.md)
npm run smoke      # tests/lobby.smoke.ts against a running server
npx knip           # dead-code sweep; should report nothing
```

Environment: Node **20+** (Wrangler needs it; 22 recommended). Vite is still pinned to 6 for the Cloudflare plugin. TypeScript is 5.9. Development is on Windows: npm scripts don't expand globs, so add each new test file to the `test` script by name.

## Layout

```
src/shared/   runs on client AND server. No three.js, no DOM. Deterministic.
  constants.ts  every tunable: TICK_DT, NET, PLAYER, MOVE (CS:GO values in Hammer units), WEAPON
  math.ts       tiny {x,y,z} helpers (yaw 0 looks down -Z, three.js convention)
  movement.ts   stepPlayer(): the 128 Hz player sim (bhop, air-strafe, slide, wallrun, pads); launchTo()
  zombie.ts     Survival zombie AI + physics (chase, claw, hop, detour, pounce); the server runs it
  collision.ts  AABB boxes + wedge ramps + non-solid Triggers: move-and-slide, probes, raycasts
  map.ts        the "Windward" map as data (boxes, triggers, decor, spawns), built from helpers; one half mirrored
  spawn.ts      pickSpawn(): random good spawn (far from, and out of sight of, living players; not recently used)
  protocol.ts   JSON wire types (ClientMsg / ServerMsg), StateFlag bits
src/server/   Cloudflare Worker: worker.ts (routing), room.ts (LobbyRoom Durable Object, one per match),
              directory.ts (Directory DO: codes + lobby list), accounts.ts + accountStore.ts (Accounts DO: username/password accounts and sessions), lobby.ts (game logic: 20 Hz snapshots, kills, respawns),
              survival.ts (rounds, zombie spawning/sim, claws and HP, game over)
              Survival also owns the per-player economy (`wallet`: points + punched flag, server-authoritative, reset with the run). The `pts` message tells the owner; `shot.up` tells others the rifle is punched; `punch` buys.
src/client/
  main.ts       boots the menu router; loading screen; starts a Game (practice or online)
  menu/         one file per screen (title, practice, host, join, lobby room, help) + router.ts, ui.ts,
                skirmish.ts (the animated island backdrop)
  settings.ts   saved player settings (name, sensitivity, auto-bhop) in localStorage
  game.ts       the Game: loop, fixed-tick sim + render interpolation, weapon state, remotes, net, camera
  achievements.ts  feats (360, no-scope, headshot, ...) + streaks/multi-kills; pure, unit-tested
  horde.ts      Survival zombies on the client: snapshot interpolation, zombie avatars, corpses
  world.ts      renders MAP by box.kind (+ sky, clouds, scenery). textures.ts = procedural canvas textures
  viewmodel.ts  first-person rifle + hands, all animation keyframed in code
  weapon/       awp.ts (procedural AWP + optional GLB loader/fitter), hands.ts (Arm)
  grenade.ts    (shared) grenade physics, blast targets (line of sight) and the no-slowdown shove; client grenadefx.ts / nadehud.ts draw it; the thrower reports 'boom', the server validates and kills
  jug.ts        (shared) Juggernog rules: station range/price/status and max health (client jugmachine.ts draws the station; survival.ts buyJug)
  night.ts      the Survival look: indigo moonlit palette, stars, moon (world.ts buildWorld(.., night) uses it; only Survival is at night)
  rope.ts       grapple rope + hook meshes
  killcam.ts    Trail (rolling per-player poses) + replay timing; game.ts records everyone and replays your death from the killer's eyes
  speedfx.ts    wind streaks overlay that scale with speed (hud.ts owns it); sfx.setWind adds the rushing-wind loop
  skin.ts (src/shared) skin spec: option lists, presets, seeded default, encode/decode ('3.0.1.3.0.0.x', validated on the server). client/skinStore.ts saves it; menu/skin.ts + skinPreview.ts are the picker.
  avatar.ts     chibi anime players (look = chosen skin, else seeded from name+colour, ink outlines, canvas faces), a zombie variant
                (poseZombie) + flung corpses. hud.ts, input.ts, net.ts, sfx.ts (synth audio)
dev/viewmodel.html  dev-only lab for tuning the rifle/hands (Vite serves it; not part of the build)
public/models/      optional awp.glb (see README)
tests/        movement.test.ts + slide.test.ts (map-agnostic physics), map.test.ts (ramps + every Windward route),
              zombie.test.ts (zombie AI, incl. every zombie spawn reaching the players), achievements.test.ts
              lobby.smoke.ts runs manually against a server
docs/         MAP_PLAN.md (map design), MENU_PLAN.md (menu UX), DEPLOYMENT.md (free hosting + prod multiplayer plan)
```

## How things work

**Movement (`movement.ts`)** is a port of Source `gamemovement`, ticked at 128 Hz.
- Order per tick: check jump *before* friction (a jump leaves the ground, so no friction that tick), then friction and accel, or air-accel with the 50 u/s cap (CS has 30; raised so bhop climbs faster, hard clamp 70 m/s), or slide, or wallrun.
- Gravity is split half before and half after the move.
- After the move, ground is classified: walkable means `normal.y >= 0.7`, and the snap-down is 18u.
- `MOVE` is mutable on purpose; the `` ` `` lil-gui panel edits it live. Every tunable belongs in `constants.ts`, not as a magic number in logic.
- Events come back as `s.events` bit flags (`Ev`) and drive sfx and camera effects.
- The grapple (E) is also in `stepPlayer` (it can also hook a player from `input.grappleTargets` and zip to them, following them; `findGrapple` is shared with the HUD so the READY chip is exact) (`fireGrapple` / `pullGrapple`): a ray along the look direction, range `MOVE.grappleRange` (40 m: about the width of the centre island, so one pull crosses a lane gap but not the map). While attached it raises your speed along the rope up to `grappleSpeed` (a "set at least", like a gate, so it never slows a rope aimed where you're heading), skips ground friction, and lets go on arrival, on Space (keeping all speed), when something blocks the line, or after `grappleMaxTime`. Cooldown after release. `MoveInput` carries `pitch` and `grapplePressed` for it; the anchor travels in the state message (`g`) so others see the rope.
- Triggers are applied after the move. A wind gate (`boost`) raises speed along whichever way you cross it (±its direction; standing still, the way you face); a puffball (`bounce`) raises upward speed to `up` and horizontal speed along your current heading to `push` (standing still, it's straight up). Both only ever *raise* velocity ("set at least"), so they can't cost momentum and need no cooldowns. Keep it that way.

**Collision (`collision.ts`)**
- The world is a list of `Box`: axis-aligned boxes, plus wedges when `box.ramp` is set.
- Ramps of kind `'ramp'` are walkable slide slopes; kind `'surf'` is steeper than 45°, so you're airborne on it and ClipVelocity keeps your tangential speed.
- Moves are sub-stepped at `MAX_STEP` so high speeds never tunnel.
- Hitscan uses `rayWorld` / `rayBox` / `raySphere`.

**Map (`map.ts`)**
- Build geometry with the helpers: `box`, `span`, `wedge`, `surfFrame`, `padTo`, `shrine`, and `house` (multi-storey: walls with windows/doors, alternating stair ramps through floor holes, roof hatch + parapet, optional balcony; depth along Z must be ≥ 10). Build boosters with `gate` (wind gate) and `puff` (puffball: throw height + forward push).
- Box kinds: `hook` (a tiny floating brass ring the grapple snaps to from ~8° off your aim; rendered in `world.ts`, no solid mesh), `floor` (grass island with a rock underside), `branch` (bark limb, no underside), `wall`, `trunk`, `cover`, `pad`, and `ramp`/`surf` for wedges. `decor` is visual only, e.g. the canopy.
- Use aimed pads (`padTo`) for branches and overhung ledges: the launch is computed from the live gravity, so retuning doesn't break them. Puffballs throw you forward, so they can hop you onto a ledge you're running at, if it's far enough away that you clear its edge on the way up (test it). Mind wind gates along a puff's flight path: they'll catch you.
- Ramps have no step-up: you can only walk onto one from its low end, so leave a clear landing in front of it (`house` does).
- Author one half; `mirror()` rotates it 180° for the other side.
- A new `BoxKind` needs rendering in `world.ts`.
- After map changes, check:
  - `map.test.ts`: spawns, every pad landing, and a scripted traversal of every route. Map-specific tests live only there.
  - `spawnDummies()` spots in `game.ts`.
  - `docs/MAP_PLAN.md`.

**Game types**: a lobby is `'battle'` (FFA) or `'survival'`, chosen on the Host screen and sent with `host`.
- Survival is co-op (no friendly fire; the client only hit-tests zombies). `Survival` (server) owns rounds: intermission → active → (all cleared: revive + heal, next round) or (everyone down: game over → post-game board, shared/postgame.ts; restarts at round 1 when all present players send 'again' or after SURVIVAL.gameOverSeconds). Dead players stay down until the round ends.
- Zombies are server-authoritative: `stepHorde` at 60 Hz, sent as `snapshot.zombies`; shots on zombies are client-detected and sanity-checked like player hits (`shoot.zombie`). Players have HP only in Survival (`hp` message to that player). Tuning lives in `SURVIVAL` and `ZOMBIE` in constants.ts.
- Points and Pack-a-Punch: pure rules in `shared/punch.ts` (kill points, `punchStatus` range/price/owned, `weaponStats`, damage, `pierced`), tunables in `SURVIVAL` and `WEAPON_PUNCHED`. The machine's spot is `MAP.punchMachine` (visual only, built client-side in `punchmachine.ts`; the server checks distance). Press F to buy; the upgrade lasts until the run restarts. The server uses the punched `fireCooldown` as its rate limit. Tests: `punch.test.ts`.
- Map data: `survivalSpawns` (players) and `zombieSpawns`.

**Feats** (`achievements.ts`): the shot's context is captured at fire time (`lastHit`), and scored when the kill is confirmed (immediately offline, on `kill`/`zombieDied` online). Feats from one kill stack into one combo popup (`hud.feats`) + `sfx.feats`. Streak resets on death.

**Menu**
- Each screen in `menu/` is a function that renders into a root element. `router.ts` uses history, so browser Back, ← Back and Esc all match.
- The lobby room is client-side only: the server drops you into the match on join, and the room screen just shows the live roster before you enter.

**Netcode (deliberate prototype shortcuts)**
- Movement is **client-authoritative**: clients send state at 20 Hz (only when it changed) and the server relays 20 Hz snapshots.
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
- No new dependencies without a strong reason. Current runtime deps: `three`, `lil-gui`. The Worker runs on Cloudflare (wrangler, @cloudflare/vite-plugin are dev deps).
- Every movement or physics change gets a test. In particular, momentum must be preserved (see the "Momentum" block in `movement.test.ts`).
- Prefer small exact edits. When several agents or sessions work in parallel, give each one clear file ownership and keep each test area in its own file.
- Don't commit unless asked. The remote is `origin` → github.com/michael-fourie/atrous (private), default branch `master`.

## Status and known gaps

A playable prototype covering practice and online lobbies. Everything listed in README works and is covered by tests or was checked in the browser. Known gaps, roughly in priority order:

- **Netcode is a prototype:** client-authoritative movement, client-side hit detection, JSON messages. The upgrade path is under Netcode above and in `docs/DEPLOYMENT.md`.
- **Deployment:** Cloudflare Worker + Durable Objects on the free plan, see `docs/DEPLOYMENT.md`. Next: Google sign-in + D1 player stats, rate limiting, reconnection tokens.
- **Lobby room:** while you sit in the room, your bean is already in the live match, idle at spawn. The fix is a server "ready" flag.
- **Real AWP model:** the GLB loader has never run against the real Sketchfab file. That file needs a manual download (see README).
- **Viewmodel:** during the bolt cycle the right hand covers the knob.
- **Survival:** zombies have no pathfinding: straight-line chase plus hops, wall detours, edge-feeling and pounces. The canopy crown (23 m) is out of pounce reach from the ground, so it's a safe camping spot. No HP regen yet (healed between rounds). Practice has no Survival mode yet; host a lobby alone to play it solo.
- **Feats are local:** only the shooter sees the combo popup and the feat title in their killfeed. Everyone else sees a plain "sniped" row. Sending feats in `shoot` would fix that.
- **knip** (latest) needs Node 20+, and older versions crash against TypeScript 5.9, so the dead-code sweep can't run on Node 18.
- **Map:**
  - Grass tufts aren't scattered on ramps.
  - House interiors are tested by scripted walks but have had little visual review.
  - Every box is its own mesh (~360 meshes). Merge static geometry by material if frame rate becomes an issue.
- **Tooling:** the Cloudflare Vite plugin is on Vite 6; Vite 8 is possible now that Node 20+ is required.

Design docs in `docs/` describe the current map and menu. Update them when you change those areas.

## Verifying in the browser

- In dev, `window.__game` is the running Game. To skip the menu, create one directly: `const { Game } = await import('/src/client/game.ts'); app.innerHTML = ''; new Game({ container: app, name: 'x', onExit() {} })`.
- Set `g.input.locked = true; g.hud.setPaused(false)` to play without pointer lock.
- Automation tabs are often **hidden**, which pauses rAF. Drive frames yourself: `let T = performance.now(); g.last = T; for (...) { T += 1000/60; g.frame(T); }`.
- Simulate keys with `document.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))`.
- **HMR gotcha:** after a hot update, the page uses `module.ts?t=…`, which is a different module instance from a fresh `import('/src/...')` in the console. State you inject (e.g. pushing boxes into `MAP`) won't reach the game. Reload the page first, or reach in through `window.__game`.
- An exception during `buildWorld` leaves the loading screen up forever. Check the console.
