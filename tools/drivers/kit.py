"""Hard-surface kit for the drivers: fitting helpers (rings cast onto the body, bands, lofts) and the
pieces themselves (goggles, monocle, respirator, collars, bracers, mechanical arms, pauldrons, belts,
harness straps, implants, gloves), plus each driver's seat and steering wheel.

Everything is built in the rest pose in world space (metres, Z up, the driver faces -Y) and then bound
to the rig: `rigid(obj, bone)` for hard parts, `skin(obj)` to copy weights from the body for anything
that should bend with it.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

# ---------------------------------------------------------------------------------------------
# Materials (flat PBR, so they survive the trip to glTF)


def hexrgb(h):
    h = h.lstrip('#')
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


_MATS = {}


def mat(name, color='#ffffff', rough=0.5, metal=0.0, emit=None, strength=0.0, alpha=1.0, coat=0.0):
    """A Principled material, made once per name. `emit` glows (strength > 1 blooms in the race)."""
    if name in _MATS and _MATS[name].name in bpy.data.materials:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*hexrgb(color), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if coat:
        p.inputs['Coat Weight'].default_value = coat
    if emit:
        p.inputs['Emission Color'].default_value = (*hexrgb(emit), 1)
        p.inputs['Emission Strength'].default_value = strength
    if alpha < 1:
        p.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
    m.diffuse_color = (*hexrgb(color), 1)
    _MATS[name] = m
    return m


#: How metallic the kit's metals are (1 is a mirror of the scene; the cartoon look wants mostly paint).
METAL = 0.55


def palette(theme):
    """The shared metals and leathers, plus one glow colour per driver."""
    # Toy-box versions: pale, satin, only part metal (METAL), so they sit with the soft cartoon bodies
    # instead of mirroring the scene; the darkest ("black" leather, gunmetal, carbon) are dusky, not black.
    return {
        'brass': mat('brass', '#e0c68c', 0.42, METAL),
        'brass_dark': mat('brass_dark', '#b0956e', 0.5, METAL),
        'copper': mat('copper', '#daa993', 0.44, METAL),
        'steel': mat('steel', '#bfc3cb', 0.4, METAL),
        'gunmetal': mat('gunmetal', '#737885', 0.46, METAL),
        'chrome': mat('chrome', '#e7eaed', 0.2, 0.85),
        'carbon': mat('carbon', '#555764', 0.4, 0.2, coat=0.6),
        'leather': mat('leather', '#8e7365', 0.7),
        'leather_black': mat('leather_black', '#54515a', 0.65),
        'leather_tan': mat('leather_tan', '#c7a789', 0.72),
        'rubber': mat('rubber', '#494950', 0.85),
        'wood': mat('wood', '#a98468', 0.5, coat=0.5),
        'glass': mat('glass', '#37404a', 0.1, 0.0, alpha=0.5),
        'glow': mat('glow_' + theme.lstrip('#'), theme, 0.4, 0.0, emit=theme, strength=4.0),
        'glow_soft': mat('glowsoft_' + theme.lstrip('#'), theme, 0.4, 0.0, emit=theme, strength=1.6),
        'lens': mat('lens_' + theme.lstrip('#'), '#232c3a', 0.1, 0.0, emit=theme, strength=2.2),
    }


# ---------------------------------------------------------------------------------------------
# Meshes


def new_obj(name, verts, faces, material, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(material)
    for p in me.polygons:
        p.use_smooth = smooth
    return o


def from_bmesh(name, bm, material, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(material)
    for p in me.polygons:
        p.use_smooth = smooth
    return o


def frame(axis, up=None):
    """An orthonormal (u, v, w) with w along `axis`."""
    w = Vector(axis).normalized()
    ref = Vector(up) if up is not None else (Vector((0, 0, 1)) if abs(w.z) < 0.9 else Vector((0, 1, 0)))
    u = ref.cross(w).normalized()
    v = w.cross(u).normalized()
    return u, v, w


def place(o, at, axis, up=None, spin=0.0):
    """Orients a mesh built around its local Z so local Z points along `axis`, then moves it to `at`."""
    u, v, w = frame(axis, up)
    m = Matrix((u, v, w)).transposed().to_4x4()
    if spin:
        m = m @ Matrix.Rotation(spin, 4, 'Z')
    o.data.transform(m)
    o.data.transform(Matrix.Translation(Vector(at)))
    o.data.update()
    return o


def cylinder(name, r, depth, material, seg=24, r2=None, cap=True):
    """Along local Z from -depth/2 to depth/2. `r2` tapers the top."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    return from_bmesh(name, bm, material)


def torus(name, R, r, material, seg=32, rseg=10, arc=2 * math.pi):
    """In the local XY plane."""
    verts, faces = [], []
    closed = arc >= 2 * math.pi - 1e-6
    n = seg if closed else seg + 1
    for i in range(n):
        a = arc * i / seg
        c = Vector((math.cos(a), math.sin(a), 0))
        for j in range(rseg):
            b = 2 * math.pi * j / rseg
            verts.append(c * (R + r * math.cos(b)) + Vector((0, 0, r * math.sin(b))))
    for i in range(seg):
        i2 = (i + 1) % n
        for j in range(rseg):
            j2 = (j + 1) % rseg
            faces.append((i * rseg + j, i2 * rseg + j, i2 * rseg + j2, i * rseg + j2))
    return new_obj(name, verts, faces, material)


def sphere(name, r, material, seg=16, rings=8, squash=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * squash[0], v.co.y * squash[1], v.co.z * squash[2]))
    return from_bmesh(name, bm, material)


