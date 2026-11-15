"""Builds the driver creator's wardrobe: per body base, a base model (rig, clips, body, eyes, lashes,
seat) and one model per swappable part (outfits, shoes, hair, brows, kit pieces, wheels), all skinned to
the same skeleton, plus `manifest.json`. The client assembles a driver from them (docs/DRIVER_CREATOR.md).

    blender -b --python tools/drivers/wardrobe.py -- [bases...]
    blender -b --python tools/drivers/wardrobe.py -- --zones     # only redo colour zones (masks, refs)

Same human, cartoon look (build.STYLE), materials and kit as the legends (build.py, kit.py), with these
differences:
- the body keeps all its skin; instead each vertex gets a `_hide` bit per outfit/shoes that covers it,
  so the client drops exactly the skin the chosen clothes hide;
- clothes, hair and brows keep their own textures, softened (build.soften: no weave, no black; brows and
  lashes as brush strokes); each outfit's colour zones are baked to an RGBA mask (zone k in channel k)
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
# Zones: (name, pick rule as in build.recolor, default colour). At most 4 per outfit, first rule wins.
# The default colours are the legends' palette (cast.py): pastel-leaning, mid-light, never near black.
# UV boxes are (u0, v0, u1, v1) with v up from the bottom of the texture.

TRIM = {'hue': (0.03, 0.14), 'sat': (0.45, 1.0)}  # the orange piping on the MakeHuman tees
PINK = {'hue': (0.85, 0.05), 'sat': (0.25, 1.0)}  # pinstripes
OUTFITS = {
    'male_elegantsuit01': [
        # The tie's navy stripes (its white ones go with the shirt).
        ('tie', {'uv': (0.34, 0.8, 0.5, 0.99), 'sat': (0.12, 1.0)}, '#f0c26a'),
        ('suit', {'val': (0.0, 0.45), 'sat': (0.0, 0.6)}, '#6fa08c'),
        ('shirt', {'val': (0.6, 1.0), 'sat': (0.0, 0.25)}, '#fbf2de'),
    ],
    'male_worksuit01': [
        ('overalls', {'hue': (0.5, 0.75), 'sat': (0.12, 1.0)}, '#d08a62'),
        ('tee', {'sat': (0.0, 0.2), 'val': (0.4, 1.0)}, '#7d8aa3'),
    ],
    'male_casualsuit05': [
        ('stripes', PINK, '#f27d7a'),
        ('jeans', {'uv': (0.0, 0.0, 0.6, 0.45), 'sat': (0.12, 1.0)}, '#8e97b5'),
        ('jacket', {}, '#565f85'),
    ],
    'male_casualsuit02': [
        ('trim', TRIM, '#ffc46b'),
        ('jeans', {'uv': (0.0, 0.0, 0.76, 0.53)}, '#6f84a8'),
        ('tee', {}, '#8fb7c9'),
    ],
    'male_casualsuit03': [
        ('stripes', PINK, '#e6c79a'),
        ('jeans', {'uv': (0.0, 0.5, 0.56, 1.0)}, '#7c86a3'),
        ('shirt', {}, '#5f6488'),
    ],
    'male_casualsuit04': [
        ('trim', TRIM, '#7df0b0'),
        ('jeans', {'uv': (0.0, 0.0, 0.78, 0.55)}, '#737c94'),
        ('tee', {}, '#585c78'),
    ],
    'male_casualsuit06': [
        ('jeans', {'uv': (0.0, 0.0, 1.0, 0.55), 'sat': (0.12, 1.0)}, '#7f95c2'),
        ('tee', {}, '#fbf2de'),
    ],
    'male_casualsuit01': [
        ('patches', {'hue': (0.04, 0.16), 'sat': (0.3, 1.0)}, '#d9a274'),
        ('clothes', {}, '#8a93a6'),
    ],
    'female_casualsuit01': [
        ('trim', TRIM, '#ff8fe3'),
        ('jeans', {'uv': (0.0, 0.0, 0.72, 0.58)}, '#6f84a8'),
        ('top', {}, '#6a6f9e'),
    ],
    'female_casualsuit02': [
        ('trim', TRIM, '#ffc46b'),
        ('shorts', {'uv': (0.0, 0.0, 0.72, 0.58)}, '#8fb7c9'),
        ('top', {}, '#fbf2de'),
    ],
    'female_elegantsuit01': [
        # A pinstriped shirt on a near-black base (v ~0.13) over a grey-green knit skirt (v ~0.3).
        ('stripes', PINK, '#f0c26a'),
        ('shirt', {'val': (0.0, 0.2)}, '#5f6488'),
        ('skirt', {}, '#6fa08c'),
    ],
    'female_sportsuit01': [
        ('trim', TRIM, '#ff8fe3'),
        ('stripe', {'uv': (0.0, 0.0, 0.72, 0.58), 'val': (0.7, 1.0)}, '#ff8fe3'),
        ('leggings', {'uv': (0.0, 0.0, 0.72, 0.58)}, '#6a6f9e'),
        ('top', {}, '#8d92c8'),
    ],
}
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
#: Pieces that hug the clothes: fitted once per outfit (`kit_<id>@<outfit>`; identical fits share a
#: file), so a collar or bracer sits on a slim suit as snugly as on bulky overalls. Head kit is shared.
CLOTH_FIT = {'collar', 'bracer_l', 'bracer_r', 'mech_arm_l', 'mech_arm_r', 'pauldron_l', 'gloves', 'gloves_fingerless', 'belt', 'chest_strap'}
#: Mechanical arms cut the outfit's sleeve off that side (the client does the cut).
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
    P['metal'] = kit.mat('metal', '#ecc878', 0.42, kit.METAL)
    P['trim'] = kit.mat('trim', '#b9945e', 0.5, kit.METAL)
    P['strap'] = kit.mat('strap', '#96705c', 0.7)
    return P


def add_asset(body, kind, name):
    path = AssetService.find_asset_absolute_path(f'{name}/{name}.mhclo', asset_subdir=kind)
    HumanService.add_mhclo_asset(path, body, asset_type=kind, subdiv_levels=0, material_type='GAMEENGINE')


def create(spec):
    """The base human wearing every outfit, shoe, hair and brow (so the kit can fit them all)."""
    arm, body, parts = build.create({
        'phenotype': spec['phenotype'], 'eyebrows': BROWS[0], 'eyelashes': LASHES[spec['frame']],
        'hair': HAIRS[0], 'clothes': list(OUTFITS) + SHOES, 'skin': SKINS[spec['frame']][0],
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


def zone_entry(key, a, zones):
    """Zone masks (shared `tex/<key>_mask.png`, same for every base) and refs for one outfit or shoe, from
    its texture `a` as MakeHuman made it (the refs are read off its softened shading, which is what ships).
    `zones` None: one zone over everything (hair, brows, shoes), no mask. Contrasts carry the cartoon
    look's softening (build.STYLE['contrast']); the client keeps the shade inside STYLE['shade']."""
    if zones is None:
        _, refs, _ = build.zone_masks(a, [{'color': '#000000'}])
        contrast = (HAIR_CONTRAST.get(key, 0.85) if key in HAIRS else 1.0) * build.STYLE['contrast']
        return {'zones': [{'name': 'all', 'ref': round(refs[0], 4), 'contrast': round(contrast, 4)}], 'mask': None}
    masks, refs, _ = build.zone_masks(a, [{**r, 'color': c} for _, r, c in zones])
    path = os.path.join(TEX, f'{key}_mask.png')
    if not os.path.exists(path):
        m = np.zeros(a.shape, np.float32)
        for i, mk in enumerate(masks):
            m[..., i] = mk
        save_image(path, m, 'PNG', data=True)
    return {
        'zones': [{'name': n, 'ref': round(ref, 4), 'color': c, 'contrast': round(r.get('contrast', 1.0) * build.STYLE['contrast'], 4)}
                  for (n, r, c), ref in zip(zones, refs)],
        'mask': f'tex/{key}_mask.png',
    }


