"""Poses for the drivers, baked into two actions the game plays:

- `drive`: seated, hip point at the origin, hands on the wheel. Frames 0..STEER_KEYS-1 sweep the wheel
  from full left lock to full right; the game scrubs the clip by its steering input.
- `idle`: standing (feet at the origin), breathing, for the garage showroom.

Arms and legs are placed by IK (the hands ride on targets parented to the wheel bone), then the whole
thing is baked to plain keys and the constraints removed, so glTF gets a normal skeletal clip.
"""

import math

import bpy
from mathutils import Matrix, Vector

STEER_KEYS = 17
#: Full lock turns the wheel this far each way (rad). Kept short of hand-over-hand, so the hands stay on.
WHEEL_LOCK = math.radians(110)
IDLE_FRAMES = 96
#: The relaxed standing arms (`hang`): hanging straight down by the sides, the hands `clear` (m) outside the
#: widest thing at the hips (body or clothes), the upper arm swung `back` (rad) behind the shoulder, the
#: elbow soft (`bend`, rad, forearm forward), palms toward the thighs and turned `palm_back` (rad) behind;
#: the outward lean is kept within `out` (rad). Michael, 2026-11-15: the arms stood out with "locked
#: elbows", hands held in front; set by direction now, not by fixed turns from the A pose.
HANG = {'clear': 0.04, 'back': math.radians(4), 'bend': math.radians(12), 'palm_back': math.radians(20),
        'out': (math.radians(3), math.radians(22))}


def update():
    bpy.context.view_layer.update()


def rot_world(arm, bone, axis, angle, about=None):
    """Rotates a pose bone by `angle` about a world `axis` through its head (or `about`)."""
    pb = arm.pose.bones[bone]
    M = pb.matrix.copy()
    h = M.translation.copy() if about is None else Vector(about)
    R = Matrix.Rotation(angle, 4, Vector(axis).normalized())
    pb.matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ M
    update()


def set_world(arm, bone, M):
    arm.pose.bones[bone].matrix = M
    update()


