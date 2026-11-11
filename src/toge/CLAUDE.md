# TŌGE (racing): the whole game

TŌGE is channel 2 on the game chooser: mountain-pass and circuit racing, solo against AI or online (up to 8).
Everything that is TŌGE's own lives in `src/toge/`: the pure rules and physics in `shared/` (used by client and
server), the browser in `client/`, the server in `server/` (`race.ts` + `raceroom.ts` + `garageStore.ts`). Its tests
are `tests/toge/`. This file is the guide for all of it.

TŌGE never imports Gambol (`src/gambol/`); `tests/boundaries.test.ts` checks it. What it shares with the rest of the
site is the shell: `src/client/pad.ts`, `src/client/account.ts`, `src/client/menu/ui.ts` (`$`, `esc`, `copy`,
`playerName`) and `router.ts` on the client, `src/server/rooms.ts` (`Socket`), `limiter.ts` and `worker.ts` (`Env`) on
the server. The shell wires TŌGE in: `src/client/main.ts` (screens `drive` / `drivelobby`, `ctx.drive`), and
`src/server/worker.ts` + `accounts.ts` + `directory.ts` (the RaceRoom DO, `/api/garage`, the 'race' lobby list).

**Handling = a realistic sim with an arcade layer on top.** `vehicle.ts` is a full rigid-body sim; the `arcade()`
layer (`ARCADE` constants, on by default, the `arcade` assist) makes it turn and drift like an arcade racer. Michael
raised `ARCADE` grip/yaw on 2026-10-30 because corners felt unmakeable, so don't weaken it without asking. Change
physics only with a test, and keep `tests/toge/racephysics.test.ts` green (it drives every car down every track with the AI).
Physics runs client-side only; the AI's target speed reads `ARCADE.grip`, so rivals scale with it.

Braking and traction (2026-11-02, after "braking is unintuitive"): arcade brakes bite `ARCADE.brakeGrip` (1.3) times
the tyres (about 1.1-1.5 g; 100-0 in 26-36 m), because 1 g brakes against `grip`-g corners left every bend arriving
too fast; the AI's braking distance reads it too. In arcade, cornering slip counts against the drive/brake budget only
in the share `sp.grip / ARCADE.grip` (the rest of the cornering is the arcade layer's, not the tyres'), so you can brake
and power through a bend. Traction control brakes a driven wheel that spins on its own (the unloaded inside wheel,
`Wheel.ex`) and cuts the engine only when both wheels of an axle spin: before, it cut the throttle all through every
corner and cars lost speed on full throttle out of a bend. `ARCADE.trailBrake` adds yaw on the brakes while turning in.
Simulation handling (`arcade` off) keeps the tyres' own numbers.

Wall riding (2026-11-06, Michael: "wall riding is faster than slowing down for corners"): grinding a barrier
drags the car by `SCRAPE + SCRAPE_V` × speed (9 + 0.6·v m/s², vehicle.ts `barrier()`), so a brush at hairpin speed
costs about 2 g and pinned at 150 km/h about 70 km/h a second. It applies to every car, CPU included; clean CPU lines
barely touch the rails, so their times didn't move.

Full throttle no longer wins (2026-11-10, Michael: "improve the gameplay ... make the game better"). Measured with the AI's
own steering and the throttle pinned, no brakes: that beat the old CPUs on 20 of 22 tracks (Monaco by 21 s). Two causes,
both fixed. (1) The rail was a better brake than the brakes: a car that went into a hairpin flat out bounced off the
outside wall at about the speed it would have braked to. Now a hit, not a brush, costs speed (`IMPACT` in vehicle.ts
`pushOff`: past 3 m/s into the rail, 2 m/s of speed per m/s more, keeping at least half): a 2° brush at 150 km/h costs
nothing extra, 12° about 30 km/h, 30° most of it. The open world's walls go through `pushOff` too. (2) The AI braked
early and softly (planned at ~60% of the brakes, feathered the pedal at ~0.5), planned corners on 0.86 of
`ARCADE.grip` though its line cuts the bends (it holds the road at `LINE_GRIP` 1.3 × grip × skill, plus `ARCADE.fast`
at speed), and lifted to 94 km/h for every crest. Now it brakes late and hard (`BRAKING`), takes crests at 151 km/h
(`CREST_SPEED`, scaled down below skill 0.84) but takes the flight out of its braking distance (`FLIGHT`), counts on half
the grip over `bumps` (it flew off Karasu Peak's), looks 30 m ahead instead of 42 in traffic (it cut kinks into the
car it was passing at 250 km/h; Hayate is now clean) and steers onto boost pads within 7 m of its line. Any Hard CPU
beats full throttle (racephysics "CPUs" test; Monaco is the closest, about a second); the three speed roads are flat
out for everyone.

**CPU difficulty** (driver.ts `CPU_LEVELS`, `rivalAi`; the Race page's CPU pills, saved as `atrous.cpu`, read by
racegame.ts `cpuLevel()`): Easy (pace 0.66, about where the CPUs were before), Normal (0.86, the default; its slowest
CPUs about match full throttle) and Hard (1: skills 0.84-0.94). The host's level also drives an online lobby's CPU racers.

Arcade refinements (2026-11-04, Devlin: "the drift hops", "turning radius and medium speeds", "losing traction at
speed should be possible"; then "the drift turns me 90° at once"), grip left as it was: the drift button is an
E-brake (`ARCADE.kick`, 0.1 s; longer spins rear-drive cars), not a hop; a drift eases into its rotation over
`driftEase` and holds its angle (past `driftAngle` the travel swings back onto the nose `driftHold` faster), so it
settles around 30-40° instead of 80-90° or a spin, still turning far tighter than grip; yaw is capped by the turning circle on full lock, so below ~40 km/h the car turns like a
car (it pivoted on a 1 m circle and scrubbed to a crawl); a yank of the stick against its own 0.25 s average at speed
(`ARCADE.loose`: none below 22 m/s, full from 35) slows the travel's swing onto the nose and over-rotates, so a
lock-to-lock flick at 126 km/h slides ~25° and catches itself. Smooth steering never triggers it; the AI only
swerving hard round something at speed (rockfall on Karasu Peak), and the AI test still passes. Then "let me drift
hairpins; steering against the drift is good as it is": holding the wheel into a drift tightens it (`ARCADE.driftIn`,
`car.tight`), building over 0.8 s to 1× more rotation and a slide held ~10° wider (about 45°), never past
`ARCADE.maxYaw`; easing off undoes it over 0.3 s. From 80 km/h a drift comes round a hairpin in ~15 m instead of
21 m; below ~50 km/h nothing changes (those drifts were already tight). Controller layout is the usual one: RT throttle, LT
brake (analog, `trigger()` dead zone), Ⓐ held to drift, Ⓧ/RB next car when spectating (`padPedals` in input.ts, tested in raceinput);
the keyboard brake ramps in at 14/s, the throttle at 5/s.

Drift bite and fast turning (2026-11-08, Michael: "the drifting is sometimes so weak it's a straight line ... turn a bit
steeper at high speeds. Just a bit"): a drift's travel only swung onto the nose at `driftAlign` × slip, and the slip
starts near zero, so at speed the car slid nearly straight for the first second while the nose came round (180 km/h:
6° of turn in 0.5 s, 23° in 1 s, against 19°/50° just steering). Now the path keeps curving at least
`ARCADE.driftCarry.share` (0.7) of the nose's yaw rate, building in over the first 0.15 rad of slip (so the tail still
gets out) and from 20 to 35 m/s (slow hairpin drifts stay as tight as they were; carrying their speed only widened
them): 13°/43° now, slip still ~35-40°. `ARCADE.fast` adds up to 12% more promised grip from 25 to 50 m/s in
`arcadeMaxYaw` (grip turn at 180 km/h 50° -> 56° in 1 s). The AI steers through `arcadeMaxYaw` but plans corner
speeds on `ARCADE.grip`, so CPU times barely moved (all race tracks within 0.3 s, one 2 s quicker).

## Menus and brand

