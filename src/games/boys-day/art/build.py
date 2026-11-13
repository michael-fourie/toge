# Every Boys Day model, at game scale. Blender: Z up, the front is +Y (the game's -Z after export).
# Parts the game tints per instance (zombies by skin and shirt, leaves and rocks by the world's palette) are near
# white here, shaded darker in the creases; things with their own colours (crates, cans, guns) carry them.
import sys, os, importlib, math
sys.path.insert(0, HERE)
import lib; importlib.reload(lib)
from lib import *
import bpy
R = math.radians
FWD = (R(-90), 0, 0)  # turns a cylinder's axis to +Y
win = bpy.context.window_manager.windows[0]
area = next((a for a in win.screen.areas if a.type == 'VIEW_3D'), win.screen.areas[0])

W, L, M, D, K = '#f4f4f4', '#d2d2d2', '#a8a8a8', '#787878', '#3c3c3c'

def zombie():
    body = join('z_body', [
        blob(W, (0.64, 0.46, 0.72), (0, 0.03, 0.16), (R(-9), 0, 0)),
        blob(W, (0.6, 0.5, 0.42), (0, 0.06, -0.2)),
        blob(D, (0.56, 0.4, 0.26), (0, 0.02, -0.45)),
        box(K, (0.6, 0.44, 0.06), (0, 0.03, -0.34), bevel=0.02),
        box('#c9b060', (0.1, 0.03, 0.08), (0, 0.25, -0.34), bevel=0.01),
        blob(L, (0.22, 0.22, 0.18), (0, 0.04, 0.55)),
        blob(M, (0.34, 0.3, 0.1), (0, 0.06, 0.48)),
        box(D, (0.1, 0.02, 0.22), (0.15, 0.27, 0.1), (R(-9), 0, R(14)), 0),
        box(D, (0.08, 0.02, 0.14), (-0.17, 0.3, -0.12), (0, 0, R(-22)), 0),
        box(D, (0.14, 0.02, 0.06), (-0.08, 0.26, 0.3), (R(-9), 0, R(8)), 0),
    ], grad=(0.78, 1.06))
    head = join('z_head', [
        blob(W, (0.6, 0.56, 0.56), (0, 0, 0)),
        blob(W, (0.46, 0.34, 0.22), (0.01, 0.1, -0.27), (R(8), 0, R(-4))),
        box('#4a2030', (0.28, 0.06, 0.1), (0.01, 0.25, -0.24), (R(8), 0, R(-4)), 0.02),
        box(W, (0.05, 0.03, 0.06), (-0.07, 0.275, -0.2), bevel=0.01),
        box(W, (0.05, 0.03, 0.05), (0.07, 0.275, -0.28), bevel=0.01),
        box(W, (0.04, 0.03, 0.05), (0.0, 0.275, -0.285), bevel=0.01),
        blob(L, (0.1, 0.1, 0.1), (0, 0.29, -0.07)),
        ball(L, (0.1, 0.16, 0.2), (0.31, -0.02, 0.0)),
        ball(L, (0.1, 0.12, 0.13), (-0.31, -0.02, 0.03)),
        blob(M, (0.54, 0.1, 0.08), (0, 0.26, 0.15), (R(-14), 0, R(5))),
        blob(D, (0.5, 0.46, 0.14), (0.02, -0.05, 0.25), (R(6), R(4), 0)),
        blob(D, (0.14, 0.1, 0.16), (0.16, 0.04, 0.33), (0, R(25), 0)),
        blob(D, (0.1, 0.1, 0.13), (-0.1, -0.1, 0.34), (0, R(-20), 0)),
    ], grad=(0.82, 1.06))
    arm = join('z_arm', [
        blob(M, (0.22, 0.22, 0.14), (0, 0, -0.04)),
        blob(W, (0.18, 0.18, 0.3), (0, 0, -0.17)),
        blob(W, (0.15, 0.15, 0.3), (0, 0.01, -0.38)),
        blob(L, (0.2, 0.13, 0.17), (0, 0.02, -0.57)),
        cyl(L, 0.028, 0.12, (-0.07, 0.03, -0.68), (R(-12), 0, 0), 0.014, 6),
        cyl(L, 0.028, 0.13, (0.0, 0.035, -0.69), (R(-16), 0, 0), 0.014, 6),
        cyl(L, 0.028, 0.11, (0.07, 0.03, -0.68), (R(-12), 0, 0), 0.014, 6),
    ], grad=(0.86, 1.04))
    leg = join('z_leg', [
        blob(W, (0.25, 0.27, 0.38), (0, 0, -0.17)),
        blob(L, (0.21, 0.23, 0.26), (0, -0.01, -0.42)),
        blob(D, (0.23, 0.14, 0.06), (0, -0.01, -0.52)),
        blob(K, (0.25, 0.4, 0.15), (0, 0.07, -0.59)),
    ], grad=(0.9, 1.04))

