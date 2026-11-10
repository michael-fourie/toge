# TŌGE drivers

Four drivers sit in every car: a realistic human (MakeHuman body, real proportions) dressed in a
steampunk-meets-cyberpunk kit, seated with their hands on their own steering wheel, or tucked over the bike's tank.
You pick yours on the garage's **Driver** tab; rivals get the other three; online, everyone sees who you picked.

| | Driver | Kit | Wheel | Glow |
| --- | --- | --- | --- | --- |
| `marlowe` | **Marlowe Vance**, "The Governor": clockwork gentleman, 55 | bottle-green suit, brass mechanical right arm (sleeve cut off, riveted shoulder cap, elbow gears, pistons), goggles pushed up, brass collar | wooden rim, brass spokes | amber |
| `kirika` | **Kirika Sato**, "Volt": neon courier, 23 | black racing top and leggings with glowing seams, carbon left arm, half-face respirator with brass filters, temple implants, lit collar | carbon yoke with a light strip | magenta |
| `okonkwo` | **Okonkwo Adeyemi**, "Boiler": steam-age mechanic, 38 | rust canvas overalls, copper pauldron with a pressure gauge, brass and copper bracers (one with a gauge), welding goggles up, tan work gloves and belt | riveted iron | green |
| `ines` | **Inès Varga**, "Wraith": night-run ghost, 38 | black jacket, red striped shirt, brass cyber-monocle with a cable to the ear, stacked collar with lit seams, bandolier, leather gloves | dished leather, red top mark | red |

## In the game

- `src/toge/shared/rider.ts`: the catalogue (`RIDER_IDS`, `RIDERS`: names, bios, glow colours), `cleanRider`,
  `rivalRider`. The garage stores your pick (`rider`); a rider's code is its id, carried as `Racer.rider` (the room
  cleans anything else to the default).
- `src/toge/client/driver.ts`: loads each GLB once and hands out skinned clones (`loadDriver`). A rig `sit()`s
  (the `drive` clip held at the steering angle; seat and wheel shown, shoes hidden), `ride()`s (the bike) or
  `stand()`s (the `idle` loop). `arrive()` seats one in a car or on a bike once it has loaded (and fades a
  time-trial ghost's copy).
- `hands.ts` (`gripClips`, run by driver.ts as a model loads, legends and custom drivers alike, ~20 ms once): fixes
  the baked clips' hands. `pose.py` put them on the wheel from inside the rim (wrists toward the hub, the hand lying
  over the rim, fingers splayed). Each `drive` key now puts the hand on the wheel's own rim (measured from its mesh,
  so yokes and dished wheels work), wrist out behind the rim, palm in toward the hub, knuckles along it, the arm
  following by two-bone IK; the fingers are straightened back to the model's, drawn together, and closed joint by
  joint until they rest on the rim. `ride` closes them round the bike's grips; `idle` gives them a soft curl.
  Tunables are `HANDS`; `tests/toge/hands.test.ts` checks every legend at five steering angles. A rebuilt GLB
  goes through the same fix, so if `pose.py` ever grips properly itself, check the fix still agrees.
- `carmodel.ts`: the driver's eyes go where the cockpit camera's are, never through the roof; they replace the
  cabin's own driver seat and wheel (theirs fit their reach). `pose()` turns the wheel with the steering (with a
  little extra ratio, so small corrections read). The cabin is hidden in the cockpit view, the driver with it.
- `bikemodel.ts`: the driver rides in the saddle group (`root.userData.rider`, hidden from the rider's eye).
- `racegame.ts`: only drivers within `DRIVER_RANGE` (70 m) are drawn.
- `showroom.ts`: your driver stands by the driver's door; the Driver tab walks the camera in.
  `riderportrait.ts` draws each driver once for the lobby's crew.

Budgets per driver: about 30-36k triangles, ~22 draw calls, 1.6-1.7 MB (WebP textures). Six on a grid
is about +130 draw calls and +190k triangles, which is why far ones are culled.

## Building them

The models are generated, not hand-made: `tools/drivers/` is a Blender script that builds all four from
scratch and exports `public/models/drivers/<id>.glb`.

Setup (once):

1. Blender 5.2.
2. MPFB 2 (MakeHuman for Blender) from extensions.blender.org:
   `blender -c extension install-file -r user_default -e add-on-mpfb-v2.0.18.zip`
3. The MakeHuman system assets (CC0, `makehuman_system_assets_cc0.zip` from files.makehumancommunity.org),
   unzipped into MPFB's user data, on Windows
   `%APPDATA%\Blender Foundation\Blender\5.2\extensions\.user\user_default\mpfb\data`.

Build (all, or some ids), optionally with preview renders:

```bash
blender -b --python tools/drivers/build.py -- marlowe kirika --preview /tmp/drivers
```

Then `npx tsx --test tests/toge/drivers.test.ts` checks every GLB still has what the game needs.

What each file does:

- `cast.py`: the four designs. A MakeHuman phenotype (gender, age, muscle, weight, proportions, height,
  ethnicity), skin, eyes, hair, clothes, recolour rules for the clothes' textures (pick pixels by hue,
  saturation, value or a UV box; repaint keeping the cloth's shading; optionally glow), the kit, the seat,
  the wheel, and the stance.
- `build.py`: makes the MPFB human (game-engine skeleton), bakes the body shape, replaces the materials with
  plain glTF ones on recoloured, downscaled textures, cuts sleeves off for mechanical arms, deletes skin
  hidden under clothes, decimates (sparing the face), builds the kit, poses, and exports.
- `kit.py`: the hard-surface parts, fitted to each body by raycasting (rings cast inward round a bone for
  bands, bracers and collars; ray grids for shells like the respirator and pauldron), then bound to the rig
  (rigid to one bone, or skinned by copying the nearest body or cloth weights). Also the seat and the wheels.
- `pose.py`: the `drive` clip (seated, hip point at the origin; 17 keys sweep the wheel ±110°, the hands on
  IK targets parented to the wheel bone, the head turning into the bend), the `ride` clip (tucked over the
  tank, hands on the bike's grips, feet on its pegs; `BIKE` holds bikemodel.ts's touch points) and the `idle`
  loop; all baked to plain keys.
- `render.py`: EEVEE preview renders (standing, face, seated, full lock).

Adding a driver: a spec in `cast.py`, an entry in `RIDER_IDS` / `RIDERS` (append), build it, run the tests.

## Custom drivers

Players can also build their own on the Driver page: `tools/drivers/wardrobe.py` builds six body bases and
swappable parts with the same human, materials and kit code, and the client assembles them per look. See
`docs/DRIVER_CREATOR.md` (plan and progress).

```bash
blender -b --python tools/drivers/wardrobe.py              # all six bases, ~3.5 min each
blender -b --python tools/drivers/wardrobe.py -- --zones    # only colour zones
```

## Licences

The MakeHuman base mesh, its targets and the system assets are CC0, and so are characters made from them.
MPFB itself is GPL, but it only runs in Blender at build time; nothing of it ships. The kit, seats and wheels
are generated by `tools/drivers`.