The home screens (hub.ts: tabs Race, Garage, Performance, Style, Driver, Friends, Settings), the race lobby (lobby.ts) and cosmetics
(cosmeticsui.ts) follow the design system in **`src/toge/DESIGN.md`**: the brand, colour roles (red acts, cyan selects,
gold pays), type, the screen anatomy, the tab map and the components. Its tokens and components are in
`src/toge/client/hub.css`; reuse them rather than styling a new screen from scratch, and update DESIGN.md when you add
a component or a page.

## Content

- **Tracks** (`TrackId` in track.ts): passes `koripass` (alpine), `saltwind` (coast), `redmesa` (desert rally:
  gravel, crests, canyon), `tsukiyo` (night: bridge, tunnel), `momiji` (autumn), `sakura` (spring), `nagare` (Nagare Pass: alpine, 3.2 km, gentle
  (< 6%), 8 corners, a ~1 minute run built for grinding time trials; `clean: true` = no obstacles);
  circuits `monza` (3 laps), `spa`, `monaco` (2 laps), `kodama` (the time trial's ring), `hachi` (Hachi-no-ji: a 1.2 km figure 8 for drifting, 3 laps,
  the first pass over the crossing on a bridge), and three original grand prix layouts (2026-11-06): `minato` (Minato
  Street: a night street circuit in the city theme round a harbour, open waterfront, big wheel), `akane` (Akane Sands:
  desert GP in the late sun, long straights and hairpins) and `kazeoka` (Kazeoka Dunes: coast, a rollercoaster through
  sandy dunes above the sea), 2 laps each; two sprint rings by day (2026-11-10, Andrew: "high speed and swiftly turns
  ... 4 lap races but relatively shorter laps ... day-time maps"): `mizuumi` (Mizuumi Ring: alpine, on a lake, 1.45 km
  a lap) and `hibari` (Hibari Coast: coast clifftops, 1.35 km a lap), 4 laps each, 13 m wide, laid out as straights
  and arcs closed exactly (no corner under ~60 m, most 70-110 m, strung into left-right esses); both race at midday
  (`TRACK_LOOKS` raises the sun; the coast theme's own is 14°) and the boost test holds the short laps, day themes,
  no slow corners and at least two flicks a lap. Nearly every corner on a lap that short is a fast bend you brake
  into, so runoff covers ~45-65% of the road (the runoff test allows a sprint ring, a lap under 1.5 km, up to 70%
  instead of 40%). Two harder clifftop rings after them (same day: "two more maps similar to Hibari Coast but a bit
  more challenging"): `kamome` (Kamome Point, 1.32 km a lap) and `shiokaze` (Shiokaze Cliffs, 1.49 km, a tightening
  right; its line sits 56 m up the short main straight so the pad out of the last corner comes before it every lap,
  or the first lap's falls on the grid). Same recipe as Hibari but 11.5 m wide, corners down to ~45 m, about twice the
  flicks (three-corner esses) and ~16 m of hills a lap (grades under 7%; the loop generator adds them as sine waves
  round the lap); the boost test holds them narrower, tighter, twistier and hillier than Hibari; city `neonbay` (Neon Bay, live
  traffic); hill climb `karasu` (Karasu Peak: uphill, 4.1 km and 336 m up, narrow, `climb: true`, only in a Hill climb lobby).
  Track `Feature`s: gravel, canyon, bridge, tunnel, crest, `cut` (a gravel shortcut through gaps in the barrier) and
  `bumps` (heaved tarmac between two control points; the grade test skips them, like crests).
  Two speed roads (2026-11-08, Devlin: "a highway map ... like street racing" and "a wide map, where the turns are
  like 30 degree turns maximum, a high speed map"): `ryusei` (Ryūsei Expressway: city at night, 4.7 km, 16 m wide,
  sweepers no tighter than ~250 m, `traffic: 'highway'`: four lanes all going with the race, `HIGHWAY_LANES` in
  traffic.ts, 61-101 km/h from the slow lane on the left to the fast one by the median, trucks mostly in the slow two;
  walled, so no runoff; the road paint has a dashed middle) and `hayate` (Hayate Flats: desert, 4.8 km, 22 m wide,
  `clean`, every corner ≤ 30° of heading change, the boost test checks it; the kinks come at 250+ km/h, so the line
  across the width is the skill). Hayate has highway traffic too (Devlin, same day: "add cars to Hayate like there are on
  the other"): `lanesOf` spreads `HIGHWAY_LANES` across a wider road (±2.7 and ±8 m on its 22 m), and both highways
  paint four lanes. On a road whose same-way lanes are over `SPLIT_LANES` (4.6 m) apart, the AI also considers the
  gap between two lanes as a line (`SPLIT_CLEAR`, tighter than `CLEAR`): without it CPUs sat behind traffic and took
  97-209 s instead of ~76-80 s. At 250 km/h they don't hold the gap's exact middle, so they brush a car now and then;
  the traffic test (racephysics) drives every car through Neon Bay, Ryūsei and Hayate.
  A third, `seatosky` (Sea-to-Sky, 2026-11-08, Andrew: "a map modeled after HWY99 in British Columbia, going from end of
  West Van towards Whistler ... high average speed ... wider corners, but stronger turns where necessary"): alpine,
  5.7 km, 15 m wide, `clean`, no traffic, Howe Sound on the left (`water` 4, `tilt` leaning the land down into it).
  Horseshoe Bay, the cliff sweepers, Lions Bay's bluff, the run down past Britannia to the Squamish flats, the
  Cheakamus canyon climb, Daisy Lake, Whistler. Every corner is a 210-430 m sweeper except three you brake for
  (Lions Bay, the canyon pair: 54-71°, ~155-175 m); the boost test holds it to that. It was laid out as straights
  and arcs with a small generator (radius + angle per corner, elevation keys by distance) rather than by hand.
  Two six-lane grand prix roads (2026-11-09, Andrew: "straight aways with high speed, as well as important breaking
  points/turns ... make the whole road full of traffic with 6 lanes going in the same direction ... two different
  maps with the same vibe, but different layouts"): `shiden` (Shiden Boulevard: city at night, 5.3 km, a 1 km straight
  into a square left, a chicane, a hairpin) and `isonami` (Isonami Corniche: coast, 5.8 km, flat-out kinks by the sea,
  a 95° left, a hairpin on the headland, a chicane). Both 21 m wide, `lanes: 6` (six lanes painted, a dashed line
  between each) and `walled`: the barrier stands `WALL_GAP` outside the white line (`t.shoulder` 0, no verge, no
  runoff). They shipped with six lanes of same-way traffic wall to wall, then the same day Andrew asked to "remove
  traffic/cars from Shiden Boulevard and Isonami Corniche": no `traffic` now, and `clean`, so no bales, barrels or cones
  either, only the racers. Each has 4+ braking zones (a corner under 70 m after 300 m of straight); the boost test
  checks walls, the empty road and the zones. Their cup is Overdrive (below).
  Five town circuits (2026-11-10, Michael: "5 new maps ... all under the same cup ... based on unique cities like
  Taketomi Island in Okinawa"), 2 laps each, laid out as straights and arcs closed exactly with hills as sine waves
  round the lap, easiest first: `taketomi` (Taketomi Island: coast, flat coral island, square village corners and a
  fast beach sweep, 10 m wide, pale lanes), `hallstatt` (Hallstatt Shore: alpine, along the lake, a hairpin pair up the
  slope behind the village, evening), `goreme` (Göreme Valley: desert, flowing, one hairpin, sunrise, no trees, hot-air
  balloons), `oia` (Oia Caldera: coast, clifftop esses and a switchback, sunset, the caldera to the west) and
  `chefchaouen` (Chefchaouen Medina: coast theme for its pines and cypress, no sea, a stack of hairpins up the
  mountainside, 10 m wide). Each is lined with its own town instead of the theme's farmhouses (client/towns.ts, below).
- **No items** (2026-11-08, Devlin: "remove items from all maps"): mystery boxes, the item slot, the turbo/oil/shield/
  shockwave/comet items, the `item`/`used` messages and the item bonus money are gone. In their place, **boost pads**
  (boost.ts; same request: "a few mini rainbow speed boosters but it doesn't cover the whole lane and is only in
  strategic locations"): `placeBoosts` puts 2-3 per pass or per lap (`BOOST.most`) on the outside of corner exits that
  open onto a straight, `BOOST.w` (2.6 m) wide, at least `BOOST.gap` apart, scored by the straight after them; it
  loosens its idea of a corner and a straight (`BOOST.tiers`) until a track has `BOOST.fewest`. A circuit's pads repeat
  every lap. They keep off jumps, tunnels and shortcut mouths, and props keep off them. `padKick` (run in racegame.ts
  `pickups()` for you and the AI, wheels on the road) gives `BOOST.seconds` of boost at `BOOST.accel`, never weakening
  a stronger boost already running. Nothing on the wire: every client places the same pads. Free roam has none (`boosts: []` in world.ts). propview.ts draws them
  as one unlit rainbow mesh with chevrons that scroll forward (brighter than white, so they bloom at night).
- **Grand Prix cups** (cups.ts; Michael asked for "4 set maps, each group of 4 a cup like Mario Kart", 2026-11-08): `CUPS`
  puts every race track in a cup of four, raced in order: Torii (nagare, sakura, momiji, koripass), Mirage
  (saltwind, kazeoka, redmesa, akane), Lantern (minato, monaco, neonbay, tsukiyo), Apex (kodama, hachi, spa, monza) and
  Velocity (hayate, seatosky, monza, ryusei: the three speed roads plus Monza) and Overdrive (id `rush`, first named Rush Hour;
  neonbay, isonami, ryusei, shiden: the two grand prix roads with the city and the expressway) and Sprint (mizuumi,
  hibari, kamome, shiokaze: the four 4-lap sprint rings, easiest first) and Postcard (taketomi, hallstatt, goreme, oia,
  chefchaouen: the five town circuits, the only cup of five; `roundsOf(cup)` is a cup's round count, so every
  "Round 2 of 4" reads it). Only Velocity and Overdrive borrow tracks from other cups.
  Names and art are our own. `GP_POINTS` 15-12-10-8-6-4-2-1 by place, a DNF scores 0; `addRound` keeps the table (ties:
  more wins, then more seconds..., then the better place in the latest round). A new race track needs a cup (the cups
  test checks every one is in one, and only Velocity and Overdrive repeat tracks); a new cup is an append to `CupId` / `CUPS`.
  Solo: the Race page's cup cards start round 1 (`DriveOpts.gp`, at least 3 rivals); racegame.ts `soloCup` adds the
  places to the table (you are key `me`, rivals by name: the same every round) and Next race hands `onNext` the next
  round, so each round is a fresh RaceGame with its own loading screen. Every round pays like a solo race.
  Online: mode `gp` (race rules; `cleanMode` / `recordMode` false; no record ghost). The host picks a cup
  (`{t:'cup'}`, lobby only; `track` is ignored); `start` from the lobby begins round 1 (`nextRound()` in race.ts). The room
  keeps `gp` (cup, round, table keyed by racer id) and puts it on `load` and `results`; CPU racers still out when the
  people are home are placed by distance (they score, never get paid). After a round's results
  (`RACE.gpResultsSeconds`) the next round loads by itself, or sooner on the host's Next race; after the last the final
  table stays `RACE.cupResultsSeconds`, then the lobby (and `gp` clears). The host's `start` from the final results races
  the cup again. Each round pays like a race.
- **Toge, the open world** (`toge` in TRACK_DEFS with `world: true`; world.ts; Michael asked for it 2026-11-08: "a free
  play map of its own... players can just drive around and hang out... great spots to go fast, and cool cutting between
  cars on the highway"). An island: a 470 m mountain, a harbour city, and 37 km of roads built as data (`layout()`): the
  Ring Expressway (three lanes each way, a median, the 2 km flat Bayshore straight down the east coast, viaducts over the
  West Valley and the city's north side), Minato Boulevard and the city grid, Harbour Drive and the harbour meet (where
  everyone spawns), Tōge Pass (hairpins and bumps up to the summit loop and lookout), the Kita Descent (crests and
  bumps), a country road, and the Old Airfield (a 1.5 km runway with kickers at its end). It is not a race track:
  `RACE_TRACKS` (track.ts) leaves it out of every race list, cup, record and solo pick; `modeTracks('roam')` is only it.
  **Free roam** (`roam` in RaceMode, hosting only): no countdown (`countdown` ms 0), no finish, prizes, CPU racers
  or record ghost; it runs until the host's pause menu sends `end` (everyone back to the lobby). Someone who joins while
  it's on sends `joinin` from the lobby and gets a `load` with the next slot at the meet; `Racer.roaming` tells the others
  to put their car on the road. The pause menu teleports to the meet, the summit lookout or the airfield; R (reset) and
  the sea put you back on the nearest road (`respawnAt`). Speed traps (`trapCrossed`) on the Bayshore and the runway show
  your km/h; the HUD shows the road you're on and the whole map.
  How it works: every road's samples are concatenated into one set of world arrays with a spatial hash; the ground is a
  precomputed terrain field (coast, plain, mountain) pulled onto every nearby road's banked plane (only roads whose plane
  covers a point count there). Viaducts are deck samples on a second layer picked by the car's hint (like Hachi-no-ji);
  rails, the median, parapets and buildings are wall segments (`wallsNear`, vehicle.ts `worldWalls`). getTrack('toge')
  returns a Track whose `world` hooks take over heightAt / groundAt / locate, so racegame.ts and the physics run unchanged.
  Traffic (worldtraffic.ts): stock Pebbles on fixed-speed lanes (expressway 31/26/21 m/s by the median out, the
  boulevard, a loop up the pass), each a pure function of `roamClock()` (the wall clock: there's no GO), so every client
  sees the same cars without a byte on the wire. `stepNearMisses` pops NEAR MISS (chains within 3 s) when you pass one
  within `NEAR_MISS.close` quickly. worldview.ts draws it all (LOD terrain chunks, per-road meshes, instanced trees per
  tile near the roads, the city's towers and flats, landmarks); worldtrafficview.ts draws the traffic (the real Pebble
  model instanced near the camera, boxes further out). Its look is `TRACK_LOOKS.toge` (late afternoon, the sun up so
  every direction is lit). `/dev/race.html?track=toge` with `rl.place(x, z, yaw)` / `rl.look(...)` frames shots.
- **Cars** (`CarId`): pebble (starter), kitsune, bramble, shiro, tengu (twin-rotor coupe, pop-up lamps), vanta, and one
  bike, raiden (`body: 'bike'`, `isBike`); 8 upgrade `PARTS`, levels 0-5.
- **Bikes** run the same four-wheel physics on a narrow hidden `track` (1.2 m), with bike-sized wheel and engine inertia
  and engine braking and a body three times steadier than its little box (`BIKE_*` in cars.ts; without it a barrel
  spun it like a top), and no spoiler (the garage hides it; a code that carries one changes nothing).
  The look is all client side: `bikemodel.ts` builds painted lofted shells (UVs like the car bodies, so paint jobs,
  stripes and decals work), frame, fork, swingarm and wheels, and leans the model into turns by the cornering
  force `pose(..., lat)` gets from racegame.ts. `root.userData.lean` is the leaning frame (the cockpit camera rides in
  it, so the horizon tilts) and `root.userData.rider` is hidden from the rider's eye. Skid marks run down the middle.
  The rider is your driver (driver.ts, the `ride` clip, hips on the saddle): your own, each online rival's from
  `Racer.rider`, `rivalRider` per AI. `buildCar(owned, rider)` passes it on; the showroom passes `null` (empty saddle,
  your driver stands beside it). The rig's meshes are every clone's, so the bike never merges or disposes them.
- **Free looks** (`Look` in cars.ts, the Style → Paint page): paint (18), finish, rims (6 designs, 7 colours), spoiler,
  stripes, underglow, then the body options (cars only; the garage hides them for bikes): window `tint`, `roof` and `hood` (body colour / black / carbon), `trim`
  (window seals and door handles), `mirrors` and front `lip`. Every list is append-only (codes store indexes). A car
  code always carries the first eight look values; the body options go on the end only when one is off its default,
  so a car without them keeps its old code (`decodeCar` takes either; the 8-digit upgrades segment marks the end).
- **Cosmetics** (cosmetics.ts): 200 items in 17 slots (paint jobs, decals, window tints, head/tail lamps, rims, calipers,
  underglow, plates, plate frames/covers, exhaust tips, and bolt-on body parts: rear wing, hood, roof, front lip, sides,
  mudflaps), 5 rarities, won from 6 cases (Street, Night Run, Livery, Chrome, Aero, Legend) bought with garage money;
  equipped per car, plus free custom plate text. No effect on physics.
- **Drivers** (rider.ts): four realistic characters, steampunk crossed with cyberpunk (Marlowe, Kirika, Okonkwo,
  Inès), GLBs built in Blender by `tools/drivers` (docs/DRIVERS.md). Free, saved in the garage (`rider`, the `rider`
  action; a rider's code is its id). Your driver sits in your car (seen through the tinted glass, hands on their own
  wheel, turning it with the steering), rides your bike, stands by your car in the showroom (the Driver tab walks the
  camera in), and the lobby shows every racer's driver in the Crew row. AI rivals get the other three. Drivers are
  ~30k triangles: the race only draws those within `DRIVER_RANGE`. After changing one, rebuild it and keep
  `tests/toge/drivers.test.ts` and `hands.test.ts` green. Their hands on the wheel, the bike's grips and standing are
  fixed at load by client/hands.ts (2026-11-10, Michael: hand positions "look unnatural"; docs/DRIVERS.md).
- **Your own driver** (look.ts, docs/DRIVER_CREATOR.md): the Driver page's fifth card opens the creator (creator.ts):
  six bodies, skin, eyes, brows, hair, 12 outfits with colour zones, shoes, up to five kit pieces (mech arms, gloves),
  metal, leather, glow, wheel. A look is an `L2.` code and is itself a `Rider`, so it travels everywhere a legend's id
  does; the garage also keeps it as `look` while you drive a legend. wardrobe.ts assembles it from
  public/models/drivers/wardrobe (built by `tools/drivers/wardrobe.py`, Draco .gltf with shared textures; the decoder is
  in public/draco/). `/dev/drivers.html` (`window.lab`) shows legends and looks side by side. Keep
  `tests/toge/look.test.ts` green after a wardrobe rebuild.
- **Battle pass** (pass.ts, the Race → Battle pass page in passui.ts; Michael asked for it 2026-11-06): a 50-tier season
  (`PASS`, $50,000 of garage money, 500 XP a tier). Every race earns XP whether or not you own the pass (`raceXp`:
  finishing, cars beaten, a win, drifting; solo a 0.6 share, only when the solo prize pays), carried on the garage
  (`xp`, `pass`, `given`). Online the room puts `xp` on each `ResultRow` and `Accounts.raceReward` pays it; guests credit
  themselves. Buying the pass (`{a:'pass'}`) hands over every tier already reached (`givePass`), and each later tier
  as it comes. One reward per tier (`TIERS`), all exclusive: car cosmetics in no case (`passOnly`: their `cases` list is
  empty, and the Legend Case skips them), home backgrounds (`STAGES`: showroom.ts `stage()` draws a gradient sky, a
  dipped race backdrop, a sun or moon, a neon grid and motes; `g.bg`), driver metals (`PASS_METALS` in look.ts) and gear
  (`GEAR`: horns, ears, visor, halo, built in code on the head bone by client/passgear.ts; a look code's optional 17th
  field), player card titles (`g.title`) and money. Non-owners see every reward and preview it (the page tries cars'
  items on, puts the stage up, dresses your own driver); the creator shows pass pieces locked with their tier.
  New season: new items (append only, `PASS` in their cases list), new `TIERS`; keep `tests/toge/pass.test.ts` green.
- **Best times** (records.ts): every racer's quickest finish per track (`Bests`), whatever the car, but only from
  record modes: `recordMode()` in protocol.ts (time trial, hill climb). Races, online or solo, never count (Michael,
  2026-11-06, when races still had items; they still have drafting and bumping). Accounts' live on the server (`b:<user>`,
  toge/server/recordStore.ts): finishes go in from the room's results (`Accounts.raceTime`, only when `onResults`'
  `mode` is a record mode; then the room sends `records` so every client marks the new bests). Solo runs keep no
  time. Bests set before this rule on Kōri Pass, Saltwind and Red Mesa are wiped with `POST /api/admin/clear-race-records` (Accounts.clearRaceRecords,
  `RecordStore.clear`; docs/DEPLOYMENT.md). Guests keep theirs in localStorage
  (`garage.noteTime`, `atrous.bests`). The results screen tags a new best (`ResultLine.newBest`, gold "New best −0.532").
  Solo times are client-reported, so `cleanTime` refuses anything quicker than the track at `RECORDS.maxAvgSpeed`. Keep that bound above every car's top speed (records.test.ts checks it): at 90 m/s it silently dropped every quick Sea-to-Sky, Hayate and Ryusei time.
- **All-time boards** (records.ts `placeOnBoard`, recordStore.ts `lb:<track>`): every track keeps the top `BOARD.size`
  accounts, one row each (their best there). Each new account best goes on its board, and the `NewBest` comes back with
  `rank` (1 = a new track record) and `beat` (the record it took); the room's `records` rows carry both. Bests from
  before the boards are put on once (`Accounts.boardsBuilt`, flag `lb:built`). Guests never reach the board. Online,
  the room keeps finishers' times one at a time in finishing order, so two racers can't both take the record. The
  results show a red "Track record" banner + tag (`.rh-record`, `.rh-tr`) and a `#4` all-time tag (`.rh-rank`).
  Read with `GET /api/leaderboard` (every track's record and the medal table) or `?t=<track>` (its board); the page is
  Race → Leaderboard (leaderboardui.ts).
- **Medal table** (2026-11-10, Andrew: "who has the most #1, #2, #3 lap times of all the maps ... gold, silver,
  bronze"): records.ts `medalTable` counts every board's top three per account and ranks them like the Olympics (golds,
  then silvers, then bronzes, then name). It rides on `GET /api/leaderboard`'s summary (`medals`), so it's always the
  boards' own truth, and the Leaderboard page shows it under Overall (top `MEDAL_ROWS`, plus your row).
- **Times beaten** (same day: "if someone beats my fastest time, I want to know"): when a new best goes on a board,
  `RecordStore.record` works out everyone it moved down or off (records.ts `overtaken`) and adds a `Notice` to each of
  their `nt:<user>` lists (who, the track, both times, place before and after; newest first, at most `NOTICES.keep`).
  `GET /api/notices` gives a session its own; `POST /api/notices {seen: at}` clears them up to that one. The garage
  (hub.ts `loadNotices`) checks on arrival, when you sign in and every `NOTICE_POLL_MS`; each notice pops up once in
  this browser (`atrous.noticePop`), the Leaderboard sub-tab shows the count, and the page lists them (each opens that
  track's board) with Got it to clear them. Not over a lobby (the pit garage).
- **Record ghost** (ghost.ts, client/ghostcar.ts): each track record keeps its run (`gh:<track>`, only while it's the
  record; a record set without a usable run clears it). A run is the car's pose every `GHOST.every` s from GO (compact
  ints, `cleanTape` checks it). Online runs are recorded by the room from the `state` poses (race.ts `Member.rec`,
  handed to `onResults` as `tapes`); solo runs keep none. The lobby host's Record ghost toggle (`{t:'ghost'}`, `RECORD_GHOST`) has the room fetch the track's ghost
  (`Accounts.recordGhost`); the room message says whose it is (`record`) and `load` carries it. In the race it's a
  see-through car with a "TR" name tag and a map dot, never a racer (no place, contact or prize).
- **Friends** (the Friends tab, friendsui.ts): add accounts by username (site-wide lists, `src/shared/friends.ts`,
  `/api/friends`), see who added you, open a friend's garage (`/api/garage?u=`, a `TogeProfile`: cars, driver, races,
  wins, best times, no money). Their car goes on the turntable with their driver beside it, and their best times sit next
  to yours with the gap. Guests see a sign-in prompt and their own times.
- **Solo**: 0/3/5/7 AI rivals (hub.ts, saved as `atrous.rivals`) picked near your PI with your upgrades, at the CPU difficulty you pick; you start mid-pack.
- **Online**: Directory instance `"race"`, sockets `/ws?game=race`, up to `RACE.maxPlayers` (8).
- **CPU racers online** (`CPU` in protocol.ts): the host adds them in the lobby's first open slot (`cpu` add/remove, lobby only). The room keeps them as members with negative ids and a dead socket, ready from the start; the host's racegame.ts drives them as `rivals` (`netId`, the solo AI; the room picks `rivalCar` / `rivalRider` against the host's), sends their poses in one `cpus` message (relayed as one `snap`), and `cpufinish` / `cpuwreck` on its own `clock`. Everyone else sees them as remotes. They give up a seat to a person who joins a full lobby, leave with a host who quits mid-race, are DNF if the people are all home first, and are never paid: people get max(the prize among the people alone, the solo-share prize for the whole field). A win only counts against another person.

## Files

```
src/toge/shared/
  track.ts     the tracks as data (TRACK_DEFS: control points, width, theme, relief, tilt) and the ground: a sampled
               centreline, the road's banked plane out to `edge`, then a blend into procedural hills (every nearby stretch
               of road contributes, so hairpins stay seamless). heightAt / groundAt / locate (with a hint, so a car never
               jumps to a parallel leg) / pointAt / gridSlot. Built once per id (getTrack).
  vehicle.ts   the car: rigid body + 4 raycast wheels, SUB=4 substeps per 120 Hz tick. Suspension (spring, damper, ARB,
               bump stop), tyres (Pacejka-style curve on normalised combined slip, relaxation lengths, low-speed damping),
               drivetrain (torque curve, clutch slip at launch, auto/manual box, LSD, AWD split, engine braking, engine
               inertia through the gears), aero, ABS/TCS/steering assist, body scraping, barrier impulses, collideCars.
               The auto box (`autoShift`) picks gears from road speed (`roadRpm`), never from `car.rpm`: that jumps with
               wheelspin and parks at launch revs while the clutch slips, which made it upshift mid-drift and stay in 4th
               after a crash. It drops several gears at once when the car has slowed a lot.
               Then the `arcade()` layer (tuned by `ARCADE`, on by default in `DEFAULT_ASSISTS`): yaws the car toward
               the stick (never tighter than full lock's turning circle: `arcadeMaxYaw` takes the spec), swings travel
               onto the nose, drift levels + mini-turbo boosts (a drift starts with an `ARCADE.kick` E-brake: the rear
               wheels lock, declutched on a rear-driven car; it used to hop; held into, it tightens: `ARCADE.driftIn`; a fast drift's path keeps turning with the nose: `ARCADE.driftCarry`), a loose tail after a yank of the wheel at
               speed (`ARCADE.loose`, `car.loose`), levelling in the air.
  cars.ts      the catalogue (CARS), upgrades (PARTS, levels 0-5), looks, tuning, encode/decodeCar (the wire code), carSpec()
               (everything -> physics numbers), torqueAt, rating (PI + class), stats (garage bars).
  garage.ts    money, owned cars, crates (the gamble), payouts, applyAction (every garage change; run by the server for
               accounts and by the client for guests). Also cosmetic cases (`case`, duplicates refund by rarity), `equip`,
               `plate`, and ownedCarCode (strips cosmetics an account doesn't own from a race code).
  cosmetics.ts the cosmetics catalogue (CATALOG per slot, APPEND ONLY: the wire code is each slot's index), cases + odds,
               rollCosCase, CosKit (what a car wears), encode/decodeKit (the optional last segment of a car code).
  standings.ts race order (finishers by time, then progress); the place readout and the leaderboard both use it.
               Lap races pass laps × lap length + distance into the lap as `progress`.
  driver.ts    AI: pure pursuit on a corner-cutting line; target speed from the tightest bend in braking range (late, hard
               braking; crests, bumps); boost pads; picks a clear lane round city traffic. CPU_LEVELS / rivalAi: difficulty.
  traffic.ts   traffic (tracks with `traffic`): four lanes, two each way (`LANES`), or on a `'highway'` all four with the
               race (`HIGHWAY_LANES`; `lanesOf`, which the AI's dodging reads too), every car's place a pure function
               of the race clock (seconds since GO), so it's identical for every racer with nothing on the wire.
               collideTraffic bumps a car off it; trafficview.ts draws it (instanced, lamps that bloom).
  world.ts     the open world (Toge, free roam): terrain, the road layout, the ground (worldHeight / worldGround /
               worldLocate, two layers at viaducts), walls, buildings, spawns, speed traps, traffic routes, worldTrack()
               (the world as a Track) and respawnAt. See Content above.
  worldtraffic.ts  the open world's traffic: routePose on the wall clock (roamClock), collideWorldTraffic, near misses.
  drift.ts     drift scoring (the meter: slides score by speed × slip angle, linked slides build a ×4 combo that banks
               after DRIFT.chainGap, a crash or spin loses it) and the bonus money for drifting (`driftPay`, capped
               per km). garage.ts `raceBonus` adds it to every prize, solo and online; the server clamps it.
  boost.ts     rainbow boost pads: BOOST tuning, placeBoosts (corner exits onto straights, see Content), onBoostPad, padKick.
  draft.ts     slipstreaming: `wakeOf` (a cone up to `DRAFT.range` behind any car going your way at speed), `stepDraft`
               (eases `car.draft`, which cuts aero drag and pulls you on the gas in vehicle.ts; tucked in for `DRAFT.charge`
               s arms a slingshot that fires as a short boost when you pull out). Run per tick in racegame.ts `slipstream()`
               for you and the AI against every car incl. online poses; off in time trials. Nothing on the wire.
  damage.ts    Physics mode (crash damage, off unless the host or the solo Race page turns it on): every knock is
               delta-V (`car.crash`, recorded in vehicle.ts with where it hit), damage = DAMAGE.scale × (dv − threshold)^power,
               dented zones (front/rear/left/right) cost engine power (`DriveInput.power`, not the pedal) and pull the steering (`damagedInput`). At 1 the car is
               wrecked: racegame.ts `crashes()`/`wreck()` blow it up and respawn it DAMAGE.respawnBack m back with a grace.
               Online: zones ride `NetCar.dm`, explosions the `wreck` message (room relays only with `physics` on).
               toge/client/damageview.ts draws it: CarDents (moves the body's own vertices, flat normals in the creases),
               Blasts (fireball, black cloud, instanced debris, a flash light that only exists with the mode on).
               A damaged car doesn't smoke: the engine plume hid the road.
  props.ts     seeded track props (`placeProps`): bales, barrels, cones. No launch ramps since 2026-11-10 (Andrew: "remove
               all ramps/jumps that are not part of the map ... Do not remove the jumps that make up the entire road"):
               jumps are only the road's own `crest` features (and the open world's runway kickers); their old slots
               are open straights, so every other prop stayed put. Not on circuits, clean passes or traffic
               tracks. A `climb` track gets rockfall instead (`placeRockfall`): boulders and rocks, each its own
               radius, bitten into the road's edges, always leaving `ROCKFALL_GAP` of clear tarmac; solid, and the AI
               steers round them by their radius. toge/client/propview.ts draws props and the boost pads.
  ghost.ts     record ghosts: GhostRecorder, the tape encoding, cleanTape / cleanRun, unpack + poseAt (playback).
  records.ts   best times: Bests per track, recordTime (keeps a time only if it beats the old one and is plausible: cleanTime,
               minTime), cleanBests, the all-time boards (BoardRow, BOARD, cleanBoard, placeOnBoard), and
               TogeProfile / profileOf (what a friend sees of your garage).
  rider.ts     your driver: RIDER_IDS / RIDERS (names, bios, glow colours), a legend or a look code (`Rider`), riderInfo,
               encode/decode/cleanRider, rivalRider. Racers carry the code as `Racer.rider` (the `rider` socket param and lobby message; the room cleans bad codes to the
               default, and old saves of the customisable drivers get it too).
  pass.ts      the battle pass: PASS (price, tiers, XP per tier), raceXp, TIERS (one reward each), STAGES (home
               backgrounds), TITLES, lockedLookParts / ownedLook (pass driver pieces). garage.ts givePass / addXp / ownedRider.
  look.ts      your own driver: the wardrobe catalogue, `Look`, encodeLook/decodeLook (`L2.` codes), withBase/withOutfit/
               withKit, randomLook. Mirrors the wardrobe manifest (tests/toge/look.test.ts).
  cardstats.ts the player card's numbers: Highs (best drift race, top speed; toge/client/highs.ts keeps them in this
               browser as `atrous.highs`, racegame.ts `finish()` writes them, solo and online), noteHighs, bestBuild,
               winRate, cardBests (the newest few of your best times from records.ts).
  cups.ts      Grand Prix cups (CUPS: four tracks each, the Postcard Cup five; roundsOf), GP_POINTS, addRound / rankCup (the cup table).
  protocol.ts  race lobby wire types (RaceServerMsg / RaceClientMsg), RACE timings, RACE_MODES (race / time trial / hill
               climb / Grand Prix), ghostMode (time trial only), cleanMode (the host's car rule: trial and climb), modeTracks + MODE_TRACK (which tracks each mode runs, and the one it switches to).
src/toge/server/race.ts (Race: lobby -> loading -> countdown -> racing -> results, ranks, prizes), raceroom.ts (the RaceRoom DO),
  garageStore.ts (accounts' garages in the Accounts DO; `/api/garage`), recordStore.ts (accounts' best times, `b:<user>`, and the all-time boards, `lb:<track>`). Race lobbies use the Directory instance 'race'
  (`/api/races`); sockets are `/ws?game=race`.
src/toge/client/ racegame.ts (the race loop), trackview.ts (sky, terrain, road, rails, forests, villages, sea), trees.ts (tree and bush shapes, wind sway, far stand-ins), lod.ts (distance swaps for tiled scenery), scenery.ts (props outside the barriers), towns.ts (the Postcard towns' buildings and extras), tracktextures.ts
  (canvas-drawn surfaces as colour + roughness + normal sets: asphalt, gravel, ground, stone; facades, signs), post.ts (HDR
  post chain: bloom (into its own texture), then one pass that adds it, grades per theme (`Look.grade`) and tone maps), carmodel.ts
  (procedural cars: lofted bodies from carloft.ts, each car's curves and kit of parts in carkits.ts, wheels/materials/
  textures in carparts.ts, merged by material; bikes in bikemodel.ts; tune them in `/dev/cars.html`, `window.lab`, `lab.info()` for draw
  calls and triangles). The glass is see-through (`GLASS` per tint in carparts.ts; cosmetic tints are too), so every
  car has a cabin behind it: the greenhouse loft drawn again from inside (`MAT.liner`, back faces, glass faces skipped),
  a dark cabin floor (the lower body's top inside the greenhouse), dash, wheel and bucket seats (`cabinParts`), a rear
  bench when there's room. It's the group named `INTERIOR`, which the race hides for the car the cockpit camera is in.
  A design can tune its cabin (carkits.ts `Design`): `interior` (seat leather, accent, liner, carbon, a sports wheel with
  shift lights in the cockpit), `eyeT` / `eyeDrop` (where the eyes sit; `driverEye()` is shared by the outside cabin and
  cockpit.ts), `recline` (lays a low car's driver back so their legs stay above the floor), `slimA` (side glass wraps
  under a slim A pillar on a raked screen) and `noFuelFlap`. The Vanta uses them all; the dash always starts where the
  windscreen clears it, so it never pokes out through a raked screen.
  `panelZones` says where the hood, doors and boot are, so the hood option and the shut lines (`details`: grooves,
  handles, repeaters, fuel flap, wipers, third brake light, badge) agree. Flanks carry a character line
  (`Section.crease`, `Design.crease`, default 0.012 m; carloft.ts samples the side finely enough to hold it, and every
  ring keeps the same point count). Round headlamps are shallow buckets standing proud of the panel (reflector bowl,
  bulb and shield, chrome rim, glass), since a flush one sits behind the paint; slit lamps are a housing with projectors
  under a clear cover; tail lamps are a dark red lens (`MAT.redLens`) with lit elements (`tailLamp`); a light bar across a curved tail
  goes on `rearCurve` / `rearBand` (carkits.ts), which follow the tail in plan (one straight box floats off the corners:
  the Vanta's did, 2026-11-10), and the plate (`plateY`) needs clear paint behind it. Lamp glow is
  global: `setLampLevel` (carparts.ts) scales every registered lamp material (`lamp()`; cosmetic lamp tints too). The
  race sets `LAMP_NIGHT` on night and city tracks and `LAMP_DAY` otherwise, so headlamps don't blaze white by day. showroom.ts (the turntable; `place()` frames the car beside the rail; `showRider()` stands your driver by the
  driver's door, `focus('rider')` turns them to the camera), driver.ts (the drivers' GLBs from public/models/drivers:
  loaded once, cloned per car as a skinned rig that sits (the `drive` clip scrubbed by steering, with its own seat and
  wheel; carmodel.ts puts its eyes at the cockpit camera's), rides (bikes) or stands (`idle`)), riderportrait.ts (one
  offscreen renderer draws each driver to a cached PNG for the lobby; released when the lobby closes), riderui.ts (the
  Driver page), playercard.ts (the player card: your name top right opens it; one 1080×1350 canvas, drawn in 2D around
  a single offscreen 3D shot of your car and driver, is both what you see and the PNG you download or share), settingsui.ts
  (the Settings page: graphics), friendsui.ts (the Friends page: list, add, a friend's
  profile and best times), leaderboardui.ts (Race → Leaderboard: a track's all-time board and every track's record), lowgfx.ts (Low graphics' material swap), hub.ts (the home screen `drive`: tabs and pages,
  styled by hub.css), lobby.ts (`drivelobby`; its Your car card switches cars, and Edit car mounts the garage over the lobby with `pitGarage(root, ctx, { close })`: hub.ts with a `Pit`, only the car and driver tabs, a lobby strip in the top bar; the room shows `Racer.pit` as a Garage tag, and the lobby re-sends your car and driver whenever the room's copy is stale), trackart.ts (track tiles and maps for the menus), loading.ts + loading.css + loadingcopy.ts (the race loading screen: track preview, tips), brand.ts (logo, icons), hud.ts (incl. the top-left leaderboard and the name tags over
  other cars, hidden behind hills), input.ts
  (keyboard + controller), audio.ts (synth engine, tyres, wind; volume in the pause menu), effects.ts (smoke, skids),
  garageStore.ts, racenet.ts, race.css, propview.ts (props, boost pads), trafficview.ts (instanced city traffic),
  worldview.ts (the open world's scene; shares trackview.ts `atmosphere()` for sky, sun and fog), worldtrafficview.ts
  (its traffic: the Pebble model baked into instanced meshes per material, painted per car, culled per car).
src/client/pad.ts  (site shell) gamepads for every menu (spatial focus moves, A/B/LB/RB) and for driving (readPad, padAxis, rumble).
```

## Rendering, authority, circuits, dev hooks

- Rendering is plain WebGL (`THREE.WebGLRenderer`) through `Post` (post.ts), ACES tone mapping, one sun shadow map that follows the camera, instanced and tiled scenery. Bloom thresholds are high by day (the sky itself is bright) and low at night, so lamps and emissives must be brighter than white to glow: keep car lamps, reflectors and signs well above 1. Watch triangle counts (`__race.renderer.info`): forests dominate. A car is ~30k triangles in ~40 draw calls.
- Reflections and surfaces (2026-11-10, a visuals pass): each material's `envMapIntensity` is honoured (envlevel.ts
  `envLevel(scene, 0.55)`: three.js was ignoring it, so cars' clear coat, glass and chrome and the damp night road reflected
  no more than the grass); the terrain's specular is cut to a third (`matteGround`), which took the grey sheen off the
  desert and the plastic look off far mountains; day asphalt is a sun-faded mid grey (`tar` in tracktextures.ts
  `asphalt()`; night and city stay dark for the wet look); city towers' windows are let floor by floor in a few light
  colours with a ceiling-to-desk falloff; the flare's ghosts are two small faint ones; and `Post.rush` blurs the frame's edges at speed.
- **Performance** (2026-11-10, Michael: "improve performance"): far forest tiles, bushes and fine terrain swap to
  cheaper versions by distance (lod.ts `LodTiles` / `LOD`, trees.ts `farTree`), the post chain has two full-size passes
  after the scene (bloom added in the grade), every shader compiles at load (racegame.ts `warmShaders`), tree shadows
  come from small shadow-only tiles, and the open world culls its traffic per car and shadows only the nearest.
  Triangles a frame (main + shadow): Kōri Pass 2.26 M -> 1.36 M, Monza 1.56 M -> 1.07 M, Neon Bay 0.91 M -> 0.81 M,
  the open world 2.44 M -> 0.36 M; SwiftShader frame time -35%, -14%, -11%, -44%. Details and rules in
  `src/toge/client/CLAUDE.md`. Measure a change with `/dev/race.html` + `rl.cost(n)` before and after.
- Sky and light per theme live in `LOOKS` (trackview.ts). Day skies are toned down with `skyGain` (the visible sky; the
  environment the cars reflect is dimmed less) and the sun is 1.75 by default: Michael found the old 2.4 sun and full-strength sky
  far too bright (2026-11-02). `clouds` sets the sky shader's coverage/density per theme.
- Distant scenery is a painted 360° strip per theme (`public/race/backdrops/<theme>.webp`, ~60-190 kB), wrapped on an open
  cylinder that follows the camera (`backdrop()` in trackview.ts): one draw call behind the terrain, loaded after the track
  with a blank placeholder map so nothing recompiles when it arrives. The images are generated by `dev/backdrops.py`
  (numpy + Pillow; ours, no licences): change a theme there and re-run it. Their haze and the band below the horizon are the
  theme's fog colour, so keep them in step if you change `fog` in LOOKS. The strip is drawn at the far plane, so any real
  terrain in front hides it (the far ring reaches past its 6 km radius), every ridge's foot fades into the fog toward the
  horizon, and the terrain fades fully into the fog by `HORIZON_FADE` and sinks below the road over the far ring's last
  2 km: together that took out a hard straight line where the land met the strip (2026-11-06).
- **Trees and scenery** (2026-11-06, Michael: "make each map look better, buildings and decorations outside, better trees,
  without hurting performance"). trees.ts: two species per theme (spruce + Scots pine, spruce + cedar at night, stone pine +
  cypress, saguaro + scrub tree, maple or cherry + cedar), soft foliage normals, a vertex-shader wind sway (`sway`, `WIND`),
  and bushes along the road (High only); one instanced mesh per species per 400 m tile; keep shapes inside the triangle
  budgets in tests/toge/scenery.test.ts. scenery.ts plans its sites first (the forest keeps clear of them), on its own
  random stream: farmhouses and barns in clearings (villas by the sea, adobe in the desert), telegraph poles + wires on the
  passes, wayside shrines (torii, lanterns) on the Japanese passes, curve and speed signs, a landmark per theme (pagoda,
  radio mast, lighthouse, hoodoos, windmill and water tower), boats, and grandstands + sponsor boards on circuits. All of
  it is merged into one mesh per 1.6 km chunk per material (windows glow through a `glow` vertex attribute at night), so
  it's a handful of draw calls. The Postcard Cup's tracks swap the farmhouses for a town (client/towns.ts `TOWNS`):
  rows of the town's own houses facing the road all round the lap (a few colour variants, plinths that sink into
  slopes, kept clear of the pits and stands by the line), its landmarks (the Nagomi tower, a spire church, the rock
  castle and fairy chimneys, blue domes and windmills, minarets and a kasbah) and extras (`wall`: coral-stone walls
  outside the barrier; `sky`: Göreme's balloons; `shore`: Hallstatt's boathouses), all in the same merged batches; no
  big wheel, lighthouse or generic village there. `TRACK_LOOKS` gives each its hour of the day, and `tar` (a Look's
  asphalt colour, passed to `asphalt()`) Taketomi its pale lanes. `/dev/scenery.html` (`window.scn`) shows any track from any spot, with draw calls and a
  triangle budget (`scn.budget()`, `scn.props()`).
- **Circuit dressing** (every `laps` track): red-and-white kerbs over the shoulder on the bends (`kerbs()` in
  trackview.ts, drawn only; the physics' road is the plane under them), asphalt with edge lines and no centre line
  (`asphalt(..., circuit)`), the pits and a race control tower on the inside of the lap by the line where the straight
  is long and flat enough (scenery.ts `pitBuilding`, `controlTower`), grandstands then fill the other side, and a big
  wheel by the water on the seaside and street circuits (`bigWheel`). A city circuit's towers keep off scenery sites
  and off the low ground by the sea (its waterfront stays open). `TRACK_LOOKS` in trackview.ts overrides a theme's
  LOOKS for one track (Minato's floodlit fill, Kazeoka's dune colours and thin pines, Akane's low gold sun); keep fog
  as the theme's (the backdrop's haze is painted in it).
- **Graphics High / Low** (the Settings tab, settingsui.ts; the choice is site-wide, `src/client/graphics.ts`, saved per
  device as `atrous.graphics`, read when a race or showroom is built). Low is for laptops: pixel ratio 1, no MSAA, no
  shadow map, no `Post` chain (it renders straight to the screen), every MeshStandard/Physical swapped for a Lambert (Phong
  for clear coat) copy only while the frame draws (lowgfx.ts `drawLow`, so game code keeps mutating its own materials),
  no sky clouds, half the trees and none past 400 m (the same rng rolls, so the rest of the scene doesn't move), no bushes, a
  brighter hemisphere fill (`LOW_FILL`) for the lost environment light, and a 60 fps cap (30 in the showroom). Measured on
  Kori Pass at 1440×900 @2x: 834 → 540 draw calls, 1.7 M → 1.0 M triangles, ~9× less GPU time per frame. Switching
  rebuilds the showroom on a fresh canvas.
- Never add or remove a light mid-race: three.js recompiles every lit shader when the light count changes (a multi-second freeze). Keep the light in the scene from the start and change its intensity (see the brake glow and headlights in racegame.ts `headlights()`).
- Online start: `start` sends `load`; each client builds the track, draws its first frames (shader compiles) and says `ready`. The room counts down (`countdown`, RACE.countdownMs) once every racer is ready, or after RACE.loadTimeoutMs without the stragglers; a straggler who loads later is sent the time left, or `go` at once. Until the countdown, cars sit `held` on the grid (racegame.ts) with a "Waiting for racers" banner. Race and Time trial both work this way.
- Driving is client-authoritative like the shooter; the server times the race, sanity-checks finish times and pays signed-in racers (guests credit themselves from `results`).
- Rerace (Race again): solo results restart the race in place (`restart()`); online, the host's results have Rerace, which sends `start` straight from the `results` phase (the room allows it there as well as in the lobby). Racers still on their results get `load` in racegame.ts and hand over to the next race (`onNext` → `drive(roomRace(m), true)`, no extra history entry); `roomRace()` (racenet.ts) is the one place a `load` becomes drive options, for the lobby too. Without it, results go back to the lobby after `RACE.resultsSeconds`.
- Pause menu (`pause()` in racegame.ts): Restart at the top, then Resume, Settings and Quit/Leave. Settings is a second page of the same panel (camera, volume, ABS, TCS, steering assist, handling, gearbox, Back); put new in-race options there, not on the main page. Restart is solo `restart()`; online only the host sees it, and it sends `start` mid-race (the room accepts the host's `start` in every phase but `loading`), which drops the race unpaid and sends everyone a `load`. racegame.ts hands over on `load` in any phase, not only on the results.
- **Drift bonus:** racegame.ts runs your `DriftMeter` each tick (the HUD shows the live combo over the spark readout and the banked total in the top bar). Online it sends `drift` (the total) as each combo banks and before `finish`; the room caps it by its own clock and puts `drift` + `bonus` on each `ResultRow` (`prize` includes the bonus). Solo sends `drift` with the `solo` action. Limits are in docs/SECURITY.md.
- A new track = a TrackDef (keep legs > 2·edge + 40 m apart, grades < 12%; the track test checks both) + its TRACK_LENGTH_KM in garage.ts. A time-trial pass gets `clean: true` (no props; the `clean passes` test also holds it under 7%).
- Circuits (`laps` on the TrackDef: Monza, Spa, Monaco, Minato, Akane, Kazeoka, Kodama, Hachi, Mizuumi, Hibari, Kamome, Shiokaze and the five Postcard towns) are closed loops unrolled once per lap, so `car.s` is the distance raced and `finishS` is after the last lap; `t.lap` = samples per lap, `lapOf(t, s)`, the renderer draws `lapView(t)`. No features or props on circuits. TRACK_LENGTH_KM is the whole race distance (it sets the prize), so keep it near the passes' 3-6 km.
- **Figure 8** (`overpass: <rise m>` on a circuit's TrackDef, Hachi-no-ji): `crossing()` in track.ts finds where the lap
  crosses itself, raises the first pass over it (a raised cosine over `OVERPASS.ramp`, so the grade stays under ~10%) and
  dips the second, and flags samples in `t.cross`: `deck` (the bridge), `up` (the upper road near it) and `low` (the lower
  road near it). There the ground has two layers, so **ground queries for a car pass its hint**: `groundAt(t, x, z, out,
  car.hint)` / `heightAt(t, x, z, onRoad, car.hint)` (vehicle.ts does); a hint on `up` sees the deck and no lower road,
  anything else (no hint: the terrain mesh, scenery) sees the world under the bridge. `locate` keeps a car to its own road
  there, `groundBelow(t, x, z, y)` is for things with no hint (wreck debris). trackview.ts `overpass()` draws the deck and
  its piers (kept clear of the lower road). Cars on the two levels never collide (collideCars checks height). The leg
  spacing test skips the crossing; `figure 8` in racephysics tests the bridge. Put the start line well clear of the bridge.
- Time trial (`mode: 'trial'` on the room, picked by the host in the lobby; switching to it puts up Kodama Ring, the short circuit built for it): the other racers' cars are see-through ghosts (`ghostly()` in carmodel.ts) and never collide. Clients send their best lap with `finish` (shown only, never paid on); the results add each racer's gap to the winner and best lap.
- **Solo time trial** (2026-11-10, Andrew: time trials "accessible when playing Solo (ie. without having to Host a Race)
  ... so you are able to put times on the Leaderboard"): the Race page's Time trial button (hub.ts `soloTrial`) opens a
  private room of one on the picked track (`raceNet.hostSolo`, socket param `solo=1`; the Worker passes it only to a
  new room) and goes straight to the start, no lobby. The room (`Race.makeSolo`) is always a time trial, full at one
  racer, ignores `mode` / `cpu` / `cup`, and says `solo` on its `room` message and its directory entry: the lobby list
  hides it, but it still counts as someone playing for the nightly deploy. Because the room times the run, a finish
  counts as a best time and goes on the all-time board like any online time trial (a solo race still keeps no time).
  Its results have Run again (the room's `start`) and Done; the room going back to its lobby takes you to the Race page.
- Hill climb (`mode: 'climb'`): solid cars (you bump and draft each other, and take damage with Physics on), but like the
  time trial the host's car rule (`cleanMode()`), run only on `climb` tracks (`modeTracks`; the server ignores any other pick, and leaving the mode puts Kōri
  Pass back up). One map so far, Karasu Peak: bumpy forest climb, a hairpin ladder up the face, a crest, a gravel shelf,
  rockfall, a twisty last kilometre to the summit. Its forest grows right up to the barrier (`climb` in trackview.ts
  `scatter`). Not in the solo list (`TRACK_IDS` in trackart.ts leaves climb tracks out). A second hill climb = another
  TrackDef with `climb: true` (uphill, grades < 12% outside `bumps`/crests).
- Cameras (C / Ⓨ cycles, saved as `atrous.raceCam`): chase, near, cockpit, hood, bumper. Cockpit = the driver's eye: `cockpit.ts`
  builds each car's interior (dash, gauges, wheel, pillars, headliner) from its DESIGNS roof line, right-hand drive, parented to
  the car's root; `headcam.ts` is the head on a damped-spring neck, pushed by the car's acceleration (taken from its velocity, so
  spectated cars work too), looking into corners, shaken by road texture × surface, the engine, hits and landings. The car body
  is single sided, so from inside its shell vanishes except surfaces facing up at you (hood, fenders, the lower body's top
  across the cabin, which the dash and lap panel cover). Tune feel in headcam.ts constants, not in racegame.ts.
- Time trial car rules (`CarRule` in protocol.ts: `own` / `vanta` / `maxed`, the host's `cars` message, lobby only, ignored in a race): the server settles every racer's car at the countdown with `raceCars()` (cars.ts; `vanta` puts everyone in a Vanta V10 with every part at `MAX_LEVEL` and their own look; `maxed` keeps their own model and sets every part to `MAX_LEVEL`) and sends `rule` + `cars` in `countdown`. Clients drive `myRaceCar()` (the maxed Vanta runs default tuning so stats match; otherwise your tuning stays on your own model) and draw others from `cars`; results show the car raced. Garages are never changed. Tests in raceroom.test.ts.
- In dev, `window.__race` is the running race. To let the AI drive yours: `const { aiDrive, newAi } = await import('/src/toge/shared/driver.ts'); const ai = newAi(0.9, 0); __race.controls.poll = function (dt) { aiDrive(__race.me.car, __race.track, ai, dt, this.input); }`.

## Adding things

- **A car:** a `CarId` + `CARS` entry (cars.ts) + a `DESIGNS` entry in `src/toge/client/carkits.ts` (a bike: add it to
  `BikeId` and build it in `bikemodel.ts` instead); tune the model in
  `/dev/cars.html` (`window.lab`: `show(id|'all')`, `view(yaw, pitch, dist)`, `look({...})`, `spin(on)`, `pose(steer, lat)`
  to steer and lean, `cockpit()` for the driver's or rider's eye).
- **A track:** a `TrackId` + `TRACK_DEFS` entry + its `TRACK_LENGTH_KM` in garage.ts (the test checks it within 0.15 km,
  plus leg spacing and grades). Race lists use `RACE_TRACKS` (every track but an open world).
- **A road in the open world:** a `RoadDef` in world.ts `layout()` (order matters: a `'snap'` point reads the roads before
  it); keep `tests/toge/world.test.ts` green (grades, ground under every road, traffic on its lanes, top speed). A new `Theme` also needs `LOOKS` (toge/client/trackview.ts) and `LITTER` (tracktextures.ts).
- **A track in a Grand Prix:** every race track sits in one cup (cups.ts); a new one goes in a new cup or swaps into one.
- **A mode:** a `RaceMode` + `RACE_MODES` entry + `MODE_TRACK` (protocol.ts); the server's `mode` / `track` handling in
  race.ts, the lobby's labels (lobby.ts `START`, hub.ts open-lobby list) and `RaceSetup.online.mode` in racegame.ts. The
  Physics switch (`physics` on the room, `PHYSICS` in protocol.ts) is separate and works with every mode.
- **Economy** (garage.ts): every garage change is an `applyAction` (server for accounts, client for guests). Prize =
  `payout()`; solo pays less and at most once per `SOLO_GAP_MS`.
- **A driver:** a spec in `tools/drivers/cast.py`, an entry in `RIDER_IDS` / `RIDERS` (append), build it with
  `blender -b --python tools/drivers/build.py -- <id>` (docs/DRIVERS.md has the setup), and run the tests.
- **A cosmetic:** append it to its slot's list in `CATALOG` (cosmetics.ts) with a rarity and its cases; a new pattern or
  decal kind also needs a painter in toge/client/cosmeticsview.ts. A new slot: append to `COS_SLOTS`, add its `Fx`
  type, apply it in carmodel.ts. Keep every case holding an item of each rarity it weights (the test checks).
  A body part (wing/hood/roof/lip/skirts/flaps) is a `style` plus a `PartLook` (paint, carbon, chrome or a colour, and an
  optional glowing edge); a new style needs building in toge/client/bodykits.ts, from the Kit helpers so it fits every car.
  Check it on every car in `/dev/cars.html` with `lab.cos({ wing: 'wg_gt', roof: 'rf_duck' })`.

Tests: `racephysics` (incl. braking, trail braking, traction out of a bend, wall hits, CPUs vs full throttle and their difficulty levels, CPUs on boost pads), `boost` (pads, the highway, Hayate's 30° rule), `garage`, `raceroom` (incl. a whole online Grand Prix), `world` (the open world and a free-roam room), `cups`, `drift`, `standings`, `raceinput`, `headcam`, `cosmetics`, `pass`, `draft`, `rider`, `drivers`, `hands` (drivers' grip on the wheel), `damage`, `records` in `tests/toge/`
(friend lists: `tests/friends.test.ts`)
(`pad` is in `tests/`: the gamepad code is the site's).