def box(name, size, material, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    o = from_bmesh(name, bm, material, smooth=False)
    if bevel:
        bev(o, bevel, 2)
    return o


def gear(name, teeth, R, depth, material, hole=0.35, tooth=0.14):
    """A spur gear in the local XY plane: `teeth` teeth of height `tooth`·R, a centre hole of `hole`·R."""
    prof, inner = [], []
    for k in range(teeth):
        for f, rr in ((0.0, 1 - tooth), (0.18, 1.0), (0.5, 1.0), (0.68, 1 - tooth)):
            a = 2 * math.pi * (k + f) / teeth
            prof.append(Vector((math.cos(a), math.sin(a), 0)) * R * rr)
            inner.append(Vector((math.cos(a), math.sin(a), 0)) * R * hole)
    n = len(prof)
    verts, faces = [], []
    for z in (-depth / 2, depth / 2):
        verts += [p + Vector((0, 0, z)) for p in prof]
        verts += [p + Vector((0, 0, z)) for p in inner]
    P0, I0, P1, I1 = 0, n, 2 * n, 3 * n
    for i in range(n):
        j = (i + 1) % n
        faces.append((P1 + i, P1 + j, I1 + j, I1 + i))  # top
        faces.append((P0 + j, P0 + i, I0 + i, I0 + j))  # bottom
        faces.append((P0 + i, P0 + j, P1 + j, P1 + i))  # teeth wall
        faces.append((I0 + j, I0 + i, I1 + i, I1 + j))  # hole wall
    return new_obj(name, verts, faces, material, smooth=False)


def tube(name, pts, r, material, seg=8, closed=False):
    """A round tube through `pts` (rotation-minimising frames)."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    verts, faces = [], []
    prev_u = None
    for i, p in enumerate(pts):
        a = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        if closed:
            a = pts[(i + 1) % n] - pts[(i - 1) % n]
        t = a.normalized()
        if prev_u is None:
            u, _, _ = frame(t)
        else:
            u = (prev_u - t * prev_u.dot(t)).normalized()
        prev_u = u
        v = t.cross(u)
        for j in range(seg):
            b = 2 * math.pi * j / seg
            verts.append(p + (u * math.cos(b) + v * math.sin(b)) * r)
    rings = n if closed else n - 1
    for i in range(rings):
        i2 = (i + 1) % n
        for j in range(seg):
            j2 = (j + 1) % seg
            faces.append((i * seg + j, i * seg + j2, i2 * seg + j2, i2 * seg + j))
    if not closed:
        faces.append(tuple(reversed(range(seg))))
        faces.append(tuple((n - 1) * seg + j for j in range(seg)))
    return new_obj(name, verts, faces, material)


def bezier(p0, p1, p2, p3, n=16):
    p0, p1, p2, p3 = map(Vector, (p0, p1, p2, p3))
    out = []
    for i in range(n + 1):
        t = i / n
        out.append(p0 * (1 - t) ** 3 + p1 * 3 * (1 - t) ** 2 * t + p2 * 3 * (1 - t) * t * t + p3 * t ** 3)
    return out


def bev(o, width, segments=1, angle=40):
    m = o.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = False
    return o


def solid(o, thickness, offset=1.0):
    m = o.modifiers.new('solid', 'SOLIDIFY')
    m.thickness = thickness
    m.offset = offset
    m.use_even_offset = True
    return o


# ---------------------------------------------------------------------------------------------
# Fitting to the body


class Body:
    """World-space lookups on the rest-pose character: bone positions and BVHs of chosen regions."""

    def __init__(self, arm, body, clothes, hair=None, eyes=None):
        self.arm = arm
        self.body = body
        self.clothes = clothes
        self.hair = hair
        self.eyes = eyes
        self._bvh = {}
        # Skin weights come from the nearest body or cloth vertex (the body is gone under clothes).
        self.src = [body, *clothes]
        self.src_ids = []
        n = sum(len(o.data.vertices) for o in self.src)
        self.kd = KDTree(n)
        for oi, o in enumerate(self.src):
            for v in o.data.vertices:
                self.kd.insert(o.matrix_world @ v.co, len(self.src_ids))
                self.src_ids.append((oi, v.index))
        self.kd.balance()

    def head(self, bone):
        return self.arm.matrix_world @ self.arm.data.bones[bone].head_local

    def tail(self, bone):
        return self.arm.matrix_world @ self.arm.data.bones[bone].tail_local

    def along(self, bone, f):
        return self.head(bone).lerp(self.tail(bone), f)

    def bvh(self, key, objs, groups=None, min_w=0.3):
        """A BVH over `objs`; with `groups`, only faces whose every vertex has that much weight in them."""
        if key in self._bvh:
            return self._bvh[key]
        verts, polys = [], []
        for o in objs:
            if o is None:
                continue
            idx = {g.index for g in o.vertex_groups if groups is None or g.name in groups}
            mw = o.matrix_world
            keep = []
            for v in o.data.vertices:
                w = sum(g.weight for g in v.groups if g.group in idx) if groups is not None else 1
                keep.append(w >= min_w)
            base = len(verts)
            verts += [mw @ v.co for v in o.data.vertices]
            for p in o.data.polygons:
                if all(keep[i] for i in p.vertices):
                    polys.append([base + i for i in p.vertices])
        t = BVHTree.FromPolygons(verts, polys)
        self._bvh[key] = t
        return t

    def outer(self):
        return self.bvh('outer', [self.body, *self.clothes, self.hair])

    def skin_only(self):
        return self.bvh('skin', [self.body])

    def eye(self, side):
        """Centre of the left (+x) or right (-x) eyeball."""
        vs = [self.eyes.matrix_world @ v.co for v in self.eyes.data.vertices if (v.co.x > 0) == (side > 0)]
        return sum(vs, Vector()) / len(vs)

    def eye_front(self, side):
        """How far forward (y) that eyeball reaches. The cartoon eyes are wide open: a ray at one goes
        through the lids to the back of the socket, so eyepieces sit no deeper than this."""
        return min((self.eyes.matrix_world @ v.co).y for v in self.eyes.data.vertices if (v.co.x > 0) == (side > 0))

    def eye_radius(self, side):
        """Half that eyeball's width: eyepieces are sized to cover it."""
        xs = [(self.eyes.matrix_world @ v.co).x for v in self.eyes.data.vertices if (v.co.x > 0) == (side > 0)]
        return (max(xs) - min(xs)) / 2

    def hit(self, tree, origin, direction, dist=1.0):
        loc, nrm, _, _ = tree.ray_cast(Vector(origin), Vector(direction).normalized(), dist)
        return (loc, nrm) if loc is not None else (None, None)

    def ring(self, tree, centre, axis, n=36, r0=0.4, gap=0.004, up=None, smooth=2, fallback=0.06):
        """Casts rays inward toward the axis in the plane through `centre`: the fitted outline, as
        (points, outward directions). Radii are smoothed so cloth wrinkles don't make it wobble."""
        u, v, w = frame(axis, up)
        c = Vector(centre)
        radii, dirs = [], []
        for i in range(n):
            a = 2 * math.pi * i / n
            d = u * math.cos(a) + v * math.sin(a)
            loc, _ = self.hit(tree, c + d * r0, -d, r0)
            radii.append((loc - c).dot(d) if loc is not None else None)
            dirs.append(d)
        known = [r for r in radii if r is not None]
        fill = (sum(known) / len(known)) if known else fallback
        radii = [r if r is not None else fill for r in radii]
        for _ in range(smooth):
            radii = [max(radii[i], (radii[i - 1] + radii[i] + radii[(i + 1) % n]) / 3) for i in range(n)]
        return [c + d * (r + gap) for d, r in zip(dirs, radii)], dirs


def band(name, pts, dirs, axis, width, thick, material, bevel_w=0.0015, closed=True):
    """A band of rectangular section along a fitted ring (closed) or part of one: inner face on it."""
    w = Vector(axis).normalized() * (width / 2)
    n = len(pts)
    verts, faces = [], []
    for p, d in zip(pts, dirs):
        verts += [p - w, p + w, p + w + d * thick, p - w + d * thick]
    if not closed:
        faces += [(0, 1, 2, 3), (4 * n - 1, 4 * n - 2, 4 * n - 3, 4 * n - 4)]
    for i in range(n if closed else n - 1):
        a, b = 4 * i, 4 * ((i + 1) % n)
        for k in range(4):
            k2 = (k + 1) % 4
            faces.append((a + k, b + k, b + k2, a + k2))
    o = new_obj(name, verts, faces, material)
    if bevel_w:
        bev(o, bevel_w, 1, 30)
    return o


def loft_rings(name, rings, material, thick=0.0, arc=None, cap=False):
    """A sleeve through several fitted rings (each a list of points, same count). `arc` (i0, i1)
    keeps only part of the way round (an open plate)."""
    n = len(rings[0])
    idx = list(range(n)) if arc is None else [i % n for i in range(arc[0], arc[1] + 1)]
    m = len(idx)
    verts = [p for ring in rings for p in (ring[i] for i in idx)]
    faces = []
    closed = arc is None
    for r in range(len(rings) - 1):
        for k in range(m if closed else m - 1):
            k2 = (k + 1) % m
            faces.append((r * m + k, r * m + k2, (r + 1) * m + k2, (r + 1) * m + k))
    o = new_obj(name, verts, faces, material)
    if thick:
        solid(o, thick, 1.0)
    return o


def surface_patch(name, b, tree, grid, material, lift=0.004, thick=0.003, smooth=0):
    """A shell over the body: `grid` is rows of (origin, direction) rays; each hit, lifted off the
    surface, becomes a vertex. `smooth` relaxes the grid so it bridges over bumps (nose, lips)."""
    rows = []
    for row in grid:
        pts = []
        for o, d in row:
            loc, nrm = b.hit(tree, o, d, 1.0)
            if loc is None:
                loc, nrm = Vector(o) + Vector(d).normalized() * 0.3, -Vector(d)
            pts.append(loc + nrm * lift)
        rows.append(pts)
    R, C = len(rows), len(rows[0])
    for _ in range(smooth):
        nxt = [r[:] for r in rows]
        for r in range(R):
            for c in range(C):
                nb = [rows[rr][cc] for rr, cc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)) if 0 <= rr < R and 0 <= cc < C]
                avg = sum(nb, Vector()) / len(nb)
                # Relax, but only outward: the shell bridges hollows and never sinks into the skin.
                if (avg - rows[r][c]).dot(-Vector(grid[r][c][1]).normalized()) > 0:
                    nxt[r][c] = rows[r][c].lerp(avg, 0.5)
        rows = nxt
    cols = len(rows[0])
    verts = [p for r in rows for p in r]
    faces = []
    for r in range(len(rows) - 1):
        for c in range(cols - 1):
            faces.append((r * cols + c, r * cols + c + 1, (r + 1) * cols + c + 1, (r + 1) * cols + c))
    o = new_obj(name, verts, faces, material)
    if thick:
        solid(o, thick, 1.0)
    return o