def trees():
    bark = '#7a5233'
    join('p_tree_trunk', [
        cyl(bark, 0.34, 3.0, (0, 0, 1.5), r2=0.2, seg=8),
        cyl(bark, 0.14, 1.5, (0.5, 0, 2.7), (0, R(42), 0), r2=0.08, seg=6),
        cyl(bark, 0.12, 1.3, (-0.4, 0.2, 2.9), (R(-20), R(-38), 0), r2=0.07, seg=6),
        ico(bark, (0.9, 0.9, 0.3), (0, 0, 0.1), sub=1, jitter=0.2, seed=2),
    ], grad=(0.65, 1.05))
    tops = [((0, 0, 4.4), 3.6, W), ((1.4, 0.3, 3.8), 2.4, L), ((-1.3, -0.4, 3.9), 2.6, L), ((0.2, 0.9, 5.5), 2.3, W), ((-0.3, -1.1, 4.9), 2.0, M), ((0.9, -0.9, 4.9), 1.9, W)]
    join('p_tree_top', [ico(c, (s, s, s * 0.82), p, sub=2, jitter=0.28, seed=i + 3) for i, (p, s, c) in enumerate(tops)], grad=(0.62, 1.12))
    join('p_pine_trunk', [cyl('#6a4a2e', 0.3, 1.9, (0, 0, 0.95), r2=0.2, seg=8)], grad=(0.7, 1.0))
    tiers = []
    for i in range(5):
        r = 2.0 - i * 0.36
        tiers.append(cyl([M, L, W, W, W][i], r, 1.9 - i * 0.14, (0.05 * (i % 2), 0.04 * ((i + 1) % 2), 2.0 + i * 1.08), (R(3 * (i % 2)), R(-2 * (i % 2)), R(37 * i)), r2=0.12, seg=9, smooth=False))
    join('p_pine_top', tiers, grad=(0.6, 1.12))
    join('p_dead', [
        cyl(W, 0.3, 4.4, (0, 0, 2.2), (R(3), 0, 0), r2=0.13, seg=7, smooth=False),
        cyl(W, 0.12, 2.0, (0.72, 0, 3.3), (0, R(50), 0), r2=0.04, seg=5, smooth=False),
        cyl(W, 0.11, 1.7, (-0.55, 0.15, 3.8), (0, R(-42), R(20)), r2=0.04, seg=5, smooth=False),
        cyl(W, 0.06, 1.0, (1.4, 0, 4.2), (0, R(12), 0), r2=0.02, seg=5, smooth=False),
        cyl(W, 0.08, 1.3, (0.05, -0.42, 4.6), (R(30), 0, 0), r2=0.03, seg=5, smooth=False),
        cyl(W, 0.05, 0.8, (-1.1, 0.25, 4.6), (0, R(-14), 0), r2=0.02, seg=5, smooth=False),
        ico(W, (0.8, 0.8, 0.3), (0, 0, 0.1), sub=1, jitter=0.25, seed=5),
    ], grad=(0.8, 1.1))
    join('p_rock', [
        ico(W, (2.5, 2.1, 1.7), (0, 0, 0.6), sub=2, jitter=0.38, seed=7),
        ico(L, (1.4, 1.3, 1.0), (1.0, 0.6, 0.4), sub=2, jitter=0.38, seed=8),
        ico(M, (0.9, 1.0, 0.7), (-1.0, -0.6, 0.25), sub=1, jitter=0.3, seed=9),
    ], grad=(0.55, 1.15))
    ribs = [blob(W, (0.62, 0.62, 3.3), (0, 0, 1.65)),
            blob(W, (0.42, 0.42, 1.2), (0.82, 0, 2.1)), blob(W, (0.62, 0.4, 0.4), (0.5, 0, 1.6)),
            blob(W, (0.4, 0.4, 0.9), (-0.8, 0, 2.5)), blob(W, (0.62, 0.38, 0.38), (-0.48, 0, 2.15))]
    for a in range(6):
        ribs.append(box(M, (0.03, 0.03, 2.9), (math.cos(a * math.pi / 3) * 0.3, math.sin(a * math.pi / 3) * 0.3, 1.6), bevel=0, smooth=False))
    join('p_cactus', ribs, grad=(0.62, 1.12))

