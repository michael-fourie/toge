# KANJO drivers

Four drivers sit in every car: a cartoon human (a MakeHuman body restyled anime-fashion: big head, big eyes,
flat soft colours) dressed in a steampunk-meets-cyberpunk kit, seated with their hands on their own steering wheel,
or tucked over the bike's tank.
You pick yours on the garage's **Driver** tab; rivals get the other three; online, everyone sees who you picked.

| | Driver | Kit | Wheel | Glow |
| --- | --- | --- | --- | --- |
| `marlowe` | **Marlowe Vance**, "The Governor": clockwork gentleman, 55 | dusty sage suit, cream shirt, silver hair, brass mechanical right arm (sleeve cut off, riveted shoulder cap, elbow gears, pistons), goggles pushed up, brass collar | wooden rim, brass spokes | amber |
| `kirika` | **Kirika Sato**, "Volt": neon courier, 23 | periwinkle racing top and dusk-blue leggings with glowing seams, white bob, carbon left arm, half-face respirator with brass filters, temple implants, lit collar | carbon yoke with a light strip | magenta |
| `okonkwo` | **Okonkwo Adeyemi**, "Boiler": steam-age mechanic, 38 | terracotta canvas overalls over a slate-blue tee, copper pauldron with a pressure gauge, brass and copper bracers (one with a gauge), welding goggles up, tan work gloves and belt | riveted iron | green |
| `ines` | **Inès Varga**, "Wraith": night-run ghost, 38 | dusk-blue jacket, coral striped shirt, rose ponytail, brass cyber-monocle with a cable to the ear, stacked collar with lit seams, bandolier, leather gloves | dished leather, red top mark | red |

## The look

Michael asked for it on 2026-11-14: the drivers looked "default, dark and odd"; make them cartoonish and anime-like,
in better, softer colour, "nice and soft like our cars are". Everything is redone in that style, legends and the
creator's wardrobe alike, by the same few rules:

- **Shape** (`STYLE['targets']`, `STYLE['head']` in build.py): on top of each body's MakeHuman phenotype, a younger,
  rounder head scaled up by a fifth, eyes at about twice MakeHuman's largest (and taller), a small nose and mouth, a
  narrow chin and a slim neck. Bodies keep their builds; the game's skeleton, clips and fits all follow.
- **Skin** (`toon_skin`): MakeHuman's photo skins blurred smooth and pulled most of the way to their own mean tone
  (lips, age lines and the tone itself survive as soft shapes), a little lighter, with a blush on each cheek.
- **Eyes** (`anime_eye`): the iris texture is painted, in the colour of MakeHuman's: a big iris dark at the top and
  bright at the bottom, a dark rim, a large pupil, two catchlights, a clean white with the lid's shadow.
- **Brows and lashes** (`stroke`): single hairs thickened into one brush stroke; brows in the hair's colour, lashes a
  soft plum-brown, never black.
- **Cloth and hair** (`soften`, `recolor`): the weave and strands are blurred out, no normal maps, and each zone is
  its colour in gentle shades (contrast × `STYLE['contrast']`, kept inside `STYLE['shade']`); anything left over is
  lifted off black (`STYLE['floor']`).
- **Palette** (cast.py, `GARMENTS` in wardrobe.py, `palette()` in kit.py): dusty pastels, mid-light, never near
  black, in the mood of the cars' paints (Sakura, Lagoon, Champagne): sage, periwinkle, dusk blue, coral,
  terracotta, cream, honey. Metals are pale and satin (`kit.METAL`: about half metal, half paint), "black" leather
  and gunmetal are dusky greys. A driver's glow colour is the one bright note; it glows a little less than it did.
  Muted on 2026-11-15 (Michael: the first cartoon palette was "a bit too bright"): every cloth, hair, shoe, metal
  and leather colour kept its hue with about three quarters of its saturation and 95% of its value (sage `#6fa08c`
  became `#75988a`, cream `#fbf2de` `#eee8da`, brass `#ecc878` `#e0c68c`); skin is a little less lifted and less
  saturated (`skin_lift` 0.11, `skin_sat` 0.88), the blush fainter and dustier (`blush` mix 0.22), irises less
  jewel-bright (`iris_sat`, `iris_sat_max`, `iris_val`), and the shade band's own glow (`TOON.floor`) is 0.04.
  The glow colours were left alone. Keep new colours in that range: dusty, not dark.