def stud(name, b, tree, origin, direction, r, h, material, seg=10):
    """A small cylinder sitting on the surface where the ray lands, along its normal."""
    loc, nrm = b.hit(tree, origin, direction, 0.5)
    if loc is None:
        return None
    o = cylinder(name, r, h, material, seg=seg, r2=r * 0.8)
    return place(o, loc + nrm * h * 0.3, nrm)


# ---------------------------------------------------------------------------------------------
# Binding to the rig


def bake_mods(o):
    """Applies bevels and solidifies, so weights cover the vertices they add."""
    for m in list(o.modifiers):
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_apply(modifier=m.name)


def rigid(o, b, bone):
    """Hard part: all weight on one bone."""
    bake_mods(o)
    g = o.vertex_groups.new(name=bone)
    g.add(range(len(o.data.vertices)), 1.0, 'REPLACE')
    _bind(o, b)
    return o


def nearest_bone(b, p, only=None):
    """The deforming bone whose segment passes closest to `p`."""
    best, name = 1e9, None
    for bn in b.arm.data.bones:
        if not bn.use_deform or (only is not None and bn.name not in only):
            continue
        h, t = b.arm.matrix_world @ bn.head_local, b.arm.matrix_world @ bn.tail_local
        ax = t - h
        f = max(0, min(1, (p - h).dot(ax) / max(ax.length_squared, 1e-9)))
        d = (h + ax * f - p).length
        if d < best:
            best, name = d, bn.name
    return name


def skin(o, b, k=4, only=None):
    """Soft part: each vertex copies the weights of the nearest body or cloth vertices (`only`: limit
    to these bones). A vertex with nothing near goes to the nearest bone."""
    bake_mods(o)
    names = [{g.index: g.name for g in src.vertex_groups} for src in b.src]
    bones = {bn.name for bn in b.arm.data.bones}
    mw = o.matrix_world
    groups = {}
    for v in o.data.vertices:
        p = mw @ v.co
        acc = {}
        for _co, i, dist in b.kd.find_n(p, k * 3):
            oi, vi = b.src_ids[i]
            f = 1 / max(dist, 1e-4)
            for g in b.src[oi].data.vertices[vi].groups:
                nm = names[oi][g.group]
                if nm in bones and g.weight > 0 and (only is None or nm in only):
                    acc[nm] = acc.get(nm, 0) + g.weight * f
        if not acc:
            acc = {nearest_bone(b, p, only): 1.0}
        s = sum(acc.values()) or 1
        for nm, wt in acc.items():
            if wt / s > 0.02:
                groups.setdefault(nm, []).append((v.index, wt / s))
    for nm, lst in groups.items():
        g = o.vertex_groups.new(name=nm)
        for i, wt in lst:
            g.add([i], wt, 'REPLACE')
    _bind(o, b)
    return o


def _bind(o, b):
    o.parent = b.arm
    o.matrix_parent_inverse = b.arm.matrix_world.inverted()
    m = o.modifiers.new('Armature', 'ARMATURE')
    m.object = b.arm
    o['kit'] = True


def paint_region(obj, bones, material, min_w=0.5):
    """Gives the faces of `obj` weighted to `bones` a new material (gloves, a metal arm)."""
    idx = {g.index for g in obj.vertex_groups if g.name in bones}
    if material.name not in [s.material.name for s in obj.material_slots if s.material]:
        obj.data.materials.append(material)
    slot = [s.material.name for s in obj.material_slots].index(material.name)
    w = [sum(g.weight for g in v.groups if g.group in idx) for v in obj.data.vertices]
    for p in obj.data.polygons:
        if sum(w[i] for i in p.vertices) / len(p.vertices) >= min_w:
            p.material_index = slot


FINGERS = [f'{f}_0{i}' for f in ('index', 'middle', 'ring', 'pinky', 'thumb') for i in (1, 2, 3)]


def hand_bones(side):
    return [f'hand_{side}'] + [f'{f}_{side}' for f in FINGERS]


def arm_bones(side, upper=True):
    return (['upperarm_' + side] if upper else []) + ['lowerarm_' + side] + hand_bones(side)


# ---------------------------------------------------------------------------------------------
# Pieces


#: An eyepiece's radius, in eyeball radii (the cartoon eyes are big; a lens has to cover one).
EYEPIECE = 1.15


