# BOYS DAY (agent instructions)

A co-op zombie road trip for 1–8 players, in the spirit of RV There Yet, PEAK, CoD Zombies' Transit and The Big
Walk. A group of Queen's students (Kingston, Ontario) wake up in a paintball arena in the next town over after a huge
night out. The apocalypse started while they were blacked out. They drive a battered city bus home, painting zombies
out of its windows, to take bong tokes with the boys. Cartoony and silly, spooky but never grim: a moonlit night,
fog, jack-o'-lanterns, dead trees, graveyards, lightning, zombies with glowing eyes.

Read `src/games/CLAUDE.md` first (the plug-in rules: stay in this folder, `three` only, scoped CSS under `.boys-day`,
controllers, cleanup, names via `textContent`).

## The run (v1)

1. **Paintball arena** (the start): you wake up holding paintball markers.
2. **Tee Time Driving Range**: park in the yellow ring; anyone presses E/Ⓐ for **Zombie Tee-Off** (zombies shamble up
   the floodlit range at you: aim across, hold to wind up the power, let go to swing; land it on one to tee it off; let
   one reach the tee and it grabs you). `RUN.golfTees` between you wins the **golf club**: V/RB at your window swings
   it and tees off zombies in reach ("FORE!").
3. **Lucky Limestone Casino**: **Reel Stopper** (pull the lever, then stop each reel yourself, each faster than the
   last) pays into the shared bail fund until it reaches `RUN.bail`.
4. **Kingston Holding Cells**: the bail is paid on arrival, then hold the horde off for `RUN.jailHold` s while Gordie
   is processed. **Gordie** then stands in the aisle in his orange jumpsuit and shoots on his own.
5. **The boys' house** (near a limestone Queen's tower): park there and you win.

Everyone rides **inside the bus, in first person** (`SEATS`, each with the way it faces). One player **drives** from
the cab (seat 0: the windscreen, a turning wheel; C/View swaps to a chase camera); everyone else stands at a side
window (or the back one) with a paintball marker and looks out of it (`LOOK` limits how far you turn). F/Ⓨ swaps
(into the driver's seat if it's free). The bus at speed **yeets** zombies; slow or parked, they climb up to the
windows and chew it until shot off (or flung off at speed). Cash bags and repair kits by the road are collected by
shooting them or **driving over them** (a kit on a full bus says so). The bus at 0 hp loses the run. The horde
**scales with the crew** (`HORDE.crewScale`: half for solo, the lot for four, about 1.5× for eight; spawning too). **Every run is a new map** (a fresh seed): the road, the scenery, the pickups and the
sleeping hordes all come from `makeRoute(seed)`.

## Files

| File | What |
| --- | --- |
| `channel.ts` | the channel (id `boys-day`, order 35) |
| `game.ts` | the app: menu (solo / host / join), lobby, starting runs (`start` carries the seed and seats), leaving |
| `session.ts` | one run on this screen: driving or the roof, shooting, the club, seats, minigames, HUD, pause, the end |
| `director.ts` | the host's referee, pure: zombies (spawn, chase, climb, yeet), stops, money, Gordie, pickups |
| `rules.ts` | pure rules and every tunable: `BUS`, `stepBus`, `collideBus`, `SEATS`, `STOP_ORDER`, `RUN`, `ZOMBIE`, `HORDE`, `GUN`, `CLUB`, `GORDIE`, `GOLF`, `SLOTS` |
| `route.ts` | the map generator, pure: the road (bus-drivable bends, never crosses itself), stops, props, obstacles, pickups, hordes |
| `net.ts` | the messages and `readMsg` (checks every message's shape), `takeSeat`, `firstSeats` |
| `world.ts` / `models.ts` | three.js: the night (`World.dress`: sky, moon, fog, lightning), ground, road ribbon, stop buildings and signs, instanced scenery, jack-o'-lanterns; the bus (a walled shell with a cab and cabin, headlights), beans, the instanced horde, paintballs and splats |
| `hud.ts`, `minigames.ts`, `input.ts`, `audio.ts`, `banner.ts`, `boys.css` | HUD and minimap; golf and slots; keyboard/mouse/pad; synthesised sound; the channel art; styles |

Tests: `tests/boys-day.test.ts` (maps are deterministic and drivable: an autopilot bus drives 12 seeds end to end;
bus physics; every stop's rules; zombies; crew scaling; pickups by driving; the wire format, including every seed the
host can roll; minigame maths).

Lights: the bus brings its headlight spot and a cabin light, and the sky its hemisphere and moonlight, all added once
at the start. Never add or remove a light mid-run (every lit shader recompiles); lightning changes an intensity.
Everything else that glows (lamps, windows, pumpkins, eyes) is an unlit or emissive material. In dev, `window.__boys` is the app and
`__boys.session` the run (`__boys.session.director` on the host).

## Netcode

The party relay only forwards messages, so the **host's browser referees** (like Royal Degeneracy). The **driver's
browser moves the bus** (`bus` at 15 Hz; everyone else smooths toward it); with nobody driving the host lets it roll
to a stop. The host sends zombies plus the effects since last time (`z`, 10 Hz) and the run state (`run`, 3 Hz and on
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