- **Shading** (src/kanjo/client/toon.ts): in the game every driver material gets soft cel shading: light falls in two
  bands with a soft edge instead of fading round the form, the shade band still gets `TOON.shade` of the light and a
  small glow of the surface's own colour (`TOON.floor`), so nobody goes dark under one spot or at night. It is a
  patch on the standard material's shader (and on Low graphics' stand-ins), so maps, skinning, the wardrobe's
  recolour and the glows work as before. Drivers don't receive shadow maps (the bands are their shading).

## The fit: nothing poking through

Michael, 2026-11-15: clothing "merges behind the character". What was wrong, and what `build.py` does about it
(`FIT` holds the numbers; legends and the wardrobe share the code):

- **Skin came through cloth, from behind most of all** (slits at the shoulder blades and upper arms, thighs
  through a skirt). The skin under clothes is dropped, but the test for "under clothes" was one ray out along
  the skin's normal, 3.5 cm long. Skin whose normal runs along the cloth instead of at it (armpits, the inside
  of the upper arm, between the legs) or that sits further from loose cloth (thighs in a skirt) was kept, and
  swung out through sleeves, jacket backs and skirts as soon as the arms came down from the rest pose.
  `under_cloth()` now also counts skin with cloth close by whose inner face looks at it, and skin with cloth all
  round it (eight level rays).
- **Cloth dipped into the skin**: MakeHuman fits clothes with next to no gap, and the bigger cartoon head and
  neck, the decimated body and the decimated clothes each move a surface a few millimetres. `lift()` moves
  every cloth vertex to at least 3 mm off the skin. Clothes are decimated before the fit, so it is worked out
  on the meshes that ship.
- **Hair sank into collars and backs**: the cartoon head is a fifth bigger, so ponytails, braids and long hair
  hang lower and closer to the back. `comb()` moves hair below the chin out of whatever can be worn with it.
- **Layers** (`over()`): trouser legs clear the shoes (leggings go inside them instead: `tuck`), and in the
  wardrobe every top clears every bottom, so any pairing works. A top is pushed level, straight out from the
  bone it hangs on (`level`), not along its normals: a hem's normals point every which way, and following them
  pulled a tee's hem into spikes over the jeans.
- **The seat** is fitted to the bulkiest clothes a body can wear (it was fitted to one tee, and a jacket's back
  sank into the backrest).

Check a change with the preview renders (`--preview`, both builds: front, both back quarters, the side, and
seated) and in `/dev/drivers.html`.

## In the game

- `src/kanjo/shared/rider.ts`: the catalogue (`RIDER_IDS`, `RIDERS`: names, bios, glow colours), `cleanRider`,
  `rivalRider`. The garage stores your pick (`rider`); a rider's code is its id, carried as `Racer.rider` (the room
  cleans anything else to the default).
- `src/kanjo/client/toon.ts`: the soft cel shading above (`toon`, `toonAll`, tunables `TOON`), applied by driver.ts
  to a legend's materials as it loads and by wardrobe.ts to an assembled driver's.
- `src/kanjo/client/driver.ts`: loads each GLB once and hands out skinned clones (`loadDriver`). A rig `sit()`s
  (the `drive` clip held at the steering angle; seat and wheel shown, shoes hidden), `ride()`s (the bike) or
  `stand()`s (the `idle` loop). `arrive()` seats one in a car or on a bike once it has loaded (and fades a
  time-trial ghost's copy).
- `hands.ts` (`gripClips`, run by driver.ts as a model loads, legends and custom drivers alike, ~20 ms once): fixes
  the baked clips' hands. `pose.py` put them on the wheel from inside the rim (wrists toward the hub, the hand lying
  over the rim, fingers splayed). Each `drive` key now puts the hand on the wheel's own rim (measured from its mesh,
  so yokes and dished wheels work), wrist out behind the rim, palm in toward the hub, knuckles along it, the arm
  following by two-bone IK; the fingers are straightened back to the model's, drawn together, and closed joint by
  joint until they rest on the rim. `ride` closes them round the bike's grips; `idle` gives them a soft curl.
  Tunables are `HANDS`; `tests/kanjo/hands.test.ts` checks every legend at five steering angles. A rebuilt GLB
  goes through the same fix, so if `pose.py` ever grips properly itself, check the fix still agrees.