def dress(body, parts, entries):
    """Plain glTF materials on the softened textures; zone entries for outfits, shoes, hair and brows.
    The body and irises get a tiny placeholder: the client loads the look's skin and eye textures."""
    for key, o in [('body', body)] + list(parts.items()):
        diffuse = build.images_of(o.data.materials[0])
        kind = 'body' if key == 'body' else 'eyes' if key == 'low-poly' else 'small' if key.startswith(('eyebrow', 'eyelash')) else 'hair' if key in HAIRS else 'clothes'
        if kind in ('body', 'eyes'):
            a = np.full((4, 4, 4), 0.6, np.float32)
        else:
            a = build.read(diffuse, build.TEX[kind])
        if key in OUTFITS:
            entries[key] = zone_entry(key, a, OUTFITS[key])
        elif key in SHOES or key in HAIRS or key in BROWS:
            entries[key] = zone_entry(key, a, None)
        if kind in ('clothes', 'hair'):
            a = build.soften(a)
        elif kind == 'small':
            # Brows are repainted in the hair colour by the client; lashes are painted here.
            a = build.stroke(a) if key in BROWS else build.stroke(a, build.STYLE['lash'], lash=True)
        col = build.write(f'{key}_color', a)
        group = 'hair' if kind == 'hair' else key if key in build.ROUGH else 'eyebrows' if kind == 'small' else 'cloth'
        # Names the client keys on: 'skin', 'iris', or the part id.
        name = 'skin' if key == 'body' else 'iris' if key == 'low-poly' else key
        m = build.textured(name, col, None, build.ROUGH[group], kind in ('hair', 'small'))
        o.data.materials.clear()
        o.data.materials.append(m)


