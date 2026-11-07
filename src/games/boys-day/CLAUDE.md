# BOYS DAY (agent instructions)

A co-op zombie road trip for 1–8 players, in the spirit of RV There Yet, PEAK, CoD Zombies' Transit and The Big
Walk. A group of Queen's students (Kingston, Ontario) wake up in a paintball arena in the next town over after a huge
night out. The apocalypse started while they were blacked out. They drive a battered city bus home, painting zombies
out of its windows, to take bong tokes with the boys. Cartoony and silly, spooky but never grim: a moonlit night,
fog, jack-o'-lanterns, dead trees, graveyards, lightning, zombies with glowing eyes.

Read `src/games/CLAUDE.md` first (the plug-in rules: stay in this folder, `three` only, scoped CSS under `.boys-day`,
controllers, cleanup, names via `textContent`).

## The run

1. **Paintball arena** (the start): you wake up holding paintball markers.
2. **Tee Time Driving Range**: park in the yellow ring; anyone presses E/Ⓐ (a big prompt says so) for **Zombie Tee-Off**
   (zombies shamble up the floodlit range at you: aim across, hold to wind up the power, let go to swing; land it on one
   to tee it off; let one reach the tee and it grabs you). `run.tees` between you (it grows with the crew, `goals`, so
   everyone gets a go) wins the **golf club**: V/RB swings it and tees off zombies in reach ("FORE!").
3. **Lucky Limestone Casino**: **Reel Stopper** (pull the lever, then stop each reel yourself, each faster than the
   last) pays into the shared bail fund until it reaches `run.bail` (also from `goals`).
4. **Kingston Holding Cells**: the bail is paid on arrival, then hold the horde off for `RUN.jailHold` s while Gordie
   is processed. **Gordie** then stands in the aisle in his orange jumpsuit and shoots on his own.
5. **The boys' house** (near a limestone Queen's tower): park there and you win.

Everyone rides **in first person**. One player **drives** from the cab (the windscreen, a turning wheel; C/View swaps
to a chase camera). Everyone else is **on foot about the bus** (`Spot`: side, along, level): WASD or the left stick
walks the aisle (`walk`, `walkBounds`), and at the **hatch** by the back (`WALK.hatch`, a ladder under it) Space/Ⓑ
climbs up to the **roof deck** (railed, the whole length of the bus) or back down. Inside you shoot out of the
windows; paintballs that hit a wall, the roof or the floor splat on it (`wallHit`). The wheel is first come: walk up to
it and press F/Ⓨ (`atCab`, `takeWheel`); F/Ⓨ again gets you up (`OFF_CAB`). Nobody at the wheel and the bus rolls to a
stop.

**The drive is rough, like RV There Yet**: the land is rolling hills (`terrain.ts`: seeded value noise; the road
follows them, smoothed and never steeper than `TERRAIN.maxGrade`, flat where you park). Uphill slows the bus and a
stalled climb rolls back; downhill runs it on (to `BUS.runaway` of top speed). The road has **hazards** (`route.ts`
`Hazard`): fallen trees and boulders across a lane (solid: steer round), potholes (a jolt and `HAZARD.potholeDamage`)
and mud (slow, and the wheel barely bites). **Fuel**: the tank burns `RUN.burn` a metre and won't last the whole way
home; **gas cans** by the road (shoot them or drive over them) top it up. Empty, the bus splutters at `BUS.fumes`.

**Zombies come in rounds** (`ROUNDS`): a calm (`first`, then `calm` between), then "ROUND n" sends `ROUNDS.size`
zombies, a few at a time and never more than `ROUNDS.alive` at once; kill them all and the next calm starts. Both
grow with the round, the stage and the crew (`HORDE.crewScale`). The HUD shows the round and how many are left. The
bus at speed **yeets** zombies; slow or parked, they climb up the sides and chew it until shot off. Cash bags, repair
kits and gas cans by the road are collected by shooting them or driving over them. The bus at 0 hp loses the run.
**Every run is a new map** (a fresh seed): the road, the hills, the hazards, the scenery and the pickups all come from
`makeRoute(seed)`.

**Looks**: a moonlit night with fog, lightning, and (by default, "Fancy" in the pause menu) bloom and moonlight
shadows that follow the camera (`post.ts`; "Fast" turns both off and is remembered per browser). The ground is a
grid draped on `groundAt` and tinted by height; buildings run on down into the slopes (`FOOTING`).

