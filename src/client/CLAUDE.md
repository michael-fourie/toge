# src/client: the browser (menu, Gambol shooter, rendering)

Everything that touches the DOM, three.js or WebAudio. Game rules belong in `src/shared` (no three.js there), the
server in `src/server`. TŌGE's client is `race/` (see `src/shared/race/CLAUDE.md`).

## Files

```
  main.ts       boots the site: touch + pad setup, account.refresh(), the menu router (SCREENS; default screen `games`,
                the channel grid), ?join= / ?race= deep links; ctx.play starts a Game (shooter), ctx.drive a RaceGame (TŌGE)
  menu/         one file per screen (title = the Fortnite-style home with the character in the middle, host, join, lobby room, help, settings = sensitivity + rebindable keys, inventory = items tab + Character tab, casino = cases/plinko/blackjack/crash, account) + router.ts, ui.ts (incl. `esc()` for HTML),
                skirmish.ts (the animated island backdrop)
  settings.ts   saved player settings (name, sensitivity, auto-bhop) in localStorage
  game.ts       the Game: loop, fixed-tick sim + render interpolation, weapon state, remotes, net, camera
  achievements.ts  feats (360, no-scope, headshot, ...) + streaks/multi-kills; pure, unit-tested
  horde.ts      Survival zombies on the client: snapshot interpolation, zombie avatars, corpses
  workshop.ts   the Tinker's Workbench on the client: the build menu (workshop.css), placement mode (ghost, click builds, right-click/Esc cancels), coins spent/refunded; contraptions.ts = the models, the bench, their effects
  rustworld.ts  renders Rustworks by box.kind (afternoon sun, Foundry textures with an emissive lift, chimneys, rubble); its tests are tests/rustworks.test.ts
  summitworld.ts  renders Summit by box.kind (cold morning, snow/cliff/ice/piste/log textures in summittextures.ts, pines on trunks, snowfall, cable cars, a mountainside under the cloud sea); its tests are tests/summit.test.ts
  duneworld.ts  renders Dune Village by box.kind (low sun, sand/sandstone/plaster, rippled dune ramps, turquoise tile surf, palms, awnings, dust); dunetextures.ts; tests in tests/dunevillage.test.ts
  touch.ts      phones/tablets: IS_TOUCH ((hover: none) and (pointer: coarse), or ?touch=1), adds html.touch + the rotate-your-phone card, fullscreen on play. touch.css holds every mobile style, all under html.touch, so desktop never changes
  touchcontrols.ts  Fortnite-style controls (floating left joystick, right-side swipe look, FIRE that aims while held + a left FIRE, jump/slide/scope/grapple/grenade/reload/swap/use/scores/pause); they drive Input's touch methods (press/release/look/setFire/setScope/stick), so game logic is shared
  royale.ts     Battle Royale on the client (RoyaleView: phase, zone, loot, shield, grenades, who we spectate); royalefx.ts draws the zone wall + next ring and the loot (baked gun models up close, rarity beams far off); royalehud.ts + royale.css: banner, minimap, shield bar, storm tint, spectate line; royaleworld.ts renders Wildmere (static boxes merged per material, instanced canopies, a shadow that follows you)
  hill.ts       King of the Hill on the client: HillFx (the zone's ring, wall of light, capture arc, gem) and HillHud (team clocks, hill dial, who's on it, status line); hill.css
  world.ts      renders Windward by box.kind (Crown uses it too) (+ sky, clouds, scenery). textures.ts = procedural canvas textures
  foundryworld.ts  renders the Foundry at night: static boxes merged into ~9 meshes (shaded per storey), floors per room clipped to their slabs, faked lamp light, doors, planks, box, stations; foundrytextures.ts, foundrybox.ts (wall-gun plates, Mystery Box, plush), foundrydecor.ts (the new rooms' props and oddities: mannequins, ghost, gear and clock, ducks, soot sprites, graffiti; two merged meshes + a few movers)
  loadout.ts    the guns we carry and their ammo (the server owns *which* guns; ammo is counted here)
  viewmodel.ts  first-person gun + hands for any gun; the gun's animation (weapon/guns.ts) says where the hands go
  weapon/       rig.ts (GunRig/GunAnim/Plan, easing, builders), guns.ts (9 guns incl. the Sunbeam: model + fire/reload animation each; the AWP's bolt animation too), awp.ts (procedural AWP + optional GLB loader/fitter), hands.ts (Arm)
  grenadefx.ts / nadehud.ts  draw grenades (physics in shared/grenade.ts); the thrower reports 'boom', the server validates and kills
  night.ts      the night palette, stars and moon (used by foundryworld.ts); usehud.ts = points + the F prompt; jugmachine.ts / punchmachine.ts draw the two stations
  rope.ts       grapple rope + hook meshes
  killcam.ts    Trail (rolling per-player poses) + replay timing; game.ts records everyone and replays your death from the killer's eyes
  speedfx.ts    wind streaks overlay that scale with speed (hud.ts owns it); sfx.setWind adds the rushing-wind loop

  avatar.ts     chibi anime players (look = chosen skin, else seeded from name+colour, ink outlines, canvas faces), a zombie variant
                (poseZombie) + flung corpses. hud.ts, input.ts, net.ts, sfx.ts (synth audio)
  account.ts    who's signed in (asks `/api/me`; the session cookie is HttpOnly); menu/account.ts is the sign-in screen
  postgame.ts   the Survival post-game board (data in shared/postgame.ts); xpcard.ts the XP card + level badge
  menu/games.ts the console-style channel grid (built-ins + src/games plug-ins); menu/play.ts hosts plug-in games;
                menu/banners.ts the animated Gambol/TŌGE tiles; menu/practice.ts bot difficulty; menu/lootui.ts coin icon etc.
  pad.ts        gamepads for every menu (spatial focus, A/B/LB/RB) and for driving (readPad, padAxis, rumble)
  CSS           styles.css (global), one .css per feature (loot, nade, usehud, xpcard, hill, royale, workshop, touch,
                menu/*.css). Mobile-only rules go in touch.css under html.touch.
```

