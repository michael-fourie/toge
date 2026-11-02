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

## Menus and brand

The home screens (hub.ts: tabs Race, Garage, Performance, Style, Driver), the race lobby (lobby.ts) and cosmetics
(cosmeticsui.ts) follow the design system in **`src/toge/DESIGN.md`**: the brand, colour roles (red acts, cyan selects,
gold pays), type, the screen anatomy, the tab map and the components. Its tokens and components are in
`src/toge/client/hub.css`; reuse them rather than styling a new screen from scratch, and update DESIGN.md when you add
a component or a page.

## Content

- **Tracks** (`TrackId` in track.ts): passes `koripass` (alpine), `saltwind` (coast), `redmesa` (desert rally:
  gravel, crests, canyon), `tsukiyo` (night: bridge, tunnel), `momiji` (autumn), `sakura` (spring);
  circuits `monza` (3 laps), `spa`, `monaco` (2 laps), `kodama` (the time trial's ring); city `neonbay` (Neon Bay, live
  traffic); hill climb `karasu` (Karasu Peak: uphill, 4.1 km and 336 m up, narrow, `climb: true`, only in a Hill climb lobby).
  Track `Feature`s: gravel, canyon, bridge, tunnel, crest, `cut` (a gravel shortcut through gaps in the barrier) and
  `bumps` (heaved tarmac between two control points; the grade test skips them, like crests).
- **Cars** (`CarId`): pebble (starter), kitsune, bramble, shiro, tengu (twin-rotor coupe, pop-up lamps), vanta, and one
  bike, raiden (`body: 'bike'`, `isBike`); 8 upgrade `PARTS`, levels 0-5.
- **Bikes** run the same four-wheel physics on a narrow hidden `track` (1.2 m), with bike-sized wheel and engine inertia
  and engine braking and a body three times steadier than its little box (`BIKE_*` in cars.ts; without it a barrel
  spun it like a top), and no spoiler (the garage hides it; a code that carries one changes nothing).
  The look is all client side: `bikemodel.ts` builds painted lofted shells (UVs like the car bodies, so paint jobs,
  stripes and decals work), frame, fork, swingarm and wheels, and leans the model into turns by the cornering
  force `pose(..., lat)` gets from racegame.ts. `root.userData.lean` is the leaning frame (the cockpit camera rides in
  it, so the horizon tilts) and `root.userData.rider` is hidden from the rider's eye. Skid marks run down the middle.
  The rider is a driver from `ridermodel.ts` (`buildRider(r, { ride: true })`, the `RIDE` pose): your own driver,
  each online rival's from `Racer.rider`, a seeded `randomRider` per AI. `buildCar(owned, rider)` passes it on; the
  showroom passes `null` (empty saddle, your driver stands beside it). Rider meshes are shared page-wide, so the bike
  never merges or disposes them.
- **Cosmetics** (cosmetics.ts): 160 items in 11 slots (paint jobs, decals, window tints, head/tail lamps, rims, calipers,
  underglow, plates, plate frames/covers, exhaust tips), 5 rarities, won from 5 cases (Street, Night Run, Livery,
  Chrome, Legend) bought with garage money; equipped per car, plus free custom plate text. No effect on physics.
- **Drivers** (rider.ts): your character, Tokyo street-drift style. 23 fields (build, height, skin, face, 12 hair styles,
  8 tops from tees to souvenir jackets and long coats with a kanji back print, bottoms, shoes, headwear, eyewear, masks,
  neck pieces, gloves, 5 poses), all free, saved in the garage (`rider`, the `rider` action). Your driver stands by your car
  in the showroom (the Driver tab walks the camera in), and the lobby shows every racer's driver in the Crew row.
