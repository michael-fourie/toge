# Gambol

A silly browser multiplayer movement shooter set on Ghibli-style sky islands: **bhop, surf, slide, wallrun, grapple, snipe**. It's in the spirit of CS:GO Combat Surf.

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

## Skins

Pick your look from the **Skin** chip on the home screen: eight named presets, individual hair style, hair colour, face, accessory, ahoge, scarf and jacket pickers, a Surprise me button, or Default (seeded from your name, as before). A live 3D preview turns as you choose. The skin is saved in your browser, used in Practice, and sent when you host or join, so everyone sees it. The jacket colour is a preference: online you get it if nobody in the lobby has it, otherwise the server picks one (Auto).


## Cases, loot and the knife
Eliminations pay **Acorns** 🌰 (10 per player kill, +5 for a headshot, 3 per zombie), shown on the home screen and in the corner of the HUD. Spend them in the **Store** on a case (Skyline: AWP paints, Windblade: knives, Wardrobe: hats, faces and backs) and watch the reel roll. Drops come in CSGO's rarities (Consumer, Industrial, Mil-Spec, Restricted, Classified, Covert, and a gold Exceedingly Rare tier). The **Inventory** lists what you own with a turning preview: equip an item, unequip it, or sell spares for acorns. Equipped gear is saved in your browser and everyone in the lobby sees it.

Press **2** for the knife (LMB stabs, one hit kills, no momentum lost) and **1** to bring the rifle back. Knives come in four shapes (field knife, karambit, machete, kunai) with many colourways.

## Accounts

Optional and simple, for friends: pick **Sign in** on the home screen to create an account with a username and password (usernames are 3-16 letters, numbers, `_` or `-`). Signed in, you always play under your username and nobody else can use it; guests can still play, but a guest who types a taken name shows up as "name (guest)". See `docs/DEPLOYMENT.md` for how it works.

## Game types

Pick one when hosting:

- **Battle**: free-for-all, one AWP each, one shot, one kill.
- **Survival**: co-op against rounds of zombies on the same map. You start by the Great Tree, and zombies climb out of the clouds around the island's rim. They shamble at you and claw you (you have 100 HP), hop over roots, and pounce up onto ledges and across gaps. Each round brings more of them, and they get a bit faster and tougher: from round 3 a body shot won't drop one, but a headshot still will. Clear a round and everyone is revived and healed. If everyone goes down, a post-game screen ranks everyone by zombie kills (MVP crown for the top scorer); press Play again to start over from round 1 once everyone is ready (or after 90 s), or Home to leave. Survival is played at **night**: a moon, stars, fireflies and dark clouds, with the pads, wind gates, hooks and stations glowing like lanterns.
  - **Points and Pack-a-Punch:** each zombie kill earns points (60 for a body shot, 100 for a headshot). At 5000 points you can buy the Pack-a-Punch upgrade at the machine west of the Great Tree (stand within 2.5 m, press F). Your rifle then cycles about twice as fast, holds 20 rounds, reloads faster, hits 2.5x as hard, and its shots pierce through zombies lined up behind the first, with a mint glow and tracer everyone can see. You keep it through deaths and rounds until the run restarts (game over); points work the same way. Across the tree from it, a **Juggernog** station (press F, 2500 points) raises your maximum health from 100 to 250 until the run restarts.

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
| Q | Grenade: lob a frag in front of you (your own speed rides along). It goes off after about 2 s, kills anyone close and in line of sight and shoves everyone nearby, you included, without slowing you. You get another 8 s after throwing; the icon bottom-left greys out and a ring refills. |
| E | Grapple: aim at any surface within 40 m and the rope reels you toward it (Space lets go and keeps your speed; 1.5 s recharge). Hook another player to zip to them, or aim near a glowing brass ring in the sky: it grabs the rope. Kills while roped score YANKED, and REELED IN if you're hooked on the victim. |
| F | Survival only: at the Pack-a-Punch machine (the brass kettle by the Great Tree), buy the upgrade. |
| Shift (hold) | Slide. Hold it in the air to slide the moment you land. Jumping out of a slide keeps your speed. |
| Run along a wall in the air | Wallrun. Space wall-jumps off it; tapping Space next to any wall kicks off it too (once per wall until you land), and refreshes the double jump. |
| Steep blue ramps | Surf: strafe into the ramp to ride it. |
| LMB / RMB | Shoot / hold to scope. The bolt cycle drops you out of scope, and you scope back in if still holding. No-scopes have spread. |
| R | Reload (automatic when the mag runs dry) |
| Tab | Scoreboard |
| (when sniped) | Kill-cam: the last two seconds replayed from the killer's eyes, with you in it |
| `` ` `` | Live movement tuning panel |

## Movement

The movement is a port of CS:GO's Source `gamemovement` with combat-surf server settings: autobhop, no speed cap, no stamina. In practice:

- **Momentum is kept.** There is no air friction, and a jump on the landing tick skips ground friction entirely.
- **Air-strafing works as in CS.** You gain speed by strafing and turning together; holding W while strafing works against you.
- **Surfing.** Slopes steeper than about 45° can be surfed.
- **Additions not in CS:** sliding, wallruns, wind gates (speed boosters, push you whichever way you cross them), puffball mushrooms (jump boosters that also throw you the way you're moving), launch pads, and an 80 ms jump buffer that approximates scroll-wheel spam.

## Using a real AWP model

A procedural CS-style AWP is built in. To use a real model instead:

1. Download **[AWP Sniper Rifle by BlenderGuy](https://sketchfab.com/3d-models/awp-sniper-rifle-428942868d1742fabaf80d556e957c88)** (CC BY 4.0) from Sketchfab as **glTF Binary (.glb)**. This needs a free account.
2. Save it as `public/models/awp.glb`.

The game auto-fits and toon-shades the model and attaches its bolt and magazine parts to the animations. The console logs which parts it found. The CC BY credit appears on the pause screen; keep it if you ship.

Developer docs (architecture, conventions, gotchas) are in [CLAUDE.md](CLAUDE.md). Design and ops plans are in [docs/](docs): the map, the menu, and free deployment.