**Feats** (`achievements.ts`): the shot's context is captured at fire time (`lastHit`), and scored when the kill is confirmed (immediately offline, on `kill`/`zombieDied` online). Feats from one kill stack into one combo popup (`hud.feats`) + `sfx.feats`. Streak resets on death.

**Menu**
- Each screen in `menu/` is a function that renders into a root element. `router.ts` uses history, so browser Back, ← Back and Esc all match.
- The lobby room is client-side only: the server drops you into the match on join, and the room screen just shows the live roster before you enter.

**Rendering**
- One `THREE.WebGLRenderer` (created in game.ts; pixel ratio capped at 2, 1.5 on touch; PCF soft shadows; `autoClear = false`), no post-processing in the shooter. A WebGPU/PBR rewrite was tried (PR #1) and reverted on 2026-10-29 because it was too slow: don't reintroduce WebGPU.
- The world builder is picked per mode/map in game.ts: `buildFoundry` (Survival), `buildWildmere` (Battle Royale), `buildRustworks` / `buildSummit` / `buildDuneVillage`, else `buildWorld` (Windward, Crown).
- Materials are `MeshToonMaterial` with the shared `toonRamp()` gradient; textures are painted on canvases at load (textures.ts and the per-map *textures.ts). The only optional asset is `public/models/awp.glb`.
- Performance: Windward makes one mesh per box; the Foundry and Wildmere merge static geometry per material (`mergeGeometries`) and use `InstancedMesh` for repeated scenery. Do the same for any new big map.
- Neutral tone mapping with Neutral tone mapping. The world renders first, then the depth buffer is cleared and the viewmodel's own scene renders on top, so the gun never clips into walls.
- Shared toon ramp: `toonRamp()`. World palette: `PALETTE` in `world.ts`.

**Viewmodel**
- Everything lives in "view" space (scaled by `VIEW_SCALE`).
- Gun space is metres with the barrel along -Z and the bolt on +X. Animations use `seg`/`hold` keyframe helpers over a normalised timeline.
- A GLB at `public/models/awp.glb` is auto-fitted, and its nodes matching `/bolt|reloader|charging|handle/` and `/mag/` are reparented into the animated pivots.
- Tune the pose in `/dev/viewmodel.html` (`lab.GUN_POS`, `lab.paused`, `lab.step(s)`).
- Sights (`weapon/sights.ts`): every gun but the AWP gets iron sights (rear notch + front post with a fibre dot) and a red-dot sight, fitted to its model at load (`buildSights` scans the mesh tops so the sight line clears the whole gun). Punched guns show the red dot, others the irons. The aim-down-sights pose is computed from them (`ironAds` / `dotAds`) so the sight sits exactly on the screen centre; there is no hand-tuned `ads` pose any more. While aiming, the HUD crosshair hides (`hud.setScoped(_, sights)`) and the punch glow rings fade.

## Mobile

Play is landscape (a portrait phone gets a rotate card). On touch, Input.touchMode replaces pointer lock ("locked" = playing), mouse events are ignored, the renderer caps pixel ratio at 1.5, and HUD bits move out from under the thumbs (touch.css). **Never change desktop CSS or input paths for mobile: scope it under `html.touch` / `IS_TOUCH`.**

## Safety

- Never put player names or anything from the network into HTML strings: use `textContent` or `esc()` (menu/ui.ts).
- The client is not trusted for anything that matters (see `src/server/CLAUDE.md`). Client-side checks are for UX only; the server re-checks.

## Verifying in the browser

## Verifying in the browser

- Gun models and animations: open `/dev/viewmodel` (dev server), pick a gun, press fire / reload / draw; right mouse aims. `window.lab` has `pick(id, punched)`, `step(seconds)` and `reload(empty)` for scripted screenshots.
- In dev, `window.__game` is the running Game. To skip the menu, create one directly: `const { Game } = await import('/src/client/game.ts'); app.innerHTML = ''; new Game({ container: app, name: 'x', onExit() {} })`.
- Set `g.input.locked = true; g.hud.setPaused(false)` to play without pointer lock.
- Automation tabs are often **hidden**, which pauses rAF. Drive frames yourself: `let T = performance.now(); g.last = T; for (...) { T += 1000/60; g.frame(T); }`.
- Simulate keys with `document.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))`.
- **HMR gotcha:** after a hot update, the page uses `module.ts?t=…`, which is a different module instance from a fresh `import('/src/...')` in the console. State you inject (e.g. pushing boxes into `MAP`) won't reach the game. Reload the page first, or reach in through `window.__game`.
- An exception during `buildWorld` leaves the loading screen up forever. Check the console.