def apply_decimate(o, ratio, keep=None):
    build.decimate(o, ratio, keep)
    with bpy.context.temp_override(object=o, active_object=o):
        bpy.ops.object.modifier_apply(modifier='decimate')
    g = o.vertex_groups.get('decimate')
    if g:
        o.vertex_groups.remove(g)


def hide_bits(body, covers, reach=0.035):
    """`_hide` on the body: bit i set where cover i hides the skin: the vertices its MakeHuman asset
    deletes (`Delete.<id>`, what the legends' masks remove) plus any a ray out along the normal finds
    under it within `reach` (build.cull_hidden's test)."""
    from mathutils.bvhtree import BVHTree
    mw = body.matrix_world
    bits = np.zeros(len(body.data.vertices), np.float32)
    for i, (cid, objs) in enumerate(covers):
        g = body.vertex_groups.get('Delete.' + cid)
        if g is not None:
            for v in body.data.vertices:
                if any(x.group == g.index and x.weight > 0.5 for x in v.groups):
                    bits[v.index] += 2 ** i
        verts, polys = [], []
        for o in objs:
            base = len(verts)
            verts += [o.matrix_world @ v.co for v in o.data.vertices]
            polys += [[base + j for j in p.vertices] for p in o.data.polygons]
        tree = BVHTree.FromPolygons(verts, polys)
        for v in body.data.vertices:
            p = mw @ v.co
            n = (mw.to_3x3() @ v.normal).normalized()
            if int(bits[v.index]) & (1 << i) == 0 and tree.ray_cast(p + n * 0.001, n, reach)[0] is not None:
                bits[v.index] += 2 ** i
    attr = body.data.attributes.new('_hide', 'FLOAT', 'POINT')
    attr.data.foreach_set('value', bits)


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


