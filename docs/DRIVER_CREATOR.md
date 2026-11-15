# KANJO driver creator: plan

Goal: players build their own driver in the garage (body, face, skin, hair, outfit and its colours,
brass-and-neon kit, glow colour, wheel), and the result looks like it belongs next to Marlowe, Kirika,
Okonkwo and Inès: a realistic MakeHuman body, recoloured MakeHuman clothes, fitted hard-surface kit, the
same materials, seated with hands on the wheel and standing in the showroom.

This file is the plan *and* the progress log. Tick boxes as things land; add what we learn under
"Notes as we go".

## The idea in one paragraph

The four legends are each one baked GLB. A custom driver can't be baked per player, so the creator
**assembles a driver at runtime from parts built by the same Blender pipeline**. For each *body base*
(a MakeHuman phenotype: frame and build) the pipeline exports one base GLB (body, eyes, rig, the `drive`
and `idle` clips, seat) plus a small GLB per wardrobe part (each hair, outfit, shoes, kit piece, wheel),
all skinned to that base's skeleton. The client loads the base plus the chosen parts, binds every part
to the base's skeleton, and recolours on the GPU from masks baked at build time. A driver's look is a
short code (`Look`), shared by client and server like the car code, so it travels in `driver=` and
rivals and remote racers can be drawn from it.

## Why this shape

- **Same style for free**: the parts come from `tools/drivers` (MPFB bodies, MakeHuman clothes, `kit.py`
  pieces, `palette()` materials), so nothing is restyled by hand in three.js.
- **Bases instead of continuous body sliders**: MakeHuman's height and proportion targets move the
  joints, so a morph slider would also need the skeleton, the seated IK (hands on the rim) and the seat
  fit redone at runtime. A small set of bases keeps all of that baked and correct. Face shape is
  different: face targets only move head vertices (the game-engine rig has no face bones), so faces can
  become morph targets later (Phase 7).
- **GPU recolour, not baked colours**: the build bakes each outfit's colour *zones* (jacket, shirt,
  trim, ...) into a mask texture and records each zone's reference luminance. A shader patch repaints
  `zoneColour × (lum / ref)` exactly like `build.py`'s `recolor()`, so colour pickers update live and
  one texture serves every colour choice.
- **Kit materials are plain PBR**: metals, leathers and the glow are `palette()` entries, so the client
  swaps them per look (pick the metal, pick the glow colour) with no rebuild.

## Data model (`src/kanjo/shared/look.ts`)

```
Look {
  base      BaseId        frame + build: m_slim m_avg m_heavy f_slim f_avg f_heavy
  skin      SkinId        a MakeHuman skin of the base's frame (tone + age; both frames list them in the same order)
  eyes      EyeId         iris texture
  brows     BrowId        12 MakeHuman brows, coloured with the hair
  hair      HairId        10 MakeHuman hairstyles or 'none'
  hairColor RGB           hair and brows
  outfit    OutfitId      12 MakeHuman outfits, worn by any base
  colors    RGB[]         one per zone of the outfit (each outfit has its own palette)
  shoes     ShoeId        6
  shoeColor RGB
  kit       KitId[]       up to 5 pieces, one per slot (brow, eyes, mouth, temple, neck, arm_l, arm_r,
                          shoulder, hands, waist, chest)
  metal     MetalId       brass | copper | gunmetal | chrome | steel | carbon
  leather   LeatherId     leather | leather_black | leather_tan
  glow      RGB           lenses, seams, implants
  wheel     WheelId       wood | yoke | iron | deep
}
```

- `encodeLook` / `decodeLook`: `L2.` + 15 dot-separated fields (catalogue indices in base 36, colours as
  6 hex). `decodeLook` validates everything (ids in range, skin of the right frame, colours per zone, kit
  slots) and returns null for junk or an old version; the server uses it (`isDriver`) on `driver=`.
- `withBase` keeps skin tone and age across frames; `withOutfit` resets to the outfit's palette;
  `withKit` keeps one piece per slot; `randomLook` for "Surprise me".
- The catalogue mirrors the build's manifest; `tests/kanjo/look.test.ts` checks the two agree, file by file.

## Build (`tools/drivers/wardrobe.py`)

`blender -b --python tools/drivers/wardrobe.py -- [bases...]` writes `public/models/drivers/wardrobe/`:
`<base>/base.gltf` + one `<part>.gltf` per part (Draco-compressed `.bin` beside each), `tex/` (every
texture and zone mask, shared by all bases), `skins/`, `eyes/` and `manifest.json`. About 3.5 min a base.
`-- --zones` only recomputes colour zones and hair contrast (masks + manifest), no geometry.

Per base:
1. The MPFB human with the base phenotype wearing *every* outfit, shoe, hair and brow at once.
2. Body: MPFB's helper mask applied, the clothes' `Delete.*` masks not: instead a `_hide` vertex
   attribute gets one bit per outfit/shoe (its delete group plus a raycast for skin under the cloth).
   Decimated to 0.6 (sparing the face) before the bits are computed.