def rest(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.matrix_basis = Matrix()
    update()


def head(arm, bone):
    return arm.pose.bones[bone].head.copy()


def tail(arm, bone):
    return arm.pose.bones[bone].tail.copy()


def add_bone(arm, name, h, t, roll=0.0, parent='Root'):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones.new(name)
    eb.head = Vector(h)
    eb.tail = Vector(t)
    eb.roll = roll
    eb.parent = arm.data.edit_bones[parent]
    eb.use_deform = True
    bpy.ops.object.mode_set(mode='OBJECT')


def empty(name, M, parent=None, bone=None):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    if parent is not None:
        e.parent = parent
        if bone:
            e.parent_type = 'BONE'
            e.parent_bone = bone
    update()
    e.matrix_world = M
    update()
    return e


def ik(arm, bone, target, chain=2):
    c = arm.pose.bones[bone].constraints.new('IK')
    c.target = target
    c.chain_count = chain
    c.use_tail = True
    c.iterations = 500
    return c


def copy_rot(arm, bone, target):
    c = arm.pose.bones[bone].constraints.new('COPY_ROTATION')
    c.target = target
    c.target_space = 'WORLD'
    c.owner_space = 'WORLD'
    return c


# ---------------------------------------------------------------------------------------------
# Hands


def hand_frame(arm, side):
    """The hand's rest frame: fingers direction, knuckle line (pinky → index), palm normal."""
    bones = arm.data.bones
    h = bones['hand_' + side].head_local
    mid = bones['middle_01_' + side].head_local
    tip = bones['middle_03_' + side].tail_local
    d = (tip - h).normalized()
    k = (bones['index_01_' + side].head_local - bones['pinky_01_' + side].head_local)
    k = (k - d * k.dot(d)).normalized()
    p = d.cross(k).normalized()
    thumb = bones['thumb_02_' + side].head_local
    if (thumb - h).dot(p) < 0:
        p = -p
    return d, k, p, h, mid


def curl(arm, side, amount=1.0, thumb=1.0):
    """Closes the fingers toward the palm (amount 1 = a fist round a wheel rim)."""
    d, k, p, _, _ = hand_frame(arm, side)
    for f, angles in (('index', (50, 65, 45)), ('middle', (55, 68, 45)), ('ring', (58, 70, 45)), ('pinky', (62, 70, 45))):
        for i, a in enumerate(angles):
            bone = f'{f}_0{i + 1}_{side}'
            pb = arm.pose.bones[bone]
            bd = (pb.tail - pb.head).normalized()
            pal = arm.pose.bones['hand_' + side].matrix.to_3x3() @ (arm.data.bones['hand_' + side].matrix_local.to_3x3().inverted() @ p)
            axis = bd.cross(pal).normalized()
            rot_world(arm, bone, axis, math.radians(a * amount))
    for i, a in enumerate((22, 28, 30)):
        bone = f'thumb_0{i + 1}_{side}'
        pb = arm.pose.bones[bone]
        bd = (pb.tail - pb.head).normalized()
        pal = arm.pose.bones['hand_' + side].matrix.to_3x3() @ (arm.data.bones['hand_' + side].matrix_local.to_3x3().inverted() @ p)
        axis = bd.cross(pal).normalized()
        rot_world(arm, bone, axis, math.radians(a * thumb))


def grip_matrix(arm, side, g, k_t, p_t):
    """Where the hand bone must be (world matrix) so its palm wraps a rim at `g`, knuckles along
    `k_t`, palm facing `p_t`."""
    d_r, k_r, p_r, h, mid = hand_frame(arm, side)
    p_t = (p_t - k_t * p_t.dot(k_t)).normalized()
    handed = 1 if (k_r.cross(p_r)).dot(d_r) > 0 else -1
    d_t = k_t.cross(p_t) * handed
    Rr = Matrix((d_r, k_r, p_r)).transposed()
    Rt = Matrix((d_t, k_t, p_t)).transposed()
    R = Rt @ Rr.inverted()
    bone_rest = arm.data.bones['hand_' + side].matrix_local.to_3x3()
    # The rim runs through the curled fist: a little past the knuckles, just off the palm.
    grip_rest = h.lerp(mid, 0.85) + p_r * 0.028 + d_r * 0.012
    wrist = g - R @ (grip_rest - h)
    M = (R @ bone_rest).to_4x4()
    M.translation = wrist
    return M


# ---------------------------------------------------------------------------------------------
# Drive


def drive(arm, spec):
    """Builds the seated pose and bakes the steering sweep into the action 'drive'. Returns the
    wheel's frame (centre, normal toward the driver, 12 o'clock) for the wheel mesh."""
    recline = math.radians(spec.get('recline', 22))
    rest(arm)
    bones = arm.data.bones
    hip_rest = (bones['thigh_l'].head_local + bones['thigh_r'].head_local) / 2
    X = Vector((1, 0, 0))

    # Pelvis to the hip point, reclined; spine curls forward a touch; head comes back to level.
    M = arm.pose.bones['pelvis'].matrix.copy()
    set_world(arm, 'pelvis', Matrix.Rotation(-recline, 4, 'X') @ Matrix.Translation(-hip_rest) @ M)
    rot_world(arm, 'spine_01', X, math.radians(5))
    rot_world(arm, 'spine_02', X, math.radians(4))
    rot_world(arm, 'spine_03', X, math.radians(3))
    rot_world(arm, 'neck_01', X, math.radians(7))
    rot_world(arm, 'head', X, math.radians(recline * 180 / math.pi - 25 + spec.get('chin', 0)))

    # Thighs forward and a little apart, knees bent: a start the IK refines.
    for s, sx in (('l', 1), ('r', -1)):
        rot_world(arm, 'thigh_' + s, X, math.radians(-92) + recline)
        rot_world(arm, 'thigh_' + s, Vector((0, 0, 1)), math.radians(sx * 6))
        rot_world(arm, 'calf_' + s, X, math.radians(85))
    # Arms forward to the wheel, elbows bent.
    for s, sx in (('l', 1), ('r', -1)):
        rot_world(arm, 'upperarm_' + s, Vector((0, 1, 0)), math.radians(sx * 25))
        rot_world(arm, 'upperarm_' + s, X, math.radians(-35))
        rot_world(arm, 'lowerarm_' + s, X, math.radians(-30))
    for s in ('l', 'r'):
        curl(arm, s, 1.0, 1.0)

    # The wheel: in front of the chest, reached with the elbows comfortably bent.
    sh = (head(arm, 'upperarm_l') + head(arm, 'upperarm_r')) / 2
    arm_len = (bones['upperarm_l'].length + bones['lowerarm_l'].length)
    tilt = math.radians(spec.get('wheel_tilt', 24))
    normal = Vector((0, math.cos(tilt), math.sin(tilt)))  # toward the driver, and up
    up = Vector((0, -math.sin(tilt), math.cos(tilt)))  # 12 o'clock
    R = spec.get('wheel_radius', 0.18)
    reach = spec.get('reach', 0.95) * arm_len
    centre = Vector((0, sh.y - math.sqrt(max(0.01, reach ** 2 - R ** 2 - 0.12 ** 2)), sh.z - spec.get('wheel_drop', 0.12)))
    add_bone(arm, 'wheel', centre, centre + normal * 0.1, 0.0)
    add_bone(arm, 'seat', Vector((0, 0, 0)), Vector((0, 0, 0.1)), 0.0)
    update()
    # Re-apply the pose (edit mode resets nothing, but make sure the new bones are quaternion).
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'

    u = up.cross(normal).normalized()  # 3 o'clock: the driver's right, -X
    targets = {}
    for s, phi in (('l', math.pi), ('r', 0.0)):
        # φ measured from 3 o'clock, counter-clockwise as the driver sees it.
        rdir = u * math.cos(phi) + up * math.sin(phi)
        g = centre + rdir * R
        # Index finger uppermost, palm toward the hub and a little forward over the rim.
        p_t = (-rdir * 0.75 - normal * 0.65).normalized()
        Mh = grip_matrix(arm, s, g, up.copy(), p_t)
        e = empty('grip_' + s, Mh, arm, 'wheel')
        targets[s] = e
    # Feet: right on the throttle, left on the rest, heels on the floor.
    leg = bones['thigh_l'].length + bones['calf_l'].length
    feet = {}
    for s, sx in (('l', 1), ('r', -1)):
        dirv = Vector((sx * 0.1, -0.93, -0.38)).normalized()
        at = Vector((sx * spec.get('knees', 0.16), 0, 0)) + dirv * leg * spec.get('legs', 0.78)
        Mf = Matrix.Rotation(math.radians(-38), 4, 'X') @ Matrix(bones['foot_' + s].matrix_local.to_3x3()).to_4x4()
        Mf.translation = at
        feet[s] = empty('foot_' + s, Mf)
    for s in ('l', 'r'):
        ik(arm, 'lowerarm_' + s, targets[s])
        copy_rot(arm, 'hand_' + s, targets[s])
        ik(arm, 'calf_' + s, feet[s])
        copy_rot(arm, 'foot_' + s, feet[s])
    update()

    # Key the base pose on every frame with the wheel turned, then bake what the IK makes of it.
    act = bpy.data.actions.new('drive')
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    base = {pb.name: pb.matrix_basis.copy() for pb in arm.pose.bones}
    look = math.radians(spec.get('look', 18))
    for f in range(STEER_KEYS):
        s = -1 + 2 * f / (STEER_KEYS - 1)  # -1 full left, +1 full right
        bpy.context.scene.frame_set(f)
        for pb in arm.pose.bones:
            pb.matrix_basis = base[pb.name]
        update()
        # Turning left spins the wheel anticlockwise (as the driver sees it): +angle about its axis.
        wb = arm.pose.bones['wheel']
        wb.rotation_quaternion = (Matrix.Rotation(-s * WHEEL_LOCK, 4, 'Y')).to_quaternion()
        update()
        # The eyes go to the apex: head and neck turn into the bend, the shoulders lean a touch.
        rot_world(arm, 'neck_01', Vector((0, 0, 1)), -s * look * 0.4)
        rot_world(arm, 'head', Vector((0, 0, 1)), -s * look * 0.6)
        rot_world(arm, 'spine_03', Vector((0, 1, 0)), s * math.radians(3))
        for pb in arm.pose.bones:
            pb.keyframe_insert('location', frame=f)
            pb.keyframe_insert('rotation_quaternion', frame=f)
    bake(arm, 0, STEER_KEYS - 1)
    for e in list(targets.values()) + list(feet.values()):
        bpy.data.objects.remove(e)
    return centre, normal, up


# ---------------------------------------------------------------------------------------------
# Ride

#: The bike's touch points from the saddle (hip point at the origin, Blender axes: forward -Y), from
#: src/kanjo/client/bikemodel.ts: grips 0.82 m ahead and 0.3 m out, pegs just behind and 0.48 m down.
BIKE = {'grip': (0.3, -0.82, -0.02), 'peg': (0.2, 0.08, -0.48)}


def ride(arm, spec):
    """Tucked over a sport bike's tank, hands on the bars, feet on the pegs: the action 'ride'
    (two identical keys; the bike's bars turn only a little, so the hands stay put)."""
    arm.animation_data_create()
    arm.animation_data.action = None
    rest(arm)
    bones = arm.data.bones
    hip_rest = (bones['thigh_l'].head_local + bones['thigh_r'].head_local) / 2
    X, Z = Vector((1, 0, 0)), Vector((0, 0, 1))
    lean = math.radians(spec.get('lean', 24))
    M = arm.pose.bones['pelvis'].matrix.copy()
    set_world(arm, 'pelvis', Matrix.Rotation(lean, 4, 'X') @ Matrix.Translation(-hip_rest) @ M)
    for b, a in (('spine_01', 9), ('spine_02', 9), ('spine_03', 8)):
        rot_world(arm, b, X, math.radians(a))
    # Chin up to see the road over the screen.
    rot_world(arm, 'neck_01', X, math.radians(-22))
    rot_world(arm, 'head', X, math.radians(-30))
    for s, sx in (('l', 1), ('r', -1)):
        rot_world(arm, 'thigh_' + s, X, math.radians(-52))
        rot_world(arm, 'thigh_' + s, Z, math.radians(sx * 9))
        rot_world(arm, 'calf_' + s, X, math.radians(105))
        rot_world(arm, 'upperarm_' + s, Vector((0, 1, 0)), math.radians(sx * 30))
        rot_world(arm, 'upperarm_' + s, X, math.radians(-55))
        rot_world(arm, 'lowerarm_' + s, X, math.radians(-15))
        curl(arm, s, 1.0, 0.8)
    gx, gy, gz = BIKE['grip']
    px, py, pz = BIKE['peg']
    targets = []
    for s, sx in (('l', 1), ('r', -1)):
        # Knuckles along the grip, index finger inboard, palm over the top of it.
        Mh = grip_matrix(arm, s, Vector((sx * gx, gy, gz)), Vector((-sx, 0, 0)), Vector((0, -0.5, -0.85)).normalized())
        hand = empty('rgrip_' + s, Mh)
        Mf = Matrix.Rotation(math.radians(18), 4, 'X') @ Matrix(bones['foot_' + s].matrix_local.to_3x3()).to_4x4()
        Mf.translation = Vector((sx * px, py, pz))
        foot = empty('rpeg_' + s, Mf)
        ik(arm, 'lowerarm_' + s, hand)
        copy_rot(arm, 'hand_' + s, hand)
        ik(arm, 'calf_' + s, foot)
        copy_rot(arm, 'foot_' + s, foot)
        targets += [hand, foot]
    update()
    act = bpy.data.actions.new('ride')
    act.use_fake_user = True
    arm.animation_data.action = act
    for f in (0, 1):
        bpy.context.scene.frame_set(f)
        for pb in arm.pose.bones:
            pb.keyframe_insert('location', frame=f)
            pb.keyframe_insert('rotation_quaternion', frame=f)
    bake(arm, 0, 1)
    for e in targets:
        bpy.data.objects.remove(e)


def bake(arm, f0, f1, step=1):
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, step=step, only_selected=True, visual_keying=True, clear_constraints=True, use_current_action=True, bake_types={'POSE'})
    bpy.ops.object.mode_set(mode='OBJECT')


