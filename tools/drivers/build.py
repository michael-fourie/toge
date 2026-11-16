"""Builds KANJO's drivers in Blender and exports them to public/models/drivers/<id>.glb.

    blender -b --python tools/drivers/build.py -- [ids...] [--preview DIR]

Needs Blender 5.x with the MPFB extension and the MakeHuman system assets installed (docs/DRIVERS.md).
Each driver: an MPFB human (rigged with the game-engine skeleton), MakeHuman clothes recoloured, a
kit of hard-surface parts (kit.py), a seat and a steering wheel, and two baked clips (pose.py).

The look is soft and cartoonish (anime-like): `STYLE` reshapes every body (a bigger, younger head, large
eyes, a small nose and mouth), `toon_skin()` flattens the skin textures to smooth tones, `anime_eye()`
paints the irises, and cloth and hair are repainted in gentle shades with no normal maps. The game's
soft cel shading is the client's (src/kanjo/client/toon.ts).
"""

import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import cast  # noqa: E402
import kit  # noqa: E402
import pose  # noqa: E402
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402

MH = os.path.join(bpy.utils.extension_path_user('bl_ext.user_default.mpfb'), 'data')
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'public', 'models', 'drivers'))
#: Texture sizes in the GLB (longest side).
TEX = {'body': 1024, 'clothes': 1024, 'hair': 1024, 'eyes': 512, 'small': 256}

#: The cartoon look every body, legend or wardrobe base, is built with.
STYLE = {
    # MakeHuman targets on top of the phenotype: the anime head. 1 is MakeHuman's own full slider; the
    # eyes go past it (create() lifts the shape keys' limit).
    'targets': {
        'head-age-decr': 0.55, 'head-scale-horiz-incr': 0.5, 'head-scale-vert-incr': 0.35, 'head-scale-depth-incr': 0.4,
        'head-oval': 0.4, 'head-fat-decr': 0.15,
        'l-eye-scale-incr': 1.9, 'r-eye-scale-incr': 1.9, 'l-eye-height1-incr': 1.0, 'r-eye-height1-incr': 1.0,
        'l-eye-height2-incr': 2.0, 'r-eye-height2-incr': 2.0, 'l-eye-height3-incr': 1.2, 'r-eye-height3-incr': 1.2,
        'l-eye-bag-decr': 1.0, 'r-eye-bag-decr': 1.0,
        'nose-scale-horiz-decr': 0.9, 'nose-scale-depth-decr': 0.9, 'nose-scale-vert-decr': 0.6, 'nose-volume-decr': 1.0,
        'nose-flaring-decr': 0.8, 'nose-hump-decr': 0.6, 'nose-point-up': 0.3,
        'mouth-scale-horiz-decr': 0.9, 'mouth-laugh-lines-out': 0.6, 'mouth-angles-up': 0.35,
        'chin-width-decr': 0.5, 'chin-bones-decr': 0.5, 'chin-jaw-drop-decr': 0.2,
        'l-cheek-bones-decr': 0.5, 'r-cheek-bones-decr': 0.5,
        'neck-scale-horiz-decr': 0.45, 'neck-scale-depth-decr': 0.35,
    },
    # Then the whole head is scaled by this about the base of the skull (big_head).
    'head': 1.2,
    # Skin: blurred over this share of the texture's width (pores, stubble and veins go), then pulled
    # toward its own mean tone (its light and dark by `skin_flat`, its colour, lips and all, by
    # `skin_even`), lifted toward white and given back a little colour.
    'skin_blur': 0.008, 'skin_flat': 0.75, 'skin_even': 0.35, 'skin_lift': 0.11, 'skin_sat': 0.88,
    # A soft blush on each cheek: (u, v) on MakeHuman's skin UVs (the face lies on its side there: u runs
    # down it), its size in u and v, how strong, and the pink it leans to.
    'blush': {'at': ((0.886, 0.538), (0.886, 0.428)), 'size': (0.02, 0.03), 'mix': 0.22, 'color': (0.93, 0.6, 0.6)},
    # Cloth and hair: the texture's own shading is blurred, softened (contrast times this) and kept inside
    # `shade`, so folds read as gentle bands and nothing is crushed to black or blown out.
    'shade_blur': 0.003, 'contrast': 0.55, 'shade': (0.62, 1.3),
    # Whatever no zone repaints (buttons, stitching, a shirt's dark stripes) is lifted off black by this.
    'floor': 0.22,
    # Brows and lashes: MakeHuman's are wisps of single hairs. Their alpha is blurred over this share of
    # the texture and multiplied up, so they read as one soft brush stroke; lashes get this colour.
    # `stroke_edge` then sharpens it again: alpha cards are clipped, and a soft edge shows as a smudge.
    'stroke_blur': 0.012, 'stroke_gain': 2.6, 'lash_blur': 0.005, 'lash_gain': 1.25, 'stroke_edge': 5.0,
    'lash': '#4d3f4c',
    # A legend's brows: its hair colour mixed this far toward the lash colour.
    'brow_mix': 0.5,
    # Eyes (anime_eye): iris radius as a share of the eye texture (MakeHuman's own is 0.115).
    'iris': 0.168,
    # The iris is MakeHuman's colour, its saturation times `iris_sat` (at most `iris_sat_max`) and its
    # value lifted to `iris_val[0] + iris_val[1] * sqrt(v)`: clear, but dusty rather than jewel-bright.
    'iris_sat': 1.2, 'iris_sat_max': 0.58, 'iris_val': (0.4, 0.4),
}

