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

**On a phone**: play sideways (it asks you to rotate). Fortnite-style touch controls: drag anywhere on the left for a joystick, swipe on the right to look, hold FIRE and drag to aim while shooting, plus jump, slide, scope, grapple, grenade, reload, weapon swap and pause buttons. The menus have compact landscape layouts too. Desktop is unchanged.

**King of the Hill** (a Battle format when hosting): Sunset vs Tide on **Crown**, a sky island built around one hill. Stand on the hill with no enemies on it to capture it; your team's clock runs while you hold it, and the first team to 3 minutes wins. Overwatch-style: more of you capture faster, enemies on the hill freeze the capture (contested), and you can't win while they're still fighting for it (overtime). The bar at the top shows both clocks, who owns the hill, the capture ring and who is standing on it. Each team respawns in its own base.

**Summit** (Battle): a snowy mountain top above the clouds. A rock ridge splits it with slide ramps into wind gates and a summit nook you pad up to; an ice chute to surf down a gully, a cable station run, a log lodge with a sniper roof, ice walls to wallrun. Step off the edge and the clouds take you.

**Dune Village** (pick it when hosting a Battle): a sunbaked market town inside a sandstone wall. Snipe from flat roofs and the gatehouse towers, surf the glazed-tile aqueduct, slide down the dune into a wind-gate run, swing roof to roof over the market.

