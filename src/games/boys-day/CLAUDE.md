# BOYS DAY (agent instructions)

An endless co-op zombie road trip for 1–8 players, in the spirit of RV There Yet, PEAK, CoD Zombies and The Big Walk.
A group of Queen's students (Kingston, Ontario) wake up in a paintball arena after a huge night out. The apocalypse
started while they were blacked out. They drive a battered city bus from checkpoint to checkpoint, each one a new
world, painting zombies as they go. There is no finish line: the run ends when the bus is wrecked, and the score is
how many checkpoints you cleared. Cartoony and silly, spooky but never grim.

Read `src/games/CLAUDE.md` first (the plug-in rules: stay in this folder, `three` only, scoped CSS under `.boys-day`,
controllers, cleanup, names via `textContent`).

## The run

**A run is a chain of legs.** Each leg is its own map (`makeRoute(seed, leg)`): a road over the hills to a
**checkpoint** arena, then a **gate**. Park in the ring, **hop off the bus** (E/Ⓐ) and do the checkpoint's **job** on
foot; that opens the gate; climb back aboard and drive through it into the next leg, where every screen rebuilds the
world (`Session.enterLeg`). Zombies get tougher and more numerous with every leg and round; nothing caps it.

**Checkpoints are generated** (`checkpoints.ts`, `checkpointOf(seed, leg)`): a place (its name decides the job) × a
biome × a twist, about 2,700 combinations (`CHECKPOINT_COUNT`). The first four legs are the story: the driving range
(golf, wins the **club**), a scavenge, the casino (slots), the holding cells (a holdout that frees **Gordie**, who
then shoots from the aisle on his own).

| Job | What you do |
| --- | --- |
| `scavenge` | grab the crates scattered round the arena (each pays you scrap; sometimes a grenade) |
| `fuel` | lug jerry cans from the pump to the bus, one at a time, slower while carrying (fills the tank) |
| `beacon` | stand in the beacon's ring to crank it (a siege: the horde doesn't let up) |
| `holdout` | kill enough zombies while parked (a siege) |
| `golf` | the tee box: Zombie Tee-Off (`minigames.ts`) |
| `slots` | the slot machine: Reel Stopper |

**Biomes** (`BIOMES`, with a look each in `sky.ts` `LOOKS`): the sky, sun or moon, fog, weather, ground colours, scenery
and the post grade all change. **Twists** (`TWISTS`): a bigger horde, better pay, a storm, and so on, with a note on
the leg's title card.

**On the bus**, everyone is in first person. One player drives from the cab (C/View: chase camera); the wheel is
first come (F/Ⓨ at the front). The rest walk the aisle (`Spot`), climb the hatch to the roof deck (Space/Ⓑ) and shoot
out of the windows (`wallHit`). At the back: the **bong** and the **cooler** (E/Ⓐ: heal a bit; the bong warps the
picture, beers sway the camera) and the **card table** (`HANG`, `hangAt`). B/D-pad↑ opens the **store**.

**On foot** (`FOOT`, `stepFoot`, `hopOff`, `hopOn`, `canBoard`): zombies within `HORDE.chase` go for walkers and
bite. Your health is yours (kept on your own screen); it comes back on the bus. At zero you're **knocked out**: hauled
aboard, out for `FOOT.ko` s, and you drop `RUN.koLoss` of your scrap. Stray too far (`FOOT.left`) and you're hauled
aboard too. Everyone on foot when the bus goes through the gate comes with it.

**Scrap is personal** (`run.cash[place]`, by place in the crew): kills, crates, minigames, pickups and clearing a
checkpoint pay it. Spend it at the store (`UPGRADES`: scrap armour, a snow plow, an engine, a tank, hoppers and pitchforks,
for the whole bus, each one bolted on where you can see it: `showBusParts`; `BUY`: a
bus repair, a paint grenade, a bandage) or gamble it at the card table: **blackjack** against the dealer (`cards.ts`,
`BLACKJACK`, `bjPay`) or **heads-up five-card draw** against a friend (`duel.ts`, refereed by the host: ante, one
draw, one betting round with a single raise).

**Guns unlock as checkpoints clear** (`GUNS`, `gunsUnlocked`; Q/D-pad→ switches): the Marker, the Splatter Shotty
(pellets), the Paint Minigun, the Long Tom (slow, hits hard, flat) and the Balloon Launcher (lobbed, splash).
**Paint grenades** (G/D-pad↓, `NADE`): you start with a few, get more per checkpoint, from crates and the store.

**The drive is rough**: hills (`terrain.ts`), fallen trees, boulders, potholes and mud (`Hazard`), and a tank that
burns `RUN.burn` a metre; gas cans by the road and `fuel` checkpoints top it up. The bus at speed **yeets** zombies;
slow or parked they climb it and chew. **Zombies come in rounds** (`ROUNDS`), growing with the round, the leg and the crew.

