"""Builds the driver creator's wardrobe: per body base, a base model (rig, clips, body, eyes, lashes,
seat) and one model per swappable part (tops, bottoms, one-pieces, shoes, hair, brows, kit pieces, wheels),
all skinned to the same skeleton, plus `manifest.json`. The client assembles a driver from them
(docs/DRIVER_CREATOR.md).

    blender -b --python tools/drivers/wardrobe.py -- [bases...] [--preview DIR]
    blender -b --python tools/drivers/wardrobe.py -- --zones     # only redo colour zones (masks, refs)

Same human, cartoon look (build.STYLE), materials and kit as the legends (build.py, kit.py), with these
differences:
- MakeHuman's outfits are cut into separates: each outfit's top and bottom are their own parts, worn in any
  pairing (the fit, build.FIT, lays every top over every bottom and every trouser leg over every shoe);
  overalls and the denim suit stay whole and take both places;
- the body keeps all its skin; instead each vertex gets a `_hide` bit per garment/shoes that covers it,
  so the client drops exactly the skin the chosen clothes hide;
- clothes, hair and brows keep their own textures, softened (build.soften: no weave, no black; brows and
  lashes as brush strokes); each garment's colour zones are baked to an RGBA mask (zone k in channel k)
  with the zone's reference luminance, for the client's recolour shader;
- skins and irises are shared textures, repainted (build.toon_skin, build.anime_eye);
- kit materials are *roles* (metal, trim, strap, glow, glow_soft, lens) the client swaps per look;
- what the legends bake into the body (a mechanical arm's metal skin, gloves, the cut-off sleeve) is
  recorded in the manifest as bone lists, and the client applies it per look.

Models are written as .gltf + Draco-compressed .bin, with textures in one shared `tex/` folder: every base
uses the same clothes textures, so they're downloaded once.
"""

import json
import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import build  # noqa: E402
import kit  # noqa: E402
import pose  # noqa: E402
from bl_ext.user_default.mpfb.services.assetservice import AssetService  # noqa: E402
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402

OUT = os.path.join(build.OUT, 'wardrobe')
TEX = os.path.join(OUT, 'tex')
#: Every wheel in the wardrobe has this radius, so one drive clip fits them all.
WHEEL_R = 0.18

# ---------------------------------------------------------------------------------------------
# Catalogue (mirrored in src/kanjo/shared/look.ts; tests/kanjo/look.test.ts checks the two agree).
# A garment is cut from a MakeHuman outfit (`src`): its `slot` says which of the outfit's loose parts it
# takes ('top': those hanging on the spine and arms, 'bottom': on the hips and legs, 'full': all of them, a
# one-piece that fills both places). Zones: (name, pick rule as in build.recolor, default colour), at most
# 4, first rule wins; only the garment's own share of the outfit's texture is looked at, so the last rule
# is usually `{}` (everything else). The default colours are the legends' palette (cast.py): dusty pastels,
# mid-light, never near black. UV boxes are (u0, v0, u1, v1) with v up from the bottom of the texture.