# ---------------------------------------------------------------------------------------------
# Idle


ARM_BONES = ('clavicle', 'upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')


def aim(arm, bone, d):
    """Turns a pose bone (by the shortest way) so it points along `d` (armature space)."""
    pb = arm.pose.bones[bone]
    cur = (pb.tail - pb.head).normalized()
    axis = cur.cross(d)
    if axis.length > 1e-6:
        rot_world(arm, bone, axis, cur.angle(d))


def hip_width(arm, side, sx, z):
    """How far out (armature x, on `side`) the meshes on `arm` reach around height `z`, arms left out."""
    inv = arm.matrix_world.inverted()
    w = 0.0
    for o in bpy.data.objects:
        if o.type != 'MESH' or o.find_armature() is not arm:
            continue
        armish = {g.index for g in o.vertex_groups if g.name.startswith(ARM_BONES)}
        M = inv @ o.matrix_world
        for v in o.data.vertices:
            if sum(g.weight for g in v.groups if g.group in armish) > 0.3:
                continue
            p = M @ v.co
            if abs(p.z - z) < 0.12:
                w = max(w, sx * p.x)
    return w


def palm(arm, side):
    """The hand's palm normal as posed."""
    _, _, p, _, _ = hand_frame(arm, side)
    rest = arm.data.bones['hand_' + side].matrix_local.to_3x3()
    return (arm.pose.bones['hand_' + side].matrix.to_3x3() @ (rest.inverted() @ p)).normalized()


