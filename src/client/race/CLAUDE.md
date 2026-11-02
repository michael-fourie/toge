# src/client/race: TŌGE in the browser

The whole TŌGE guide (physics, tracks, cars, server, rendering rules, how to add a car or track) is
`src/shared/race/CLAUDE.md`. Read it before changing anything here.

The rules that bite most often in this folder:

- Plain `THREE.WebGLRenderer` through `Post` (post.ts: bloom, film grade per theme, ACES). No WebGPU.
- Never add or remove a light mid-race (every lit shader recompiles: a multi-second freeze). Add it at load and change its intensity.
- At night bloom only catches values above 1: lamps, reflectors and signs must be brighter than white.
- Watch triangle counts with `__race.renderer.info`; forests dominate, a car is ~30k triangles in ~40 draw calls.
- Driving physics is shared (`src/shared/race/vehicle.ts`); don't put handling logic in this folder.
- Cosmetics: cosmeticsview.ts draws them (one livery canvas per car for paint jobs + decals, seeded by item id so every
  client sees the same camo; cached materials per item, registered with `share()` so a car's dispose leaves them);
  cosmeticsui.ts is the Locker and Cases tabs and the case reel (styles in cosmetics.css). Body UVs: u nose to tail,
  v round the section, so each flank needs its own transform to read the right way (`onFlanks`).
- Body parts (wings, hoods, roof gear, lips, sides, mudflaps): bodykits.ts builds them from the Kit helpers (`k.top`,
  `k.height`, `k.side`, `k.front`, `k.cabin`) inside carmodel.ts's `common()`, before the merge; a cosmetic wing replaces
  the stock spoiler. Glowing edges are MeshBasicMaterial brighter than white (bloom) and marked `userData.glow` (no shadow).
- Dev hooks: `window.__race` (the running race), `/dev/cars.html` + `window.lab` for car models (`lab.cos({...})` dresses them).