def eyecup(name, P, at, normal, up, lens, R=0.024, depth=0.026):
    """One goggle eyepiece: a brass barrel, a knurled rim, a lens stack, and a little adjuster screw."""
    parts = []
    n = Vector(normal).normalized()
    barrel = cylinder(name + '_barrel', R, depth, P['brass'], seg=28, r2=R * 1.06)
    parts.append(place(barrel, at + n * (depth / 2 - 0.004), n, up))
    rim = torus(name + '_rim', R * 1.04, 0.0042, P['brass_dark'], seg=36, rseg=8)
    parts.append(place(rim, at + n * (depth - 0.002), n, up))
    back = torus(name + '_seal', R * 0.98, 0.006, P['leather_black'], seg=28, rseg=8)
    parts.append(place(back, at - n * 0.002, n, up))
    glass = cylinder(name + '_lens', R * 0.9, 0.003, lens, seg=28)
    parts.append(place(glass, at + n * (depth - 0.003), n, up))
    for i, rr in enumerate((0.62, 0.36)):
        ring = torus(f'{name}_ring{i}', R * rr, 0.0016, P['brass'], seg=24, rseg=6)
        parts.append(place(ring, at + n * (depth - 0.0005 + 0.0012 * i), n, up))
    u, v, _ = frame(n, up)
    screw = cylinder(name + '_screw', 0.004, 0.012, P['steel'], seg=10)
    parts.append(place(screw, at + n * (depth * 0.55) + u * (R * 1.08), u))
    return parts


def goggles(b, P, lens, where='eyes', lift=0.0, tilt=0.0, strap='leather_black', single=None, flip=False):
    """Brass driving goggles. `where`: 'eyes' (worn), 'forehead' (pushed up, `lift` m above the eyes,
    tipped back by `tilt` rad). `single`: one eyepiece is a cyber optic (its own lens material)."""
    parts = []
    el, er = b.eye(1), b.eye(-1)
    mid = (el + er) / 2
    fwd = Vector((0, -1, 0))
    up = Vector((0, 0, 1))
    if where == 'forehead':
        rot = Matrix.Rotation(-tilt, 3, 'X')
        fwd = rot @ fwd
        up = rot @ up
    centre = mid + up * lift
    tree = b.outer()
    cups = []
    for side, e in ((1, el), (-1, er)):
        off = Vector((e.x - mid.x, 0, 0)) * 1.08
        o = centre + off
        loc, _ = b.hit(tree, o + fwd * 0.2, -fwd, 0.25)
        base = (loc if loc is not None else o + fwd * 0.03) + fwd * 0.004
        if where == 'eyes':
            base = Vector((base.x, min(base.y, b.eye_front(side) - 0.002), base.z))
        cups.append(base)
        mat_lens = single if (single is not None and (side < 0) != flip) else lens
        parts += eyecup(f'goggle{side}', P, base, fwd, up, mat_lens, R=max(0.024, b.eye_radius(side) * EYEPIECE))
    # Bridge between the cups.
    a, c = cups
    bridge = tube('goggle_bridge', bezier(a + fwd * 0.01 + Vector((-0.02, 0, 0)), a + fwd * 0.02 + up * 0.012 + Vector((-0.03, 0, 0)), c + fwd * 0.02 + up * 0.012 + Vector((0.03, 0, 0)), c + fwd * 0.01 + Vector((0.02, 0, 0)), 10), 0.0035, P['brass_dark'])
    parts.append(bridge)
    # The strap goes round the head at the cups' height.
    axis = up
    hc = Vector((mid.x, (b.head('head').y + mid.y) / 2 + 0.02, centre.z))
    pts, dirs = b.ring(tree, hc, axis, n=40, r0=0.25, gap=0.002)
    s = band('goggle_strap', pts, dirs, axis, 0.026, 0.004, P[strap])
    parts.append(s)
    for p in parts:
        rigid(p, b, 'head')
    return parts


def monocle(b, P, lens, side=-1):
    """A brass cyber-monocle over one eye, with a ring of rivets, a telescoping arm and a cable
    looping back behind the ear."""
    e = b.eye(side)
    fwd = Vector((0, -1, 0))
    tree = b.outer()
    loc, _ = b.hit(tree, e + fwd * 0.2 + Vector((0, 0, 0.004)), -fwd, 0.25)
    base = (loc if loc is not None else e + fwd * 0.03) + fwd * 0.006
    base.y = min(base.y, b.eye_front(side) - 0.002)
    R = max(0.021, b.eye_radius(side) * EYEPIECE)
    parts = eyecup('monocle', P, base, fwd, Vector((0, 0, 1)), lens, R=R, depth=0.022)
    for i in range(10):
        a = 2 * math.pi * i / 10
        r = sphere(f'mono_rivet{i}', 0.0017, P['brass_dark'], 8, 4)
        r.data.transform(Matrix.Translation(base + fwd * 0.022 + Vector((math.cos(a), 0, math.sin(a))) * (R + 0.0025)))
        parts.append(r)
    ear = Vector((e.x + side * 0.065, b.head('head').y + 0.01, e.z - 0.01))
    side_v = Vector((side, 0, 0))
    arm_pts = bezier(base + side_v * 0.02, base + side_v * 0.05 + fwd * 0.01, ear + fwd * 0.04 + side_v * 0.012, ear + side_v * 0.012, 12)
    parts.append(tube('monocle_arm', arm_pts, 0.0028, P['brass_dark'], 8))
    pod = cylinder('monocle_pod', 0.014, 0.012, P['gunmetal'], seg=20)
    parts.append(place(pod, ear + side_v * 0.008, side_v))
    led = cylinder('monocle_led', 0.006, 0.004, P['glow'], seg=12)
    parts.append(place(led, ear + side_v * 0.015, side_v))
    for p in parts:
        rigid(p, b, 'head')
    neck = b.along('neck_01', 0.3) + Vector((side * 0.045, 0.03, 0))
    cable = tube('monocle_cable', bezier(ear + Vector((0, 0.01, -0.01)), ear + Vector((side * 0.02, 0.05, -0.06)), neck + Vector((side * 0.03, 0.03, 0.05)), neck, 14), 0.003, P['rubber'], 6)
    skin(cable, b, only={'head', 'neck_01', 'spine_03'})
    return parts + [cable]


