# Atrous

A silly browser multiplayer movement shooter set on Ghibli-style sky islands: **bhop, surf, slide, wallrun, snipe**. It's in the spirit of CS:GO Combat Surf. It's a prototype, focused on movement feel.

```bash
npm install
npm run dev      # game server :3001 + Vite client :5173 → open http://localhost:5173
npm test         # physics, slide and map traversal tests
npm run smoke    # host/join/shoot/respawn against a running server
npm run build && npm start   # production: one server serves client + websocket on :3001
```

Requires Node ≥ 18.18. Node 22 LTS is recommended, and also unlocks Vite 8.

**Practice** runs offline against target dummies. **Host** creates a lobby with a 4-letter code. Others join with that code, from the lobby list, or with `/?join=CODE`.

## Controls

| Input | Action |
| --- | --- |
| WASD | Move. In the air, let go of W, hold A or D and turn the mouse the same way to gain speed (air-strafing). |
| Space / mouse wheel | Jump. Hold Space to auto-bhop; you keep all your speed on every hop. |
| Shift (hold) | Slide. Hold it in the air to slide the moment you land. Jumping out of a slide keeps your speed. |
| Run along a wall in the air | Wallrun. Space wall-jumps off it. |
| Steep blue ramps | Surf: strafe into the ramp to ride it. |
| LMB / RMB | Shoot / hold to scope. The bolt cycle drops you out of scope, and you scope back in if still holding. No-scopes have spread. |
| R | Reload (automatic when the mag runs dry) |
| Tab | Scoreboard |
| `` ` `` | Live movement tuning panel |

## Movement

The movement is a port of CS:GO's Source `gamemovement` with combat-surf server settings: autobhop, no speed cap, no stamina. In practice:

- **Momentum is kept.** There is no air friction, and a jump on the landing tick skips ground friction entirely.
- **Air-strafing works as in CS.** You gain speed by strafing and turning together; holding W while strafing works against you.
- **Surfing.** Slopes steeper than about 45° can be surfed.
- **Additions not in CS:** sliding, wallruns, wind gates (speed boosters), puffball mushrooms (jump boosters that also throw you the way you're moving), launch pads, and an 80 ms jump buffer that approximates scroll-wheel spam.

## Using a real AWP model

A procedural CS-style AWP is built in. To use a real model instead:

1. Download **[AWP Sniper Rifle by BlenderGuy](https://sketchfab.com/3d-models/awp-sniper-rifle-428942868d1742fabaf80d556e957c88)** (CC BY 4.0) from Sketchfab as **glTF Binary (.glb)**. This needs a free account.
2. Save it as `public/models/awp.glb`.

The game auto-fits and toon-shades the model and attaches its bolt and magazine parts to the animations. The console logs which parts it found. The CC BY credit appears on the pause screen; keep it if you ship.

Developer docs (architecture, conventions, gotchas) are in [CLAUDE.md](CLAUDE.md). Design and ops plans are in [docs/](docs): the map, the menu, and free deployment.
