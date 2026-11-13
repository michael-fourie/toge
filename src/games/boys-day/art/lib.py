# Helpers for the Boys Day models: every asset is one mesh with vertex colours (no textures), smooth and bevelled.
import bpy, bmesh, math, os
from mathutils import Vector, Euler

def reset():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for b in list(coll):
            if b.users == 0:
                coll.remove(b)

def hexc(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]

def _finish(o, color, bevel=0.0, sub=0, smooth=True):
    if sub:
        m = o.modifiers.new('sub', 'SUBSURF'); m.levels = sub; m.render_levels = sub
    if bevel:
        m = o.modifiers.new('bev', 'BEVEL'); m.width = bevel; m.segments = 2; m.limit_method = 'ANGLE'
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    me = o.data
    ca = me.color_attributes.new('Color', 'FLOAT_COLOR', 'CORNER')
    c = hexc(color)
    for d in ca.data:
        d.color = c
    for p in me.polygons:
        p.use_smooth = smooth
    return o

def _new(loc, rot, scale):
    o = bpy.context.view_layer.objects.active
    o.location = loc; o.rotation_euler = Euler(rot); o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o

def box(color, size, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.04, sub=0, smooth=True):
    bpy.ops.mesh.primitive_cube_add(size=1)
    return _finish(_new(loc, rot, size), color, bevel, sub, smooth)

def ball(color, size, loc=(0, 0, 0), rot=(0, 0, 0), seg=16):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, segments=seg, ring_count=max(6, seg // 2))
    return _finish(_new(loc, rot, size), color)

def blob(color, size, loc=(0, 0, 0), rot=(0, 0, 0), sub=2):
    """A soft rounded box: a subdivided cube."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    return _finish(_new(loc, rot, size), color, 0, sub)

def cyl(color, r, h, loc=(0, 0, 0), rot=(0, 0, 0), r2=None, seg=12, bevel=0.0, smooth=True):
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    return _finish(_new(loc, rot, (1, 1, 1)), color, bevel, 0, smooth)

def ico(color, size, loc=(0, 0, 0), rot=(0, 0, 0), sub=1, smooth=False, jitter=0.0, seed=1):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=0.5, subdivisions=sub)
    o = _new(loc, rot, size)
    if jitter:
        import random
        r = random.Random(seed)
        for v in o.data.vertices:
            v.co *= 1 + (r.random() - 0.5) * jitter
    return _finish(o, color, 0, 0, smooth)

def shade(o, bottom, top):
    """Darken toward the bottom, lighten toward the top (a baked gradient), multiplying the colour."""
    me = o.data
    zs = [v.co.z for v in me.vertices]
    lo, hi = min(zs), max(zs)
    ca = me.color_attributes['Color']
    for l in me.loops:
        t = (me.vertices[l.vertex_index].co.z - lo) / max(1e-6, hi - lo)
        k = bottom + (top - bottom) * t
        c = ca.data[l.index].color
        ca.data[l.index].color = (c[0] * k, c[1] * k, c[2] * k, 1)
    return o

def join(name, parts, grad=(0.72, 1.08)):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for p in parts:
        bpy.context.view_layer.objects.active = p
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name; o.data.name = name
    if grad:
        shade(o, *grad)
    o.select_set(False)
    return o

def export(path):
    for o in bpy.context.view_layer.objects:
        o.select_set(o.type == 'MESH')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_materials='NONE', export_normals=True,
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_texcoords=False)

def preview(path, names=None, cols=6, gap=3.0, res=(1600, 900), bg='#2a2440', close=None, side=False):
    """Lays the assets out in a grid (copies), lights them and renders a PNG."""
    sc = bpy.context.scene
    objs = [o for o in sc.objects if o.type == 'MESH' and (names is None or o.name in names)]
    mat = bpy.data.materials.new('vc'); mat.use_nodes = True
    nt = mat.node_tree; b = nt.nodes['Principled BSDF']
    a = nt.nodes.new('ShaderNodeVertexColor'); a.layer_name = 'Color'
    nt.links.new(a.outputs['Color'], b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.85
    hidden = [o for o in sc.objects if o.type == 'MESH']
    for o in hidden:
        o.hide_render = True
    made = []
    for i, o in enumerate(objs):
        c = o.copy(); c.data = o.data.copy(); sc.collection.objects.link(c)
        c.hide_render = False
        c.data.materials.clear(); c.data.materials.append(mat)
        c.location = ((i % cols) * gap, -(i // cols) * gap * 1.2, 0)
        made.append(c)
    rows = (len(objs) - 1) // cols + 1
    cx, cy = (min(cols, len(objs)) - 1) * gap / 2, -(rows - 1) * gap * 1.2 / 2
    bpy.ops.mesh.primitive_plane_add(size=200, location=(cx, cy, 0)); floor = bpy.context.view_layer.objects.active
    fm = bpy.data.materials.new('floor'); fm.use_nodes = True
    fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = hexc('#3b3557')
    floor.data.materials.append(fm); made.append(floor)
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 10)); sun = bpy.context.view_layer.objects.active
    sun.data.energy = 3.5; sun.rotation_euler = Euler((math.radians(50), 0, math.radians(35))); made.append(sun)
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 10)); fill = bpy.context.view_layer.objects.active
    fill.data.energy = 1.2; fill.data.color = (0.6, 0.7, 1); fill.rotation_euler = Euler((math.radians(60), 0, math.radians(-140))); made.append(fill)
    span = max(cols * gap, rows * gap * 1.6)
    bpy.ops.object.camera_add(location=(cx + span * 0.2, cy - span * 1.15, span * 0.75)); cam = bpy.context.view_layer.objects.active
    look = Vector((cx, cy, 1.0))
    if close:
        # (height looked at, distance, camera height): a three-quarter view from the front (+Y), or from the side.
        look = Vector((cx, cy, close[0]))
        cam.location = (cx + close[1], cy + (0.25 if side else 1.0) * close[1] * (0.4 if side else 1), close[2]) if side else (cx + close[1] * 0.45, cy + close[1], close[2])
    d = look - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler(); cam.data.lens = 34; made.append(cam)
    sc.camera = cam
    w = bpy.data.worlds.new('w'); w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = hexc(bg); sc.world = w
    for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            sc.render.engine = eng; break
        except Exception:
            pass
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path; sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    for o in made:
        bpy.data.objects.remove(o, do_unlink=True)
    for o in hidden:
        o.hide_render = False

def pose(name, parts):
    """A preview-only copy: parts as (source name, location, rotation), joined."""
    cs = []
    for src, loc, rot in parts:
        o = bpy.data.objects[src]; c = o.copy(); c.data = o.data.copy(); bpy.context.scene.collection.objects.link(c)
        c.location = loc; c.rotation_euler = Euler(rot); cs.append(c)
    return join(name, cs, grad=None)

def tube(color, a, b, r, r2=None, seg=8, smooth=True):
    """A cylinder (or cone) from point a to point b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r, radius2=r if r2 is None else r2, depth=d.length)
    o = bpy.context.view_layer.objects.active
    o.location = (a + b) / 2
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return _finish(o, color, 0, 0, smooth)

def ring(color, R_, r, loc=(0, 0, 0), rot=(0, 0, 0), seg=16, arc=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=R_, minor_radius=r, major_segments=seg, minor_segments=6)
    return _finish(_new(loc, rot, (1, 1, 1)), color)