def respirator(b, P, glow, filters=True):
    """A half-face respirator: a smooth shell over nose and mouth, a brass grille with glowing slits,
    twin filter canisters angled down, and a strap round the back of the head."""
    tree = b.skin_only()
    el, er = b.eye(1), b.eye(-1)
    mid = (el + er) / 2
    hw = (el.x - er.x) / 2
    # Rays come in from the front, fanning out so the sides wrap round the cheeks.
    grid = []
    rows, cols = 9, 13
    for r in range(rows):
        f = r / (rows - 1)
        z = mid.z - 0.035 - 0.08 * f
        span = hw * (1.35 - 0.45 * f ** 2)
        row = []
        for c in range(cols):
            x = mid.x - span + 2 * span * c / (cols - 1)
            row.append((Vector((x, mid.y - 0.25, z)), Vector((-(x - mid.x) * 1.1, 1, 0))))
        grid.append(row)
    shell = surface_patch('mask_shell', b, tree, grid, P['gunmetal'], lift=0.009, thick=0.004, smooth=6)
    bev(shell, 0.0015, 1, 30)
    parts = [shell]
    front = b.hit(tree, Vector((mid.x, mid.y - 0.25, mid.z - 0.075)), Vector((0, 1, 0)), 0.4)[0] or (mid + Vector((0, -0.05, -0.075)))
    ax = Vector((0, -1, -0.2)).normalized()
    grill = cylinder('mask_grill', 0.017, 0.014, P['brass'], seg=24, r2=0.015)
    parts.append(place(grill, front + ax * 0.014, ax))
    for i in range(3):
        slit = box(f'mask_slit{i}', (0.022, 0.002, 0.003), glow)
        slit.data.transform(Matrix.Translation(front + ax * 0.0215 + Vector((0, 0, 0.006 * (i - 1)))))
        parts.append(slit)
    if filters:
        for s in (1, -1):
            at = front + Vector((s * 0.038, 0.012, 0.004))
            fa = Vector((s * 0.6, -0.55, -0.58)).normalized()
            can = cylinder(f'mask_can{s}', 0.015, 0.03, P['brass'], seg=20)
            parts.append(place(can, at + fa * 0.016, fa))
            for i in range(2):
                rib = torus(f'mask_rib{s}{i}', 0.0155, 0.0016, P['brass_dark'], seg=20, rseg=5)
                parts.append(place(rib, at + fa * (0.008 + 0.012 * i), fa))
            cap = cylinder(f'mask_cap{s}', 0.0125, 0.003, glow, seg=18)
            parts.append(place(cap, at + fa * 0.0315, fa))
    # The strap: only the part of the ring behind the cheeks.
    hc = Vector((mid.x, b.head('head').y, mid.z - 0.05))
    axis = Vector((0, 0.3, 1)).normalized()
    pts, dirs = b.ring(b.outer(), hc, axis, n=48, r0=0.25, gap=0.003)
    n = len(pts)
    keep = {i for i in range(n) if pts[i].y > front.y + 0.06}
    start = next(i for i in range(n) if i in keep and (i - 1) % n not in keep)
    order = [k for k in ((start + j) % n for j in range(n)) if k in keep]
    parts.append(band('mask_strap', [pts[i] for i in order], [dirs[i] for i in order], axis, 0.016, 0.003, P['leather_black'], closed=False))
    for p in parts:
        rigid(p, b, 'head')
    return parts


def collar(b, P, metal='brass', bands=3, height=0.06, glow=None):
    """Stacked metal rings round the neck, with rivets and a glowing seam between them."""
    parts = []
    tree = b.bvh('neck', [b.body, *b.clothes], {'neck_01', 'head', 'spine_03'}, 0.4)
    n0 = b.head('neck_01')
    n1 = b.tail('neck_01')
    axis = (n1 - n0).normalized()
    for i in range(bands):
        f = 0.12 + (height / (n1 - n0).length) * i / max(1, bands - 1)
        c = n0.lerp(n1, min(0.95, f))
        pts, dirs = b.ring(tree, c, axis, n=36, r0=0.16, gap=0.004 + 0.002 * i)
        parts.append(band(f'collar{i}', pts, dirs, axis, height / bands * 0.75, 0.005, P[metal]))
        if glow is not None and i < bands - 1:
            c2 = n0.lerp(n1, min(0.95, f + height / (n1 - n0).length / max(1, bands - 1) / 2))
            p2, d2 = b.ring(tree, c2, axis, n=36, r0=0.16, gap=0.003 + 0.002 * i)
            parts.append(band(f'collar_glow{i}', p2, d2, axis, 0.003, 0.003, glow, 0))
        for k in range(0, 36, 6):
            r = sphere(f'collar_rivet{i}{k}', 0.0022, P['brass_dark'], 8, 4)
            r.data.transform(Matrix.Translation(pts[k] + dirs[k] * 0.005))
            parts.append(r)
    for p in parts:
        skin(p, b, only={'neck_01', 'head', 'spine_03'})
    return parts


def bracer(b, P, side, metal='brass', strap='leather', gauge=None, length=(0.25, 0.85)):
    """A fitted metal bracer on the forearm, with leather straps and (optionally) a glowing gauge."""
    bone = 'lowerarm_' + side
    tree = b.bvh('forearm' + side, [b.body, *b.clothes], {bone, 'hand_' + side}, 0.5)
    h, t = b.head(bone), b.tail(bone)
    axis = (t - h).normalized()
    rings = []
    for i in range(6):
        f = length[0] + (length[1] - length[0]) * i / 5
        pts, dirs = b.ring(tree, h.lerp(t, f), axis, n=32, r0=0.12, gap=0.006 + 0.004 * math.sin(math.pi * i / 5))
        rings.append((pts, dirs))
    shell = loft_rings('bracer_' + side, [r[0] for r in rings], P[metal], thick=0.003)
    bev(shell, 0.001, 1)
    parts = [shell]
    for f in (0.3, 0.7):
        i = int(f * 5)
        pts, dirs = rings[i]
        parts.append(band(f'bracer_strap{side}{i}', [p + d * 0.003 for p, d in zip(pts, dirs)], dirs, axis, 0.018, 0.003, P[strap]))
    if gauge is not None:
        top_dir = Vector((0, 0, 1)) - axis * axis.z
        pts, dirs = rings[3]
        k = max(range(len(dirs)), key=lambda j: dirs[j].dot(top_dir.normalized()))
        at = pts[k] + dirs[k] * 0.006
        body = cylinder('gauge_' + side, 0.016, 0.01, P['brass_dark'], seg=24)
        parts.append(place(body, at, dirs[k]))
        face = cylinder('gauge_face' + side, 0.0135, 0.002, gauge, seg=24)
        parts.append(place(face, at + dirs[k] * 0.0055, dirs[k]))
        ring = torus('gauge_bezel' + side, 0.0145, 0.0018, P['brass'], seg=24, rseg=6)
        parts.append(place(ring, at + dirs[k] * 0.006, dirs[k]))
    for p in parts:
        rigid(p, b, bone)
    return parts