TRIM = {'hue': (0.03, 0.14), 'sat': (0.45, 1.0)}  # the orange piping on the MakeHuman tees
PINK = {'hue': (0.85, 0.05), 'sat': (0.25, 1.0)}  # pinstripes
GARMENTS = {
    # Tops (wire order: append only, like every list here).
    'suit_jacket': {'src': 'male_elegantsuit01', 'slot': 'top', 'zones': [
        # The tie's navy stripes (its white ones go with the shirt).
        ('tie', {'uv': (0.34, 0.8, 0.5, 0.99), 'sat': (0.12, 1.0)}, '#e4c383'),
        ('jacket', {'val': (0.0, 0.45), 'sat': (0.0, 0.6)}, '#75988a'),
        ('shirt', {'val': (0.6, 1.0), 'sat': (0.0, 0.25)}, '#eee8da'),
    ]},
    'field_jacket': {'src': 'male_casualsuit05', 'slot': 'top', 'zones': [('stripes', PINK, '#e6918f'), ('jacket', {}, '#5c637e')]},
    'long_tee': {'src': 'male_casualsuit02', 'slot': 'top', 'zones': [('trim', TRIM, '#f2c887'), ('tee', {}, '#95b2bf')]},
    'pinstripe_shirt': {'src': 'male_casualsuit03', 'slot': 'top', 'zones': [('stripes', PINK, '#dac4a4'), ('shirt', {}, '#646781')]},
    'trim_tee': {'src': 'male_casualsuit04', 'slot': 'top', 'zones': [('trim', TRIM, '#91e4b6'), ('tee', {}, '#5b5e72')]},
    'plain_tee': {'src': 'male_casualsuit06', 'slot': 'top', 'zones': [('tee', {}, '#eee8da')]},
    'fitted_tee': {'src': 'female_casualsuit01', 'slot': 'top', 'zones': [('trim', TRIM, '#f2a1de'), ('tee', {}, '#717496')]},
    'cap_tee': {'src': 'female_casualsuit02', 'slot': 'top', 'zones': [('trim', TRIM, '#f2c887'), ('tee', {}, '#eee8da')]},
    'blouse': {'src': 'female_elegantsuit01', 'slot': 'top', 'zones': [('stripes', PINK, '#e4c383'), ('shirt', {}, '#646781')]},
    'crop_top': {'src': 'female_sportsuit01', 'slot': 'top', 'zones': [('trim', TRIM, '#f2a1de'), ('top', {}, '#9397be')]},
    # One-pieces: worn as a top, with no bottom.
    'overalls': {'src': 'male_worksuit01', 'slot': 'full', 'zones': [
        ('overalls', {'hue': (0.5, 0.75), 'sat': (0.12, 1.0)}, '#c69376'),
        ('tee', {'sat': (0.0, 0.2), 'val': (0.4, 1.0)}, '#7f899b'),
    ]},
    'denim_suit': {'src': 'male_casualsuit01', 'slot': 'full', 'zones': [
        ('patches', {'hue': (0.04, 0.16), 'sat': (0.3, 1.0)}, '#cea685'),
        ('denim', {}, '#89909e'),
    ]},
    # Bottoms.
    'suit_trousers': {'src': 'male_elegantsuit01', 'slot': 'bottom', 'zones': [('trousers', {}, '#75988a')]},
    'field_jeans': {'src': 'male_casualsuit05', 'slot': 'bottom', 'zones': [('jeans', {}, '#9096ac')]},
    'washed_jeans': {'src': 'male_casualsuit02', 'slot': 'bottom', 'zones': [('jeans', {}, '#7686a0')]},
    'dark_jeans': {'src': 'male_casualsuit03', 'slot': 'bottom', 'zones': [('jeans', {}, '#7f869b')]},
    'grey_jeans': {'src': 'male_casualsuit04', 'slot': 'bottom', 'zones': [('jeans', {}, '#757b8d')]},
    'blue_jeans': {'src': 'male_casualsuit06', 'slot': 'bottom', 'zones': [('jeans', {}, '#8898b8')]},
    'slim_jeans': {'src': 'female_casualsuit01', 'slot': 'bottom', 'zones': [('jeans', {}, '#7686a0')]},
    'shorts': {'src': 'female_casualsuit02', 'slot': 'bottom', 'zones': [('shorts', {}, '#95b2bf')]},
    'skirt': {'src': 'female_elegantsuit01', 'slot': 'bottom', 'zones': [('skirt', {}, '#75988a')]},
    # Skin-tight, so they go inside the shoes (every other leg goes over them).
    'leggings': {'src': 'female_sportsuit01', 'slot': 'bottom', 'tuck': True, 'zones': [
        ('stripe', {'val': (0.7, 1.0)}, '#f2a1de'),
        ('leggings', {}, '#717496'),
    ]},
}
SOURCES = list(dict.fromkeys(g['src'] for g in GARMENTS.values()))
TOPS = [g for g, v in GARMENTS.items() if v['slot'] != 'bottom']
BOTTOMS = [g for g, v in GARMENTS.items() if v['slot'] == 'bottom']
FULL = [g for g, v in GARMENTS.items() if v['slot'] == 'full']
#: Bones a bottom hangs on: a loose part of an outfit with most of its weight here is the bottom's.
LEGS = ('pelvis', 'thigh_', 'calf_', 'foot_', 'ball_')
SHOES = ['shoes01', 'shoes02', 'shoes03', 'shoes04', 'shoes05', 'shoes06']
HAIRS = ['short01', 'short02', 'short03', 'short04', 'bob01', 'bob02', 'ponytail01', 'braid01', 'long01', 'afro01']
#: Hair is repainted as lum / ref like clothes; strongly mottled textures get a gentler contrast so a
#: light colour doesn't come out blotchy (the braid has near-black strands).
HAIR_CONTRAST = {'braid01': 0.5, 'bob01': 0.6}
BROWS = [f'eyebrow{i:03d}' for i in range(1, 13)]
LASHES = {'m': 'eyelashes02', 'f': 'eyelashes04'}

#: Kit pieces: id -> (slot, kit function, kwargs). Materials by role.
KIT = {
    'goggles_up': ('brow', 'goggles', {'lens': '@lens', 'where': 'forehead', 'lift': 0.065, 'tilt': 0.48, 'strap': 'strap'}),
    'goggles': ('eyes', 'goggles', {'lens': '@glass', 'where': 'eyes', 'strap': 'strap'}),
    'monocle': ('eyes', 'monocle', {'lens': '@lens', 'side': -1}),
    'respirator': ('mouth', 'respirator', {'glow': '@glow'}),
    'implants': ('temple', 'implants', {'glow': '@glow', 'side': 1, 'count': 4}),
    'collar': ('neck', 'collar', {'metal': 'metal', 'bands': 2, 'height': 0.03, 'glow': '@glow'}),
    'bracer_l': ('arm_l', 'bracer', {'side': 'l', 'metal': 'metal', 'strap': 'strap'}),
    'bracer_r': ('arm_r', 'bracer', {'side': 'r', 'metal': 'metal', 'strap': 'strap', 'gauge': '@lens'}),
    'mech_arm_l': ('arm_l', 'mech_arm', {'side': 'l', 'glow': '@glow', 'metal': 'trim', 'plate': 'metal'}),
    'mech_arm_r': ('arm_r', 'mech_arm', {'side': 'r', 'glow': '@glow', 'metal': 'trim', 'plate': 'metal'}),
    'pauldron_l': ('shoulder', 'pauldron', {'side': 'l', 'metal': 'metal', 'glow': '@lens'}),
    'gloves': ('hands', 'gloves', {'material': 'strap', 'cuff': 'metal'}),
    'gloves_fingerless': ('hands', 'gloves', {'material': 'strap', 'cuff': 'strap', 'fingerless': True}),
    'belt': ('waist', 'belt', {'material': 'strap', 'buckle': 'metal', 'z_frac': 0.55}),
    'chest_strap': ('chest', 'chest_strap', {'side': 'l', 'material': 'strap', 'buckle': 'metal'}),
}
#: Pieces that hug the clothes: fitted once per top (`kit_<id>@<top>`; identical fits share a file), so a
#: collar or bracer sits on a slim jacket as snugly as on bulky overalls. Head kit is shared.
CLOTH_FIT = {'collar', 'bracer_l', 'bracer_r', 'mech_arm_l', 'mech_arm_r', 'pauldron_l', 'gloves', 'gloves_fingerless', 'belt', 'chest_strap'}
#: Of those, the ones that also touch the bottom. They are fitted over the top with every bottom under it
#: (tops hang over every waistband, so that fit holds whatever the bottom); where a top is too short to
#: reach the piece (a crop top and the belt), it is fitted to each bottom instead (`kit_<id>@_<bottom>`).
WAIST_FIT = {'belt', 'chest_strap'}
#: Mechanical arms cut the top's sleeve off that side (the client does the cut).
SLEEVE = {'mech_arm_l': 'l', 'mech_arm_r': 'r'}
WHEELS = ['wood', 'yoke', 'iron', 'deep']