**Practice** runs offline on Windward against sniper bots. Pick **Easy**, **Normal** or **Hard** first (it's remembered): Easy bots are slow to spot you and miss a lot, Normal bots hunt you and strafe, Hard bots react quickly, hop and go for the head. Bots need a moment to settle their aim, miss more the faster you move (keep bhopping), and only one fires at a time. A bot that's aiming at you shows a red laser and a red glint that swells just before it fires; you get 3 s after respawning before they shoot. Bots that lose you slip round to a new angle on you. Each bot kill pays 1 coin (no XP). **Host** creates a lobby with a 4-letter code. Others join with that code, from the lobby list, or with `/?join=CODE`.

## Skins

Pick your look from the **Skin** chip on the home screen: eight named presets, individual hair style, hair colour, face, accessory, ahoge, scarf and jacket pickers, a Surprise me button, or Default (seeded from your name, as before). A live 3D preview turns as you choose. The skin is saved in your browser, used in Practice, and sent when you host or join, so everyone sees it. The jacket colour is a preference: online you get it if nobody in the lobby has it, otherwise the server picks one (Auto).


## Cases, loot and the knife
**Levels**: online play earns XP: 20 per Battle kill, 75 for finishing a match and 100 more for winning; in Survival 5 per zombie, 40 per round cleared, 150 when the Foreman goes down and 75 for finishing a run. Each level needs a little more XP than the last. Your level sits on the home screen, and after every Battle match and Survival run a card shows the XP you earned, what for, and the bar filling toward the next level. Like coins, it's saved in your browser.

Coins come from playing online: **10 per kill and 50 for winning** a Battle match, and in Survival **10 for every round cleared and 50 when the boss goes down** (everyone in the lobby gets those), shown on the home screen and in the corner of the HUD. Spend them in the **Casino**: open a case (Skyline: AWP paints, Windblade: knives, Wardrobe: hats, faces and backs) and watch the reel roll, drop a ball down **Plinko** (bet any amount; slots pay 0.4× up to 30×), or play the house at **Blackjack** (dealer stands on 17, blackjack pays 3:2, double on any two cards). Drops come in CSGO's rarities (Consumer, Industrial, Mil-Spec, Restricted, Classified, Covert, and a gold Exceedingly Rare tier). The **Inventory** lists what you own with a turning preview: equip an item, unequip it, or sell spares for coins. Equipped gear is saved in your browser and everyone in the lobby sees it.

Press **2** for the knife (**3** in Survival, where 2 is your second gun; LMB stabs, one hit kills, no momentum lost) and **1** to bring your gun back. Knives come in four shapes (field knife, karambit, machete, kunai) with many colourways.

## Accounts

Optional and simple, for friends: pick **Sign in** on the home screen to create an account with a username and password (usernames are 3-16 letters, numbers, `_` or `-`). Signed in, you always play under your username and nobody else can use it; guests can still play, but a guest who types a taken name shows up as "name (guest)". See `docs/DEPLOYMENT.md` for how it works.

## Game types

Pick one when hosting:

- **Battle**: one AWP each, one shot, one kill. The host picks **Free for all** or **Teams** (Sunset vs Tide: pick a side in the lobby room, or hit Random teams; no friendly fire). First to 30 kills wins (a team's kills add up), then a fresh match starts after a few seconds.
- **Survival**: co-op against rounds of zombies in **the Foundry**, an old walled factory at night (full design notes: `docs/FOUNDRY.md`). Think Call of Duty zombies:
  - **Start small.** You spawn in the little Office with a pistol (the Sparrow). Everything else is behind **doors you buy** (F, 750-1500 points each): the Assembly Hall, Boiler Room, Storage, Furnace, Locker Room and Loading Dock, plus a mezzanine you can snipe from.
  - **Zombies break in through boarded windows.** Fourteen bays in the outside walls are nailed shut with five planks each. Zombies queue outside, rip the boards off one by one, then climb in and chase you through whatever rooms you have opened. **Hold F at a window to nail the boards back up** (10 points a board); you can't repair one while a zombie is standing on it.
  - **Guns off the walls.** Chalk-lit wall guns sell the Marshal revolver, the Rattler SMG, the Warden rifle, the Bramble shotgun and the Kestrel lever-action (600-1500 points); buy the same gun again for half price to refill its ammo. You carry two guns (**1** / **2** to switch).
  - **The Mystery Box** (950 points, moves between four spots): any gun in the game, including the Hammer LMG, the AWP and the Sunbeam ray gun. Sometimes the box gives you a sad plush instead: your points come back and it moves.
  - **Pack-a-Punch** (5000 points, in the Furnace) upgrades the gun in your hands: about 2.5x damage, 1.5x the ammo, quicker cycling and reloads, a new name, a mint glow and a red-dot sight (stock guns aim down iron sights). Every gun has a Pack-a-Punched version. **Juggernog** (2500, in Storage) raises your maximum health from 100 to 250. Three more perk machines wait in rooms you have to open: **Swift Mend** (1500, Boiler Room) revives teammates twice as fast, **Zephyr Fizz** (2000, Loading Dock) makes you run 25% faster, and **Second Wind** (2500, Locker Room) gets you back up by yourself once.
  - **Going down**: at 0 health you drop where you stand instead of dying. Zombies leave you alone, a teammate holds F beside you for 4 seconds to get you up, and if nobody does in 30 seconds you're out until the round ends. Everyone down is game over.
  - **The Foreman**: every 5th round a giant zombie with a health bar breaks in first. He gets tougher every time, and more players means more health. Killing him pays 500 points to whoever lands the kill and 50 coins to everyone.
  - **The power is off** when a run starts: the lamps are dark and the perk machines, Juggernog and the Pack-a-Punch don't work. Throw the switch on the generator in the **Boiler Room** to bring them to life.
  - **Zombies with jobs**: from round 2 a growing share of the horde turns up in work clothes. **Welders** wear a welding mask (headshots only do body damage) and a leather apron (tougher). **Couriers** in red caps are fast and flimsy and pay a 60-point tip. **Stokers** glow with embers and burst when they die, scorching anyone (zombies included) within 3 m.
  - **Round modifiers**: every 3rd round comes with a twist, announced at the start: Rush Hour (faster zombies), Double Shift (double points), Smog (thick fog), Big Heads (easy headshots), Moon Shift (low gravity) or Shrink Ray (tiny, weaker zombies). Never the same twice in a row.
  - **The Gale Scythe** (wonder weapon): three parts glow in the far rooms (Locker Room, Loading Dock, Furnace). Press F to pick each one up (for the whole team), build it at the workbench on the mezzanine, and one player takes it. It replaces their knife: every swing cuts all zombies around them. If they leave or bleed out it goes back on the bench.
  - **The Skyline** (2000 points): a hatch in the Assembly Hall's roof. Buy it and a pad throws you up onto a tower on the roof, where three surf lines run off to the Boiler Room, Storage and the Furnace and dive through chutes into them (a chute stays shut until its room is open). Don't hang about up there: the roof is scorching and burns after 6 seconds.
  - **Max Ammo**: a glowing ammo crate. Zombies drop one about 1 kill in 100, but the horde gives at most one every 4 rounds; The Foreman always drops one. Whoever walks into it fills every gun of every player. It blinks and fades after 25 seconds.
  - **Points** come from kills (60 body, 100 head), 10 per hit and 10 per board. Health regenerates a few seconds after a claw. Each round brings more zombies, faster and tougher. Clear a round and everyone is revived and healed. If everyone goes down, a post-game screen ranks everyone by zombie kills (MVP crown for the top scorer); press Play again to start over from round 1 once everyone is ready (or after 90 s), or Home to leave.

## Guns (Survival)

Every gun has its own model and its own hands-on animation (recoil, action and reload), and its own Pack-a-Punched name.

| Gun | Where | Feel | Animation |
| --- | --- | --- | --- |
| Sparrow M1911 | start | 8-round pistol | slide blows back and locks open on the last round; mag drop, slide release |
| Marshal .44 | wall, 600 | heavy 6-shot revolver | hammer rises; cylinder swings out, six casings fall, speedloader goes in |
| Rattler SMG | wall, 1000 | fast and spraying | open bolt chatters; mag swap, charging handle |
| Warden AR | wall, 1200 | steady automatic rifle | curved mag swap, charging handle hauled back |
| Bramble 12g | wall, 1500 | 8-pellet pump shotgun | forend pumps every shot; shells thumbed in one at a time |
| Kestrel Lever | wall, 1500 | punchy lever-action | lever loop swings with your hand on it; shells through the side gate |
| Hammer LMG | box | 100-round belt-fed | top cover flips up, belt and box swapped, cover slammed |
| AWP | box | the original bolt sniper | bolt cycle; scoped |
| Sunbeam | box | ray gun with splash | coils spin up on every shot; the glowing cell pops out of the top |

Hold RMB to aim down the sights (the AWP scopes). Automatic guns fire while LMB is held.

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
| F | Survival only: buy doors, wall guns, the Mystery Box, Pack-a-Punch and the perks; take a gun from the box; hold at a window to repair the boards; hold beside a downed teammate to revive them. |
| 1 / 2 | Survival: switch between your two guns. |
| Shift (hold) | Slide. Hold it in the air to slide the moment you land. Jumping out of a slide keeps your speed. |
| Run along a wall in the air | Wallrun. Space wall-jumps off it; tapping Space next to any wall kicks off it too (once per wall until you land), and refreshes the double jump. |
| Steep blue ramps | Surf: strafe into the ramp to ride it. |
| LMB / RMB | Shoot (hold for automatic guns) / hold to aim down the sights or scope. The AWP's bolt cycle drops you out of scope, and you scope back in if still holding. Hip fire and no-scopes have spread. |
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