def mech_arm(b, P, side, glow, metal='gunmetal', plate='brass'):
    """A mechanical arm: the skin from the shoulder down turns to dark metal, with brass plates over the
    upper arm and forearm, an elbow gear, twin pistons and a glowing core in the forearm."""
    paint_region(b.body, arm_bones(side), P[metal], 0.55)
    parts = []
    for bone, span in (('upperarm_' + side, (0.15, 0.85)), ('lowerarm_' + side, (0.12, 0.88))):
        tree = b.bvh('limb' + bone, [b.body, *b.clothes], {bone}, 0.5)
        h, t = b.head(bone), b.tail(bone)
        axis = (t - h).normalized()
        rings = []
        for i in range(5):
            f = span[0] + (span[1] - span[0]) * i / 4
            pts, _ = b.ring(tree, h.lerp(t, f), axis, n=32, r0=0.14, gap=0.005 + 0.003 * math.sin(math.pi * i / 4))
            rings.append(pts)
        # The plate covers the outside of the limb (the half facing away from the body).
        out = Vector((1 if side == 'l' else -1, 0, 0.3)).normalized()
        u, v, _ = frame(axis)
        best = max(range(32), key=lambda j: (u * math.cos(2 * math.pi * j / 32) + v * math.sin(2 * math.pi * j / 32)).dot(out))
        pl = loft_rings('mplate_' + bone, rings, P[plate], thick=0.004, arc=(best - 10, best + 10))
        bev(pl, 0.0015, 1)
        parts.append(rigid(pl, b, bone))
        # Rivets down both edges.
        for r in range(5):
            for j in (best - 10, best + 10):
                rv = sphere(f'mrivet{bone}{r}{j}', 0.0024, P['brass_dark'], 8, 4)
                rv.data.transform(Matrix.Translation(rings[r][j % 32] + (rings[r][j % 32] - h.lerp(t, span[0] + (span[1] - span[0]) * r / 4)).normalized() * 0.004))
                parts.append(rigid(rv, b, bone))
        # Glowing seam along the inside of the forearm.
        if bone.startswith('lower'):
            inner = (best + 16) % 32
            seam = tube('mcore_' + side, [rings[r][inner] + (rings[r][inner] - h.lerp(t, span[0] + (span[1] - span[0]) * r / 4)).normalized() * 0.003 for r in range(5)], 0.0035, glow, 6)
            parts.append(rigid(seam, b, bone))
    # Elbow: a gear on the outside of the joint.
    elbow = b.head('lowerarm_' + side)
    ua = (b.tail('upperarm_' + side) - b.head('upperarm_' + side)).normalized()
    fa = (b.tail('lowerarm_' + side) - b.head('lowerarm_' + side)).normalized()
    hinge = ua.cross(fa).normalized()
    if hinge.length < 0.5:
        hinge = Vector((0, 1, 0))
    outside = Vector((1 if side == 'l' else -1, 0, 0))
    if hinge.dot(outside) < 0:
        hinge = -hinge
    tree = b.bvh('elbow' + side, [b.body, *b.clothes], {'upperarm_' + side, 'lowerarm_' + side}, 0.3)
    loc, _ = b.hit(tree, elbow + hinge * 0.15, -hinge, 0.2)
    at = (loc if loc is not None else elbow + hinge * 0.04) + hinge * 0.006
    g = gear('elbow_gear' + side, 14, 0.026, 0.007, P['brass'])
    parts.append(rigid(place(g, at, hinge), b, 'lowerarm_' + side))
    hub = cylinder('elbow_hub' + side, 0.009, 0.012, P['steel'], seg=16)
    parts.append(rigid(place(hub, at + hinge * 0.003, hinge), b, 'lowerarm_' + side))
    g2 = gear('elbow_gear2' + side, 9, 0.015, 0.006, P['copper'])
    parts.append(rigid(place(g2, at + ua * -0.03 + hinge * 0.002, hinge, spin=0.2), b, 'upperarm_' + side))
    # Pistons from the upper arm to the forearm (they flex with the elbow, so they're skinned).
    for k, off in enumerate((-0.012, 0.012)):
        a0 = b.along('upperarm_' + side, 0.55) + hinge * 0.03 + Vector((0, off, 0))
        a1 = b.along('lowerarm_' + side, 0.4) + hinge * 0.028 + Vector((0, off, 0))
        rod = tube(f'piston{side}{k}', [a0, a0.lerp(a1, 0.5), a1], 0.0032, P['chrome'], 8)
        parts.append(skin(rod, b, only={'upperarm_' + side, 'lowerarm_' + side}))
    return parts


def shoulder_cap(b, P, side, metal='brass'):
    """Where a sleeve was cut off: a riveted ring hides the hem at the top of the arm."""
    bone = 'upperarm_' + side
    tree = b.bvh('cap' + side, [b.body, *b.clothes], {bone, 'clavicle_' + side}, 0.3)
    h, t = b.head(bone), b.tail(bone)
    axis = (t - h).normalized()
    pts, dirs = b.ring(tree, h.lerp(t, 0.14), axis, n=36, r0=0.16, gap=0.006, smooth=3)
    parts = [band('cap_' + side, pts, dirs, axis, 0.034, 0.006, P[metal])]
    for k in range(0, 36, 4):
        r = sphere(f'cap_rivet{side}{k}', 0.0025, P['brass_dark'], 8, 4)
        r.data.transform(Matrix.Translation(pts[k] + dirs[k] * 0.0065))
        parts.append(r)
    for p in parts:
        skin(p, b, only={bone, 'clavicle_' + side})
    return parts


def pauldron(b, P, side, metal='brass', glow=None):
    """A layered shoulder plate: three overlapping lames capping the deltoid (upper over lower), with
    rivets along their lower edges and a small glowing pressure gauge on top."""
    parts = []
    sx = 1 if side == 'l' else -1
    bone = 'upperarm_' + side
    tree = b.bvh('shoulder' + side, [b.body, *b.clothes], {bone, 'clavicle_' + side, 'spine_03'}, 0.3)
    centre = b.head(bone) + Vector((0, 0, -0.01))
    pole = Vector((sx * 0.72, 0, 0.7)).normalized()
    e1 = Vector((0, -1, 0))
    e2 = pole.cross(e1).normalized()

    def ray(th, ph):
        d = pole * math.cos(math.radians(th)) + (e1 * math.cos(math.radians(ph)) + e2 * math.sin(math.radians(ph))) * math.sin(math.radians(th))
        return centre + d * 0.3, -d

    for lame, (t0, t1, lift) in enumerate(((3, 30, 0.022), (24, 46, 0.017), (40, 62, 0.012))):
        rows = [[ray(t0 + (t1 - t0) * r / 3, -25 + 230 * c / 12) for c in range(13)] for r in range(4)]
        p = surface_patch(f'pauldron{side}{lame}', b, tree, rows, P[metal], lift=lift, thick=0.004, smooth=3)
        bev(p, 0.0015, 1)
        parts.append(rigid(p, b, bone))
        for c in range(1, 12, 2):
            loc, nrm = b.hit(tree, *ray(t1 - 3, -25 + 230 * c / 12), 0.35)
            if loc is not None:
                rv = sphere(f'prv{side}{lame}{c}', 0.003, P['brass_dark'], 8, 4)
                rv.data.transform(Matrix.Translation(loc + nrm * (lift + 0.004)))
                parts.append(rigid(rv, b, bone))
    if glow is not None:
        loc, nrm = b.hit(tree, *ray(0, 0), 0.35)
        if loc is not None:
            at = loc + nrm * 0.034
            g = cylinder('pgauge' + side, 0.017, 0.014, P['brass_dark'], seg=24)
            parts.append(rigid(place(g, at, nrm), b, bone))
            f = cylinder('pgauge_face' + side, 0.014, 0.002, glow, seg=24)
            parts.append(rigid(place(f, at + nrm * 0.0075, nrm), b, bone))
            rim = torus('pgauge_rim' + side, 0.015, 0.002, P['brass'], seg=24, rseg=6)
            parts.append(rigid(place(rim, at + nrm * 0.008, nrm), b, bone))
    return parts