def things():
    w, d = '#c79658', '#8a6238'
    parts = [box(w, (1.06, 1.06, 0.86), (0, 0, 0.45), bevel=0.03, smooth=False)]
    for x in (-0.5, 0.5):
        for y in (-0.5, 0.5):
            parts.append(box(d, (0.13, 0.13, 0.94), (x, y, 0.47), bevel=0.02, smooth=False))
    for z in (0.06, 0.86):
        parts += [box(d, (1.12, 0.1, 0.1), (0, s * 0.52, z), bevel=0.02, smooth=False) for s in (-1, 1)]
        parts += [box(d, (0.1, 1.12, 0.1), (s * 0.52, 0, z), bevel=0.02, smooth=False) for s in (-1, 1)]
    for s in (-1, 1):
        parts.append(box(d, (0.09, 0.03, 1.15), (0, s * 0.545, 0.46), (0, R(48), 0), bevel=0.01, smooth=False))
        parts.append(box(d, (0.03, 0.09, 1.15), (s * 0.545, 0, 0.46), (R(48), 0, 0), bevel=0.01, smooth=False))
    parts.append(box('#ffd23f', (0.4, 0.4, 0.02), (0, 0, 0.9), (0, 0, R(45)), bevel=0, smooth=False))
    join('p_crate', parts, grad=(0.8, 1.08))
    r, k = '#e03a2e', '#26272e'
    join('p_jerry', [
        box(r, (0.62, 0.32, 0.72), (0, 0, 0), bevel=0.06),
        box('#b02a22', (0.4, 0.34, 0.4), (0, 0, -0.02), bevel=0.02),
        box('#b02a22', (0.34, 0.345, 0.04), (0, 0, -0.02), (0, R(45), 0), bevel=0.01),
        box('#b02a22', (0.34, 0.345, 0.04), (0, 0, -0.02), (0, R(-45), 0), bevel=0.01),
        cyl('#d8d8d8', 0.06, 0.26, (0.24, 0, 0.44), (0, R(35), 0), r2=0.045, seg=8),
        box(k, (0.3, 0.07, 0.06), (-0.08, 0, 0.5), bevel=0.02),
        box(k, (0.06, 0.07, 0.12), (-0.21, 0, 0.42), bevel=0.01), box(k, (0.06, 0.07, 0.12), (0.05, 0, 0.42), bevel=0.01),
    ], grad=(0.82, 1.08))