def hang(arm, s, sx):
    """Arm `s` hanging relaxed by the side (HANG): straight down past the hips, elbow soft, palm in."""
    up, lo = 'upperarm_' + s, 'lowerarm_' + s
    sh = head(arm, up)
    length = arm.data.bones[up].length + arm.data.bones[lo].length
    hips = hip_width(arm, s, sx, sh.z - length)
    out = math.asin(max(-1.0, min(1.0, (hips + HANG['clear'] - sx * sh.x) / length)))
    out = max(HANG['out'][0], min(HANG['out'][1], out))
    down = Vector((sx * math.sin(out), 0, -math.cos(out)))
    aim(arm, up, (down + Vector((0, math.sin(HANG['back']), 0))).normalized())
    fore = (down + Vector((0, -math.sin(HANG['bend']), 0))).normalized()
    aim(arm, lo, fore)
    # Palm toward the thigh: turn the whole arm about its length (the forearm has no twist bone), then put
    # the forearm back on its line.
    want = Vector((-sx * math.cos(HANG['palm_back']), math.sin(HANG['palm_back']), 0))
    for _ in range(2):
        u = (arm.pose.bones[up].tail - arm.pose.bones[up].head).normalized()
        p, w = palm(arm, s), want - u * want.dot(u)
        p = p - u * p.dot(u)
        if p.length > 1e-4 and w.length > 1e-4:
            ang = p.angle(w)
            if p.cross(w).dot(u) < 0:
                ang = -ang
            rot_world(arm, up, u, ang)
        aim(arm, lo, fore)
    curl(arm, s, 0.35, 0.3)