def belt(b, P, z_frac=0.5, width=0.042, material='leather', buckle='brass', glow=None):
    """A belt round the hips with a brass buckle (and a glowing stripe, if given)."""
    tree = b.bvh('hips', [b.body, *b.clothes], {'pelvis', 'spine_01', 'thigh_l', 'thigh_r'}, 0.2)
    c = b.head('pelvis').lerp(b.tail('pelvis'), z_frac)
    pts, dirs = b.ring(tree, c, Vector((0, 0, 1)), n=48, r0=0.4, gap=0.004)
    parts = [band('belt', pts, dirs, Vector((0, 0, 1)), width, 0.005, P[material])]
    k = min(range(len(pts)), key=lambda j: pts[j].y)
    at = pts[k] + dirs[k] * 0.006
    bk = box('buckle', (0.06, 0.012, width + 0.012), P[buckle], 0.002)
    bk.data.transform(Matrix.Translation(at))
    parts.append(bk)
    if glow is not None:
        parts.append(band('belt_glow', [p + d * 0.0052 for p, d in zip(pts, dirs)], dirs, Vector((0, 0, 1)), 0.004, 0.001, glow, 0))
    for p in parts:
        skin(p, b, only={'pelvis', 'spine_01', 'thigh_l', 'thigh_r'})
    return parts