#: How clothes are fitted so nothing pokes through or sinks in (metres). Cloth is lifted off the skin
#: (`lift`), an outer garment is pushed clear of the one under it (`over`: tops over bottoms, trouser legs
#: over shoes), hair is combed out of collars and backs (`comb`), and skin counts as hidden when cloth lies
#: over it along its normal or close above it in any direction (`under_cloth`).
FIT = {
    # Cloth sits at least `skin_gap` off the skin; only cloth within `skin_reach` of it is looked at.
    'skin_gap': 0.003, 'skin_reach': 0.025,
    # An outer layer clears the inner one by `layer_gap`, looking `layer_reach` out along its normal.
    'layer_gap': 0.004, 'layer_reach': 0.045,
    # Hair below the chin is moved out of the clothes, away from the spine, by up to `hair_reach`.
    'hair_gap': 0.006, 'hair_reach': 0.1,
    # Neighbours of a moved vertex follow by this share, this many rings out, so no step shows.
    'ease': 0.5, 'ease_rings': 3,
    # Skin is hidden by cloth `cover_reach` out along its normal, or by cloth within `near_reach` whose
    # inner face looks at it (inside `near_cone`, the cosine): armpits, the crotch, behind a collar; or by
    # cloth all round it: of `ring` level rays, at least `ring_hits` meet the garment within `ring_reach`
    # (thighs inside a skirt or wide trouser legs, where the cloth hangs well off the skin).
    'cover_reach': 0.035, 'near_reach': 0.04, 'near_cone': 0.6, 'ring': 8, 'ring_hits': 7, 'ring_reach': 0.6,
}


def reset():
    bpy.ops.wm.read_homefile(use_empty=True)
    kit._MATS.clear()


def asset(kind, name):
    return f'{name}/{name}.mhclo'


def create(spec):
    info = {
        'name': 'driver',
        'phenotype': {'gender': 0.5, 'age': 0.5, 'muscle': 0.5, 'weight': 0.5, 'proportions': 0.5, 'height': 0.5,
                      'cupsize': 0.5, 'firmness': 0.5, **spec['phenotype']},
        'rig': 'game_engine',
        'eyes': 'low-poly/low-poly.mhclo',
        'eyebrows': asset('eyebrows', spec['eyebrows']),
        'eyelashes': asset('eyelashes', spec['eyelashes']),
        'tongue': '', 'teeth': '',
        'hair': asset('hair', spec['hair']),
        'proxy': '',
        'targets': [{'target': t, 'value': v} for t, v in {**STYLE['targets'], **spec.get('targets', {})}.items()],
        'clothes': [asset('clothes', c) for c in spec['clothes']],
        'skin_mhmat': f"skins/{spec['skin']}/{spec['skin']}.mhmat",
        'skin_material_type': 'GAMEENGINE',
        'eyes_material_type': 'GAMEENGINE',
        'clothes_material_type': 'GAMEENGINE',
        'skin_material_settings': {},
        'eyes_material_settings': {},
        'expressions': [],
    }
    settings = HumanService.get_default_deserialization_settings()
    settings['subdiv_levels'] = 0
    settings['override_clothes_model'] = 'GAMEENGINE'
    settings['override_eyes_model'] = 'GAMEENGINE'
    # MPFB makes each target a shape key limited to 1; STYLE pushes a few further.
    make_key = TargetService.target_string_to_shape_key

    def unlimited(*args, **kw):
        key = make_key(*args, **kw)
        key.slider_max = 4
        return key
    TargetService.target_string_to_shape_key = staticmethod(unlimited)
    try:
        body = HumanService.deserialize_from_dict(info, settings)
    finally:
        TargetService.target_string_to_shape_key = staticmethod(make_key)
    TargetService.bake_targets(body)
    arm = body.parent
    parts = {o.name.split('.', 1)[1]: o for o in arm.children if o.type == 'MESH' and o is not body}
    big_head(arm, [body, *parts.values()], STYLE['head'])
    return arm, body, parts


