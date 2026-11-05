"""Preview renders of a built driver (EEVEE): standing idle (full body and face) and seated in the
drive pose at centre and full lock. Only used while designing; the game never sees these."""

import math

import bpy
from mathutils import Vector


def _light(sc, name, loc, energy, color, size=1.5, aim=(0, 0, 1.0)):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = energy
    d.color = color
    d.size = size
    o = bpy.data.objects.new(name, d)
    o.location = loc
    sc.collection.objects.link(o)
    o.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()


def _setup(sc):
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 800
    sc.render.resolution_y = 1000
    sc.view_settings.view_transform = 'AgX'
    if not sc.world:
        sc.world = bpy.data.worlds.new('w')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.03, 0.035, 0.045, 1)
    _light(sc, 'key', (-2.2, -3.0, 2.8), 380, (1, 0.95, 0.88))
    _light(sc, 'fill', (2.8, -2.2, 1.4), 110, (0.8, 0.88, 1.0))
    _light(sc, 'rimc', (-2.5, 2.5, 2.2), 300, (0.25, 0.75, 1.0))
    _light(sc, 'rimm', (2.5, 2.5, 2.2), 220, (1.0, 0.25, 0.6))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def _shoot(sc, cam, path, target, dist, lens, yaw, pitch=0.08):
    cam.data.lens = lens
    target = Vector(target)
    cam.location = target + Vector((math.sin(yaw) * dist, -math.cos(yaw) * dist, dist * pitch))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def _show(prefixes, on):
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.name.startswith(prefixes):
            o.hide_render = not on


def previews(did, arm, prefix, views=('idle', 'face', 'drive', 'lock', 'top')):
    sc = bpy.context.scene
    cam = _setup(sc)
    acts = {a.name.split('.')[0]: a for a in bpy.data.actions}
    head_z = (arm.matrix_world @ arm.data.bones['head'].head_local).z + 0.08
    if {'idle', 'face'} & set(views):
        arm.animation_data.action = acts['idle']
        sc.frame_set(24)
        _show(('seat', 'wheel'), False)
        if 'idle' in views:
            _shoot(sc, cam, prefix + '_idle.png', (0, 0, head_z * 0.52), 5.0, 50, 0.45)
            _shoot(sc, cam, prefix + '_back.png', (0, 0, head_z * 0.52), 5.0, 50, math.pi - 0.5)
        if 'face' in views:
            _shoot(sc, cam, prefix + '_face.png', (0, -0.05, head_z - 0.02), 1.0, 85, 0.4, 0.02)
    if {'drive', 'lock', 'top'} & set(views):
        arm.animation_data.action = acts['drive']
        _show(('seat', 'wheel'), True)
        sc.frame_set(8)
        if 'drive' in views:
            _shoot(sc, cam, prefix + '_drive.png', (0, -0.2, 0.45), 3.4, 50, 1.25, 0.15)
            _shoot(sc, cam, prefix + '_drive_front.png', (0, -0.2, 0.55), 3.0, 50, 0.35, 0.25)
            _shoot(sc, cam, prefix + '_hands.png', (0, -0.3, 0.42), 1.3, 50, 0.25, 0.35)
        if 'lock' in views:
            sc.frame_set(0)
            _shoot(sc, cam, prefix + '_lock.png', (0, -0.2, 0.55), 3.0, 50, 0.35, 0.25)
        if 'ride' in acts:
            arm.animation_data.action = acts['ride']
            _show(('seat', 'wheel'), False)
            sc.frame_set(0)
            _shoot(sc, cam, prefix + '_ride.png', (0, -0.3, 0.1), 3.4, 50, 1.4, 0.1)
            arm.animation_data.action = acts['drive']
            _show(('seat', 'wheel'), True)
        if 'top' in views:
            sc.frame_set(8)
            _shoot(sc, cam, prefix + '_top.png', (0, -0.2, 0.4), 3.2, 50, 2.6, 0.6)