def chest_strap(b, P, side='l', material='leather', buckle='brass'):
    """A bandolier from one shoulder across the chest to the opposite hip, fitted front and back."""
    tree = b.bvh('torso', [b.body, *b.clothes], {'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'pelvis'}, 0.4)
    sx = 1 if side == 'l' else -1
    top = b.head('upperarm_' + side) + Vector((-sx * 0.05, 0, 0.04))
    bot = b.head('pelvis') + Vector((-sx * 0.16, 0, 0.0))
    axis = (top - bot)
    normal = axis.cross(Vector((0, 1, 0))).normalized()
    pts, dirs = b.ring(tree, (top + bot) / 2, normal, n=56, r0=0.5, gap=0.005, up=axis)
    parts = [band('chest_strap', pts, dirs, normal, 0.038, 0.004, P[material])]
    for k in sorted(range(len(pts)), key=lambda j: pts[j].y)[:1]:
        bk = box('strap_buckle', (0.05, 0.012, 0.05), P[buckle], 0.002)
        place(bk, pts[k] + dirs[k] * 0.007, dirs[k], up=axis)
        parts.append(bk)
    for p in parts:
        skin(p, b, only={'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'pelvis'})
    return parts


def implants(b, P, glow, side=1, count=4):
    """A row of glowing studs along the temple and down the cheekbone, joined by a fine seam."""
    tree = b.skin_only()
    e = b.eye(side)
    parts, pts = [], []
    for i in range(count):
        f = i / max(1, count - 1)
        o = e + Vector((side * (0.035 + 0.012 * f), -0.0 + 0.03 * f, 0.03 - 0.055 * f))
        loc, nrm = b.hit(tree, o + Vector((side * 0.2, -0.05, 0)), Vector((-side, 0.25, 0)), 0.4)
        if loc is None:
            continue
        s = cylinder(f'implant{i}', 0.0032, 0.003, glow, seg=10)
        parts.append(place(s, loc + nrm * 0.0008, nrm))
        r = torus(f'implant_ring{i}', 0.0042, 0.0009, P['chrome'], seg=14, rseg=5)
        parts.append(place(r, loc + nrm * 0.0012, nrm))
        pts.append(loc + nrm * 0.0008)
    if len(pts) > 1:
        parts.append(tube('implant_seam', pts, 0.0008, P['glow_soft'], 5))
    for p in parts:
        rigid(p, b, 'head')
    return parts


def gloves(b, P, sides=('l', 'r'), material='leather_black', cuff='leather_black', fingerless=False):
    """Driving gloves: the hands' skin takes the leather, with a cuff band at each wrist."""
    parts = []
    for s in sides:
        bones = hand_bones(s) if not fingerless else [f'hand_{s}'] + [f'{f}_{s}' for f in FINGERS if f.endswith('_01')]
        paint_region(b.body, bones, P[material], 0.5)
        bone = 'lowerarm_' + s
        tree = b.bvh('wrist' + s, [b.body, *b.clothes], {bone, 'hand_' + s}, 0.3)
        h, t = b.head(bone), b.tail(bone)
        axis = (t - h).normalized()
        pts, dirs = b.ring(tree, h.lerp(t, 0.9), axis, n=28, r0=0.1, gap=0.003)
        parts.append(rigid(band('cuff_' + s, pts, dirs, axis, 0.03, 0.004, P[cuff]), b, bone))
    return parts


def hat_band(b, P, hat, material='brass', glow=None, goggles_on=None, lens=None):
    """A metal band round a hat's crown, optionally with goggles resting on the brim."""
    zs = [hat.matrix_world @ v.co for v in hat.data.vertices]
    top = max(p.z for p in zs)
    bot = min(p.z for p in zs)
    tree = b.bvh('hat', [hat])
    cx = sum(p.x for p in zs) / len(zs)
    cy = sum(p.y for p in zs) / len(zs)
    z = bot + (top - bot) * 0.42
    pts, dirs = b.ring(tree, Vector((cx, cy, z)), Vector((0, 0, 1)), n=48, r0=0.3, gap=0.002)
    parts = [band('hat_band', pts, dirs, Vector((0, 0, 1)), 0.016, 0.003, P[material])]
    if glow is not None:
        parts.append(band('hat_glow', [p + d * 0.0032 for p, d in zip(pts, dirs)], dirs, Vector((0, 0, 1)), 0.003, 0.001, glow, 0))
    k = min(range(len(pts)), key=lambda j: pts[j].y)
    g = gear('hat_gear', 12, 0.014, 0.004, P['brass'])
    parts.append(place(g, pts[k + 6] + dirs[k + 6] * 0.004, dirs[k + 6]))
    for p in parts:
        rigid(p, b, 'head')
    return parts


def cable(b, P, pts, material='rubber', r=0.004, only=None):
    c = tube('cable', pts, r, P[material], 8)
    return [skin(c, b, only=only)]


# ---------------------------------------------------------------------------------------------
# The car's side of things: a bucket seat and a steering wheel (both live in the drive frame,
# with the hip point at the origin and the driver facing -Y)


def seat(P, recline, style, cushion=-0.06, back=0.14):
    """A bucket seat: cushion, bolstered back, headrest. `cushion` is the cushion's top (m, from the
    hip point) and `back` how far behind the hip point the backrest's face is, so the seat can be
    fitted to the posed body. `style` picks leather, trim and studs."""
    parts = []
    leather = P[style.get('leather', 'leather_black')]
    trim = P[style.get('trim', 'brass')]
    back_rot = Matrix.Rotation(-recline, 4, 'X')
    B = back + 0.05  # the backrest's centre plane
    c = box('seat_cushion', (0.46, 0.5, 0.1), leather, 0.02)
    c.data.transform(Matrix.Translation((0, -0.14, cushion - 0.05)))
    parts.append(c)
    for s in (1, -1):
        bol = box(f'seat_bolster{s}', (0.07, 0.46, 0.12), leather, 0.025)
        bol.data.transform(Matrix.Translation((s * 0.24, -0.16, cushion)))
        parts.append(bol)
    bk = box('seat_back', (0.48, 0.1, 0.66), leather, 0.025)
    bk.data.transform(back_rot @ Matrix.Translation((0, B, 0.3)))
    parts.append(bk)
    for s in (1, -1):
        wing = box(f'seat_wing{s}', (0.07, 0.16, 0.5), leather, 0.025)
        wing.data.transform(back_rot @ Matrix.Translation((s * 0.25, B - 0.04, 0.28)) @ Matrix.Rotation(s * 0.25, 4, 'Z'))
        parts.append(wing)
    hr = box('seat_head', (0.28, 0.1, 0.2), leather, 0.03)
    hr.data.transform(back_rot @ Matrix.Translation((0, B + 0.01, 0.77)))
    parts.append(hr)
    # Trim: a metal edge round the back and two rows of studs.
    f = B - 0.055
    edge = tube('seat_trim', [back_rot @ Vector(p) for p in [(-0.24, f, -0.02), (-0.245, f, 0.5), (-0.14, f + 0.005, 0.64), (0.14, f + 0.005, 0.64), (0.245, f, 0.5), (0.24, f, -0.02)]], 0.008, trim, 8)
    parts.append(edge)
    for i in range(7):
        z = 0.06 + 0.07 * i
        for s in (1, -1):
            st = sphere(f'seat_stud{i}{s}', 0.006, trim, 8, 4)
            st.data.transform(back_rot @ Matrix.Translation((s * 0.17, f, z)))
            parts.append(st)
    if style.get('glow'):
        g = box('seat_glow', (0.008, 0.008, 0.5), P['glow'], 0)
        g.data.transform(back_rot @ Matrix.Translation((0, f - 0.002, 0.3)))
        parts.append(g)
    return parts


def wheel(P, centre, normal, up, style):
    """A steering wheel in its own frame, centred on the origin (the caller places the bone).
    Styles: 'wood' (wooden rim, brass spokes), 'yoke' (carbon yoke with a light strip),
    'iron' (riveted steel, three fat spokes), 'deep' (dished leather with a red top mark)."""
    kind = style.get('kind', 'wood')
    R = style.get('radius', 0.18)
    parts = []
    rim_mat = P[{'wood': 'wood', 'yoke': 'carbon', 'iron': 'gunmetal', 'deep': 'leather_black'}[kind]]
    spoke_mat = P[{'wood': 'brass', 'yoke': 'carbon', 'iron': 'steel', 'deep': 'gunmetal'}[kind]]
    if kind == 'yoke':
        arc = math.radians(250)
        rim = torus('wheel_rim', R, 0.017, rim_mat, seg=40, rseg=10, arc=arc)
        rim.data.transform(Matrix.Rotation(-math.pi / 2 - arc / 2, 4, 'Z'))
        parts.append(rim)
        bar = tube('wheel_bar', [Vector((-R * 0.82, R * 0.45, 0)), Vector((R * 0.82, R * 0.45, 0))], 0.011, rim_mat, 10)
        parts.append(bar)
        strip = torus('wheel_strip', R + 0.012, 0.003, P['glow'], seg=40, rseg=6, arc=arc * 0.4)
        strip.data.transform(Matrix.Rotation(-math.pi / 2 - arc * 0.2, 4, 'Z'))
        parts.append(strip)
    else:
        parts.append(torus('wheel_rim', R, 0.016 if kind != 'iron' else 0.018, rim_mat, seg=48, rseg=10))
    n_sp = {'wood': 4, 'yoke': 2, 'iron': 3, 'deep': 3}[kind]
    for i in range(n_sp):
        a = {'wood': [45, 135, 225, 315], 'yoke': [0, 180], 'iron': [0, 180, 270], 'deep': [0, 180, 270]}[kind][i]
        a = math.radians(a)
        d = Vector((math.cos(a), math.sin(a), 0))
        dish = 0.05 if kind == 'deep' else 0.025
        sp = tube(f'wheel_spoke{i}', [Vector((0, 0, -dish)) + d * 0.03, d * (R * 0.55) + Vector((0, 0, -dish * 0.4)), d * (R - 0.01)], 0.008 if kind != 'iron' else 0.012, spoke_mat, 8)
        parts.append(sp)
    hub = cylinder('wheel_hub', 0.045, 0.03, P['brass' if kind == 'wood' else 'gunmetal'], seg=28)
    hub.data.transform(Matrix.Translation((0, 0, -0.03 if kind != 'deep' else -0.05)))
    parts.append(hub)
    badge = cylinder('wheel_badge', 0.026, 0.006, P['glow'] if kind in ('yoke', 'deep') else P['brass'], seg=24)
    badge.data.transform(Matrix.Translation((0, 0, -0.012 if kind != 'deep' else -0.032)))
    parts.append(badge)
    if kind == 'deep':
        mark = box('wheel_mark', (0.02, 0.02, 0.035), mat('redmark', '#c81e1e', 0.5), 0.004)
        mark.data.transform(Matrix.Translation((0, R, 0)))
        parts.append(mark)
    if kind == 'iron':
        for i in range(16):
            a = 2 * math.pi * i / 16
            rv = sphere(f'wheel_rivet{i}', 0.004, P['brass'], 8, 4)
            rv.data.transform(Matrix.Translation((math.cos(a) * R, math.sin(a) * R, 0.017)))
            parts.append(rv)
    # Column.
    col = cylinder('wheel_column', 0.024, 0.12, P['gunmetal'], seg=12)
    col.data.transform(Matrix.Translation((0, 0, -0.1)))
    parts.append(col)
    # Into the drive frame: local Z is the wheel's axis (toward the driver), local Y its 12 o'clock.
    u, v, w = Vector(up).cross(Vector(normal)).normalized(), Vector(up).normalized(), Vector(normal).normalized()
    m = Matrix((u, v, w)).transposed().to_4x4()
    m.translation = Vector(centre)
    for p in parts:
        p.data.transform(m)
    return parts


def join(objs, name):
    """Joins meshes that share a material into one object each (fewer draw calls)."""
    by_mat = {}
    for o in objs:
        if o is None:
            continue
        key = o.data.materials[0].name if o.data.materials else ''
        by_mat.setdefault(key, []).append(o)
    out = []
    for key, group in by_mat.items():
        if len(group) > 1:
            with bpy.context.temp_override(active_object=group[0], selected_editable_objects=group, object=group[0]):
                bpy.ops.object.join()
        group[0].name = f'{name}_{key}'
        group[0].data.name = group[0].name
        out.append(group[0])
    return out
