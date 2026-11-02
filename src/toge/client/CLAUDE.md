# src/toge/client: TŌGE in the browser

The whole TŌGE guide (physics, tracks, cars, server, rendering rules, how to add a car or track) is
`src/toge/CLAUDE.md`. Read it before changing anything here. Never import from `src/gambol/`; site-wide pieces
(pad, account, menu kit, router) come from `src/client/`.

The rules that bite most often in this folder:

- Plain `THREE.WebGLRenderer` through `Post` (post.ts: bloom, film grade per theme, ACES). No WebGPU.
- Low graphics (Settings tab; `lowGraphics()` from src/client/graphics.ts) must stay cheap: no shadows, no post chain,
  Lambert/Phong stand-ins for PBR (lowgfx.ts). A new effect either skips itself on Low or costs next to nothing.
- Never add or remove a light mid-race (every lit shader recompiles: a multi-second freeze). Add it at load and change its intensity.
- At night bloom only catches values above 1: lamps, reflectors and signs must be brighter than white.
- Watch triangle counts with `__race.renderer.info`; forests dominate, a car is ~30k triangles in ~40 draw calls.
- Driving physics is shared (`src/toge/shared/vehicle.ts`); don't put handling logic in this folder.
- Menus (hub.ts, lobby.ts, cosmeticsui.ts) follow `src/toge/DESIGN.md`; tokens and components are in hub.css. race.css is
  only the in-race HUD. Page ids (`dtab`) are restored on reload: keep them stable.
- Cosmetics: cosmeticsview.ts draws them (one livery canvas per car for paint jobs + decals, seeded by item id so every
  client sees the same camo; cached materials per item, registered with `share()` so a car's dispose leaves them);
  cosmeticsui.ts is the Locker and Cases pages and the case reel (styles in cosmetics.css). Body UVs: u nose to tail,
  v round the section, so each flank needs its own transform to read the right way (`onFlanks`).
- Dev hooks: `window.__race` (the running race), `/dev/cars.html` + `window.lab` for car models.