RACE = {'caucasian': 0.34, 'asian': 0.33, 'african': 0.33}
BASES = {
    'm_slim': {'frame': 'm', 'phenotype': {'gender': 1.0, 'age': 0.5, 'muscle': 0.45, 'weight': 0.36, 'proportions': 0.75, 'height': 0.5, 'race': RACE}},
    'm_avg': {'frame': 'm', 'phenotype': {'gender': 1.0, 'age': 0.5, 'muscle': 0.55, 'weight': 0.5, 'proportions': 0.7, 'height': 0.55, 'race': RACE}},
    'm_heavy': {'frame': 'm', 'phenotype': {'gender': 1.0, 'age': 0.55, 'muscle': 0.85, 'weight': 0.66, 'proportions': 0.6, 'height': 0.6, 'race': RACE}},
    'f_slim': {'frame': 'f', 'phenotype': {'gender': 0.0, 'age': 0.48, 'muscle': 0.5, 'weight': 0.36, 'proportions': 0.8, 'height': 0.48, 'cupsize': 0.45, 'firmness': 0.6, 'race': RACE}},
    'f_avg': {'frame': 'f', 'phenotype': {'gender': 0.0, 'age': 0.5, 'muscle': 0.5, 'weight': 0.48, 'proportions': 0.75, 'height': 0.55, 'cupsize': 0.5, 'firmness': 0.6, 'race': RACE}},
    'f_heavy': {'frame': 'f', 'phenotype': {'gender': 0.0, 'age': 0.52, 'muscle': 0.7, 'weight': 0.64, 'proportions': 0.6, 'height': 0.6, 'cupsize': 0.6, 'firmness': 0.55, 'race': RACE}},
}

SKINS = {
    'm': ['young_caucasian_male', 'young_caucasian_male2', 'young_african_male', 'young_asian_male', 'middleage_caucasian_male',
          'middleage_african_male', 'middleage_asian_male', 'old_caucasian_male', 'old_african_male', 'old_asian_male'],
    'f': ['young_caucasian_female', 'young_caucasian_female2', 'young_african_female', 'young_asian_female', 'middleage_caucasian_female',
          'middleage_african_female', 'middleage_asian_female', 'old_caucasian_female', 'old_african_female', 'old_asian_female'],
}
EYES = ['brown', 'brownlight', 'blue', 'bluegreen', 'deepblue', 'lightblue', 'green', 'grey', 'ice']

# ---------------------------------------------------------------------------------------------


def role_palette():
    """kit.palette() with the per-look materials renamed to their roles."""
    P = kit.palette('#ffffff')
    for k in ('glow', 'glow_soft', 'lens'):
        P[k].name = k
    P['metal'] = kit.mat('metal', '#e0c68c', 0.42, kit.METAL)
    P['trim'] = kit.mat('trim', '#b0956e', 0.5, kit.METAL)
    P['strap'] = kit.mat('strap', '#8e7365', 0.7)
    return P


def add_asset(body, kind, name):
    path = AssetService.find_asset_absolute_path(f'{name}/{name}.mhclo', asset_subdir=kind)
    HumanService.add_mhclo_asset(path, body, asset_type=kind, subdiv_levels=0, material_type='GAMEENGINE')


def create(spec):
    """The base human wearing every outfit, shoe, hair and brow (so the kit can fit them all)."""
    arm, body, parts = build.create({
        'phenotype': spec['phenotype'], 'eyebrows': BROWS[0], 'eyelashes': LASHES[spec['frame']],
        'hair': HAIRS[0], 'clothes': SOURCES + SHOES, 'skin': SKINS[spec['frame']][0],
    })
    for h in HAIRS[1:]:
        add_asset(body, 'hair', h)
    for b in BROWS[1:]:
        add_asset(body, 'eyebrows', b)
    parts = {o.name.split('.', 1)[1]: o for o in arm.children if o.type == 'MESH' and o is not body}
    # Keep all the skin (the client hides what the chosen clothes cover), but drop MPFB's helpers.
    for m in list(body.modifiers):
        if m.type == 'MASK' and m.name.startswith('Delete.'):
            body.modifiers.remove(m)
    build.apply_masks(body)
    return arm, body, parts


def save_image(path, a, fmt, data=False):
    h, w = a.shape[:2]
    im = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    if data:
        im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(np.ascontiguousarray(a, np.float32).ravel())
    im.filepath_raw = path
    im.file_format = fmt
    bpy.context.scene.render.image_settings.quality = 85
    im.save()
    bpy.data.images.remove(im)


#: Zone masks written this run (the first base writes them; they're the same for every base).
_masks = set()


