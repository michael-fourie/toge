# src/toge/client: TŌGE in the browser

The whole TŌGE guide (physics, tracks, cars, server, rendering rules, how to add a car or track) is
`src/toge/CLAUDE.md`. Read it before changing anything here. Never import from `src/gambol/`; site-wide pieces
(pad, account, menu kit, router) come from `src/client/`.

The rules that bite most often in this folder:

- Plain `THREE.WebGLRenderer` through `Post` (post.ts: bloom, film grade per theme, ACES). No WebGPU.
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
- Driving physics is shared (`src/toge/shared/vehicle.ts`); don't put handling logic in this folder.
- Menus (hub.ts, lobby.ts, cosmeticsui.ts) follow `src/toge/DESIGN.md`; tokens and components are in hub.css. race.css is
  only the in-race HUD. Page ids (`dtab`) are restored on reload: keep them stable.
- Cosmetics: cosmeticsview.ts draws them (one livery canvas per car for paint jobs + decals, seeded by item id so every
  client sees the same camo; cached materials per item, registered with `share()` so a car's dispose leaves them);
  cosmeticsui.ts is the Locker and Cases pages and the case reel (styles in cosmetics.css). Body UVs: u nose to tail,
  v round the section, so each flank needs its own transform to read the right way (`onFlanks`).
- Dev hooks: `window.__race` (the running race), `/dev/cars.html` + `window.lab` for car models.
