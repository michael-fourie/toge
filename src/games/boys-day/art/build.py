import sys, os, importlib
sys.path.insert(0, HERE)
import lib; importlib.reload(lib)
from lib import *
import math
R = math.radians
import bpy
win = bpy.context.window_manager.windows[0]
area = next((a for a in win.screen.areas if a.type == 'VIEW_3D'), win.screen.areas[0])
with bpy.context.temp_override(window=win, screen=win.screen, area=area):
    reset()

    # --- Zombies: separate parts so the game can swing the arms and legs (origins at the joints).
    def zombie_parts():
        skin, shirt, pants, dark = '#86b86c', '#6d5f8a', '#3d3a52', '#2a2333'
        # Body: a slouched torso with a torn shirt hem and a belly.
        torso = join('z_body', [
            blob(shirt, (0.62, 0.42, 0.72), (0, 0.02, 1.18), (R(8), 0, 0)),
            blob(shirt, (0.56, 0.4, 0.3), (0, 0.05, 0.86)),
            blob(pants, (0.54, 0.36, 0.24), (0, 0.03, 0.72)),
            blob(skin, (0.2, 0.2, 0.16), (0, -0.02, 1.58)),
            box(dark, (0.1, 0.02, 0.2), (0.14, -0.2, 1.2), (R(8), 0, R(12)), 0),
            box(dark, (0.07, 0.02, 0.13), (-0.16, -0.2, 1.05), (R(8), 0, R(-20)), 0),
        ])
        # Head: big, lumpy, jaw hanging, one ear chewed.
        head = join('z_head', [
            blob(skin, (0.6, 0.56, 0.54), (0, 0, 0.3)),
            blob(skin, (0.42, 0.3, 0.2), (0, -0.14, 0.06), (R(-10), 0, 0)),
            box('#3a1f2a', (0.26, 0.06, 0.09), (0, -0.27, 0.1), (R(-10), 0, 0), 0.02),
            box('#f3ecd2', (0.05, 0.03, 0.06), (-0.07, -0.29, 0.14), (0, 0, 0), 0.01),
            box('#f3ecd2', (0.05, 0.03, 0.05), (0.05, -0.29, 0.07), (0, 0, 0), 0.01),
            ball(skin, (0.12, 0.08, 0.16), (0.31, 0.02, 0.3)),
            ball(skin, (0.1, 0.07, 0.1), (-0.31, 0.02, 0.33)),
            blob('#4c6b3c', (0.5, 0.3, 0.12), (0.02, 0.1, 0.56), (R(-6), R(5), 0)),
            ball('#c96a8a', (0.16, 0.14, 0.1), (0.14, 0.08, 0.57)),
            blob('#5e8a4a', (0.5, 0.1, 0.07), (0, -0.25, 0.4), (R(12), 0, R(-6))),
        ], grad=(0.8, 1.1))
        eyes = join('z_eyes', [
            ball('#ffffff', (0.17, 0.08, 0.17), (-0.13, -0.27, 0.32)),
            ball('#ffffff', (0.12, 0.08, 0.12), (0.14, -0.27, 0.3)),
        ], grad=None)
        arm = join('z_arm', [
            blob(shirt, (0.2, 0.2, 0.3), (0, 0, -0.12)),
            blob(skin, (0.15, 0.15, 0.42), (0, -0.02, -0.42)),
            blob(skin, (0.19, 0.16, 0.17), (0, -0.03, -0.68)),
            cyl(skin, 0.03, 0.12, (-0.06, -0.05, -0.8), (R(10), 0, 0), 0.015, 6),
            cyl(skin, 0.03, 0.13, (0.0, -0.06, -0.81), (R(14), 0, 0), 0.015, 6),
            cyl(skin, 0.03, 0.11, (0.06, -0.05, -0.8), (R(10), 0, 0), 0.015, 6),
        ])
        leg = join('z_leg', [
            blob(pants, (0.24, 0.26, 0.5), (0, 0, -0.25)),
            blob(pants, (0.2, 0.22, 0.2), (0, 0.01, -0.5)),
            blob('#2b2530', (0.24, 0.38, 0.16), (0, -0.07, -0.64)),
        ])
        return [torso, head, eyes, arm, leg]

    zombie_parts()

    # --- Scenery.
    def pine():
        g = ['#2f6b4a', '#38805a', '#44966a']
        parts = [cyl('#5a3d2b', 0.2, 1.4, (0, 0, 0.7), r2=0.13, seg=8)]
        for i in range(4):
            parts.append(cyl(g[min(2, i)], 1.5 - i * 0.32, 1.5 - i * 0.12, (0.04 * (i % 2), 0, 1.6 + i * 0.95), (R(3 * (i % 2)), 0, R(40 * i)), r2=0.1, seg=9, smooth=False))
        return join('p_pine', parts, grad=(0.6, 1.15))

    def tree():
        parts = [cyl('#6a4a32', 0.24, 2.0, (0, 0, 1.0), r2=0.16, seg=8),
                 cyl('#6a4a32', 0.1, 1.0, (0.3, 0, 2.0), (0, R(40), 0), r2=0.06, seg=6)]
        for i, (p, s, c) in enumerate([((0, 0, 3.0), 2.4, '#4f9a4a'), ((0.9, 0.2, 2.6), 1.6, '#5fae55'), ((-0.8, -0.3, 2.7), 1.7, '#458a44'), ((0.1, 0.5, 3.8), 1.5, '#6cc060')]):
            parts.append(ico(c, (s, s, s * 0.85), p, sub=2, jitter=0.25, seed=i + 3))
        return join('p_tree', parts, grad=(0.6, 1.15))

    def dead():
        w = '#4a4040'
        return join('p_dead', [
            cyl(w, 0.2, 2.6, (0, 0, 1.3), (R(4), 0, 0), r2=0.1, seg=7, smooth=False),
            cyl(w, 0.09, 1.5, (0.5, 0, 2.5), (0, R(48), 0), r2=0.03, seg=5, smooth=False),
            cyl(w, 0.08, 1.3, (-0.42, 0.1, 2.9), (0, R(-40), R(20)), r2=0.03, seg=5, smooth=False),
            cyl(w, 0.05, 0.8, (0.95, 0, 3.2), (0, R(10), 0), r2=0.02, seg=5, smooth=False),
            cyl(w, 0.06, 1.0, (0.05, -0.3, 3.3), (R(30), 0, 0), r2=0.02, seg=5, smooth=False),
            cyl(w, 0.04, 0.6, (-0.8, 0.15, 3.5), (0, R(-15), 0), r2=0.015, seg=5, smooth=False),
        ], grad=(0.7, 1.0))

    def rock():
        return join('p_rock', [
            ico('#7d7a8c', (2.2, 1.8, 1.5), (0, 0, 0.55), sub=2, jitter=0.35, seed=7),
            ico('#8b8899', (1.2, 1.1, 0.9), (0.9, 0.5, 0.35), sub=2, jitter=0.35, seed=8),
            ico('#6f6c7e', (0.8, 0.9, 0.6), (-0.9, -0.5, 0.22), sub=1, jitter=0.3, seed=9),
        ], grad=(0.55, 1.15))

    def cactus():
        g = '#3f8f5a'
        parts = [blob(g, (0.55, 0.55, 2.6), (0, 0, 1.3)),
                 blob(g, (0.36, 0.36, 0.9), (0.62, 0, 1.75)), blob(g, (0.5, 0.34, 0.34), (0.38, 0, 1.4)),
                 blob(g, (0.34, 0.34, 0.7), (-0.6, 0, 1.25)), blob(g, (0.5, 0.32, 0.32), (-0.36, 0, 1.0)),
                 ball('#ff7ab0', (0.22, 0.22, 0.16), (0, 0, 2.66)), ball('#ff7ab0', (0.16, 0.16, 0.12), (0.62, 0, 2.24))]
        return join('p_cactus', parts, grad=(0.6, 1.15))

    def shroom():
        return join('p_shroom', [
            cyl('#efe6d0', 0.28, 1.5, (0, 0, 0.75), r2=0.2, seg=10),
            blob('#d8455a', (2.0, 2.0, 0.8), (0, 0, 1.75)),
            ball('#fff3d6', (0.36, 0.36, 0.12), (0.4, -0.3, 2.1)), ball('#fff3d6', (0.3, 0.3, 0.1), (-0.5, 0.1, 2.08)),
            ball('#fff3d6', (0.24, 0.24, 0.1), (0.1, 0.55, 2.08)), ball('#fff3d6', (0.2, 0.2, 0.08), (-0.1, -0.6, 2.05)),
        ], grad=(0.7, 1.1))

    def crystal():
        c = ['#7ad8ff', '#a58bff', '#62f0d0']
        parts = []
        for i, (p, r, h, rot) in enumerate([((0, 0, 1.1), 0.45, 2.4, (0, 0, 0)), ((0.5, 0.2, 0.7), 0.3, 1.5, (0, R(24), 0)), ((-0.45, -0.1, 0.6), 0.26, 1.3, (R(8), R(-26), 0)), ((0.1, -0.45, 0.45), 0.2, 1.0, (R(28), 0, 0))]):
            parts.append(cyl(c[i % 3], r, h, p, rot, r2=0.02, seg=6, smooth=False))
        return join('p_crystal', parts, grad=(0.6, 1.4))

    def pumpkin():
        parts = [ball('#ff8a2a', (0.34, 0.6, 0.55), (math.cos(a) * 0.2, math.sin(a) * 0.2, 0.3), (0, 0, a)) for a in [i * math.pi / 3 for i in range(6)]]
        parts.append(cyl('#4f7a3a', 0.05, 0.22, (0, 0, 0.66), (R(12), 0, 0), r2=0.03, seg=6))
        return join('p_pumpkin', parts, grad=(0.75, 1.1))

    def crate():
        w, d = '#b98a52', '#8a6238'
        parts = [box(w, (1.0, 1.0, 0.9), (0, 0, 0.45), bevel=0.03, smooth=False)]
        for x in (-0.46, 0.46):
            for y in (-0.46, 0.46):
                parts.append(box(d, (0.12, 0.12, 0.96), (x, y, 0.47), bevel=0.02, smooth=False))
        for z in (0.06, 0.86):
            parts += [box(d, (1.06, 0.1, 0.1), (0, s * 0.48, z), bevel=0.02, smooth=False) for s in (-1, 1)]
            parts += [box(d, (0.1, 1.06, 0.1), (s * 0.48, 0, z), bevel=0.02, smooth=False) for s in (-1, 1)]
        parts.append(box('#ffd23f', (0.5, 0.02, 0.3), (0, -0.51, 0.5), bevel=0, smooth=False))
        return join('p_crate', parts, grad=(0.8, 1.08))

    def jerry():
        r = '#d8362e'
        return join('p_jerry', [
            box(r, (0.5, 0.24, 0.6), (0, 0, 0.3), bevel=0.05),
            box('#a82620', (0.3, 0.26, 0.3), (0, 0, 0.3), bevel=0.02),
            cyl('#2a2a30', 0.06, 0.12, (0.15, 0, 0.66), seg=8),
            box('#2a2a30', (0.26, 0.06, 0.05), (-0.06, 0, 0.7), bevel=0.02),
            box('#2a2a30', (0.05, 0.06, 0.1), (-0.17, 0, 0.64), bevel=0.01), box('#2a2a30', (0.05, 0.06, 0.1), (0.05, 0, 0.64), bevel=0.01),
        ], grad=(0.8, 1.08))

    for f in (pine, tree, dead, rock, cactus, shroom, crystal, pumpkin, crate, jerry):
        f()

    import bpy
    names = [o.name for o in bpy.context.scene.objects if o.type == 'MESH']
    tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH'}
    open(os.path.join(HERE, 'log.txt'), 'a').write(str(tris) + '\n')
    export(os.path.join(HERE, 'boys-day.glb'))
    pose('zombie', [('z_body', (0, 0, 0), (0, 0, 0)), ('z_head', (0, -0.03, 1.6), (R(6), 0, R(8))), ('z_eyes', (0, -0.03, 1.6), (R(6), 0, R(8))),
                    ('z_arm', (0.4, 0, 1.45), (R(80), 0, 0)), ('z_arm', (-0.4, 0, 1.45), (R(62), 0, 0)),
                    ('z_leg', (0.16, 0, 0.72), (R(-14), 0, 0)), ('z_leg', (-0.16, 0, 0.72), (R(16), 0, 0))])
    preview(os.path.join(HERE, 'preview.png'), names=['zombie', 'p_pine', 'p_tree', 'p_dead', 'p_rock', 'p_cactus', 'p_shroom', 'p_crystal', 'p_pumpkin', 'p_crate', 'p_jerry'], cols=4, gap=4.2)
    preview(os.path.join(HERE, 'zombie.png'), names=['zombie'], cols=1, gap=3.2, res=(900, 900))
    bpy.data.objects.remove(bpy.data.objects['zombie'], do_unlink=True)
