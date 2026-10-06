# Atrous

A silly browser multiplayer movement shooter: **bhop, wallrun, snipe**. It's in the spirit of CS:GO Combat Surf, with bhopping, wallrunning and jump pads in place of surf ramps. This is a prototype focused on movement feel.

```bash
npm install
npm run dev      # game server :3001 + Vite client :5173 → open http://localhost:5173
npm test         # movement physics + map traversal tests
npm run smoke    # host/join/shoot/respawn against a running server
npm run build && npm start   # production: one server serves client + websocket on :3001
```

Requires Node ≥ 18.18. Node 22 LTS is recommended; on Node 22 you can move to Vite 8.

## Controls

| Input | Action |
| --- | --- |
| WASD | Move. In the air, let go of W, hold A or D, and turn the mouse the same way to gain speed (air-strafing). |
| Space / mouse wheel | Jump. Hold Space to auto-bhop; you keep all your speed on every hop. |
| Run along a wall in the air | Wallrun. Space wall-jumps off it. |
| LMB / RMB | Shoot / hold to scope (you drop out of scope while the bolt cycles, and scope back in if still holding). No-scopes have spread. |
| Tab | Scoreboard |
| `` ` `` | Live movement tuning panel |

## Movement model (CS:GO bhop)

`src/shared/movement.ts` is a port of Source's `gamemovement` with combat-surf server settings (`sv_autobunnyhopping 1`, `sv_enablebunnyhopping 1`, stamina off). Values are converted from Hammer units at 1u = 0.0254 m.

- **Momentum.** There is no air friction, so in the air you keep flying the way you were going with no keys held. The jump is checked before friction, and jumping leaves the ground, so a hop on the landing tick loses no speed. Holding Space autohops on exactly that tick.
- **Air-strafing.** Air acceleration (`sv_airaccelerate 100`) can only add up to 30 u/s along your wish direction. Strafing sideways while turning keeps that direction close to perpendicular to your velocity, and each tick bends and lengthens it. That is how speed is gained. Holding W while strafing works against you, as in CS.
- **Ground.** `sv_accelerate 5.5`, `sv_friction 5.2`, `sv_stopspeed 80`, 250 u/s run speed, `sv_gravity 800`, 57u jump. Mistimed hops cost speed through friction on every grounded tick.
- **Gravity.** Applied half before and half after the move, like Source.
- **Not in CS.** An 80 ms jump buffer, so a tap or scroll slightly before landing still hops, which approximates scroll-wheel spam. Wallrunning and jump pads are also additions. Air jumps and the shot-recoil push exist as tuning knobs but default to off, because both ate momentum.

**Practice** runs fully offline with target dummies. **Host** creates a lobby with a 4-letter code. Friends can join with that code, from the lobby list, or with `/?join=CODE`.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Rendering | **Three.js** (WebGL2 renderer) | It has the largest ecosystem and is a thin layer. The scene is simple boxes, so WebGL is universal and enough. `WebGPURenderer` is a drop-in later if we need compute or particles. |
| Build | **Vite + TypeScript** | Instant HMR, and the same TS runs on client and server. |
| Physics | **Custom Quake/Source-style movement** (`src/shared/movement.ts`) | Bhop and air-strafe feel comes from specific accel and friction rules that general physics engines don't replicate. The code is deterministic and shared, which is what you need for server reconciliation later. Rapier (WASM) is the pick if we ever want rigid-body props or real ragdolls. |
| Networking | **Node + `ws`**, own lobby/room code | WebSockets are the reliable default in 2026 (WebTransport support is still uneven). A hand-rolled room layer stays small and keeps the netcode (snapshots, interpolation, later prediction) fully in our control. Colyseus would also work if we want its matchmaking and state sync. |

## How it works

- `src/shared/`: code that runs on both sides, with no Three.js in it.
  - `movement.ts`: 128 Hz fixed-tick player sim (the CS:GO bhop model above, plus wallrun with magnetism and ramping gravity, wall-jump, and jump pads).
  - `collision.ts`: axis-separated swept AABB collision with sub-stepping, plus raycasts for hitscan.
  - `map.ts`: the "Skyhop" map as data (boxes + spawns), with one half mirrored for symmetry.
  - `protocol.ts`: the JSON message types.
- `src/client/`: Three.js rendering, pointer-lock input, viewmodel, HUD, synth SFX, and offline dummies. The local player simulates at 128 Hz with render interpolation. Remote players render 100 ms in the past, interpolated between snapshots.
- `src/server/`: lobbies, 20 Hz snapshots, hit sanity checks, kills/respawns, and host migration.

### Prototype shortcuts (deliberate, to revisit)

- **Client-authoritative movement.** Clients send position at 30 Hz and the server relays it. Next step: send inputs instead, run `stepPlayer` on the server, and add client prediction plus reconciliation. The sim is already shared and deterministic for this.
- **Client-side hit detection** ("favour the shooter"). The server only rejects hits far from the victim's last known position. Proper lag compensation (server-side rewind) comes after server-authoritative movement.
- JSON over the wire. Switch to a binary encoding once the message shapes settle.
- Tuning-panel changes only affect your own client.

In dev builds, `window.__game` exposes the running game for console poking.
