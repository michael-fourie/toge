# src/toge/client: TŌGE in the browser

The whole TŌGE guide (physics, tracks, cars, server, rendering rules, how to add a car or track) is
`src/toge/CLAUDE.md`. Read it before changing anything here. Never import from `src/gambol/`; site-wide pieces
(pad, account, menu kit, router) come from `src/client/`.

The rules that bite most often in this folder:

- Plain `THREE.WebGLRenderer` through `Post` (post.ts: bloom, then one last pass for the film grade per theme, the sun's lens
  flare, the speed blur and ACES + sRGB; keep it one pass). No WebGPU. The bloom (`Bloom`) leaves its result in a half-size texture that
  the grade adds (`tBloom`), and its bright pass and the grade clip the scene themselves (`SAFE`), so after the scene
  there are only two full-size passes (the MSAA resolve and the grade); don't add a full-screen pass for something a
  shader already reading the image can do. The flare (`Grade.flare`, 0 on night themes) checks whether the sun is
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
- Levels of detail (lod.ts `LodTiles`, swap distances in `LOD`): past `LOD.trees` (300 m to the nearest edge of a
  400 m tile) a tile's trees are drawn with `farTree` stand-ins (trees.ts: a five-sided lathe of the crown's outline
  and averaged colours, ~20 triangles instead of 50-100) sharing the tile's instance matrices and colours (`farTwin`);
  bushes aren't drawn past `LOD.bushes`; a fine terrain chunk past `LOD.terrain` is drawn with every other vertex
  (`coarse` in trackview.ts: each vertex the lowest of the fine ones round it, so it never pokes through the road, and a
  skirt so the seams don't gap). A new tree species gets a stand-in for free; set `noFar` on one a lathe can't stand
  in for (the saguaro's arms). trackview.ts / worldview.ts `follow()` runs `lods.update`.
- Tree and rock shadows come from shadow-only copies cut into 100 m squares (lod.ts `shadowCasters` + `ShadowOnly`:
  hidden while three.js lists what the camera draws, shown when the shadow map starts), so the 90 m shadow box draws
  only the trees round the camera, not every tree of each 400 m tile it touches. The tiles themselves don't cast.
- Shaders: racegame.ts `warmShaders()` compiles every material in the scene behind the loading screen, hidden ones
  included (far stand-ins, effects). Anything shown later with a new material (or new defines) compiles mid-race, a
  stall of 50-300 ms on Windows: build it hidden at load instead of creating it when it's first needed. It compiles
  into the post chain's HDR target (`post.sceneTarget`: tone mapping and colour space differ from the screen's), and
  shadows use `PCFShadowMap` (three r186 swaps PCFSoft for PCF at the first shadow render, recompiling everything).
- Adaptive resolution (`adaptResolution` + `RES` in racegame.ts): when frames average slower than `RES.slowMs` for
  `RES.slowFor` s, the render scale drops a step (to `RES.min` of the pixel ratio at worst); with headroom it climbs back.
  `__race.resScale` shows it. A machine that keeps up never leaves full resolution.
- The HUD runs every frame, so keep it cheap: no `innerHTML` rebuilds per frame (the strip reuses its dots), cache what
  doesn't move (the tach face, the minimap's road outline as a Path2D), and never read layout (`clientWidth`) after
  writing the DOM (the view size is kept from `resize`). City traffic further than `TRAFFIC_DRAW` isn't drawn.
- The open world (worldview.ts, worldtrafficview.ts; free roam on `toge`) is one scene for a 7 km island: terrain in
  LOD chunks (`LODS_HIGH` / `LODS_LOW`), trees only near the roads in 400 m tiles shown within `TREE_DRAW` (stand-ins
  past `LOD.trees`), the island's lines, rails, walls and posts split into `CELL` squares so the view and the shadow map
  cull them, the traffic's full Pebble model only within `DRAW_HIGH[0]` / `DRAW_LOW[0]` (at most `MAX_NEAR`), boxes
  beyond. A Pebble is ~30k triangles, so full ones out of view aren't drawn and only those within `SHADOW_NEAR` (two
  instanced sets per material) cast shadows: the traffic was ~1.5 M of the island's 2.65 M triangles a frame. Road
  meshes face up (their triangles are wound left to right across the road): a downward winding made the roads invisible
  from above. The HUD's roam mode (`.rh.roam`) hides place, clock, board and strip.
- Building walls (facades.ts, 2026-11-11: Michael wanted the background buildings less blocky and plain, at no frame
  cost): towers, flats and village houses share one shader patch (`facadeMaterial`) that reads two array textures
  (colour with glass in alpha, glow) of four layers: three wall styles and a shopfront strip. Geometry carries `uv` in
  facade tiles and a `fac` attribute (`pushFac`: style, street height, roof height): the bottom `FAC_SHOP` m read the
  shops, the top 0.9 m is a dark parapet. Same draw calls and texture reads as before (measured on Neon Bay and the
  open world). Use array layers, not an atlas: an atlas needed `textureGrad` across its seams, which cost ~20% of the
  frame in SwiftShader. Round the style in the shader (an interpolated 2.0 can arrive as 1.999 and pick the wrong layer).
  Roofs use `roofDeck` with planar `roofUv`.
- Driving physics is shared (`src/toge/shared/vehicle.ts`); don't put handling logic in this folder.
- Menus (hub.ts, lobby.ts, cosmeticsui.ts) follow `src/toge/DESIGN.md`; tokens and components are in hub.css. race.css is
  only the in-race HUD. Page ids (`dtab`) are restored on reload: keep them stable.
- Cosmetics: cosmeticsview.ts draws them (one livery canvas per car for paint jobs + decals, seeded by item id so every
  client sees the same camo; cached materials per item, registered with `share()` so a car's dispose leaves them);
  cosmeticsui.ts is the Locker and Cases pages and the case reel (styles in cosmetics.css). Body UVs: u nose to tail,
  v round the section, so each flank needs its own transform to read the right way (`onFlanks`).
- Body parts (wings, hoods, roof gear, lips, sides, mudflaps): bodykits.ts builds them from the Kit helpers (`k.top`,
  `k.height`, `k.side`, `k.front`, `k.cabin`) inside carmodel.ts's `common()`, before the merge; a cosmetic wing replaces
  the stock spoiler. Bikes don't wear them. Whole body kits (the Vanta Case) are designs, not bolt-ons: shells.ts. Glowing edges are MeshBasicMaterial brighter than white (bloom) and marked `userData.glow` (no shadow).
- Dev hooks: `window.__race` (the running race), `/dev/race.html?track=…&car=…` + `window.rl` (a solo race the AI drives, stepped
  by hand: `rl.drive(s)`, `rl.sun(at)` to face the sun, `rl.cost(n)` for ms per frame, draw calls and triangles: shoot and measure before and after a visual change), `/dev/cars.html` + `window.lab` for car models (`lab.cos({...})` dresses them), `/dev/cosmetics.html` +
  `window.cz` for any cosmetic kit on any car in the real garage showroom (and every Locker card).