def guns():
    k, s, wd, m = '#2a2b33', '#8f95a3', '#9a6634', '#454856'
    def base(extra, name):
        parts = [
            box(k, (0.11, 0.44, 0.15), (0, 0, 0), bevel=0.02),
            box(m, (0.115, 0.2, 0.05), (0, 0.02, 0.06), bevel=0.01),
            box(k, (0.075, 0.09, 0.2), (0, -0.11, -0.15), (R(-18), 0, 0), bevel=0.02),
            box(m, (0.03, 0.14, 0.02), (0, 0.0, -0.13), bevel=0.005),
            box(m, (0.03, 0.02, 0.07), (0, 0.07, -0.1), bevel=0.005),
            box(m, (0.02, 0.02, 0.06), (0, 0.0, -0.1), (R(15), 0, 0), bevel=0.005),
            box(k, (0.09, 0.2, 0.11), (0, -0.3, 0.0), bevel=0.02),
            box(m, (0.1, 0.05, 0.16), (0, -0.41, -0.01), bevel=0.02),
        ] + extra
        return join(name, parts, grad=(0.8, 1.1))
    barrel = lambda r, ln, y, x=0, z=0.03, c=k: cyl(c, r, ln, (x, y, z), FWD, seg=10)
    base([barrel(0.034, 0.5, 0.45), barrel(0.045, 0.07, 0.68, c=s), barrel(0.04, 0.26, 0.36, z=-0.06, c=s), cyl(m, 0.05, 0.07, (0, 0.02, 0.1), seg=10)], 'g_0')
    base([barrel(0.05, 0.56, 0.47, -0.046), barrel(0.05, 0.56, 0.47, 0.046), box(m, (0.2, 0.04, 0.1), (0, 0.72, 0.03), bevel=0.01),
          box(wd, (0.17, 0.2, 0.09), (0, 0.4, -0.05), bevel=0.03), box(wd, (0.09, 0.22, 0.13), (0, -0.33, -0.02), (R(-8), 0, 0), bevel=0.03),
          cyl(m, 0.05, 0.07, (0, 0.02, 0.1), seg=10)], 'g_1')
    mini = [barrel(0.02, 0.7, 0.55, math.cos(a) * 0.07, 0.03 + math.sin(a) * 0.07, s) for a in [i * math.pi / 3 for i in range(6)]]
    mini += [barrel(0.1, 0.03, 0.3, c=m), barrel(0.1, 0.03, 0.6, c=m), barrel(0.1, 0.04, 0.88, c=m), barrel(0.03, 0.72, 0.55, c=k),
             box(m, (0.03, 0.2, 0.03), (0, 0.1, 0.16), bevel=0.01), box(m, (0.03, 0.03, 0.09), (0, 0.19, 0.12), bevel=0.01), box(m, (0.03, 0.03, 0.09), (0, 0.01, 0.12), bevel=0.01)]
    base(mini, 'g_2')
    base([barrel(0.03, 1.1, 0.75), barrel(0.045, 0.14, 1.26, c=m), barrel(0.046, 0.36, 0.02, z=0.15, c=m), barrel(0.058, 0.05, 0.2, z=0.15, c=k), barrel(0.052, 0.05, -0.16, z=0.15, c=k),
          box(m, (0.03, 0.04, 0.05), (0, 0.1, 0.1), bevel=0.005), box(m, (0.03, 0.04, 0.05), (0, -0.08, 0.1), bevel=0.005),
          box(wd, (0.09, 0.3, 0.14), (0, -0.36, -0.03), (R(-8), 0, 0), bevel=0.03),
          cyl(m, 0.012, 0.3, (0.07, 0.9, -0.1), (R(-25), R(20), 0), seg=6), cyl(m, 0.012, 0.3, (-0.07, 0.9, -0.1), (R(-25), R(-20), 0), seg=6)], 'g_3')
    b = '#3a6aa8'
    base([cyl(b, 0.09, 0.62, (0, 0.46, 0.03), FWD, r2=0.115, seg=14), barrel(0.125, 0.05, 0.75, c='#ffd23f'), barrel(0.105, 0.04, 0.3, c='#ffd23f'), barrel(0.1, 0.04, 0.5, c=m),
          box(m, (0.03, 0.12, 0.08), (0, 0.4, 0.15), bevel=0.01), box(k, (0.12, 0.1, 0.18), (0, -0.44, 0.0), bevel=0.04)], 'g_4')

with bpy.context.temp_override(window=win, screen=win.screen, area=area):
    reset()
    zombie(); trees(); things(); guns()
    tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH'}
    open(os.path.join(HERE, 'log.txt'), 'a').write(str(tris) + '\ntotal ' + str(sum(tris.values())) + '\n')
    export(os.path.join(HERE, 'boys-day.glb'))
    Z = (0, 0, 0)
    pose('zombie', [('z_body', (0, 0, 0.95), Z), ('z_head', (0, 0.08, 1.6), (0, R(10), 0)),
                    ('z_arm', (0.36, 0, 1.35), (R(83), 0, 0)), ('z_arm', (-0.36, 0, 1.35), (R(75), 0, 0)),
                    ('z_leg', (0.14, 0, 0.62), (R(20), 0, 0)), ('z_leg', (-0.14, 0, 0.62), (R(-20), 0, 0))])
    pose('tree', [('p_tree_trunk', Z, Z), ('p_tree_top', Z, Z)]); pose('pine', [('p_pine_trunk', Z, Z), ('p_pine_top', Z, Z)])
    preview(os.path.join(HERE, 'zombie.png'), names=['zombie'], cols=1, gap=1, res=(900, 900), close=(1.0, 3.4, 1.5))
    preview(os.path.join(HERE, 'guns.png'), names=['g_0', 'g_1', 'g_2', 'g_3', 'g_4'], cols=5, gap=0.8, res=(1600, 600), close=(0.3, 3.2, 1.3), side=True)
    preview(os.path.join(HERE, 'preview.png'), names=['tree', 'pine', 'p_dead', 'p_rock', 'p_cactus', 'p_crate', 'p_jerry', 'zombie'], cols=4, gap=5.5)
    for n in ('zombie', 'tree', 'pine'):
        bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)