3. Clothes, hair and brows keep their MakeHuman textures; each outfit's zones (rules like the legends'
   `recolor()`) become an RGBA mask with per-zone reference luminance. Hair, brows and shoes have one
   zone over everything.
4. Kit with role materials. Head pieces fit once; cloth-hugging pieces (`CLOTH_FIT`) fit once per
   outfit and identical fits (within 8 mm) share a file. Mechanical arms are fitted to a sleeve-cut copy
   of each outfit. What the legends paint into the body (`kit.paint_region`: metal arm skin, gloves) is
   recorded as `paint` (bones, threshold, role) and mech arms as `sleeve`.
5. `drive`/`idle` clips (wheel radius 0.18 m), seat fitted, four wheels.
6. Exported as `.gltf` (JSON minified) with `export_texture_dir` pointing at the shared `tex/`.

## Client (`src/kanjo/client/wardrobe.ts`)

- `assemble(look)`: loads base + parts (cached per URL, Draco via `public/draco/`), clones the base,
  rebinds each part's SkinnedMesh to the base skeleton by bone name, and applies the look:
  - body: triangles under worn clothes dropped (`_hide`), except the arm under a cut sleeve; repaint
    groups from bone weights (`paint`); skin texture per look;
  - outfits lose the sleeve a mech arm cut (triangles with average arm weight > 0.5);
  - recolour shader on outfits, shoes, hair, brows; role materials on kit and seat.
- `loadDriver(id | look)` covers legends and custom drivers; seating, showroom and culling are shared.

## Garage UI (Driver tab)

- Two modes: **Legends** (today's four cards) and **Your driver** (the creator).
- Creator sections: Body (base), Face & skin (skin, eyes, brows), Hair (style, colour), Outfit (suit,
  zone colours, shoes), Kit (slots, metal, leather), Glow, Wheel. Swatch palettes in the house style plus
  a free picker; "Surprise me"; a name/nick field.
- The showroom's driver focus (camera walk-in, portrait light) shows the live rig; a "seated" preview
  toggle sits them in the car's seat with the wheel.
- Gamepad navigable like the rest of the hub.

## Phases

- [x] **0. Plan** (this file).
- [x] **1. Look model**: `src/kanjo/shared/look.ts` (catalogue, `Look`, `encodeLook`/`decodeLook`/
  `lookProblem`, `withOutfit`/`withKit`, `randomLook`); `tests/kanjo/look.test.ts` (round trips, junk refused,
  kit slots, and the catalogue checked against the built manifest and files).
- [x] **2. Pipeline, one base**: `tools/drivers/wardrobe.py` builds `m_avg` (3 outfits, 1 shoes, 3 hairs,
  11 kit pieces, 4 wheels; 7 skins and 6 irises shared) in ~25 s. `build.py` now exposes `zone_masks()`
  (used by `recolor()`) and only runs `main()` when run directly.
- [x] **3. Assembler**: `src/kanjo/client/wardrobe.ts` (`assemble(look)`), recolour shader, body hiding,
  role materials; `DriverRig` takes any scene; `loadDriver()` takes a legend id or a look code.
  `/dev/drivers.html` (`window.lab`) shows legends beside custom looks, standing or seated.
- [x] **4. Creator UI**: a fifth card on the Driver tab ("Your driver") opens the creator underneath
  (`src/kanjo/client/creator.ts`: face, hair, outfit + zone colours, shoes, kit, metal, leather, glow,
  wheel, Surprise me). Saved in localStorage (`atrous.look`, and `atrous.driver` holds the code while
  you drive it); the showroom re-assembles 150 ms after a change.
- [x] **5. Race + network**: `isDriver()` (legend or wearable look) on the server; `Racer.driver` is a
  string; racegame seats custom drivers (yours and remote racers'); rivals are the four legends when you
  drive your own; the lobby roster tags custom drivers "Own driver" in their glow. Tested in
  `tests/kanjo/rider.test.ts`.
- [x] **6. Fill the wardrobe**: six bases (masculine/feminine × slim/average/heavy), all 12 MakeHuman
  outfits with colour zones, 6 shoes, 10 hairstyles, 12 brows, 10 skins per frame, 9 irises, 15 kit
  pieces incl. mechanical arms (sleeve cut + metal skin at runtime) and gloves (painted hands). Draco +
  shared textures + minified JSON. Creator: Frame and Build rows, brows, shoes.
- [ ] **7. Faces**: face-shape morph targets (MakeHuman face/ethnicity targets on head vertices) as a few
  sliders; age via skin texture.
- [x] **8. Accounts**: the pick and the look are part of the garage (`Garage.driver`, `Garage.look`, the
  `{a: 'driver'}` action, checked by `isDriver` / `decodeLook`), so they live in the Accounts DO for a
  signed-in player and in `atrous.garage` for a guest, through the same rules. The client applies a
  change at once and sends it 400 ms after the last edit (`garage.setDriver`), so dragging a colour is
  one request. On first sign-in an account with no look adopts the guest's; the old `atrous.driver` /
  `atrous.look` keys are folded into the guest garage once. Tests in `tests/kanjo/rider.test.ts`.
  Still open: whether some parts should be unlocked with money or crates.

## Risks and open questions

- **Goggles over hair**: forehead goggles sit on the hair; big hair (afro) may swallow the strap. Option:
  mark some kit/hair pairs incompatible in the catalogue.
- **Repo size**: the wardrobe is ~5 MB per base (mostly per-outfit kit geometry), ~35 MB in all. A
  player only downloads what they wear (~1-2 MB). If the repo weight matters: share fits across more
  outfits (looser tolerance, or fit classes), or move the wardrobe to R2.
- **Draw calls**: a custom driver is more meshes than a legend (one per part). Merge parts sharing a
  material after assembly if the grid gets heavy (6 drivers × ~25 calls today).

## Notes as we go

- 2026-11-05: ported onto master's KANJO (`src/kanjo/`, drivers are "riders"). `Rider` is now a legend id or a
  look code (`LookCode`, a template-literal type); the rider-code plumbing master already had (garage `rider`,
  the `rider` socket param and lobby message, records, portraits, the showroom) carries custom drivers as is,
  with `RIDER_CODE_MAX` raised to 200. The garage keeps your look in `look`; the `rider` action takes an
  optional `look`. The Driver page gets a fifth card and the creator, saved through master's rider draft
  (700 ms after the last change). Every wardrobe base also bakes master's `ride` pose (bikes). Low graphics
  keeps the recolour (lowgfx.ts copies `onBeforeCompile` onto its Lambert stand-ins). Superseded the
  `kanjo-drivers` branch's `garage.driver` / `setDriver` (master's rider draft does the same job).

- 2026-11-04 (Phase 6): the wardrobe is full. Findings:
  - The `.gltf` JSON was pretty-printed and repeats the skeleton in every part (~20 kB each): minified,
    and Draco on the geometry, a base went from 7 MB to ~5-6 MB; all six plus shared textures are 42 MB.
    One look downloads ~1 MB (a legend is 1.6 MB).
  - Draco's generic quantization must stay 0, or the `_hide` bit field gets quantized.
  - Filenames can't contain `@`: the exporter URL-encodes it in the `.bin` URI and Vite doesn't decode
    it (the loader got the HTML fallback). Per-outfit kit files are `kit_<id>__<outfit>.gltf`; manifest
    keys keep `@`.
  - Outfit zones were authored from a contact sheet of the textures (most are tee + jeans with orange
    piping, or pinstripes). The legends' `male_casualsuit05` rule names were swapped (the "jacket" box
    is the jeans). `female_elegantsuit01` splits on value: the shirt's base is near-black, the skirt grey.
  - Hair is repainted like clothes; mottled textures (braid, blunt bob) need a lower contrast or light
    colours come out blotchy (`HAIR_CONTRAST`).
  - Mechanical arms: fitted to a sleeve-cut copy of each outfit; the client cuts the same sleeve
    (average arm weight > 0.5) and shows the arm skin under it, painted in the trim metal.
  - Every outfit fits every base; the feminine outfits on masculine bodies are fine (the racing top is
    a crop top on anyone).
