"""Builds KANJO's drivers in Blender and exports them to public/models/drivers/<id>.glb.

    blender -b --python tools/drivers/build.py -- [ids...] [--preview DIR]

Needs Blender 5.x with the MPFB extension and the MakeHuman system assets installed (docs/DRIVERS.md).
Each driver: an MPFB human (rigged with the game-engine skeleton), MakeHuman clothes recoloured, a
kit of hard-surface parts (kit.py), a seat and a steering wheel, and two baked clips (pose.py).
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
TEX = {'body': 1024, 'clothes': 1024, 'hair': 1024, 'normal': 512, 'eyes': 256, 'small': 256}


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
        'targets': [],
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
    body = HumanService.deserialize_from_dict(info, settings)
    TargetService.bake_targets(body)
    arm = body.parent
    parts = {o.name.split('.', 1)[1]: o for o in arm.children if o.type == 'MESH' and o is not body}
    return arm, body, parts


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


def zone_masks(a, rules):
    """Soft masks of the pixels each rule picks (first rule wins), and each zone's mean luminance (the
    shade reference). The wardrobe bakes these for the client's recolour shader; recolor() uses them."""
    rgb = a[..., :3]
    h, s, v = hsv(rgb)
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    alpha = a[..., 3]
    claimed = np.zeros(lum.shape, np.float32)
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


def recolor(a, rules):
    """Repaints the pixels each rule picks (first rule wins). Returns (colour, emission or None)."""
    masks, refs, lum = zone_masks(a, rules)
    alpha = a[..., 3]
    out = a[..., :3].copy()
    emit = None
    for rule, m, ref in zip(rules, masks, refs):
        if m.sum() < 1:
            continue
        shade = np.clip(lum / max(ref, 0.02), 0.25, 1.9) ** rule.get('contrast', 1.0)
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
    diffuse = normal = None
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image:
            if 'normal' in n.image.name.lower():
                normal = n.image
            elif diffuse is None:
                diffuse = n.image
    return diffuse, normal


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


ROUGH = {'hair': 0.55, 'eyebrows': 0.7, 'eyelashes': 0.7, 'eyes': 0.1, 'body': 0.52}


def materials(spec, body, parts):
    """Replaces MPFB's materials with plain glTF-friendly ones on downscaled (and recoloured) textures."""
    rules = spec.get('recolor', {})
    for key, o in [('body', body)] + list(parts.items()):
        old = o.data.materials[0]
        diffuse, normal = images_of(old)
        if key == 'low-poly':
            diffuse = bpy.data.images.load(os.path.join(MH, 'eyes', 'materials', spec['eyes'] + '_eye.png'))
        kind = 'body' if key == 'body' else 'eyes' if key == 'low-poly' else 'small' if key.startswith(('eyebrow', 'eyelash')) else 'hair' if key == spec['hair'] else 'clothes'
        a = read(diffuse, TEX[kind])
        emit_img = None
        if key in rules:
            a, e = recolor(a, rules[key])
            if e is not None:
                emit_img = write(f'{key}_emit', e)
        col = write(f'{key}_color', a)
        nrm = write(f'{key}_normal', read(normal, TEX['normal']), True) if normal is not None and kind in ('clothes', 'hair') else None
        alpha = kind in ('hair', 'small')
        group = 'hair' if kind == 'hair' else key if key in ROUGH else 'eyebrows' if kind == 'small' else 'cloth'
        rough = ROUGH.get(group, 0.78)
        m = textured(f"{'skin' if key == 'body' else key}", col, nrm, rough, alpha, emit_img)
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


def cull_hidden(body, cover, reach=0.035):
    """Deletes skin that clothes hide: a vertex is hidden when a ray out along its normal meets cloth
    within `reach`. Saves triangles, and hidden skin can't poke through when the body bends."""
    import bmesh
    from mathutils.bvhtree import BVHTree
    verts, polys = [], []
    for o in cover:
        base = len(verts)
        verts += [o.matrix_world @ v.co for v in o.data.vertices]
        polys += [[base + i for i in p.vertices] for p in o.data.polygons]
    tree = BVHTree.FromPolygons(verts, polys)
    mw = body.matrix_world
    hidden = []
    for v in body.data.vertices:
        p = mw @ v.co
        n = (mw.to_3x3() @ v.normal).normalized()
        hidden.append(tree.ray_cast(p + n * 0.001, n, reach)[0] is not None)
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