## Files

| File | What |
| --- | --- |
| `channel.ts` | the channel (id `boys-day`, order 35) |
| `game.ts` | the app: menu (solo / host / join), lobby, starting runs, leaving |
| `session.ts` | one run on this screen: legs, the bus, walking on and off it, the jobs, guns and grenades, the hangout, the store, the card table, HUD, pause, the end |
| `director.ts` | the host's referee, pure: checkpoints and legs, rounds and sieges, zombies (chasing the bus or walkers), wallets, the store, fuel, potholes, Gordie, pickups |
| `duel.ts` | heads-up five-card draw, pure: the host's referee and the views it sends |
| `rules.ts` | pure rules and every tunable: the bus, walking on it and on foot, `JOBS`, `RUN`, `UPGRADES`/`BUY`, `GUNS`, `NADE`, `HANG`, cards (`pokerScore`, `bjTotal`), zombies, rounds |
| `checkpoints.ts` | the checkpoint generator, pure: `BIOMES`, `PLACES`, `TWISTS`, `checkpointOf` |
| `route.ts` | a leg's map, pure: road, checkpoint arena and its sites, gate, props, obstacles, hazards, pickups; `groundAt`, `hazardAt`, `solids` |
| `terrain.ts` | the hills, pure |
| `roster.ts` | the boys you can play as, pure: `BOYS` (looks follow their Royal Degeneracy cards), `castBoys` (your pick, or somebody nobody picked) |
| `net.ts` | the messages and `readMsg` (checks every message's shape), `takeWheel` |
| `sky.ts` | the sky that outlives the legs: shader dome (stars, aurora), sun/moon, lights, fog, weather; a `Look` per biome |
| `world.ts` / `models.ts` | three.js: a leg's ground, road, arena, gate and scenery; the bus (with the bong, cooler and card table), beans, guns, the horde, paintballs and splats |
| `assets.ts`, `art/` | the Blender models: `art/build.py` builds `art/boys-day.glb` (see `art/README.md`); `assets.ts` loads it and hands out geometry by name (`art('z_head')`), with the old code-built shapes as the fallback |
| `post.ts` | bloom, shadows and the grade ("Fancy") or straight to the screen ("Fast") |
| `cards.ts` | the card table's screens (blackjack, heads-up poker): DOM with real buttons |
| `hud.ts`, `minigames.ts`, `input.ts`, `audio.ts`, `banner.ts`, `boys.css` | HUD, minimap and the leg title card; golf and slots; keyboard/mouse/pad; synthesised sound; the channel art; styles |

Tests: `tests/boys-day.test.ts` (legs are deterministic and drivable; checkpoints; every job; on-foot movement and
boarding; bites and knock-outs; wallets and the store; guns and grenades; blackjack, poker hands and the duel; bus
physics; rounds; the wire format).

Lights: the bus's headlight and cabin light and the sky's lights are added once at the start and live for the whole
run (`Sky` is never rebuilt; a new leg changes colours and intensities). Never add or remove a light mid-run (every
lit shader recompiles). Every gun's viewmodel is built at the start and shown in turn for the same reason. In dev,
`window.__boys` is the app and `__boys.session` the run (`__boys.session.director` on the host).

## Netcode

In the lobby everyone says who they'd like to be (`pick`); the host casts the crew when it starts the run and `start`
carries the result (`boys`, by place in the crew).

The party relay only forwards messages, so the **host's browser referees** (`Director`, and `Duel` for the card
table). The **driver's browser moves the bus** (`bus` at 15 Hz, tagged with its leg `l`; a pose from another leg is
dropped); with nobody driving the host lets it roll to a stop. Everyone sends where they are with their aim (`aim`,
8 Hz: on the bus a `Spot`, off it `l: 2` with world x/z). The host sends zombies plus effects (`z`, 10 Hz) and the
run with this leg's taken pickups and crates (`run`, 3 Hz and on change). Players batch shots, hits, grenade hits,
pickups and swings into one `act` a tenth of a second; `do` (crate, can, knocked out, toke, drink), `mini`, `bj`,
`buy` and `duel` go to the host. Poker hands are sent to their owner alone (`party.send(data, toId)`); the table
(`table`) to everyone. Hits and blackjack results are claimed by the player and sanity-checked by the director
(bounds, alive, in reach): it's co-op among friends, the checks stop a broken client, not a cheat.

## Next iterations (ideas, not built yet)

- More jobs and Big Walk-style minigames at checkpoints; Texas Hold'em at the table for more than two.
- The longboard ride: a downhill section through the Queen's campus.
- Late joining mid-run; a ready check in the lobby; touch controls.