def idle(arm, spec):
    """A relaxed stand with a slow breathing loop; `spec['stance']` picks the arms."""
    arm.animation_data_create()
    arm.animation_data.action = None
    rest(arm)
    stance = spec.get('stance', 'relaxed')
    X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
    # Weight on one leg: the hips shift and drop on the other side; the feet stay planted by IK.
    feet = {}
    for s in ('l', 'r'):
        M = arm.pose.bones['foot_' + s].matrix.copy()
        feet[s] = empty('ifoot_' + s, M)
    w = spec.get('weight', 1)
    M = arm.pose.bones['pelvis'].matrix.copy()
    set_world(arm, 'pelvis', Matrix.Translation((w * 0.03, 0, -0.012)) @ M)
    rot_world(arm, 'pelvis', Y, math.radians(-w * 3))
    rot_world(arm, 'spine_02', Y, math.radians(w * 2.5))
    rot_world(arm, 'spine_03', Y, math.radians(w * 1.5))
    rot_world(arm, 'head', Z, math.radians(spec.get('head_turn', 8)))
    rot_world(arm, 'head', Y, math.radians(-w * 2))
    rot_world(arm, 'head', X, math.radians(spec.get('chin_idle', 0)))
    for s in ('l', 'r'):
        rot_world(arm, 'thigh_' + s, X, math.radians(-3))
    targets = []
    for s, sx in (('l', 1), ('r', -1)):
        a = stance if isinstance(stance, str) else stance[s]
        if a in ('relaxed', 'pocket'):
            hang(arm, s, sx)
        elif a == 'hip':
            # Hand on the hip, elbow out.
            hip = head(arm, 'thigh_' + s) + Vector((sx * 0.07, 0.0, 0.1))
            rot_world(arm, 'upperarm_' + s, Y, math.radians(sx * 14))
            rot_world(arm, 'lowerarm_' + s, X, math.radians(-10))
            M = arm.pose.bones['hand_' + s].matrix.copy()
            Mh = Matrix.Rotation(math.radians(sx * 70), 4, 'Y') @ Matrix(M.to_3x3()).to_4x4()
            Mh = Matrix.Rotation(math.radians(-25), 4, 'X') @ Mh
            Mh.translation = hip + Vector((sx * 0.02, 0.02, 0.0))
            e = empty('ihand_' + s, Mh)
            ik(arm, 'lowerarm_' + s, e)
            copy_rot(arm, 'hand_' + s, e)
            targets.append(e)
            curl(arm, s, 0.4, 0.2)
        elif a == 'behind':
            # Hands clasped behind the back, at the small of it.
            back = head(arm, 'pelvis') + Vector((sx * 0.04, 0.17, 0.08))
            rot_world(arm, 'upperarm_' + s, Y, math.radians(sx * 30))
            rot_world(arm, 'upperarm_' + s, X, math.radians(20))
            M = arm.pose.bones['hand_' + s].matrix.copy()
            Mh = Matrix.Rotation(math.radians(sx * 90), 4, 'Z') @ Matrix(M.to_3x3()).to_4x4()
            Mh.translation = back
            e = empty('ihand_' + s, Mh)
            ik(arm, 'lowerarm_' + s, e)
            copy_rot(arm, 'hand_' + s, e)
            targets.append(e)
            curl(arm, s, 0.6, 0.4)
    for s in ('l', 'r'):
        ik(arm, 'calf_' + s, feet[s])
        copy_rot(arm, 'foot_' + s, feet[s])
    update()
    act = bpy.data.actions.new('idle')
    act.use_fake_user = True
    arm.animation_data.action = act
    base = {pb.name: pb.matrix_basis.copy() for pb in arm.pose.bones}
    for f in range(0, IDLE_FRAMES + 1, 8):
        ph = 2 * math.pi * f / IDLE_FRAMES
        bpy.context.scene.frame_set(f)
        for pb in arm.pose.bones:
            pb.matrix_basis = base[pb.name]
        update()
        # Breathe in and out twice a loop; sway a little once.
        b = math.sin(2 * ph)
        rot_world(arm, 'spine_02', X, math.radians(-0.8 * b))
        rot_world(arm, 'spine_03', X, math.radians(-0.9 * b))
        rot_world(arm, 'clavicle_l', Y, math.radians(-0.8 * b))
        rot_world(arm, 'clavicle_r', Y, math.radians(0.8 * b))
        rot_world(arm, 'pelvis', Z, math.radians(1.2 * math.sin(ph)))
        rot_world(arm, 'head', Z, math.radians(2.5 * math.sin(ph + 0.6)))
        for pb in arm.pose.bones:
            pb.keyframe_insert('location', frame=f)
            pb.keyframe_insert('rotation_quaternion', frame=f)
    bake(arm, 0, IDLE_FRAMES, 4)
    for e in targets + list(feet.values()):
        bpy.data.objects.remove(e)
