# KANJO driver creator: plan

Goal: players build their own driver in the garage (body, face, skin, hair, a top and a bottom and their
colours, shoes, brass-and-neon kit, glow colour, wheel), and the result looks like it belongs next to Marlowe, Kirika,
Okonkwo and Inès: a cartoon MakeHuman body (the legends' anime restyle: docs/DRIVERS.md "The look"),
recoloured MakeHuman clothes, fitted hard-surface kit, the same materials and soft cel shading, seated with
hands on the wheel and standing in the showroom.

This file is the plan *and* the progress log. Tick boxes as things land; add what we learn under
"Notes as we go".

## The idea in one paragraph

The four legends are each one baked GLB. A custom driver can't be baked per player, so the creator
**assembles a driver at runtime from parts built by the same Blender pipeline**. For each *body base*
(a MakeHuman phenotype: frame and build) the pipeline exports one base GLB (body, eyes, rig, the `drive`
and `idle` clips, seat) plus a small GLB per wardrobe part (each hair, top, bottom, shoes, kit piece, wheel),
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
- **GPU recolour, not baked colours**: the build bakes each garment's colour *zones* (jacket, shirt,
  trim, ...) into a mask texture and records each zone's reference luminance. A shader patch repaints
  `zoneColour × (lum / ref) ^ contrast`, kept inside the look's shade range (`SHADE` in wardrobe.ts,
  `STYLE['shade']` in build.py), exactly like `build.py`'s `recolor()`, so colour pickers update live and
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
  top       TopId         10 tops and 2 one-pieces (overalls, denim suit), worn by any base
  topColors RGB[]         one per zone of the top (each garment has its own palette)
  bottom    BottomId|none 10 bottoms; 'none' exactly when the top is a one-piece
  bottomColors RGB[]      one per zone of the bottom
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

- `encodeLook` / `decodeLook`: `L3.` + 17 dot-separated fields (catalogue indices in base 36, colours as
  6 hex; an 18th with battle pass gear). `decodeLook` validates everything (ids in range, skin of the right
  frame, colours per zone, a bottom unless the top is a one-piece, kit slots) and returns null for junk; the
  server uses it (`isRider`) on `rider=` and for the garage's `look`.
- **`L2.` codes still decode** (looks saved before separates, 2026-11-15): the outfit index maps through
  `L2_OUTFITS` to the top and bottom that outfit was cut into, and its zone colours go to the zones they
  painted (a three-piece's suit colour is both the jacket's and the trousers'). Nothing stored is rewritten:
  a garage or a lobby keeps the `L2.` string until the player next changes their driver, and every reader
  decodes it. `encodeLook` only writes `L3.`.
- `withBase` keeps skin tone and age across frames; `withTop` / `withBottom` put a garment on in its own
  palette and leave the other half alone (a one-piece takes the bottom off; taking one off puts the spare
  half on: a plain tee or blue jeans); `withKit` keeps one piece per slot; `randomLook` for "Surprise me".
- The catalogue mirrors the build's manifest; `tests/kanjo/look.test.ts` checks the two agree, file by file.

## Build (`tools/drivers/wardrobe.py`)

`blender -b --python tools/drivers/wardrobe.py -- [bases...]` writes `public/models/drivers/wardrobe/`:
`<base>/base.gltf` + one `<part>.gltf` per part (Draco-compressed `.bin` beside each), `tex/` (every
texture and zone mask, shared by all bases), `skins/`, `eyes/` and `manifest.json`. About 3.5 min a base.
`-- --zones` only recomputes colour zones and hair contrast (masks + manifest), no models (it makes one
human to read the garments' UVs). `-- [bases] --preview DIR` also renders a few looks per base from the
front, both back quarters, the side and seated, as the client would assemble them, to check the fit.

Per base:
1. The MPFB human with the base phenotype wearing *every* outfit, shoe, hair and brow at once.
   The body is the cartoon one (build.py `STYLE`: big head and eyes, small nose and mouth).
2. **Separates** (`GARMENTS`, `split()`): each MakeHuman outfit is a mesh of loose parts, and they are sorted
   by the bones they hang on: parts on the hips and legs are the outfit's bottom, the rest its top (a
   jacket, its shirt and tie are one top). Overalls (the bib and the tee under it) and the denim suit (one
   mesh) stay whole: `slot: 'full'`, worn as a top with no bottom. A garment keeps its outfit's texture
   (both halves share the file) and gets its own zones, picked only on its own share of that texture
   (`uv_cover`), so no UV boxes are needed to tell a tee from the jeans it came with.
3. Body and clothes are decimated (body 0.6, sparing the face; clothes 0.55, shoes 0.3), then **fitted**
   (`fit()`, build.py `FIT`; docs/DRIVERS.md "The fit"): cloth lifted off the skin, shoes over the leggings,
   every other leg over every shoe, every top over every bottom, hair combed out of every top.
4. Body: MPFB's helper mask applied, the clothes' `Delete.*` masks not: instead the `_hide` and `_hide2`
   vertex attributes get one bit per garment/shoe (16 to an attribute; the manifest's `hide` is the
   number): the vertices its outfit's delete group names (each to the nearer half of a cut outfit) plus
   skin under its cloth (`build.under_cloth`).
5. Clothes, hair and brows keep their MakeHuman textures, softened (`build.soften`: weave blurred out,
   darks lifted off black, no normal maps; brows and lashes thickened to brush strokes by `build.stroke`);
   each garment's zones (rules like the legends' `recolor()`) become an RGBA mask with per-zone reference
   luminance, and each zone's contrast carries the look's softening. A garment with one zone has no mask;
   hair, brows and shoes have one zone over everything. The shared skins and irises are repainted
   (`build.toon_skin`, `build.anime_eye`).