def build_base(base_id, spec):
    build.reset()
    os.makedirs(os.path.join(OUT, base_id), exist_ok=True)
    arm, body, parts = create(spec)
    entries = {}
    dress(body, parts, entries)

    # The body: decimated now (sparing the face), so the hide bits are computed on what ships.
    apply_decimate(body, 0.6, keep={'head'})
    covers = list(OUTFITS) + SHOES
    hide_bits(body, [(c, [parts[c]]) for c in covers])

    shoes = [parts[s] for s in SHOES]
    eyes = parts['low-poly']
    b = kit.Body(arm, body, [parts[c] for c in OUTFITS] + shoes, None, eyes)
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
        for c in OUTFITS:
            cut = sleeve_cut(parts[c], SLEEVE[kid]) if kid in SLEEVE else None
            bc = kit.Body(arm, body, [cut or parts[c], *shoes], None, eyes)
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
    cushion, back = build.seat_fit(arm, [body, parts['male_casualsuit06']], recline)
    seat = kit.seat(P, recline, {'leather': 'strap', 'trim': 'trim'}, cushion, back)
    for o in seat:
        kit.rigid(o, b, 'seat')
    pose.idle(arm, {'stance': 'relaxed', 'weight': 1, 'head_turn': 6})
    pose.ride(arm, {})
    arm.animation_data.action = None

    for c in covers:
        build.decimate(parts[c], 0.3 if c.startswith('shoes') else 0.55)
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

    for c in OUTFITS:
        part(c, 'outfit', [parts[c]], hide=covers.index(c), **entries[c])
    for c in SHOES:
        part(c, 'shoes', [parts[c]], hide=covers.index(c), **entries[c])
    for h in HAIRS:
        part(h, 'hair', [parts[h]], **entries[h])
    for br in BROWS:
        part(br, 'brows', [parts[br]], **entries[br])
    fits = {}  # kit id -> [(signature, file)]
    for pid, (slot, objs, paints) in kit_parts.items():
        kid = pid.split('@')[0]
        joined = kit.join(objs, 'kit_' + kid)
        extra = {}
        if paints:
            extra['paint'] = paints
        if kid in SLEEVE:
            extra['sleeve'] = SLEEVE[kid]
        sig = signature(joined)
        same = next((f for s, f in fits.get(kid, []) if s.shape == sig.shape and np.abs(s - sig).max() < 0.008), None)
        if same:
            # The same fit as another outfit's: point at that file.
            man['parts']['kit_' + pid] = {**man['parts'][same], **extra}
            for o in joined:
                bpy.data.objects.remove(o)
            continue
        part('kit_' + pid, slot, joined, **extra)
        fits.setdefault(kid, []).append((sig, 'kit_' + pid))
    for w, objs in wheels.items():
        part('wheel_' + w, 'wheel', kit.join(objs, 'wheel_' + w))
    return man


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
    contrast without rebuilding geometry (the textures are the same on every base)."""
    entries = {}
    for key in list(OUTFITS) + SHOES + HAIRS + BROWS:
        folder = os.path.join(build.MH, 'hair' if key in HAIRS else 'eyebrows' if key in BROWS else 'clothes', key)
        mhmat = os.path.join(folder, key + '.mhmat')
        tex = next(line.split()[1] for line in open(mhmat) if line.startswith('diffuseTexture'))
        img = bpy.data.images.load(os.path.join(folder, os.path.basename(tex)))
        a = build.read(img, build.TEX['small' if key in BROWS else 'hair' if key in HAIRS else 'clothes'])
        if key in OUTFITS:
            mask = os.path.join(TEX, f'{key}_mask.png')
            if os.path.exists(mask):
                os.remove(mask)
            entries[key] = zone_entry(key, a, OUTFITS[key])
        else:
            entries[key] = zone_entry(key, a, None)
    for m in manifest['bases'].values():
        for pid, p in m['parts'].items():
            if pid in entries:
                p.update(entries[pid])


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
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
        manifest['bases'][bid] = build_base(bid, BASES[bid])
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


main()