def zone_entry(key, a, zones, cover=None):
    """Zone masks (shared `tex/<key>_mask.png`, same for every base) and refs for one garment or shoe, from
    its texture `a` as MakeHuman made it (the refs are read off its softened shading, which is what ships).
    `zones` None: one zone over everything (hair, brows, shoes), no mask. `cover`: the garment's share of
    the texture (uv_cover). Contrasts carry the cartoon look's softening (build.STYLE['contrast']); the
    client keeps the shade inside STYLE['shade']."""
    if zones is None:
        _, refs, _ = build.zone_masks(a, [{'color': '#000000'}])
        contrast = (HAIR_CONTRAST.get(key, 0.85) if key in HAIRS else 1.0) * build.STYLE['contrast']
        return {'zones': [{'name': 'all', 'ref': round(refs[0], 4), 'contrast': round(contrast, 4)}], 'mask': None}
    masks, refs, _ = build.zone_masks(a, [{**r, 'color': c} for _, r, c in zones], cover)
    out = {
        'zones': [{'name': n, 'ref': round(ref, 4), 'color': c, 'contrast': round(r.get('contrast', 1.0) * build.STYLE['contrast'], 4)}
                  for (n, r, c), ref in zip(zones, refs)],
        'mask': None,
    }
    if len(zones) == 1 and not zones[0][1]:
        return out  # one zone over the whole garment: no mask to load
    path = os.path.join(TEX, f'{key}_mask.png')
    if key not in _masks:
        m = np.zeros(a.shape, np.float32)
        for i, mk in enumerate(masks):
            m[..., i] = mk
        save_image(path, m, 'PNG', data=True)
        _masks.add(key)
    out['mask'] = f'tex/{key}_mask.png'
    return out


def uv_cover(o, shape, grow=3):
    """The texels of an (H, W) texture that `o`'s faces use, grown by `grow` texels: a garment cut from an
    outfit shares the outfit's texture, and its colour zones are picked and measured on its share alone."""
    H, W = shape
    cov = np.zeros((H, W), bool)
    uv = o.data.uv_layers.active.data
    for p in o.data.polygons:
        pts = [(uv[i].uv.x * W, uv[i].uv.y * H) for i in p.loop_indices]
        for k in range(1, len(pts) - 1):
            (ax, ay), (bx, by), (cx, cy) = pts[0], pts[k], pts[k + 1]
            x0, x1 = max(0, int(min(ax, bx, cx)) - 1), min(W, int(max(ax, bx, cx)) + 2)
            y0, y1 = max(0, int(min(ay, by, cy)) - 1), min(H, int(max(ay, by, cy)) + 2)
            if x1 <= x0 or y1 <= y0:
                continue
            yy, xx = np.mgrid[y0:y1, x0:x1]
            xx = xx + 0.5
            yy = yy + 0.5
            d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(d) < 1e-9:
                continue
            u = ((by - cy) * (xx - cx) + (cx - bx) * (yy - cy)) / d
            v = ((cy - ay) * (xx - cx) + (ax - cx) * (yy - cy)) / d
            e = 1.0 / max(1.0, abs(d)) ** 0.5  # a texel of slack, so slivers aren't missed
            cov[y0:y1, x0:x1] |= (u >= -e) & (v >= -e) & (u + v <= 1 + e)
    return build.blur(cov.astype(np.float32), grow / W, 1) > 0.01


def split(parts):
    """Cuts every outfit into its garments (GARMENTS): `parts` loses the outfits and gains one object per
    garment, each a copy of its outfit without the loose parts that aren't its own."""
    for src in SOURCES:
        o = parts.pop(src)
        me = o.data
        # Loose parts, and which hang on the hips and legs.
        comp = list(range(len(me.vertices)))

        def find(i):
            while comp[i] != i:
                comp[i] = comp[comp[i]]
                i = comp[i]
            return i
        for e in me.edges:
            a, b = find(e.vertices[0]), find(e.vertices[1])
            if a != b:
                comp[a] = b
        legs = {g.index for g in o.vertex_groups if g.name.startswith(LEGS)}
        low, all_w = {}, {}
        for v in me.vertices:
            c = find(v.index)
            for g in v.groups:
                all_w[c] = all_w.get(c, 0) + g.weight
                if g.group in legs:
                    low[c] = low.get(c, 0) + g.weight
        is_bottom = {c: low.get(c, 0) > 0.5 * w for c, w in all_w.items()}
        for gid, g in GARMENTS.items():
            if g['src'] != src:
                continue
            c = o.copy()
            c.data = me.copy()
            for col in o.users_collection:
                col.objects.link(c)
            if g['slot'] != 'full':
                bm = bmesh.new()
                bm.from_mesh(c.data)
                dead = [v for v in bm.verts if is_bottom.get(find(v.index), False) != (g['slot'] == 'bottom')]
                bmesh.ops.delete(bm, geom=dead, context='VERTS')
                bm.to_mesh(c.data)
                bm.free()
            assert len(c.data.polygons) > 50, f'{gid}: nothing left of {src}'
            parts[gid] = c
        bpy.data.objects.remove(o)


def dress(body, parts, entries, raw):
    """Plain glTF materials on the softened textures; zone entries for shoes, hair and brows, and each
    outfit's texture as MakeHuman made it in `raw` (its garments' zones are read off it after split()).
    The body and irises get a tiny placeholder: the client loads the look's skin and eye textures."""
    for key, o in [('body', body)] + list(parts.items()):
        diffuse = build.images_of(o.data.materials[0])
        kind = 'body' if key == 'body' else 'eyes' if key == 'low-poly' else 'small' if key.startswith(('eyebrow', 'eyelash')) else 'hair' if key in HAIRS else 'clothes'
        if kind in ('body', 'eyes'):
            a = np.full((4, 4, 4), 0.6, np.float32)
        else:
            a = build.read(diffuse, build.TEX[kind])
        if key in SOURCES:
            raw[key] = a
        elif key in SHOES or key in HAIRS or key in BROWS:
            entries[key] = zone_entry(key, a, None)
        if kind in ('clothes', 'hair'):
            a = build.soften(a)
        elif kind == 'small':
            # Brows are repainted in the hair colour by the client; lashes are painted here.
            a = build.stroke(a) if key in BROWS else build.stroke(a, build.STYLE['lash'], lash=True)
        col = build.write(f'{key}_color', a)
        group = 'hair' if kind == 'hair' else key if key in build.ROUGH else 'eyebrows' if kind == 'small' else 'cloth'
        # Names the client keys on: 'skin', 'iris', or the part id (an outfit's garments share its material).
        name = 'skin' if key == 'body' else 'iris' if key == 'low-poly' else key
        m = build.textured(name, col, None, build.ROUGH[group], kind in ('hair', 'small'))
        o.data.materials.clear()
        o.data.materials.append(m)