- **Solo**: 0/3/5/7 AI rivals (hub.ts, saved as `atrous.rivals`) picked near your PI with your upgrades; you start mid-pack.
- **Online**: Directory instance `"race"`, sockets `/ws?game=race`, up to `RACE.maxPlayers` (8).

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
               Then the `arcade()` layer (tuned by `ARCADE`, on by default in `DEFAULT_ASSISTS`): yaws the car toward
               the stick, swings travel onto the nose, drift levels + mini-turbo boosts, hop, levelling in the air.
  cars.ts      the catalogue (CARS), upgrades (PARTS, levels 0-5), looks, tuning, encode/decodeCar (the wire code), carSpec()
               (everything -> physics numbers), torqueAt, rating (PI + class), stats (garage bars).
  garage.ts    money, owned cars, crates (the gamble), payouts, applyAction (every garage change; run by the server for
               accounts and by the client for guests). Also cosmetic cases (`case`, duplicates refund by rarity), `equip`,
               `plate`, and ownedCarCode (strips cosmetics an account doesn't own from a race code).
  cosmetics.ts the cosmetics catalogue (CATALOG per slot, APPEND ONLY: the wire code is each slot's index), cases + odds,
               rollCosCase, CosKit (what a car wears), encode/decodeKit (the optional last segment of a car code).
  standings.ts race order (finishers by time, then progress); the place readout and the leaderboard both use it.
               Lap races pass laps × lap length + distance into the lap as `progress`.
  driver.ts    AI: pure pursuit on a corner-cutting line; target speed from the tightest bend in braking range; picks a
               clear lane round city traffic.
  traffic.ts   city traffic (tracks with `traffic: true`): four lanes, two each way, every car's place a pure function
               of the race clock (seconds since GO), so it's identical for every racer with nothing on the wire.
               collideTraffic bumps a car off it; trafficview.ts draws it (instanced, lamps that bloom).
  drift.ts     drift scoring (the meter: slides score by speed × slip angle, linked slides build a ×4 combo that banks
               after DRIFT.chainGap, a crash or spin loses it) and the bonus money for drifting and item use (`driftPay`,
               `itemPay`, caps). garage.ts `raceBonus` adds it to every prize, solo and online; the server clamps it.
  powerups.ts  items from mystery boxes (`Item`: turbo/triple/oil/shield/shock/comet), `POWER` tuning, `rollItem` with
               catch-up odds; oil/shock/comet are relayed as the `item` message.
  draft.ts     slipstreaming: `wakeOf` (a cone up to `DRAFT.range` behind any car going your way at speed), `stepDraft`
               (eases `car.draft`, which cuts aero drag and pulls you on the gas in vehicle.ts; tucked in for `DRAFT.charge`
               s arms a slingshot that fires as a short boost when you pull out). Run per tick in racegame.ts `slipstream()`
               for you and the AI against every car incl. online poses; off in time trials. Nothing on the wire.
  damage.ts    Physics mode (crash damage, off unless the host or the solo Race page turns it on): every knock is
               delta-V (`car.crash`, recorded in vehicle.ts with where it hit), damage = DAMAGE.scale × (dv − threshold)^power,
               dented zones (front/rear/left/right) cost power and pull the steering (`damagedInput`). At 1 the car is
               wrecked: racegame.ts `crashes()`/`wreck()` blow it up and respawn it DAMAGE.respawnBack m back with a grace.
               Online: zones ride `NetCar.dm`, explosions the `wreck` message (room relays only with `physics` on).
               toge/client/damageview.ts draws it: CarDents (moves the body's own vertices, flat normals in the creases),
               Blasts (fireball, black cloud, instanced debris, a flash light that only exists with the mode on), smokeFrom.
  props.ts     seeded track props (`placeProps`): mystery boxes, ramps, bales, barrels, cones. Not on circuits; Neon Bay
               gets boxes only. A `climb` track gets rockfall instead (`placeRockfall`): boulders and rocks, each its own
               radius, bitten into the road's edges, always leaving `ROCKFALL_GAP` of clear tarmac; solid, and the AI
               steers round them by their radius. toge/client/propview.ts draws props, oil slicks, the shield bubble.
  rider.ts     your driver: RIDER_FIELDS (APPEND ONLY, like the cosmetics catalogue: a code is one base-36 digit per field,
               after `r1.`; shorter old codes fill the new fields with 0), encode/decode/cleanRider, randomRider. Racers carry
               the code as `Racer.rider` (the `rider` socket param and lobby message; the room cleans bad codes to the default).
  protocol.ts  race lobby wire types (RaceServerMsg / RaceClientMsg), RACE timings, RACE_MODES (race / time trial / hill
               climb), ghostMode (time trial only), cleanMode (no items + car rule: trial and climb), modeTracks + MODE_TRACK (which tracks each mode runs, and the one it switches to).
src/toge/server/race.ts (Race: lobby -> loading -> countdown -> racing -> results, ranks, prizes), raceroom.ts (the RaceRoom DO),
  garageStore.ts (accounts' garages in the Accounts DO; `/api/garage`). Race lobbies use the Directory instance 'race'
  (`/api/races`); sockets are `/ws?game=race`.
src/toge/client/ racegame.ts (the race loop), trackview.ts (sky, terrain, road, rails, forests, villages, sea), tracktextures.ts
  (canvas-drawn surfaces as colour + roughness + normal sets: asphalt, gravel, ground, stone; facades, signs), post.ts (HDR
  post chain: clamp, bloom, film grade per theme (`Look.grade`), then tone mapping), carmodel.ts
  (procedural cars: lofted bodies from carloft.ts, each car's curves and kit of parts in carkits.ts, wheels/materials/
  textures in carparts.ts, merged by material; bikes in bikemodel.ts; tune them in `/dev/cars.html`, `window.lab`), showroom.ts (the turntable; `place()` frames the car beside the rail; `showRider()` stands your driver by the
  driver's door, `focus('rider')` turns them to the camera), ridermodel.ts (the driver figure: ~70 primitives with cached
  geometry and materials, posed, a breathing idle; tune in `/dev/riders.html`, `window.lab`), riderportrait.ts (one
  offscreen renderer draws each driver to a cached PNG for the lobby; released when the lobby closes), riderui.ts (the
  Driver page), hub.ts (the home screen `drive`: tabs and pages,
  styled by hub.css), lobby.ts (`drivelobby`), trackart.ts (track tiles and maps for the menus), brand.ts (logo, icons), hud.ts (incl. the top-left leaderboard and the name tags over
  other cars, hidden behind hills), input.ts
  (keyboard + controller), audio.ts (synth engine, tyres, wind; volume in the pause menu), effects.ts (smoke, skids),
  garageStore.ts, racenet.ts, race.css, propview.ts (props, oil slicks, shield bubble), trafficview.ts (instanced city traffic).
src/client/pad.ts  (site shell) gamepads for every menu (spatial focus moves, A/B/LB/RB) and for driving (readPad, padAxis, rumble).
```

## Rendering, authority, circuits, dev hooks

- Rendering is plain WebGL (`THREE.WebGLRenderer`) through `Post` (post.ts), ACES tone mapping, one sun shadow map that follows the camera, instanced and tiled scenery. Bloom thresholds are high by day (the sky itself is bright) and low at night, so lamps and emissives must be brighter than white to glow: keep car lamps, reflectors and signs well above 1. Watch triangle counts (`__race.renderer.info`): forests dominate. A car is ~30k triangles in ~40 draw calls.
- Sky and light per theme live in `LOOKS` (trackview.ts). Day skies are toned down with `skyGain` (the visible sky; the
  environment the cars reflect is dimmed less) and the sun is 1.75 by default: Michael found the old 2.4 sun and full-strength sky
  far too bright (2026-11-02). `clouds` sets the sky shader's coverage/density per theme.
- Distant scenery is a painted 360° strip per theme (`public/race/backdrops/<theme>.webp`, ~60-190 kB), wrapped on an open
  cylinder that follows the camera (`backdrop()` in trackview.ts): one draw call behind the terrain, loaded after the track
  with a blank placeholder map so nothing recompiles when it arrives. The images are generated by `dev/backdrops.py`
  (numpy + Pillow; ours, no licences): change a theme there and re-run it. Their haze and the band below the horizon are the
  theme's fog colour, so keep them in step if you change `fog` in LOOKS.
- Never add or remove a light mid-race: three.js recompiles every lit shader when the light count changes (a multi-second freeze). Keep the light in the scene from the start and change its intensity (see the comet light in racegame.ts).
- Online start: `start` sends `load`; each client builds the track, draws its first frames (shader compiles) and says `ready`. The room counts down (`countdown`, RACE.countdownMs) once every racer is ready, or after RACE.loadTimeoutMs without the stragglers; a straggler who loads later is sent the time left, or `go` at once. Until the countdown, cars sit `held` on the grid (racegame.ts) with a "Waiting for racers" banner. Race and Time trial both work this way.
- Driving is client-authoritative like the shooter; the server times the race, sanity-checks finish times and pays signed-in racers (guests credit themselves from `results`).
- **Drift and item bonus:** racegame.ts runs your `DriftMeter` each tick (the HUD shows the live combo over the spark readout and the banked total in the top bar) and counts your item uses (a gold `+$` pops by the item slot). Online it sends `drift` (the total) as each combo banks and before `finish`, and `used` for turbos and shields; the room counts relayed attack items itself, caps drift by its own clock, and puts `drift` + `bonus` on each `ResultRow` (`prize` includes the bonus). Solo sends `drift` + `uses` with the `solo` action. Time trials pay drift but not items. Limits are in docs/SECURITY.md.
- A new track = a TrackDef (keep legs > 2·edge + 40 m apart, grades < 12%; the track test checks both) + its TRACK_LENGTH_KM in garage.ts.
- Circuits (`laps` on the TrackDef: Monza, Spa, Monaco) are closed loops unrolled once per lap, so `car.s` is the distance raced and `finishS` is after the last lap; `t.lap` = samples per lap, `lapOf(t, s)`, the renderer draws `lapView(t)`. No features or props on circuits. TRACK_LENGTH_KM is the whole race distance (it sets the prize), so keep it near the passes' 3-6 km.
- Time trial (`mode: 'trial'` on the room, picked by the host in the lobby; switching to it puts up Kodama Ring, the short circuit built for it): the other racers' cars are see-through ghosts (`ghostly()` in carmodel.ts) and never collide, there are no item boxes and the server drops `item` messages. Clients send their best lap with `finish` (shown only, never paid on); the results add each racer's gap to the winner and best lap.
- Hill climb (`mode: 'climb'`): solid cars (you bump and draft each other, and take damage with Physics on), but like the
  time trial no items and the host's car rule (`cleanMode()`), run only on `climb` tracks (`modeTracks`; the server ignores any other pick, and leaving the mode puts Kōri
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
- Time trial car rules (`CarRule` in protocol.ts: `own` / `spec` / `maxed`, the host's `cars` message, lobby only, ignored in a race): the server settles every racer's car at the countdown with `raceCars()` (cars.ts; `spec` draws one racer's car with the room's `rand`, everyone gets its model and upgrades with their own look; `maxed` sets every part to `MAX_LEVEL`) and sends `rule` + `cars` in `countdown`. Clients drive `myRaceCar()` (a spec car runs default tuning so stats match; otherwise your tuning stays on your own model) and draw others from `cars`; results show the car raced. Garages are never changed. Tests in raceroom.test.ts.
- In dev, `window.__race` is the running race. To let the AI drive yours: `const { aiDrive, newAi } = await import('/src/toge/shared/driver.ts'); const ai = newAi(0.9, 0); __race.controls.poll = function (dt) { aiDrive(__race.me.car, __race.track, ai, dt, this.input); }`.

## Adding things

- **A car:** a `CarId` + `CARS` entry (cars.ts) + a `DESIGNS` entry in `src/toge/client/carkits.ts` (a bike: add it to
  `BikeId` and build it in `bikemodel.ts` instead); tune the model in
  `/dev/cars.html` (`window.lab`: `show(id|'all')`, `view(yaw, pitch, dist)`, `look({...})`, `spin(on)`, `pose(steer, lat)`
  to steer and lean, `cockpit()` for the driver's or rider's eye).
- **A track:** a `TrackId` + `TRACK_DEFS` entry + its `TRACK_LENGTH_KM` in garage.ts (the test checks it within 0.15 km,
  plus leg spacing and grades). A new `Theme` also needs `LOOKS` (toge/client/trackview.ts) and `LITTER` (tracktextures.ts).
- **A mode:** a `RaceMode` + `RACE_MODES` entry + `MODE_TRACK` (protocol.ts); the server's `mode` / `track` handling in
  race.ts, the lobby's labels (lobby.ts `START`, hub.ts open-lobby list) and `RaceSetup.online.mode` in racegame.ts. The
  Physics switch (`physics` on the room, `PHYSICS` in protocol.ts) is separate and works with every mode.
- **Economy** (garage.ts): every garage change is an `applyAction` (server for accounts, client for guests). Prize =
  `payout()`; solo pays less and at most once per `SOLO_GAP_MS`.
- **A driver option:** append to its field's `options` (and `colors`) in rider.ts, or append a new field to `RIDER_FIELDS`
  (it decodes as 0 from old codes, so make 0 the plain choice); draw it in ridermodel.ts and check it in `/dev/riders.html`
  (`lab.vary('hair')`, `lab.random(8)`). Keep every field under 36 options.
- **A cosmetic:** append it to its slot's list in `CATALOG` (cosmetics.ts) with a rarity and its cases; a new pattern or
  decal kind also needs a painter in toge/client/cosmeticsview.ts. A new slot: append to `COS_SLOTS`, add its `Fx`
  type, apply it in carmodel.ts. Keep every case holding an item of each rarity it weights (the test checks).

Tests: `racephysics`, `garage` (incl. item odds), `raceroom`, `drift`, `standings`, `raceinput`, `headcam`, `cosmetics`, `draft`, `rider`, `damage` in `tests/toge/`
(`pad` is in `tests/`: the gamepad code is the site's).