def big_head(arm, meshes, k):
    """Scales the head (and whatever rides on it: eyes, hair, brows, lashes) by `k` about the base of the
    skull, each vertex by its weight on the head bone, so the neck blends. MakeHuman's own head targets
    stop well short of cartoon proportions."""
    bone = arm.data.bones['head']
    pivot = arm.matrix_world @ bone.head_local
    for o in meshes:
        g = o.vertex_groups.get('head')
        if g is None:
            continue
        local = o.matrix_world.inverted() @ pivot
        for v in o.data.vertices:
            w = next((x.weight for x in v.groups if x.group == g.index), 0.0)
            if w > 0:
                v.co = local + (v.co - local) * (1 + (k - 1) * w)
        o.data.update()
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones['head']
    eb.tail = eb.head + (eb.tail - eb.head) * k
    bpy.ops.object.mode_set(mode='OBJECT')


# ---------------------------------------------------------------------------------------------
# Textures


def read(img, size):
    im = img.copy()
    w, h = im.size
    if max(w, h) > size:
        im.scale(size, size * h // w)
    w, h = im.size
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)


def write(name, a, non_color=False):
    h, w = a.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=True)
    if non_color:
        im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(np.ascontiguousarray(a, np.float32).ravel())
    im.pack()
    return im


def hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    safe = np.where(d > 1e-6, d, 1)
    h = np.where(mx == r, ((g - b) / safe) % 6, np.where(mx == g, (b - r) / safe + 2, (r - g) / safe + 4)) / 6
    h = np.where(d > 1e-6, h, 0)
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def srgb(hexc):
    hexc = hexc.lstrip('#')
    return np.array([int(hexc[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def zone_masks(a, rules, within=None):
    """Soft masks of the pixels each rule picks (first rule wins, picked on the texture as MakeHuman made
    it), and each zone's mean luminance on the softened texture (the shade reference; also returned). The
    wardrobe bakes these for the client's recolour shader; recolor() uses them. `within`: only these
    pixels count (a garment's own share of an outfit's texture: wardrobe.uv_cover)."""
    rgb = a[..., :3]
    h, s, v = hsv(rgb)
    lum = soften(a)[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
    alpha = a[..., 3]
    claimed = np.zeros(lum.shape, np.float32) if within is None else 1 - within.astype(np.float32)
    H, W = lum.shape
    vv, uu = np.mgrid[0:H, 0:W]
    uu = uu / W
    vv = vv / H

    def within(x, rng, feather=0.03):
        lo, hi = rng
        m = np.ones(x.shape, np.float32)
        if lo > 0:
            m *= np.clip((x - lo) / feather + 0.5, 0, 1)
        if hi < 1:
            m *= np.clip((hi - x) / feather + 0.5, 0, 1)
        return m

    masks, refs = [], []
    for rule in rules:
        m = np.ones(lum.shape, np.float32) * (alpha > 0.02)
        if 'hue' in rule:
            lo, hi = rule['hue']
            # Hue wraps: (0.9, 0.05) is the reds either side of 0.
            m *= within(h, (lo, hi)) if lo <= hi else np.maximum(within(h, (lo, 1)), within(h, (0, hi)))
        if 'sat' in rule:
            m *= within(s, rule['sat'])
        if 'val' in rule:
            m *= within(v, rule['val'])
        if 'uv' in rule:
            u0, v0, u1, v1 = rule['uv']
            m *= ((uu >= u0) & (uu <= u1) & (vv >= v0) & (vv <= v1)).astype(np.float32)
        m *= 1 - claimed
        claimed += m
        masks.append(m)
        refs.append(float((lum * m).sum() / m.sum()) if m.sum() >= 1 else 0.5)
    return masks, refs, lum


LUM = np.array([0.299, 0.587, 0.114], np.float32)


def blur(a, share, passes=3):
    """A soft blur (box blurs stacked) over `share` of the image's width; edges repeat."""
    r = max(1, round(a.shape[1] * share))
    out = a.astype(np.float32)
    for _ in range(passes):
        for axis in (0, 1):
            pad = [(0, 0)] * out.ndim
            pad[axis] = (r + 1, r)
            c = np.cumsum(np.pad(out, pad, mode='edge'), axis=axis, dtype=np.float64)
            n = out.shape[axis]
            hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
            lo = np.take(c, np.arange(0, n), axis=axis)
            out = ((hi - lo) / (2 * r + 1)).astype(np.float32)
    return out


def soften(a):
    """A cloth or hair texture as the cartoon look ships it: its fine weave and strands blurred away
    (cartoon cloth has folds, not threads) and its darks lifted off black. Alpha untouched. The zones'
    shading is read from this."""
    out = a.copy()
    w = a[..., 3:4]
    # Blur colour weighted by alpha, so the dark around alpha-cut hair cards doesn't bleed in.
    rgb = blur(a[..., :3] * w, STYLE['shade_blur']) / np.maximum(blur(w, STYLE['shade_blur']), 1e-3)
    out[..., :3] = STYLE['floor'] + rgb * (1 - STYLE['floor'])
    return out


def stroke(a, color=None, lash=False):
    """A brow or lash texture as one soft brush stroke instead of single hairs (and in `color`)."""
    out = soften(a)
    share, gain = (STYLE['lash_blur'], STYLE['lash_gain']) if lash else (STYLE['stroke_blur'], STYLE['stroke_gain'])
    out[..., 3] = np.clip((blur(a[..., 3], share) * gain - 0.5) * STYLE['stroke_edge'] + 0.5, 0, 1)
    if color is not None:
        out[..., :3] = srgb(color)
    return out


def mix(c0, c1, t):
    """'#rrggbb' between two."""
    c = srgb(c0) * (1 - t) + srgb(c1) * t
    return '#' + ''.join(f'{round(float(x) * 255):02x}' for x in c)


def toon_skin(a):
    """A MakeHuman skin as a cartoon one: smooth, close to one tone (lips, cheeks and the age's lines
    stay as soft shapes), a little lighter and cleaner."""
    rgb = blur(a[..., :3], STYLE['skin_blur'])
    tone = np.median(rgb.reshape(-1, 3), axis=0)
    d = rgb - tone
    shade = (d @ LUM)[..., None]
    rgb = tone + shade * (1 - STYLE['skin_flat']) + (d - shade) * (1 - STYLE['skin_even'])
    rgb = 1 - (1 - rgb) * (1 - STYLE['skin_lift'])
    grey = rgb @ LUM
    rgb = grey[..., None] + (rgb - grey[..., None]) * STYLE['skin_sat']
    H, W = rgb.shape[:2]
    vv, uu = np.mgrid[0:H, 0:W]
    b = STYLE['blush']
    pink = np.array(b['color'], np.float32) * 0.6 + tone * 0.4
    for u, v in b['at']:
        k = np.exp(-(((uu + 0.5) / W - u) / b['size'][0]) ** 2 - (((vv + 0.5) / H - v) / b['size'][1]) ** 2) * b['mix']
        rgb = rgb + (pink - rgb) * k[..., None]
    return np.concatenate([np.clip(rgb, 0, 1), a[..., 3:]], -1)


#: MakeHuman's eye texture holds both eyeballs: (u, v) of each iris centre (v up, which is also up on
#: the face), and which way +u runs across the face (the second eye's UVs are mirrored).
EYE_UV = [((0.705, 0.702), 1), ((0.290, 0.292), -1)]


def _step(lo, hi, x):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def anime_eye(a):
    """Repaints MakeHuman's eye texture as an anime eye in the same colour: a big iris, dark at the top
    and bright at the bottom, a dark rim, a large soft pupil and two catchlights, on a clean white."""
    H, W = a.shape[:2]
    vv, uu = np.mgrid[0:H, 0:W]
    uu = (uu + 0.5) / W
    vv = (vv + 0.5) / H
    # The eye's colour: MakeHuman's iris, between its pupil and its rim.
    (cu, cv), _ = EYE_UV[0]
    d = np.hypot(uu - cu, vv - cv)
    c = a[..., :3][(d > 0.055) & (d < 0.095)].mean(0)
    h, s, v = (float(x) for x in hsv(c))
    # Clearer than life, but still that colour (greys stay grey), and soft like the rest of the palette.
    s, v = min(s * STYLE['iris_sat'], STYLE['iris_sat_max']), STYLE['iris_val'][0] + STYLE['iris_val'][1] * v ** 0.5
    i, f = int(h * 6) % 6, h * 6 - int(h * 6)
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    c = np.array([(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)][i], np.float32)

    R = STYLE['iris']
    px = 1.5 / W
    white = np.array([0.97, 0.965, 0.96], np.float32)
    out = np.empty((H, W, 3), np.float32)
    out[:] = white
    for (cu, cv), side in EYE_UV:
        du, dv = (uu - cu) * side, vv - cv
        d = np.hypot(du, dv)
        up = dv / R  # -1 at the bottom of the iris, 1 at the top
        # The lid's soft shadow on the white.
        ball = white * (1 - 0.16 * _step(0.3, 1.5, up))[..., None]
        iris = c * (0.98 - 0.42 * _step(-0.6, 0.9, up))[..., None]
        # A bright crescent along the bottom.
        glow = (_step(0.35, 0.8, d / R) * (1 - _step(-0.9, 0.1, up)) * 0.55)[..., None]
        iris = iris + (1 - iris) * glow
        iris = iris * (1 - 0.72 * _step(0.84, 0.99, d / R))[..., None]  # the rim
        k = (1 - _step(0.38, 0.44, d / R))[..., None]  # the pupil
        iris = iris * (1 - k) + c * 0.16 * k
        for (hu, hv), hr in (((-0.36, 0.4), 0.24), ((0.4, -0.44), 0.11)):  # catchlights
            k = (1 - _step(hr * R - px, hr * R + px, np.hypot(du - hu * R, dv - hv * R)))[..., None]
            iris = iris + (1 - iris) * k
        k = (1 - _step(R - px, R + px, d))[..., None]
        near = d < 0.29  # each eyeball's own island
        out[near] = (ball * (1 - k) + iris * k)[near]
    return np.concatenate([out, np.ones((H, W, 1), np.float32)], -1)


def recolor(a, rules):
    """Repaints the pixels each rule picks (first rule wins) in soft shades of the rule's colour.
    Returns (colour, emission or None)."""
    masks, refs, lum = zone_masks(a, rules)
    alpha = a[..., 3]
    out = soften(a)[..., :3]
    emit = None
    for rule, m, ref in zip(rules, masks, refs):
        if m.sum() < 1:
            continue
        shade = np.clip((lum / max(ref, 0.02)) ** (rule.get('contrast', 1.0) * STYLE['contrast']), *STYLE['shade'])
        col = srgb(rule['color'])[None, None, :] * shade[..., None]
        out = out * (1 - m[..., None]) + np.clip(col, 0, 1) * m[..., None]
        if 'emit' in rule:
            e = srgb(rule['emit'])[None, None, :] * m[..., None]
            emit = e if emit is None else emit + e
    res = np.concatenate([out, alpha[..., None]], -1)
    if emit is not None:
        emit = np.concatenate([np.clip(emit, 0, 1), np.ones_like(alpha)[..., None]], -1)
    return res, emit


def images_of(mat):
    """A MakeHuman material's colour texture."""
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and 'normal' not in n.image.name.lower():
            return n.image
    return None


def textured(name, color_img, normal_img=None, rough=0.7, alpha=False, emit_img=None, strength=4.0, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = color_img
    nt.links.new(t.outputs['Color'], p.inputs['Base Color'])
    if alpha:
        # glTF alpha clip: alpha → Round → BSDF alpha.
        r = nt.nodes.new('ShaderNodeMath')
        r.operation = 'ROUND'
        nt.links.new(t.outputs['Alpha'], r.inputs[0])
        nt.links.new(r.outputs[0], p.inputs['Alpha'])
        m.surface_render_method = 'DITHERED'
    if normal_img is not None:
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = normal_img
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
    if emit_img is not None:
        te = nt.nodes.new('ShaderNodeTexImage')
        te.image = emit_img
        nt.links.new(te.outputs['Color'], p.inputs['Emission Color'])
        p.inputs['Emission Strength'].default_value = strength
    return m


#: Matt everywhere but the eyes: cartoon skin and hair don't shine.
ROUGH = {'hair': 0.8, 'eyebrows': 0.85, 'eyelashes': 0.85, 'low-poly': 0.3, 'body': 0.85, 'cloth': 0.9}


def materials(spec, body, parts):
    """Replaces MPFB's materials with plain glTF-friendly ones on downscaled (and recoloured) textures."""
    rules = dict(spec.get('recolor', {}))
    hair_color = rules.get(spec['hair'], [{}])[0].get('color')
    brow = mix(hair_color, STYLE['lash'], STYLE['brow_mix']) if hair_color else STYLE['lash']
    for key, o in [('body', body)] + list(parts.items()):
        old = o.data.materials[0]
        diffuse = images_of(old)
        if key == 'low-poly':
            diffuse = bpy.data.images.load(os.path.join(MH, 'eyes', 'materials', spec['eyes'] + '_eye.png'))
        kind = 'body' if key == 'body' else 'eyes' if key == 'low-poly' else 'small' if key.startswith(('eyebrow', 'eyelash')) else 'hair' if key == spec['hair'] else 'clothes'
        a = read(diffuse, TEX[kind])
        if kind == 'body':
            a = toon_skin(a)
        elif kind == 'eyes':
            a = anime_eye(a)
        elif kind == 'small':
            a = stroke(a, brow) if key.startswith('eyebrow') else stroke(a, STYLE['lash'], lash=True)
        emit_img = None
        if key in rules:
            a, e = recolor(a, rules[key])
            if e is not None:
                emit_img = write(f'{key}_emit', e)
        elif kind == 'clothes':
            a = soften(a)
        col = write(f'{key}_color', a)
        alpha = kind in ('hair', 'small')
        group = 'hair' if kind == 'hair' else key if key in ROUGH else 'eyebrows' if kind == 'small' else 'cloth'
        # No normal maps: the cloth's printed wrinkles are a photo look.
        m = textured(f"{'skin' if key == 'body' else key}", col, None, ROUGH[group], alpha, emit_img)
        o.data.materials.clear()
        o.data.materials.append(m)


# ---------------------------------------------------------------------------------------------
# Geometry clean-up


def sleeveless(body, parts, side):
    """Cuts one sleeve off the clothes and gives the body back the arm the sleeve was hiding."""
    import bmesh
    bones = set(kit.arm_bones(side))
    for o in parts.values():
        idx = {g.index for g in o.vertex_groups if g.name in bones}
        if not idx:
            continue
        w = [sum(g.weight for g in v.groups if g.group in idx) for v in o.data.vertices]
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        dead = [f for f in bm.faces if sum(w[v.index] for v in f.verts) / len(f.verts) > 0.5]
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        bm.to_mesh(o.data)
        bm.free()
    idx = {g.index for g in body.vertex_groups if g.name in bones}
    arm_verts = [v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in idx) > 0.35]
    for g in body.vertex_groups:
        if g.name.startswith('Delete.'):
            g.remove(arm_verts)


def tree_of(objs):
    """A BVH over `objs` in world space."""
    from mathutils.bvhtree import BVHTree
    verts, polys = [], []
    for o in objs:
        base = len(verts)
        verts += [o.matrix_world @ v.co for v in o.data.vertices]
        polys += [[base + i for i in p.vertices] for p in o.data.polygons]
    return BVHTree.FromPolygons(verts, polys)


def _move(o, moves):
    """Applies world-space `moves` ({vertex: Vector}) to `o`, easing them out over the neighbouring rings
    (FIT['ease']) so a pushed patch blends into the cloth round it. Returns how many vertices moved."""
    if not moves:
        return 0
    me = o.data
    near = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices
        near[a].append(b)
        near[b].append(a)
    moves = dict(moves)
    for _ in range(FIT['ease_rings']):
        ring = {}
        for i in list(moves):
            for j in near[i]:
                if j not in moves and j not in ring:
                    got = [moves[k] for k in near[j] if k in moves]
                    ring[j] = sum(got, Vector()) / len(got) * FIT['ease']
        moves.update(ring)
    inv = o.matrix_world.inverted()
    for i, d in moves.items():
        me.vertices[i].co = inv @ (o.matrix_world @ me.vertices[i].co + d)
    me.update()
    return len(moves)


def lift(o, body_tree):
    """Cloth `o` off the skin: every vertex in the skin, on it or closer than FIT['skin_gap'] is moved out
    along the skin's normal. MakeHuman fits clothes with next to no gap, and the cartoon proportions and
    the decimated body leave tight cloth (sleeves, leggings, the seat of trousers) dipping under it."""
    mw = o.matrix_world
    moves = {}
    for v in o.data.vertices:
        p = mw @ v.co
        loc, nrm, _, _ = body_tree.find_nearest(p, FIT['skin_reach'])
        if loc is None:
            continue
        s = (p - loc).dot(nrm)
        if s < FIT['skin_gap']:
            moves[v.index] = nrm * (FIT['skin_gap'] - s)
    return _move(o, moves)


def _way_out(tree, p, d, reach, gap):
    """How far `p` must go along `d` to stand `gap` outside every surface of `tree` it is inside of (it is
    inside when the first thing a ray meets is a face seen from behind), or 0."""
    out, at = 0.0, p
    for _ in range(6):
        loc, nrm, _, dist = tree.ray_cast(at + d * 1e-4, d, reach - out)
        if loc is None or nrm.dot(d) <= 0:
            break
        out += dist + gap
        at = p + d * out
    return out


def over(o, inner, groups=None, level=False):
    """Garment `o` over the garments in `inner`: wherever a vertex of `o` lies under one of them it is
    pushed out along its normal to clear it (tops hang over waistbands, trouser legs over boots).
    `groups`: only vertices weighted to bones whose names start with these are looked at.
    `level`: push straight out, level, from the bone the vertex hangs on, not along its normal: a hem's
    normals point every which way, and pushing along them pulled a tee's hem into spikes over the jeans."""
    tree = tree_of(inner)
    mw = o.matrix_world
    rot = mw.to_3x3()
    idx = None if groups is None else {g.index for g in o.vertex_groups if g.name.startswith(groups)}
    arm = o.find_armature() if level else None
    lines = {}
    if arm is not None:
        for g in o.vertex_groups:
            b = arm.data.bones.get(g.name)
            if b is not None:
                lines[g.index] = (arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local)
    moves = {}
    for v in o.data.vertices:
        if idx is not None and sum(g.weight for g in v.groups if g.group in idx) < 0.3:
            continue
        n = (rot @ v.normal).normalized()
        own = [g for g in v.groups if g.group in lines]
        if own:
            a, b = lines[max(own, key=lambda g: g.weight).group]
            p = mw @ v.co
            t = max(0.0, min(1.0, (p - a).dot(b - a) / max((b - a).length_squared, 1e-9)))
            r = p - (a + (b - a) * t)
            r.z = 0
            if r.length > 1e-4:
                n = r.normalized()
        d = _way_out(tree, mw @ v.co, n, FIT['layer_reach'], FIT['layer_gap'])
        if d > 0:
            moves[v.index] = n * d
    return _move(o, moves)


def comb(hair, arm, cover):
    """Hair out of the clothes: the bigger cartoon head hangs ponytails, braids and long hair lower and
    closer to the back, where they sank into collars, jackets and shoulders. Every hair vertex below the
    chin that is inside `cover` (the body and whatever can be worn with this hair) moves straight away from
    the spine until it lies on top."""
    tree = tree_of(cover)
    mw = hair.matrix_world
    chin = (arm.matrix_world @ arm.data.bones['head'].head_local).z + 0.02
    spine = arm.matrix_world @ arm.data.bones['spine_03'].head_local
    moves = {}
    for v in hair.data.vertices:
        p = mw @ v.co
        if p.z > chin:
            continue
        d = Vector((p.x - spine.x, p.y - spine.y, 0))
        if d.length < 1e-4:
            continue
        d.normalize()
        out = _way_out(tree, p, d, FIT['hair_reach'], FIT['hair_gap'])
        if out > 0:
            moves[v.index] = d * out
    return _move(hair, moves)


def under_cloth(body, tree):
    """Per body vertex: does the cloth in `tree` hide it? A ray out along the skin's normal meets cloth
    within FIT['cover_reach'], or cloth lies within FIT['near_reach'] with its inner face toward the vertex,
    or the cloth is all round it (FIT['ring']). The last two catch skin the first misses because its normal
    points along the cloth, not at it, or the cloth hangs too far off (armpits, the inside of the upper
    arm, between the legs, thighs under a skirt): that skin swung out through sleeves, jacket backs and
    skirts as soon as the body left its rest pose."""
    mw = body.matrix_world
    rot = mw.to_3x3()
    ring = [Vector((math.cos(a), math.sin(a), 0)) for a in (2 * math.pi * k / FIT['ring'] for k in range(FIT['ring']))]
    out = []
    for v in body.data.vertices:
        p = mw @ v.co
        n = (rot @ v.normal).normalized()
        hit = tree.ray_cast(p + n * 0.001, n, FIT['cover_reach'])[0] is not None
        if not hit:
            loc, nrm, _, dist = tree.find_nearest(p, FIT['near_reach'])
            hit = loc is not None and dist > 1e-6 and (p - loc).dot(nrm) / dist < -FIT['near_cone']
        if not hit:
            hit = sum(tree.ray_cast(p, d, FIT['ring_reach'])[0] is not None for d in ring) >= FIT['ring_hits']
        out.append(hit)
    return out


def cull_hidden(body, cover):
    """Deletes skin that clothes hide (under_cloth). Saves triangles, and hidden skin can't poke through
    when the body bends."""
    import bmesh
    hidden = under_cloth(body, tree_of(cover))
    bm = bmesh.new()
    bm.from_mesh(body.data)
    dead = [f for f in bm.faces if all(hidden[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(body.data)
    bm.free()


def decimate(o, ratio, keep=None):
    """Collapses `o` to `ratio` of its triangles. `keep`: bone groups to spare (the face)."""
    m = o.modifiers.new('decimate', 'DECIMATE')
    m.ratio = ratio
    m.use_collapse_triangulate = True
    if keep:
        idx = {g.index for g in o.vertex_groups if g.name in keep}
        g = o.vertex_groups.new(name='decimate')
        for v in o.data.vertices:
            g.add([v.index], 1 - 0.9 * min(1, sum(x.weight for x in v.groups if x.group in idx)), 'REPLACE')
        m.vertex_group = g.name
        m.vertex_group_factor = 1.0
    # Ahead of the armature, so the exporter applies it to the rest pose.
    with bpy.context.temp_override(object=o, active_object=o):
        bpy.ops.object.modifier_move_to_index(modifier=m.name, index=0)


def apply_masks(body):
    for m in list(body.modifiers):
        if m.type == 'MASK':
            with bpy.context.temp_override(object=body, active_object=body):
                bpy.ops.object.modifier_apply(modifier=m.name)


# ---------------------------------------------------------------------------------------------


def seat_fit(arm, objs, recline):
    """Where the seated body meets the seat: the cushion's top under the buttocks, and how far behind
    the hip point the backrest's face sits (along the backrest's normal)."""
    arm.animation_data.action = bpy.data.actions['drive']
    bpy.context.scene.frame_set(pose.STEER_KEYS // 2)
    dg = bpy.context.evaluated_depsgraph_get()
    n = Vector((0, math.cos(recline), -math.sin(recline)))
    low, back = 0.0, 0.0
    for o in objs:
        hip = {g.index for g in o.vertex_groups if g.name in ('pelvis', 'thigh_l', 'thigh_r')}
        spine = {g.index for g in o.vertex_groups if g.name in ('pelvis', 'spine_01', 'spine_02', 'spine_03')}
        me = o.evaluated_get(dg).to_mesh()
        for v, src in zip(me.vertices, o.data.vertices):
            p = o.matrix_world @ v.co
            if sum(g.weight for g in src.groups if g.group in hip) > 0.5 and p.y > -0.2:
                low = min(low, p.z)
            if sum(g.weight for g in src.groups if g.group in spine) > 0.5:
                back = max(back, p.dot(n))
        o.evaluated_get(dg).to_mesh_clear()
    return low + 0.012, back + 0.004


def resolve(kw, P):
    return {k: (P[v[1:]] if isinstance(v, str) and v.startswith('@') else v) for k, v in kw.items()}


def build(did, spec, preview=None):
    reset()
    arm, body, parts = create(spec)
    materials(spec, body, parts)
    for side in spec.get('sleeveless', []):
        sleeveless(body, parts, side)
    apply_masks(body)
    hair = parts.get(spec['hair'])
    clothes = [o for k, o in parts.items() if k in spec['clothes']]
    # The fit (FIT): cloth off the skin, trouser legs over the shoes, hair out of the collar and off the back.
    skin = tree_of([body])
    for o in clothes:
        lift(o, skin)
    shoes = [o for k, o in parts.items() if k in spec['clothes'] and k.startswith('shoes')]
    for o in clothes:
        if o in shoes:
            continue
        if spec.get('tuck'):
            for sh in shoes:
                over(sh, [o], ('calf', 'foot'))
        elif shoes:
            over(o, shoes, ('calf', 'foot'))
    if hair is not None:
        comb(hair, arm, [body, *clothes])
    cull_hidden(body, clothes)
    b = kit.Body(arm, body, clothes, hair, parts['low-poly'])
    P = kit.palette(spec['theme'])
    pieces = []
    for fn, kw in spec['kit']:
        pieces += getattr(kit, fn)(b, P, **resolve(kw, P)) or []
    for side in spec.get('sleeveless', []):
        pieces += kit.shoulder_cap(b, P, side)

    # The hands close on the rim of this driver's own wheel.
    centre, normal, up = pose.drive(arm, {**spec['drive'], 'wheel_radius': spec['wheel'].get('radius', 0.18)})
    wheel = kit.wheel(P, centre, normal, up, spec['wheel'])
    for o in wheel:
        kit.rigid(o, b, 'wheel')
    recline = math.radians(spec['drive'].get('recline', 22))
    cushion, back = seat_fit(arm, [body] + clothes, recline)
    seat = kit.seat(P, recline, spec['seat'], cushion, back)
    for o in seat:
        kit.rigid(o, b, 'seat')
    pose.ride(arm, spec.get('ride', {}))
    pose.idle(arm, spec['idle'])

    for o in clothes:
        decimate(o, 0.3 if o.name.startswith('shoes') else 0.55)
    decimate(body, 0.6, keep={'head'})
    kit.join(pieces, 'kit')
    kit.join(wheel, 'wheel')
    kit.join(seat, 'seat')
    body.name = 'body'
    for k, o in parts.items():
        o.name = k
    arm.name = did
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, did + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=False, export_apply=True,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_skins=True, export_morph=False, export_def_bones=False, export_yup=True,
        export_image_format='WEBP', export_image_quality=82, export_extras=False,
    )
    dg = bpy.context.evaluated_depsgraph_get()
    count = {o.name: len(o.evaluated_get(dg).data.loop_triangles) for o in bpy.data.objects if o.type == 'MESH'}
    print(f'DRIVER {did}: {sum(count.values())} tris, {os.path.getsize(path) / 1e6:.2f} MB -> {path}')
    print('  ' + ', '.join(f'{k} {v}' for k, v in sorted(count.items(), key=lambda kv: -kv[1])))
    if preview:
        import render
        render.previews(did, arm, os.path.join(preview, did))


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    preview = None
    if '--preview' in argv:
        i = argv.index('--preview')
        preview = argv[i + 1]
        del argv[i:i + 2]
    ids = argv or list(cast.CAST)
    for did in ids:
        build(did, cast.CAST[did], preview)


if __name__ == '__main__':
    main()