- 2026-11-05 (Phase 8): checked on the local dev server: a guest's driver carried into a new account,
  21 creator edits sent as one request, and a wiped browser got the driver back from the account.
- Next up: Phase 7 (faces); unlocks for parts if wanted. Smaller: live uniform updates for colour pickers;
  hats (`fedora01`, `fedora_cocked`) as a slot that hides hair; repo weight (see Risks).

- 2026-11-04 (first session): phases 0-5 done for one base. Findings:
  - MPFB's body has a "Hide helpers" mask that must still be applied; only the `Delete.<asset>` masks
    are dropped. Those delete groups become the `_hide` bits (plus the raycast), which is what hides
    feet under shoes and legs under trousers.
  - The legends' "tie" rule for `male_elegantsuit01` actually picks a sleeve panel (Marlowe's cut-off
    right sleeve, so it never showed). The wardrobe's tie zone is the real tie (navy stripes).
  - Fitting collars/bracers/belts against every outfit at once made them float on slim suits, so
    cloth-hugging kit is built per outfit (`kit_<id>@<outfit>`, `CLOTH_FIT` in wardrobe.py); head kit is
    shared. Goggles fit the head without hair, so they sit on top of any hair.
  - Outfit zone colours mean different things per outfit, so changing outfit resets to its palette.
  - Sizes: base.glb 1.2 MB (includes a default skin texture the client replaces: drop it to save
    ~0.4 MB), parts 40-480 kB. A default look downloads ~2 MB, about one legend.
  - Seen once: a burst of "computeBoundingSphere(): radius is NaN" errors in the garage session; not
    reproduced in the lab, the creator or a race with a custom driver. Keep an eye out.
- (Done in Phase 6: female frame and builds, all outfits and hairs, sleeve cuts, gloves; the base no
  longer carries a skin texture.)

- 2026-11-04: plan written. Blender 5.2 + MPFB 2 with the MakeHuman system assets are installed on the
  dev machine (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`). Available: 14 suits,
  6 shoes, 2 hats, 10 hairs, 12 brows, 23 skins, 10 eye colours.
