# src/toge/client: TŌGE in the browser

The whole TŌGE guide (physics, tracks, cars, server, rendering rules, how to add a car or track) is
`src/toge/CLAUDE.md`. Read it before changing anything here. Never import from `src/gambol/`; site-wide pieces
(pad, account, menu kit, router) come from `src/client/`.

The rules that bite most often in this folder:

- Plain `THREE.WebGLRenderer` through `Post` (post.ts: bloom, then one last pass for the film grade per theme, the sun's lens
  flare, the speed blur and ACES + sRGB; keep it one pass). No WebGPU. The flare (`Grade.flare`, 0 on night themes) checks whether the sun is
  hidden by sampling the image at the sun in the vertex shader, so it costs nothing per pixel. The speed blur (`Post.rush`,
  set in racegame.ts from `RUSH`) streaks only the frame's edges, only above ~150 km/h or on a boost: four taps there, none elsewhere.
- `envMapIntensity` only works in a scene marked with `envLevel()` (envlevel.ts; trackview.ts `atmosphere()` does it for
  every race and the open world). three.js otherwise hands every material the scene's `environmentIntensity` and ignores
  its own, which left clear coat, glass, chrome and the wet night road at a flat 0.55 until 2026-11-10. Ground materials
  call `matteGround()` (trackview.ts) so slopes don't wash out to a pale sheen against the sun.
- Contact shadows (contactshadow.ts): one instanced quad darkens the road under every car, on High and Low. Add a car
  with `contact.add(root, ...)` and take it out with `contact.remove(root)` when its model goes.
- Low graphics (Settings tab; `lowGraphics()` from src/client/graphics.ts) must stay cheap: no shadows, no post chain,
  Lambert/Phong stand-ins for PBR (lowgfx.ts). A new effect either skips itself on Low or costs next to nothing.
- A renderer that goes away goes out through `releaseRenderer()` (src/client/graphics.ts), or `dispose()` + `forceContextLoss()`
  when its canvas stays on the page. `dispose()` alone leaked every race's whole WebGL context (~250 MB of GPU memory each)
  until the tab crashed: shared materials keep old renderers reachable. tests/graphics.test.ts checks.
- Never add or remove a light mid-race (every lit shader recompiles: a multi-second freeze). Add it at load and change its intensity.
- At night bloom only catches values above 1: lamps, reflectors and signs must be brighter than white.
- Watch triangle counts with `__race.renderer.info`; forests dominate, a car is ~30k triangles in ~40 draw calls.
- Adaptive resolution (`adaptResolution` + `RES` in racegame.ts): when frames average slower than `RES.slowMs` for
  `RES.slowFor` s, the render scale drops a step (to `RES.min` of the pixel ratio at worst); with headroom it climbs back.
  `__race.resScale` shows it. A machine that keeps up never leaves full resolution.
- The HUD runs every frame, so keep it cheap: no `innerHTML` rebuilds per frame (the strip reuses its dots), cache what
  doesn't move (the tach face, the minimap's road outline as a Path2D), and never read layout (`clientWidth`) after
  writing the DOM (the view size is kept from `resize`). City traffic further than `TRAFFIC_DRAW` isn't drawn.
- The open world (worldview.ts, worldtrafficview.ts; free roam on `toge`) is one scene for a 7 km island: terrain in
  LOD chunks (`LODS_HIGH` / `LODS_LOW`), trees only near the roads in 400 m tiles shown within `TREE_DRAW`, the
  traffic's full Pebble model only within `DRAW_HIGH[0]` / `DRAW_LOW[0]` (at most `MAX_NEAR`), boxes beyond. Road
  meshes face up (their triangles are wound left to right across the road): a downward winding made the roads invisible
  from above. The HUD's roam mode (`.rh.roam`) hides place, clock, board and strip.
- Driving physics is shared (`src/toge/shared/vehicle.ts`); don't put handling logic in this folder.
- Menus (hub.ts, lobby.ts, cosmeticsui.ts) follow `src/toge/DESIGN.md`; tokens and components are in hub.css. race.css is
  only the in-race HUD. Page ids (`dtab`) are restored on reload: keep them stable.
- Cosmetics: cosmeticsview.ts draws them (one livery canvas per car for paint jobs + decals, seeded by item id so every
  client sees the same camo; cached materials per item, registered with `share()` so a car's dispose leaves them);
  cosmeticsui.ts is the Locker and Cases pages and the case reel (styles in cosmetics.css). Body UVs: u nose to tail,
  v round the section, so each flank needs its own transform to read the right way (`onFlanks`).
- Body parts (wings, hoods, roof gear, lips, sides, mudflaps): bodykits.ts builds them from the Kit helpers (`k.top`,
  `k.height`, `k.side`, `k.front`, `k.cabin`) inside carmodel.ts's `common()`, before the merge; a cosmetic wing replaces
  the stock spoiler. Bikes don't wear them. Glowing edges are MeshBasicMaterial brighter than white (bloom) and marked `userData.glow` (no shadow).
- Dev hooks: `window.__race` (the running race), `/dev/race.html?track=…&car=…` + `window.rl` (a solo race the AI drives, stepped
  by hand: `rl.drive(s)`, `rl.sun(at)` to face the sun, `rl.cost(n)` for ms per frame, draw calls and triangles: shoot and measure before and after a visual change), `/dev/cars.html` + `window.lab` for car models (`lab.cos({...})` dresses them), `/dev/cosmetics.html` +
  `window.cz` for any cosmetic kit on any car in the real garage showroom (and every Locker card).