- `carmodel.ts`: the driver's eyes go where the cockpit camera's are, never through the roof; they replace the
  cabin's own driver seat and wheel (theirs fit their reach). `pose()` turns the wheel with the steering (with a
  little extra ratio, so small corrections read). The cabin is hidden in the cockpit view, the driver with it.
- `bikemodel.ts`: the driver rides in the saddle group (`root.userData.rider`, hidden from the rider's eye).
- `racegame.ts`: only drivers within `DRIVER_RANGE` (70 m) are drawn.
- `showroom.ts`: your driver stands by the driver's door; the Driver tab walks the camera in.
  `riderportrait.ts` draws each driver once for the lobby's crew.

Budgets per driver: about 29-36k triangles, ~22 draw calls, 1.4-1.6 MB (WebP textures). Six on a grid
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

Then `npx tsx --test tests/kanjo/drivers.test.ts` checks every GLB still has what the game needs.

What each file does:

- `cast.py`: the four designs. A MakeHuman phenotype (gender, age, muscle, weight, proportions, height,
  ethnicity; `targets` can add to or override the cartoon head's), skin, eyes, hair, clothes, recolour rules for
  the clothes' textures (pick pixels by hue, saturation, value or a UV box; repaint in soft shades of a colour;
  optionally glow), the kit, the seat, the wheel, and the stance.
- `build.py`: `STYLE` (every number of the look above) and `FIT` (the fit), makes the MPFB human (game-engine
  skeleton) with the cartoon targets, bakes the body shape, enlarges the head (`big_head`), replaces the
  materials with plain glTF ones on repainted, downscaled textures (`toon_skin`, `anime_eye`, `stroke`, `soften`,
  `recolor`), cuts sleeves off for mechanical arms, fits the clothes and hair (`lift`, `over`, `comb`), deletes
  skin hidden under clothes (`cull_hidden`), decimates (sparing the face), builds the kit, poses, and exports.
- `kit.py`: the hard-surface parts, fitted to each body by raycasting (rings cast inward round a bone for
  bands, bracers and collars; ray grids for shells like the respirator and pauldron), then bound to the rig
  (rigid to one bone, or skinned by copying the nearest body or cloth weights). Also the seat and the wheels.
- `pose.py`: the `drive` clip (seated, hip point at the origin; 17 keys sweep the wheel ±110°, the hands on
  IK targets parented to the wheel bone, the head turning into the bend), the `ride` clip (tucked over the
  tank, hands on the bike's grips, feet on its pegs; `BIKE` holds bikemodel.ts's touch points) and the `idle`
  loop; all baked to plain keys. The idle's `relaxed` arms (`hang`, tunables `HANG`; Michael, 2026-11-15: the
  old ones stood out with "locked elbows", hands held in front) are set by direction, not by turns from the A
  pose: each arm hangs straight down just outside the widest thing at the hips (body or any clothes it can
  wear), elbow soft, palm turned to the thigh.
- `render.py`: EEVEE preview renders (standing, face, seated, full lock) in a soft bright studio. They show
  shape, textures and palette; the cel shading is the game's, so check `/dev/drivers.html` too.

Adding a driver: a spec in `cast.py`, an entry in `RIDER_IDS` / `RIDERS` (append), build it, run the tests.

## Custom drivers

Players can also build their own on the Driver page: `tools/drivers/wardrobe.py` builds six body bases and
swappable parts with the same human, cartoon look, materials and kit code, and the client assembles them per look. See
`docs/DRIVER_CREATOR.md` (plan and progress).

```bash
blender -b --python tools/drivers/wardrobe.py              # all six bases, ~4 min each
blender -b --python tools/drivers/wardrobe.py -- m_avg --preview /tmp/wardrobe   # one base, with fit renders
blender -b --python tools/drivers/wardrobe.py -- --zones    # only colour zones
```

## Licences

The MakeHuman base mesh, its targets and the system assets are CC0, and so are characters made from them.
MPFB itself is GPL, but it only runs in Blender at build time; nothing of it ships. The kit, seats and wheels
are generated by `tools/drivers`.
