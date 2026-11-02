# TŌGE (racing): shared code + overview

TŌGE is channel 2 on the game chooser: mountain-pass and circuit racing, solo against AI or online (up to 8).
Shared physics and rules live here; the client is `src/client/race/`, the server `src/server/race.ts` +
`raceroom.ts` + `garageStore.ts`. This file is the guide for all of it.

**Handling = a realistic sim with an arcade layer on top.** `vehicle.ts` is a full rigid-body sim; the `arcade()`
layer (`ARCADE` constants, on by default, the `arcade` assist) makes it turn and drift like an arcade racer. Michael
raised `ARCADE` grip/yaw on 2026-10-30 because corners felt unmakeable, so don't weaken it without asking. Change
physics only with a test, and keep `tests/racephysics.test.ts` green (it drives every car down every track with the AI).
Physics runs client-side only; the AI's target speed reads `ARCADE.grip`, so rivals scale with it.

## Content

- **Tracks** (`TrackId` in track.ts): passes `koripass` (alpine), `saltwind` (coast), `redmesa` (desert rally:
  gravel, crests, canyon), `tsukiyo` (night: bridge, tunnel), `momiji` (autumn), `sakura` (spring);
  circuits `monza` (3 laps), `spa`, `monaco` (2 laps); city `neonbay` (Neon Bay, live traffic).
  Track `Feature`s: gravel, canyon, bridge, tunnel, crest and `cut` (a gravel shortcut through gaps in the barrier).
- **Cars** (`CarId`): pebble (starter), kitsune, bramble, shiro, vanta; 8 upgrade `PARTS`, levels 0-5.
- **Solo**: 0/3/5/7 AI rivals (hub.ts, saved as `atrous.rivals`) picked near your PI with your upgrades; you start mid-pack.
- **Online**: Directory instance `"race"`, sockets `/ws?game=race`, up to `RACE.maxPlayers` (8).

## Files

```
src/shared/race/
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
               accounts and by the client for guests).
  standings.ts race order (finishers by time, then progress); the place readout and the leaderboard both use it.
               Lap races pass laps × lap length + distance into the lap as `progress`.
  driver.ts    AI: pure pursuit on a corner-cutting line; target speed from the tightest bend in braking range; picks a
               clear lane round city traffic.
  traffic.ts   city traffic (tracks with `traffic: true`): four lanes, two each way, every car's place a pure function
               of the race clock (seconds since GO), so it's identical for every racer with nothing on the wire.
               collideTraffic bumps a car off it; trafficview.ts draws it (instanced, lamps that bloom).
  powerups.ts  items from mystery boxes (`Item`: turbo/triple/oil/shield/shock/comet), `POWER` tuning, `rollItem` with
               catch-up odds; oil/shock/comet are relayed as the `item` message.
  props.ts     seeded track props (`placeProps`): mystery boxes, ramps, bales, barrels, cones. Not on circuits; Neon Bay
               gets boxes only. client/race/propview.ts draws props, oil slicks, the shield bubble.
  protocol.ts  race lobby wire types (RaceServerMsg / RaceClientMsg), RACE timings.
src/server/race.ts (Race: lobby -> countdown -> racing -> results, ranks, prizes), raceroom.ts (the RaceRoom DO),
  garageStore.ts (accounts' garages in the Accounts DO; `/api/garage`). Race lobbies use the Directory instance 'race'
  (`/api/races`); sockets are `/ws?game=race`.
src/client/race/ racegame.ts (the race loop), trackview.ts (sky, terrain, road, rails, forests, villages, sea), tracktextures.ts
  (canvas-drawn surfaces as colour + roughness + normal sets: asphalt, gravel, ground, stone; facades, signs), post.ts (HDR
  post chain: clamp, bloom, film grade per theme (`Look.grade`), then tone mapping), carmodel.ts
  (procedural cars: lofted bodies from carloft.ts, each car's curves and kit of parts in carkits.ts, wheels/materials/
  textures in carparts.ts, merged by material; tune them in `/dev/cars.html`, `window.lab`), showroom.ts, hub.ts (the garage screen `drive`), lobby.ts (`drivelobby`), hud.ts (incl. the top-left leaderboard and the name tags over
  other cars, hidden behind hills), input.ts
  (keyboard + controller), audio.ts (synth engine, tyres, wind; volume in the pause menu), effects.ts (smoke, skids),
  garageStore.ts, racenet.ts, race.css, propview.ts (props, oil slicks, shield bubble), trafficview.ts (instanced city traffic).
src/client/pad.ts  gamepads for every menu (spatial focus moves, A/B/LB/RB) and for driving (readPad, padAxis, rumble).
```

## Rendering, authority, circuits, dev hooks

- Rendering is plain WebGL (`THREE.WebGLRenderer`) through `Post` (post.ts), ACES tone mapping, one sun shadow map that follows the camera, instanced and tiled scenery. Bloom thresholds are high by day (the sky itself is bright) and low at night, so lamps and emissives must be brighter than white to glow: keep car lamps, reflectors and signs well above 1. Watch triangle counts (`__race.renderer.info`): forests dominate. A car is ~30k triangles in ~40 draw calls.
- Never add or remove a light mid-race: three.js recompiles every lit shader when the light count changes (a multi-second freeze). Keep the light in the scene from the start and change its intensity (see the comet light in racegame.ts).
- Driving is client-authoritative like the shooter; the server times the race, sanity-checks finish times and pays signed-in racers (guests credit themselves from `results`).
- A new track = a TrackDef (keep legs > 2·edge + 40 m apart, grades < 12%; the track test checks both) + its TRACK_LENGTH_KM in garage.ts.
- Circuits (`laps` on the TrackDef: Monza, Spa, Monaco) are closed loops unrolled once per lap, so `car.s` is the distance raced and `finishS` is after the last lap; `t.lap` = samples per lap, `lapOf(t, s)`, the renderer draws `lapView(t)`. No features or props on circuits. TRACK_LENGTH_KM is the whole race distance (it sets the prize), so keep it near the passes' 3-6 km.
- In dev, `window.__race` is the running race. To let the AI drive yours: `const { aiDrive, newAi } = await import('/src/shared/race/driver.ts'); const ai = newAi(0.9, 0); __race.controls.poll = function (dt) { aiDrive(__race.me.car, __race.track, ai, dt, this.input); }`.

## Adding things

- **A car:** a `CarId` + `CARS` entry (cars.ts) + a `DESIGNS` entry in `src/client/race/carkits.ts`; tune the model in
  `/dev/cars.html` (`window.lab`: `show(id|'all')`, `view(yaw, pitch, dist)`, `look({...})`, `spin(on)`).
- **A track:** a `TrackId` + `TRACK_DEFS` entry + its `TRACK_LENGTH_KM` in garage.ts (the test checks it within 0.15 km,
  plus leg spacing and grades). A new `Theme` also needs `LOOKS` (client/race/trackview.ts) and `LITTER` (tracktextures.ts).
- **A mode:** there is no mode switch yet; the entry points are `RaceSetup` in client/race/racegame.ts and the race protocol.
- **Economy** (garage.ts): every garage change is an `applyAction` (server for accounts, client for guests). Prize =
  `payout()`; solo pays less and at most once per `SOLO_GAP_MS`.

Tests: `racephysics`, `garage` (incl. item odds), `raceroom`, `standings`, `raceinput`, `pad` in `tests/`.