6. Kit with role materials. Head pieces fit once; cloth-hugging pieces (`CLOTH_FIT`) fit once per top
   (`kit_<id>@<top>`) and identical fits (within 8 mm) share a file. The belt and harness also touch the
   bottom (`WAIST_FIT`): they are fitted over the top with every bottom under it, and where a top is too
   short to reach the piece (a belt under a crop top) once per bottom instead (`kit_<id>@_<bottom>`).
   Mechanical arms are fitted to a sleeve-cut copy of each top. What the legends paint into the body
   (`kit.paint_region`: metal arm skin, gloves) is recorded as `paint` (bones, threshold, role) and mech
   arms as `sleeve`.
7. `drive`/`idle` clips (wheel radius 0.18 m), the seat fitted to everything the body can wear, four wheels.
8. Exported as `.gltf` (JSON minified) with `export_texture_dir` pointing at the shared `tex/`.

## Client (`src/kanjo/client/wardrobe.ts`)

- `assemble(look)`: loads base + parts (cached per URL, Draco via `public/draco/`), clones the base,
  rebinds each part's SkinnedMesh to the base skeleton by bone name, and applies the look:
  - body: triangles under worn clothes dropped (`_hide`, `_hide2`), except the arm under a cut sleeve;
    repaint groups from bone weights (`paint`); skin texture per look;
  - tops lose the sleeve a mech arm cut (triangles with average arm weight > 0.5);
  - recolour shader on tops (`topColors`), bottoms (`bottomColors`), shoes, hair, brows; role materials on kit and seat (`METAL`, `LEATHER`:
    the legends' pale satin metals and dusky leathers; the battle pass metals keep their shine);
  - soft cel shading on every material (`toonAll`, toon.ts).
- `loadDriver(id | look)` covers legends and custom drivers; seating, showroom and culling are shared.

## Garage UI (Driver tab)

- Two modes: **Legends** (today's four cards) and **Your driver** (the creator, `creator.ts`).
- The creator (redone 2026-11-15; Michael asked for a UX overhaul with separates) is a head that stays put
  while the page scrolls, and the open category under it:
  - a toolbar: **Undo** (hub.ts keeps the last 40 looks; a colour drag is one step), **Surprise me**,
    **Reset** (the default look; undoable), and **Standing / Seated** (the showroom sits the driver in
    their own seat at their wheel);
  - category tabs (sub-tabs): **Body** (frame, build, skin by age), **Face** (eyes, brows), **Hair**
    (style tiles, colour), **Top** (tops, then the one-pieces, then the worn top's colour zones),
    **Bottom** (bottoms and the worn one's zones; under a one-piece, a note that it covers both and that
    picking a bottom brings separates back), **Shoes**, **Kit** (by where it's worn, metal, leather, glow,
    battle pass gear), **Wheel**;
  - garments are option tiles (`.tg-opt`): a silhouette in the garment's own colour, its name and a chip
    per zone; each zone is a row of the house cloth swatches plus a free picker, with a dot showing the
    colour it has now and "Stock colours" to go back.
- The showroom is the live preview: it frames what the open tab is about (`Showroom.frameRider`: the whole
  driver, the head for Face and Hair, the feet for Shoes; the Wheel tab seats them), a drag turns the
  driver (the turn stays), the mouse wheel or a pinch zooms.
- Phones (`html.touch`): bigger swatches and pills, a zone's swatches under its name, the tabs scroll
  sideways; held sideways (up to 900 px wide) the driver takes the left of the screen and the creator the
  right, instead of the usual strip of showroom over the rail (hub.ts `frameCar` centres the view on the stage).
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

- 2026-11-15 (separates, the fit, muted colours, the new creator; Michael): outfits became tops and bottoms.
  - 12 outfits are now 10 tops, 2 one-pieces and 10 bottoms (`GARMENTS` in wardrobe.py, `TOPS` / `BOTTOMS` in
    look.ts): 100 pairings plus the two one-pieces. Nothing left the wardrobe; six of the bottoms are the same
    jeans mesh with different washes, as MakeHuman ships them.
  - Look codes are `L3.` now; `L2.` codes decode to the same clothes in the same colours (look.ts
    `L2_OUTFITS`, tests in look.test.ts).
  - Clipping: see docs/DRIVERS.md "The fit". The preview renders (`--preview`) are how to check it.
  - The hide bits outgrew one float attribute (28 covers): `_hide` and `_hide2`, 16 bits each.
  - One hair mesh serves every top, so `comb()` lays hair on the bulkiest top's surface: over a crop top a
    braid sits a centimetre or two off the back. Per-top hair would fix it and multiply the hair files by 12.
  - Kit that touches the waist (belt, harness) is fitted over each top with every bottom under it; the tops
    are pushed clear of every waistband first, so that fit holds for any pairing.
  - The palette was muted (docs/DRIVERS.md "The look"); a look saved earlier keeps the brighter colours in
    its code until a garment or a swatch is picked again.
  - Standing arms hang naturally now (pose.py `hang`; the old idle held the hands out in front with stiff
    elbows), and tops are pushed level over bottoms (build.py `over(level=True)`; a tee's hem had spiked).

- 2026-11-14 (the cartoon restyle; Michael: the characters "look default, dark and odd ... cartoonish, anime-like,
  better softer colour ... nice and soft like our cars are", keeping every customisation): nothing left the
  catalogue (six bases, 10 skins a frame, 9 irises, 12 brows, 10 hairstyles, 12 outfits and their zones, 6 shoes,
  15 kit pieces, 10 metals, 3 leathers, 4 wheels, the pass gear) and look codes are unchanged; every part was
  rebuilt in the new style (docs/DRIVERS.md "The look"). What changed for a look:
  - Outfits come in new soft colours (`OUTFITS` here and in look.ts; the creator's swatches, `DEFAULT_LOOK`
    and `randomLook` too). A look saved before keeps the colours in its code; picking the outfit again (or a
    swatch) gives the new ones.
  - Skins keep their ten tones and three ages per frame, but as flat cartoon tones (age shows as soft lines).
  - The "Black" leather is a dusk grey now and is labelled Dusk; gunmetal and carbon are mid greys.
  - The outfits' and hair's normal maps are gone (`tex/*_normal.webp`), so a look downloads a little less.
  - Zone `contrast` in the manifest includes the softening, and the shader keeps the shade inside `SHADE`;
    `wardrobe.py -- --zones` still retunes zones without rebuilding geometry.

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