## Files

| File | What |
| --- | --- |
| `channel.ts` | the channel (id `boys-day`, order 35) |
| `game.ts` | the app: menu (solo / host / join), lobby, starting runs (`start` carries the seed and the first driver), leaving |
| `session.ts` | one run on this screen: driving, walking the bus and the roof, the bus on the hills, shooting, the club, the wheel, minigames, HUD, pause, the end |
| `director.ts` | the host's referee, pure: zombie rounds (spawn, chase, climb, yeet), stops, money, fuel, potholes, Gordie, pickups |
| `rules.ts` | pure rules and every tunable: `BUS`, `stepBus` (with the `Ground` under it), `collideBus`, walking (`WALK`, `walk`, `wallHit`), `STOP_ORDER`, `RUN`, `goals`, `ZOMBIE`, `ROUNDS`, `HORDE`, `GUN`, `CLUB`, `GORDIE`, `GOLF`, `SLOTS` |
| `route.ts` | the map generator, pure: the road (bus-drivable bends, never crosses itself, heights from the hills), stops, props, obstacles, hazards, pickups; `groundAt`, `hazardAt` |
| `terrain.ts` | the hills, pure: `TERRAIN`, seeded noise, the road's heights (grade-clamped, flat at stops), `wildness` |
| `net.ts` | the messages and `readMsg` (checks every message's shape), `takeWheel` |
| `world.ts` / `models.ts` | three.js: the night (`World.dress`: sky, moon, fog, lightning, the shadow-casting moonlight), the hilly ground, road ribbon, hazards, stop buildings and signs, instanced scenery and jack-o'-lanterns, gas cans; the bus (a walled shell with a cab, a cabin, a hatch and ladder, a railed roof deck, headlights), beans, the instanced horde, paintballs and splats |
| `post.ts` | bloom and shadows ("Fancy") or straight to the screen ("Fast") |
| `hud.ts`, `minigames.ts`, `input.ts`, `audio.ts`, `banner.ts`, `boys.css` | HUD and minimap; golf and slots; keyboard/mouse/pad; synthesised sound; the channel art; styles |

Tests: `tests/boys-day.test.ts` (maps are deterministic and drivable: an autopilot bus drives 12 seeds end to end over
the hills and through the mud; bus physics on slopes and in mud; terrain grades and flat stops; hazards; fuel and gas;
walking, the hatch, the cab and window/wall hits; rounds; every stop's rules; zombies; crew scaling of the horde and the
goals; pickups by driving; the wire format, including every seed the host can roll; minigame maths).

Lights: the bus brings its headlight spot and a cabin light, and the sky its hemisphere and moonlight, all added once
at the start. Never add or remove a light mid-run (every lit shader recompiles); lightning changes an intensity. The
Fancy/Fast switch recompiles once, from the pause menu, which is fine.
Everything else that glows (lamps, windows, pumpkins, eyes) is an unlit or emissive material. In dev, `window.__boys` is the app and
`__boys.session` the run (`__boys.session.director` on the host).

## Netcode

The party relay only forwards messages, so the **host's browser referees** (like Royal Degeneracy). The **driver's
browser moves the bus** (`bus` at 15 Hz; everyone else smooths toward it); with nobody driving the host lets it roll
to a stop. Who drives is the host's call (`drive` asks, `driver` tells everyone). Everyone sends where they stand on
the bus with their aim (`aim`, 8 Hz). The host sends zombies plus the effects since last time (`z`, 10 Hz) and the run state (`run`, 3 Hz and on
every change). Players batch a tenth of a second's shots, hits, pickups and swings into one `act`. Batching keeps
everyone under the relay's 60 messages a second. Hits are claimed by the shooter (what you see is what you hit) and
checked by the director (alive, in reach for the club). It's co-op among friends: the checks stop a broken client,
not a cheat.

## Next iterations (ideas agreed with the user, not built yet)

- **The longboard ride**: a downhill longboard section through the Queen's campus area on the way home.
- **More Big Walk-style minigames** at stops and along the road (the user wants "as many as possible").
- Kingston landmarks along the route (limestone buildings, the lake), more stop variety per run.
- Late joining mid-run; a ready check in the lobby.
- Touch controls (phones): not in v1.
