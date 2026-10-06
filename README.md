# Gambol

A silly browser multiplayer movement shooter set on Ghibli-style sky islands: **bhop, surf, slide, wallrun, snipe**. It's in the spirit of CS:GO Combat Surf.

```bash
npm install
npm run dev      # Vite + the Worker running locally → open the URL it prints (http://localhost:5173)
npm test         # physics, slide, map traversal, zombie AI and achievement tests
npm run smoke    # host/join/shoot/respawn against a running server
npm run deploy   # build and publish to Cloudflare (see docs/DEPLOYMENT.md)
```

Requires Node ≥ 20 (Wrangler). Node 22 LTS is recommended, and also unlocks Vite 8.

**The map, Windward:** two harbour islands face each other across a great tree. Three lanes lead to the middle: a slide-and-bhop Windway, a Surf Gorge, and walled Old Ruins. Along the way are multi-storey houses with sniping windows, extra surfs, wind gates (speed boosters) and puffball mushrooms (jump boosters).

**Practice** runs offline against target dummies. **Host** creates a lobby with a 4-letter code. Others join with that code, from the lobby list, or with `/?join=CODE`.

## Game types

Pick one when hosting:

- **Battle**: free-for-all, one AWP each, one shot, one kill.
- **Survival**: co-op against rounds of zombies on the same map. You start by the Great Tree, and zombies climb out of the clouds around the island's rim. They shamble at you and claw you (you have 100 HP), hop over roots, and pounce up onto ledges and across gaps. Each round brings more of them, and they get a bit faster and tougher: from round 3 a body shot won't drop one, but a headshot still will. Clear a round and everyone is revived and healed. If everyone goes down, it's game over and you start again from round 1.

## Feats and streaks

Kills earn mini achievements, and several at once **stack** into one combo with a jingle (more feats, fancier jingle), e.g. **360 NO-SCOPE HEADSHOT ×3 COMBO**.

| Feat | How |
| --- | --- |
| HEADSHOT | Hit the head |
| NO-SCOPE | Fire without scoping |
| 360 | Turn a full circle in the 1.5 s before the shot |
| AIRBORNE / WALLRUN / SLIDING | Shoot after a second in the air (a normal bhop hop doesn't count), mid-wallrun, or mid-slide |
| MACH | Moving at 15 m/s or more |
| LONG SHOT / POINT BLANK | 60 m or further / 2.5 m or closer |
| DOUBLE / TRIPLE / QUAD KILL | Kills within 4 s of each other |
| KILLING SPREE, RAMPAGE, UNSTOPPABLE, GODLIKE, LEGENDARY | 3, 5, 10, 15 and 25 kills without dying |

## Controls

| Input | Action |
| --- | --- |
| WASD | Move. In the air, let go of W, hold A or D and turn the mouse the same way to gain speed (air-strafing). |
| Space / mouse wheel | Jump. Hold Space to auto-bhop; you keep all your speed on every hop. Tap again in the air for a double jump. |
| Shift (hold) | Slide. Hold it in the air to slide the moment you land. Jumping out of a slide keeps your speed. |
| Run along a wall in the air | Wallrun. Space wall-jumps off it; tapping Space next to any wall kicks off it too (once per wall until you land), and refreshes the double jump. |
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