def garment_zones(parts, entries, raw):
    for gid, g in GARMENTS.items():
        a = raw[g['src']]
        entries[gid] = zone_entry(gid, a, g['zones'], uv_cover(parts[gid], a.shape[:2]))


def apply_decimate(o, ratio, keep=None):
    build.decimate(o, ratio, keep)
    with bpy.context.temp_override(object=o, active_object=o):
        bpy.ops.object.modifier_apply(modifier='decimate')
    g = o.vertex_groups.get('decimate')
    if g:
        o.vertex_groups.remove(g)


#: `_hide` holds this many covers' bits per attribute (a float attribute is exact to 24 bits); the next
#: covers go in `_hide2`. The manifest's `hide` is the cover's number: attribute `hide // HIDE_BITS`, bit
#: `hide % HIDE_BITS`.
HIDE_BITS = 16


def hide_bits(body, covers):
    """`_hide` / `_hide2` on the body: cover i's bit set where it hides the skin: the vertices its
    MakeHuman outfit deletes (`Delete.<outfit>`, what the legends' masks remove; where an outfit was cut
    in two, each vertex goes to the nearer garment) plus any under its cloth (build.under_cloth).
    `covers`: (id, object, MakeHuman asset)."""
    mw = body.matrix_world
    trees = [build.tree_of([o]) for _, o, _ in covers]
    bits = [np.zeros(len(body.data.vertices), np.int64) for _ in range((len(covers) + HIDE_BITS - 1) // HIDE_BITS)]
    for i, (cid, o, asset) in enumerate(covers):
        mine = bits[i // HIDE_BITS]
        bit = 1 << (i % HIDE_BITS)
        hidden = build.under_cloth(body, trees[i])
        g = body.vertex_groups.get('Delete.' + asset)
        rivals = [trees[j] for j, c in enumerate(covers) if j != i and c[2] == asset]
        for v in body.data.vertices:
            if not hidden[v.index] and g is not None and any(x.group == g.index and x.weight > 0.5 for x in v.groups):
                p = mw @ v.co
                d = trees[i].find_nearest(p)[3]
                hidden[v.index] = all(d <= t.find_nearest(p)[3] for t in rivals)
            if hidden[v.index]:
                mine[v.index] |= bit
    for k, b in enumerate(bits):
        attr = body.data.attributes.new('_hide' if k == 0 else f'_hide{k + 1}', 'FLOAT', 'POINT')
        attr.data.foreach_set('value', b.astype(np.float32))


def fit(arm, body, parts):
    """The fit (build.FIT), so any top goes with any bottom, shoes and hair without one poking through
    another: cloth off the skin; shoes over the tucked bottoms (leggings); every other leg over every shoe;
    every top over every bottom; hair out of every collar and off every back."""
    skin = build.tree_of([body])
    shoes = [parts[s] for s in SHOES]
    moved = {}
    for c in list(GARMENTS) + SHOES:
        moved[c] = build.lift(parts[c], skin)
    tucked = [parts[b] for b in BOTTOMS if GARMENTS[b].get('tuck')]
    for s in SHOES:
        moved[s] += build.over(parts[s], tucked, ('calf', 'foot'))
    for g in BOTTOMS + FULL:
        if not GARMENTS[g].get('tuck'):
            moved[g] += build.over(parts[g], shoes, ('calf', 'foot'))
    for t in TOPS:
        if t not in FULL:
            moved[t] += build.over(parts[t], [parts[b] for b in BOTTOMS], level=True)
    cover = [body] + [parts[t] for t in TOPS]
    for h in HAIRS:
        moved[h] = build.comb(parts[h], arm, cover)
    print('  fit, vertices moved: ' + ', '.join(f'{k} {v}' for k, v in moved.items() if v))


def sleeve_cut(o, side):
    """A copy of outfit `o` without the sleeve on `side` (what the client shows with a mechanical arm),
    so the arm is fitted to the bare limb. The same test as build.sleeveless and wardrobe.ts."""
    c = o.copy()
    c.data = o.data.copy()
    bpy.context.collection.objects.link(c)
    bones = set(kit.arm_bones(side))
    idx = {g.index for g in c.vertex_groups if g.name in bones}
    w = [sum(g.weight for g in v.groups if g.group in idx) for v in c.data.vertices]
    bm = bmesh.new()
    bm.from_mesh(c.data)
    dead = [f for f in bm.faces if sum(w[v.index] for v in f.verts) / len(f.verts) > 0.5]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(c.data)
    bm.free()
    return c


#: Body repaints a kit piece asks for while it's built (kit.paint_region), kept for the manifest.
_paints = []


def _record_paint(obj, bones, material, min_w=0.5):
    _paints.append({'bones': list(bones), 'min': min_w, 'role': material.name})


kit.paint_region = _record_paint


def _retry(write, tries=5):
    """Runs `write`, again after a pause if the file was busy: on Windows a virus scanner or a dev server
    watching public/ can hold a file the last export just wrote (seen as OSError 22 half way through a
    base)."""
    for i in range(tries):
        try:
            return write()
        except (OSError, RuntimeError):
            if i == tries - 1:
                raise
            time.sleep(2)


def export(path, arm, objs, animations=False):
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    for o in objs:
        o.select_set(True)
    _retry(lambda: bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLTF_SEPARATE', export_texture_dir=os.path.relpath(TEX, os.path.dirname(path)),
        use_selection=True, export_apply=True,
        export_animations=animations, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_skins=True, export_morph=False, export_def_bones=False, export_yup=True,
        export_attributes=True, export_image_format='WEBP', export_image_quality=82, export_extras=False,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14, export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12, export_draco_generic_quantization=0,
    ))
    minify(path)
    return os.path.getsize(path) + os.path.getsize(path[:-5] + '.bin')


def minify(path):
    """The exporter pretty-prints, and every part repeats the skeleton: compact JSON, floats to 6
    significant digits (well under a micron at driver scale)."""
    def r(x):
        if isinstance(x, float):
            return float(f'{x:.6g}')
        if isinstance(x, list):
            return [r(v) for v in x]
        if isinstance(x, dict):
            return {k: r(v) for k, v in x.items()}
        return x
    with open(path) as f:
        g = r(json.load(f))
    with open(path, 'w') as f:
        json.dump(g, f, separators=(',', ':'))


def tris(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    return sum(len(o.evaluated_get(dg).data.loop_triangles) for o in objs)


def signature(objs):
    """Vertex positions of a built piece, to spot two outfits giving the same fit."""
    return np.concatenate([np.array([o.matrix_world @ v.co for v in o.data.vertices], np.float32).reshape(-1, 3) for o in sorted(objs, key=lambda o: o.name)])


def prepare(spec):
    """The base human with every garment, shoe, hair and brow cut, dressed, decimated to what ships and
    fitted, and the body's hide bits. Returns (arm, body, parts, entries, covers)."""
    arm, body, parts = create(spec)
    entries, raw = {}, {}
    dress(body, parts, entries, raw)
    split(parts)
    garment_zones(parts, entries, raw)
    # Decimated now (the body sparing the face), so the fit and the hide bits are worked out on what ships.
    apply_decimate(body, 0.6, keep={'head'})
    covers = list(GARMENTS) + SHOES
    for c in covers:
        apply_decimate(parts[c], 0.3 if c.startswith('shoes') else 0.55)
    fit(arm, body, parts)
    hide_bits(body, [(c, parts[c], GARMENTS[c]['src'] if c in GARMENTS else c) for c in covers])
    return arm, body, parts, entries, covers


def build_base(base_id, spec, preview=None):
    build.reset()
    os.makedirs(os.path.join(OUT, base_id), exist_ok=True)
    arm, body, parts, entries, covers = prepare(spec)

    shoes = [parts[s] for s in SHOES]
    bottoms = [parts[g] for g in BOTTOMS]
    eyes = parts['low-poly']
    b = kit.Body(arm, body, [parts[c] for c in GARMENTS] + shoes, None, eyes)
    P = role_palette()
    kit_parts = {}  # pid -> (slot, objs, paints)

    def make(pid, slot, fn, bb, kw):
        _paints.clear()
        objs = getattr(kit, fn)(bb, P, **build.resolve(kw, P)) or []
        if fn == 'mech_arm':
            objs += kit.shoulder_cap(bb, P, kw['side'], metal='metal')
        kit_parts[pid] = (slot, objs, list(_paints))

    for kid, (slot, fn, kw) in KIT.items():
        if kid not in CLOTH_FIT:
            make(kid, slot, fn, b, kw)
            continue
        if kid in WAIST_FIT:
            # What each bottom gives without a top over it: a top whose own fit is the same as the fit to
            # all the bottoms doesn't reach the piece, and wears these instead (decided below).
            make(f'{kid}@_', slot, fn, kit.Body(arm, body, [*bottoms, *shoes], None, eyes), kw)
            for c in BOTTOMS:
                make(f'{kid}@_{c}', slot, fn, kit.Body(arm, body, [parts[c], *shoes], None, eyes), kw)

        for c in TOPS:
            cut = sleeve_cut(parts[c], SLEEVE[kid]) if kid in SLEEVE else None
            under = bottoms if kid in WAIST_FIT and c not in FULL else []
            bc = kit.Body(arm, body, [cut or parts[c], *under, *shoes], None, eyes)
            make(f'{kid}@{c}', slot, fn, bc, kw)
            if cut:
                bpy.data.objects.remove(cut)

    centre, normal, up = pose.drive(arm, {'recline': 22, 'reach': 0.95, 'wheel_drop': 0.12, 'wheel_radius': WHEEL_R})
    wheels = {}
    for w in WHEELS:
        objs = kit.wheel(P, centre, normal, up, {'kind': w, 'radius': WHEEL_R})
        for o in objs:
            kit.rigid(o, b, 'wheel')
        wheels[w] = objs
    recline = math.radians(22)
    # The seat clears the bulkiest thing that can be worn: fitted to one tee, a jacket's back sank into it.
    cushion, back = build.seat_fit(arm, [body] + [parts[c] for c in GARMENTS], recline)
    seat = kit.seat(P, recline, {'leather': 'strap', 'trim': 'trim'}, cushion, back)
    for o in seat:
        kit.rigid(o, b, 'seat')
    pose.idle(arm, {'stance': 'relaxed', 'weight': 1, 'head_turn': 6})
    pose.ride(arm, {})
    arm.animation_data.action = None

    body.name = 'body'
    for k, o in parts.items():
        o.name = k
    arm.name = base_id

    man = {'frame': spec['frame'], 'parts': {}}
    seat_objs = kit.join(seat, 'seat')
    base_objs = [body, eyes, parts[LASHES[spec['frame']]], *seat_objs]
    size = export(os.path.join(OUT, base_id, 'base.gltf'), arm, base_objs, animations=True)
    man['base'] = {'file': 'base.gltf', 'bytes': size, 'tris': tris(base_objs)}

    def part(pid, slot, objs, **extra):
        # Files avoid '@': the exporter URL-encodes it in the .bin's URI, and not every server decodes it.
        name = pid.replace('@', '__')
        size = export(os.path.join(OUT, base_id, name + '.gltf'), arm, objs)
        man['parts'][pid] = {'slot': slot, 'file': name + '.gltf', 'bytes': size, 'tris': tris(objs), **extra}
        print(f'  {base_id}/{pid}: {man["parts"][pid]["tris"]} tris, {size / 1e3:.0f} kB')

    for c in GARMENTS:
        slot = GARMENTS[c]['slot']
        part(c, 'bottom' if slot == 'bottom' else 'top', [parts[c]], hide=covers.index(c), **({'full': True} if slot == 'full' else {}), **entries[c])
    for c in SHOES:
        part(c, 'shoes', [parts[c]], hide=covers.index(c), **entries[c])
    for h in HAIRS:
        part(h, 'hair', [parts[h]], **entries[h])
    for br in BROWS:
        part(br, 'brows', [parts[br]], **entries[br])
    fits = {}  # kit id -> [(signature, file)]
    bare = {}  # kit id -> the signature of its fit to every bottom with no top
    for pid, (slot, objs, paints) in kit_parts.items():
        kid, _, on = pid.partition('@')
        joined = kit.join(objs, 'kit_' + kid)
        extra = {}
        if paints:
            extra['paint'] = paints
        if kid in SLEEVE:
            extra['sleeve'] = SLEEVE[kid]
        sig = signature(joined)
        close = bare.get(kid)
        if on == '_' or (on in TOPS and close is not None and close.shape == sig.shape and np.abs(close - sig).max() < 0.008):
            # The fit to no top at all, or a top that doesn't reach this piece: the client falls back to
            # the bottom's own fit (`kit_<id>@_<bottom>`).
            bare.setdefault(kid, sig)
            for o in joined:
                bpy.data.objects.remove(o)
            continue
        same = next((f for s, f in fits.get(kid, []) if s.shape == sig.shape and np.abs(s - sig).max() < 0.008), None)
        if same:
            # The same fit as another outfit's: point at that file.
            man['parts']['kit_' + pid] = {**man['parts'][same], **extra}
            for o in joined:
                bpy.data.objects.remove(o)
            continue
        part('kit_' + pid, slot, joined, **extra)
        fits.setdefault(kid, []).append((sig, 'kit_' + pid))
    for kid in WAIST_FIT:
        # No top falls back to the bottoms' own fits of this piece: they're not needed.
        if all(f'kit_{kid}@{t}' in man['parts'] for t in TOPS):
            for b in BOTTOMS:
                del man['parts'][f'kit_{kid}@_{b}']
    for w, objs in wheels.items():
        part('wheel_' + w, 'wheel', kit.join(objs, 'wheel_' + w))
    if preview:
        previews(base_id, arm, body, parts, covers, os.path.join(preview, base_id))
    return man


#: What the preview renders show: (top, bottom or None, shoes, hair) on each base, from four sides standing
#: and two seated.
PREVIEW = [
    ('suit_jacket', 'suit_trousers', 'shoes03', 'ponytail01'),
    ('field_jacket', 'leggings', 'shoes03', 'long01'),
    ('crop_top', 'skirt', 'shoes05', 'braid01'),
    ('blouse', 'washed_jeans', 'shoes01', 'bob01'),
    ('long_tee', 'shorts', 'shoes02', 'short02'),
    ('overalls', None, 'shoes04', 'afro01'),
    ('denim_suit', None, 'shoes06', 'short01'),
    ('plain_tee', 'blue_jeans', 'shoes03', 'bob02'),
]


def previews(base_id, arm, body, parts, covers, prefix, looks=None):
    """EEVEE renders of a few looks as the client would assemble them (the skin the clothes hide dropped),
    to check the fit: nothing poking through, from the front, both back quarters and the side, and seated."""
    import render
    sc = bpy.context.scene
    cam = render._setup(sc)
    sc.render.resolution_x, sc.render.resolution_y = 500, 700
    names = ['_hide'] + [f'_hide{k}' for k in range(2, 9)]
    hide = np.zeros(len(body.data.vertices), np.int64)
    for k, n in enumerate(names):
        a = body.data.attributes.get(n)
        if a is None:
            break
        f = np.zeros(len(body.data.vertices), np.float32)
        a.data.foreach_get('value', f)
        hide |= f.astype(np.int64) << (k * HIDE_BITS)
    full = body.data
    acts = {a.name.split('.')[0]: a for a in bpy.data.actions}
    head_z = (arm.matrix_world @ arm.data.bones['head'].head_local).z + 0.08
    always = {'body', 'low-poly'} | {o.name for o in parts.values() if o.name.startswith('eyelash')} | {BROWS[0]}
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = o.name not in always
    # The body ships with a placeholder texture (the client loads the look's skin): a plain skin tone here.
    tone = kit.mat('preview_skin', '#d2b4a1', 0.85)
    was = body.data.materials[0]
    body.data.materials[0] = tone
    for top, bottom, shoe, hair in looks or PREVIEW:
        worn = [c for c in (top, bottom, shoe) if c]
        mask = sum(1 << covers.index(c) for c in worn)
        me = full.copy()
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(int(hide[v.index]) & mask for v in f.verts)], context='FACES')
        bm.to_mesh(me)
        bm.free()
        body.data = me
        for c in worn + [hair]:
            parts[c].hide_render = False
        name = f'{prefix}_{top}_{bottom or "full"}'
        arm.animation_data.action = acts['idle']
        sc.frame_set(24)
        for view, yaw in (('front', 0.3), ('back', math.pi - 0.4), ('side', math.pi / 2), ('back2', math.pi + 0.4)):
            render._shoot(sc, cam, f'{name}_{view}.png', (0, 0, head_z * 0.5), 3.0, 50, yaw)
        arm.animation_data.action = acts['drive']
        sc.frame_set(pose.STEER_KEYS // 2)
        for view, yaw in (('sit_side', 1.4), ('sit_back', math.pi - 0.6)):
            render._shoot(sc, cam, f'{name}_{view}.png', (0, -0.2, 0.45), 2.4, 50, yaw, 0.15)
        for c in worn + [hair]:
            parts[c].hide_render = True
        body.data = full
        bpy.data.meshes.remove(me)
    body.data.materials[0] = was
    arm.animation_data.action = None


def shared_textures(manifest):
    for d in ('skins', 'eyes'):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)
    for s in SKINS['m'] + SKINS['f']:
        mhmat = os.path.join(build.MH, 'skins', s, s + '.mhmat')
        tex = next(line.split()[1] for line in open(mhmat) if line.startswith('diffuseTexture'))
        img = bpy.data.images.load(os.path.join(build.MH, 'skins', s, os.path.basename(tex)))
        save_image(os.path.join(OUT, 'skins', s + '.webp'), build.toon_skin(build.read(img, build.TEX['body'])), 'WEBP')
    for e in EYES:
        img = bpy.data.images.load(os.path.join(build.MH, 'eyes', 'materials', e + '_eye.png'))
        save_image(os.path.join(OUT, 'eyes', e + '.webp'), build.anime_eye(build.read(img, build.TEX['eyes'])), 'WEBP')
    manifest['skins'] = SKINS
    manifest['eyes'] = EYES


def zones_only(manifest):
    """Recomputes every zone entry and mask from the MakeHuman textures, for retuning zones and hair
    contrast without rebuilding the models (textures and UVs are the same on every base, so one human is
    made just to read the garments' UVs)."""
    build.reset()
    _, _, parts = create(next(iter(BASES.values())))
    entries, raw = {}, {}
    for key in SOURCES + SHOES + HAIRS + BROWS:
        folder = os.path.join(build.MH, 'hair' if key in HAIRS else 'eyebrows' if key in BROWS else 'clothes', key)
        mhmat = os.path.join(folder, key + '.mhmat')
        tex = next(line.split()[1] for line in open(mhmat) if line.startswith('diffuseTexture'))
        img = bpy.data.images.load(os.path.join(folder, os.path.basename(tex)))
        a = build.read(img, build.TEX['small' if key in BROWS else 'hair' if key in HAIRS else 'clothes'])
        if key in SOURCES:
            raw[key] = a
        else:
            entries[key] = zone_entry(key, a, None)
    split(parts)
    garment_zones(parts, entries, raw)
    for m in manifest['bases'].values():
        for pid, p in m['parts'].items():
            if pid in entries:
                p.update(entries[pid])


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    preview = None
    if '--preview' in argv:
        i = argv.index('--preview')
        preview = argv[i + 1]
        del argv[i:i + 2]
        os.makedirs(preview, exist_ok=True)
    os.makedirs(TEX, exist_ok=True)
    path = os.path.join(OUT, 'manifest.json')
    manifest = json.load(open(path)) if os.path.exists(path) else {'bases': {}}
    if argv == ['--zones']:
        zones_only(manifest)
        with open(path, 'w') as f:
            json.dump(manifest, f, indent=1)
        print('ZONES done')
        return
    ids = argv or list(BASES)
    shared_textures(manifest)
    for bid in ids:
        manifest['bases'][bid] = build_base(bid, BASES[bid], preview)
        m = manifest['bases'][bid]
        total = m['base']['bytes'] + sum(p['bytes'] for p in {p['file']: p for p in m['parts'].values()}.values())
        print(f'BASE {bid}: base {m["base"]["tris"]} tris, {len(m["parts"])} parts, {total / 1e6:.1f} MB')
        with open(path, 'w') as f:
            json.dump(manifest, f, indent=1)
        prune(manifest, bid)


def prune(manifest, bid):
    """Deletes what an earlier build left behind that nothing uses now: a base's models the manifest no
    longer lists (kit fits are shared differently when bodies change) and, once every base's models are
    read, textures no model or mask points at."""
    m = manifest['bases'][bid]
    keep = {m['base']['file']} | {p['file'] for p in m['parts'].values()}
    keep |= {f[:-5] + '.bin' for f in keep}
    folder = os.path.join(OUT, bid)
    for f in os.listdir(folder):
        if f not in keep:
            os.remove(os.path.join(folder, f))
    if set(manifest['bases']) != set(BASES):
        return
    used = set()
    for b, mb in manifest['bases'].items():
        used |= {os.path.basename(p['mask']) for p in mb['parts'].values() if p.get('mask')}
        for f in os.listdir(os.path.join(OUT, b)):
            if f.endswith('.gltf'):
                with open(os.path.join(OUT, b, f)) as g:
                    used |= {os.path.basename(i['uri']) for i in json.load(g).get('images', [])}
    for f in os.listdir(TEX):
        if f not in used:
            os.remove(os.path.join(TEX, f))


if __name__ == '__main__':
    main()
