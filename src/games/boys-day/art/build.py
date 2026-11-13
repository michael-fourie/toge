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
    k, s, wd, m, hz, og = '#23242c', '#9aa1b0', '#a06a36', '#4a4e5e', '#ffd23f', '#ff7a1a'
    P = '#ffffff'  # the paint parts: tinted with your colour in the game
    barrel = lambda r, ln, y, x=0, z=0.03, c=k, seg=12: cyl(c, r, ln, (x, y, z), FWD, seg=seg)
    def frame(stock=True):
        parts = [
            box(k, (0.11, 0.46, 0.15), (0, 0, 0), bevel=0.025),
            box(m, (0.118, 0.26, 0.045), (0, 0.03, 0.065), bevel=0.01),
            box(hz, (0.114, 0.05, 0.05), (0, -0.14, 0.02), (0, 0, 0), bevel=0.005),
            box(k, (0.114, 0.012, 0.05), (0, -0.14, 0.02), (R(35), 0, 0), bevel=0),
            box(k, (0.078, 0.095, 0.22), (0, -0.12, -0.16), (R(-18), 0, 0), bevel=0.025),
            box(wd, (0.084, 0.07, 0.16), (0, -0.125, -0.17), (R(-18), 0, 0), bevel=0.02),
            box(m, (0.03, 0.15, 0.018), (0, 0.0, -0.135), bevel=0.005),
            box(m, (0.03, 0.018, 0.07), (0, 0.075, -0.105), bevel=0.005),
            box(s, (0.018, 0.02, 0.06), (0, 0.0, -0.1), (R(15), 0, 0), bevel=0.005),
            cyl(s, 0.014, 0.125, (0, 0.1, 0.03), (0, R(90), 0), seg=8), cyl(s, 0.014, 0.125, (0, -0.06, -0.03), (0, R(90), 0), seg=8),
        ]
        if stock:
            parts += [box(k, (0.07, 0.24, 0.07), (0, -0.33, 0.02), bevel=0.02), box(m, (0.09, 0.05, 0.19), (0, -0.46, -0.02), bevel=0.02),
                      box(k, (0.05, 0.2, 0.04), (0, -0.36, -0.08), (R(14), 0, 0), bevel=0.015)]
        return parts
    # 0: the Marker. A fat barrel with porting, an air tank, a feed neck for the hopper.
    join('g_0', frame() + [
        barrel(0.036, 0.52, 0.47), barrel(0.046, 0.1, 0.7, c=m), barrel(0.05, 0.03, 0.76, c=og), barrel(0.042, 0.03, 0.4, c=s), barrel(0.042, 0.03, 0.5, c=s),
        barrel(0.045, 0.3, 0.38, z=-0.07, c=s), barrel(0.05, 0.04, 0.55, z=-0.07, c=k), barrel(0.03, 0.06, 0.2, z=-0.07, c=k),
        cyl(m, 0.055, 0.1, (0, 0.03, 0.12), seg=12), box(m, (0.02, 0.3, 0.03), (0.065, 0.2, 0.03), bevel=0.005),
        box(k, (0.05, 0.07, 0.14), (0, 0.33, -0.1), (R(20), 0, 0), bevel=0.02),
    ], grad=(0.8, 1.1))
    join('g_0_paint', [blob(P, (0.24, 0.36, 0.22), (0, 0.04, 0.27)), cyl(P, 0.05, 0.03, (0, -0.02, 0.385), seg=10)], grad=(0.85, 1.1))
    # 1: the Splatter Shotty. Sawn-off, two fat barrels, a wooden pump, shells down the side.
    shot = frame(stock=False) + [
        barrel(0.055, 0.5, 0.46, -0.05, seg=14), barrel(0.055, 0.5, 0.46, 0.05, seg=14),
        barrel(0.062, 0.05, 0.69, -0.05, c=m, seg=14), barrel(0.062, 0.05, 0.69, 0.05, c=m, seg=14),
        barrel(0.04, 0.02, 0.72, -0.05, c='#0a0a0c'), barrel(0.04, 0.02, 0.72, 0.05, c='#0a0a0c'),
        box(m, (0.22, 0.05, 0.13), (0, 0.24, 0.03), bevel=0.015), box(s, (0.02, 0.4, 0.02), (0, 0.46, 0.09), bevel=0.005), ball(hz, (0.03, 0.03, 0.03), (0, 0.67, 0.105)),
        box(wd, (0.19, 0.22, 0.1), (0, 0.42, -0.06), bevel=0.035),
        box(wd, (0.09, 0.26, 0.14), (0, -0.34, -0.04), (R(-12), 0, 0), bevel=0.035), box(k, (0.095, 0.03, 0.15), (0, -0.47, -0.065), (R(-12), 0, 0), bevel=0.01),
    ]
    for i in range(4):
        shot.append(box('#5a3a1e', (0.195, 0.012, 0.085), (0, 0.345 + i * 0.05, -0.06), bevel=0))
    join('g_1', shot, grad=(0.8, 1.1))
    join('g_1_paint', [cyl(P, 0.022, 0.07, (0.07, -0.08 + i * 0.055, 0.03), (0, 0, 0), seg=8) for i in range(4)] + [box(P, (0.02, 0.26, 0.03), (0.062, 0.0, -0.01), bevel=0.005)], grad=None)
    # 2: the Paint Minigun. Six barrels in clamps, a motor, a carry handle, spade grips.
    mini = frame(stock=False)
    mini += [barrel(0.021, 0.74, 0.58, math.cos(a) * 0.075, 0.03 + math.sin(a) * 0.075, s, 8) for a in [i * math.pi / 3 for i in range(6)]]
    mini += [barrel(0.108, 0.035, 0.3, c=m, seg=16), barrel(0.108, 0.03, 0.62, c=k, seg=16), barrel(0.108, 0.045, 0.93, c=m, seg=16), barrel(0.03, 0.76, 0.58, c=k),
             barrel(0.095, 0.14, 0.18, c=k, seg=16), barrel(0.1, 0.02, 0.12, c=hz, seg=16),
             box(m, (0.026, 0.24, 0.026), (0, 0.16, 0.2), bevel=0.01), box(m, (0.026, 0.026, 0.1), (0, 0.27, 0.15), bevel=0.01), box(m, (0.026, 0.026, 0.1), (0, 0.05, 0.15), bevel=0.01),
             box(k, (0.2, 0.03, 0.03), (0, -0.27, 0.02), bevel=0.01), box(k, (0.03, 0.03, 0.16), (0.09, -0.27, -0.04), bevel=0.012), box(k, (0.03, 0.03, 0.16), (-0.09, -0.27, -0.04), bevel=0.012),
             box(k, (0.16, 0.2, 0.2), (-0.14, 0.02, -0.03), bevel=0.02), box(hz, (0.165, 0.05, 0.05), (-0.14, 0.02, 0.02), bevel=0.005)]
    join('g_2', mini, grad=(0.8, 1.1))
    join('g_2_paint', [cyl(P, 0.16, 0.13, (0.12, 0.0, -0.08), (0, R(90), 0), seg=18), cyl(P, 0.05, 0.14, (0.12, 0.0, -0.08), (0, R(90), 0), seg=10)] +
         [ball(P, (0.045, 0.045, 0.045), (0.07 - i * 0.012, 0.1 + i * 0.03, 0.0 + i * 0.02)) for i in range(4)], grad=(0.8, 1.1))
    # 3: the Long Tom. A long fluted barrel, a brake, a fat scope, a bipod, a cheek rest.
    tom = frame() + [
        barrel(0.03, 1.15, 0.8), barrel(0.04, 0.5, 0.5, c=m), barrel(0.052, 0.16, 1.4, c=k), barrel(0.058, 0.03, 1.36, c=og), barrel(0.058, 0.03, 1.44, c=m),
        barrel(0.05, 0.4, 0.03, z=0.165, c=k, seg=14), barrel(0.064, 0.08, 0.25, z=0.165, c=m, seg=14), barrel(0.058, 0.07, -0.19, z=0.165, c=m, seg=14),
        barrel(0.052, 0.012, 0.293, z=0.165, c='#5fe0ff', seg=14),
        box(m, (0.03, 0.04, 0.06), (0, 0.12, 0.11), bevel=0.005), box(m, (0.03, 0.04, 0.06), (0, -0.08, 0.11), bevel=0.005),
        cyl(s, 0.025, 0.05, (0, 0.03, 0.225), seg=8), cyl(s, 0.012, 0.09, (0.09, -0.05, 0.05), (0, R(90), 0), seg=6), ball(s, (0.04, 0.04, 0.04), (0.14, -0.05, 0.05)),
        box(wd, (0.08, 0.2, 0.05), (0, -0.33, 0.085), bevel=0.02),
        tube(m, (0.02, 0.98, 0.0), (0.16, 1.06, -0.3), 0.012), tube(m, (-0.02, 0.98, 0.0), (-0.16, 1.06, -0.3), 0.012), barrel(0.045, 0.05, 0.98, c=m),
        box(k, (0.03, 0.03, 0.03), (0.165, 1.065, -0.31), bevel=0.01), box(k, (0.03, 0.03, 0.03), (-0.165, 1.065, -0.31), bevel=0.01),
    ]
    for i in range(5):
        tom.append(barrel(0.044, 0.02, 0.32 + i * 0.09, c=k))
    join('g_3', tom, grad=(0.8, 1.1))
    join('g_3_paint', [box(P, (0.06, 0.1, 0.2), (0, 0.13, -0.16), (R(8), 0, 0), bevel=0.02), cyl(P, 0.02, 0.5, (0, 0.5, 0.085), FWD, seg=8)], grad=(0.85, 1.1))
    # 4: the Balloon Launcher. A fat flared tube, a revolver drum of balloons, a ladder sight, a shoulder pad.
    b = '#3a6aa8'
    join('g_4', frame() + [
        cyl(b, 0.095, 0.5, (0, 0.5, 0.04), FWD, r2=0.12, seg=16), cyl(b, 0.12, 0.12, (0, 0.8, 0.04), FWD, r2=0.16, seg=16),
        barrel(0.165, 0.03, 0.865, z=0.04, c=hz, seg=16), barrel(0.105, 0.04, 0.27, z=0.04, c=m, seg=16), barrel(0.125, 0.035, 0.6, z=0.04, c=m, seg=16),
        barrel(0.13, 0.016, 0.875, z=0.04, c='#0a0a0c', seg=16),
        box(m, (0.02, 0.02, 0.14), (0, 0.55, 0.2), bevel=0.005), box(m, (0.07, 0.02, 0.02), (0, 0.55, 0.26), bevel=0.005), box(m, (0.07, 0.02, 0.02), (0, 0.55, 0.21), bevel=0.005),
        box(k, (0.13, 0.08, 0.2), (0, -0.5, -0.01), bevel=0.04), box(og, (0.114, 0.03, 0.05), (0, 0.18, 0.02), bevel=0.005),
        box(k, (0.05, 0.08, 0.15), (0, 0.42, -0.12), (R(15), 0, 0), bevel=0.02),
    ], grad=(0.8, 1.1))
    drum = [cyl(m, 0.05, 0.16, (0, 0.14, -0.14), FWD, seg=10)]
    join('g_4_paint', [ball(P, (0.1, 0.13, 0.1), (math.cos(a) * 0.1, 0.14, -0.14 + math.sin(a) * 0.1)) for a in [i * math.pi * 2 / 5 + 0.3 for i in range(5)]] + [ball(P, (0.2, 0.22, 0.2), (0, 0.93, 0.04))], grad=(0.85, 1.1))
    join('g_4_drum', drum, grad=(0.8, 1.1))

def boys():
    Wc = '#f4f4f4'
    # Shirt: torso, shoulders, both arms out to the marker (right hand on the grip, left under the barrel).
    rs, ls, rh, lh = (0.27, 0.0, 1.1), (-0.27, 0.0, 1.1), (0.26, 0.2, 0.78), (0.16, 0.44, 0.84)
    re, le = (0.36, 0.06, 0.86), (-0.2, 0.26, 0.86)
    join('b_shirt', [
        blob(Wc, (0.52, 0.34, 0.5), (0, 0, 0.95)), blob(Wc, (0.62, 0.3, 0.2), (0, 0, 1.1)), blob(Wc, (0.48, 0.32, 0.16), (0, 0, 0.72)),
        tube(Wc, rs, re, 0.085), tube(Wc, re, rh, 0.075, 0.065), tube(Wc, ls, le, 0.085), tube(Wc, le, lh, 0.075, 0.065),
        ball(Wc, (0.18, 0.18, 0.18), re), ball(Wc, (0.18, 0.18, 0.18), le),
    ], grad=(0.8, 1.06))
    join('b_trim', [box(Wc, (0.5, 0.345, 0.07), (0, 0.0, 0.98), bevel=0.02), blob(Wc, (0.3, 0.3, 0.07), (0, 0.0, 1.2))], grad=None)
    join('b_pants', [
        blob(Wc, (0.5, 0.33, 0.2), (0, 0, 0.6)),
        blob(Wc, (0.21, 0.24, 0.5), (0.13, 0, 0.32)), blob(Wc, (0.21, 0.24, 0.5), (-0.13, 0, 0.32)),
    ], grad=(0.78, 1.04))
    join('b_shoes', [blob(Wc, (0.23, 0.38, 0.14), (0.13, 0.06, 0.07)), blob(Wc, (0.23, 0.38, 0.14), (-0.13, 0.06, 0.07)),
                     box('#b8b8b8', (0.24, 0.39, 0.04), (0.13, 0.06, 0.02), bevel=0.015), box('#b8b8b8', (0.24, 0.39, 0.04), (-0.13, 0.06, 0.02), bevel=0.015)], grad=None)
    join('b_skin', [
        blob(Wc, (0.56, 0.52, 0.54), (0, 0.01, 1.5)), blob(Wc, (0.2, 0.2, 0.14), (0, 0, 1.2)),
        ball(Wc, (0.1, 0.14, 0.17), (0.28, 0.0, 1.48)), ball(Wc, (0.1, 0.14, 0.17), (-0.28, 0.0, 1.48)),
        blob('#e6e6e6', (0.09, 0.1, 0.09), (0, 0.27, 1.45)),
        blob(Wc, (0.13, 0.13, 0.12), rh), blob(Wc, (0.13, 0.13, 0.12), lh),
    ], grad=(0.88, 1.05))
    eye, wh = '#18181c', '#ffffff'
    join('b_face', [
        ball(wh, (0.13, 0.06, 0.15), (0.12, 0.245, 1.53)), ball(wh, (0.13, 0.06, 0.15), (-0.12, 0.245, 1.53)),
        ball(eye, (0.07, 0.04, 0.08), (0.12, 0.27, 1.525)), ball(eye, (0.07, 0.04, 0.08), (-0.12, 0.27, 1.525)),
        box(eye, (0.14, 0.03, 0.03), (0.12, 0.26, 1.635), (0, R(8), 0), bevel=0.01), box(eye, (0.14, 0.03, 0.03), (-0.12, 0.26, 1.635), (0, R(-8), 0), bevel=0.01),
        box('#7a2a2a', (0.16, 0.03, 0.035), (0.01, 0.26, 1.36), (0, R(-4), 0), bevel=0.012),
    ], grad=None)
    H = lambda n, parts: join('h_' + n, parts, grad=(0.75, 1.1))
    cap_ = lambda sz=(0.6, 0.56, 0.3), z=1.68: blob(Wc, sz, (0, -0.02, z))
    H('buzz', [blob(Wc, (0.575, 0.535, 0.3), (0, 0.0, 1.645))])
    H('short', [cap_(), blob(Wc, (0.5, 0.2, 0.16), (0, 0.2, 1.74), (R(-18), 0, 0)), blob(Wc, (0.6, 0.3, 0.3), (0, -0.14, 1.56))])
    H('medium', [cap_((0.62, 0.58, 0.34), 1.68), blob(Wc, (0.56, 0.22, 0.2), (0.03, 0.2, 1.72), (R(-22), 0, R(8))), blob(Wc, (0.64, 0.34, 0.42), (0, -0.14, 1.5)),
                 blob(Wc, (0.12, 0.3, 0.3), (0.29, -0.02, 1.56)), blob(Wc, (0.12, 0.3, 0.3), (-0.29, -0.02, 1.56))])
    H('swept', [cap_((0.62, 0.58, 0.34), 1.68), blob(Wc, (0.5, 0.34, 0.22), (0.08, 0.14, 1.8), (R(-30), R(14), R(18))), blob(Wc, (0.3, 0.26, 0.2), (-0.14, 0.2, 1.76), (R(-20), 0, 0)),
                blob(Wc, (0.62, 0.32, 0.36), (0, -0.14, 1.53))])
    H('shaggy', [cap_((0.66, 0.62, 0.36), 1.68), blob(Wc, (0.6, 0.24, 0.2), (0, 0.22, 1.7), (R(-10), 0, 0)), blob(Wc, (0.68, 0.4, 0.5), (0, -0.13, 1.45)),
                 blob(Wc, (0.16, 0.36, 0.44), (0.3, 0.0, 1.47)), blob(Wc, (0.16, 0.36, 0.44), (-0.3, 0.0, 1.47)),
                 blob(Wc, (0.2, 0.16, 0.2), (0.18, 0.24, 1.66), (0, R(20), 0)), blob(Wc, (0.2, 0.16, 0.2), (-0.16, 0.25, 1.64), (0, R(-20), 0))])
    H('verylong', [cap_((0.64, 0.6, 0.34), 1.68), blob(Wc, (0.5, 0.18, 0.14), (0, 0.22, 1.76), (R(-14), 0, 0)), blob(Wc, (0.66, 0.36, 0.9), (0, -0.16, 1.22)),
                   blob(Wc, (0.14, 0.3, 0.8), (0.3, 0.02, 1.3)), blob(Wc, (0.14, 0.3, 0.8), (-0.3, 0.02, 1.3)), blob(Wc, (0.5, 0.2, 0.3), (0, -0.2, 0.8))])
    join('hat_cap', [blob(Wc, (0.6, 0.56, 0.26), (0, -0.01, 1.72)), box(Wc, (0.4, 0.3, 0.035), (0, 0.36, 1.66), (R(-8), 0, 0), bevel=0.015), ball('#d0d0d0', (0.06, 0.06, 0.04), (0, -0.01, 1.855))], grad=(0.8, 1.08))
    join('hat_toque', [blob(Wc, (0.62, 0.58, 0.36), (0, -0.01, 1.72)), ring('#e0e0e0', 0.29, 0.045, (0, -0.01, 1.62)), ball('#ffffff', (0.15, 0.15, 0.15), (0, -0.01, 1.94))], grad=(0.82, 1.08))
    # Your paint colour: an armband and a bandana at the neck.
    join('b_band', [ring(Wc, 0.095, 0.03, (0.315, 0.03, 0.98), (0, R(60), R(-30)), seg=12), blob(Wc, (0.3, 0.3, 0.09), (0, 0.02, 1.245)), blob(Wc, (0.16, 0.06, 0.16), (0, 0.16, 1.17), (R(20), R(45), 0))], grad=None)

def bus():
    k, m, s, y, rust, red = '#23242c', '#4a4e5e', '#aab0bd', '#f2a516', '#9b4a1c', '#d8362e'
    Wd, F, B = 1.35, 5.5, -5.5
    parts = [
        # Front: a bull-nosed bumper, a grille, headlight pods, wipers, mirrors on stalks, marker lights, tow hooks.
        box(k, (2.86, 0.3, 0.34), (0, F + 0.14, 0.58), bevel=0.08), box(s, (2.5, 0.06, 0.1), (0, F + 0.3, 0.58), bevel=0.02),
        box(k, (1.5, 0.08, 0.5), (0, F + 0.03, 1.08), bevel=0.03),
    ]
    for i in range(6):
        parts.append(box(s, (1.4, 0.05, 0.035), (0, F + 0.08, 0.89 + i * 0.075), bevel=0.01))
    for sx in (-1, 1):
        parts += [cyl(k, 0.21, 0.12, (sx * 1.0, F + 0.05, 1.1), FWD, seg=14), cyl(s, 0.215, 0.03, (sx * 1.0, F + 0.11, 1.1), FWD, seg=14),
                  tube(k, (sx * 1.3, F - 0.1, 2.25), (sx * 1.72, F + 0.25, 2.2), 0.025), box(k, (0.07, 0.2, 0.36), (sx * 1.74, F + 0.25, 2.2), bevel=0.03),
                  box(s, (0.02, 0.16, 0.3), (sx * 1.74 - sx * 0.03, F + 0.22, 2.2), bevel=0.005),
                  box(k, (0.03, 0.03, 0.5), (sx * 0.45, F + 0.02, 1.85), (0, R(sx * -40), 0), bevel=0.01),
                  tube(s, (sx * 0.7, F + 0.2, 0.5), (sx * 0.7, F + 0.42, 0.42), 0.03), ring(s, 0.05, 0.018, (sx * 0.7, F + 0.45, 0.4), (R(90), 0, 0), seg=10),
                  # Wheel arches and mud flaps.
                  ]
        for wy in (3.5, -3.3):
            for a in range(7):
                ang = math.pi * a / 6
                parts.append(box(k, (0.16, 0.36, 0.09), (sx * (Wd + 0.03), wy + math.cos(ang) * 0.7, 0.55 + math.sin(ang) * 0.7), (ang - math.pi / 2, 0, 0), bevel=0.03))
            parts.append(box(k, (0.04, 0.03, 0.42), (sx * (Wd - 0.05), wy - 0.74, 0.36), bevel=0.01))
        # A rub rail with rivets, rocker panel, patched and dented plates.
        parts.append(box(s, (0.04, 10.6, 0.07), (sx * (Wd + 0.02), 0, 1.02), bevel=0.015))
        for i in range(22):
            parts.append(ball(s, (0.05, 0.05, 0.05), (sx * (Wd + 0.035), -5.0 + i * 0.47, 1.66), seg=6))
        for py, pz, pw, ph, rz in ((1.8 * sx, 1.25, 0.9, 0.45, 4), (-2.4 * sx, 1.4, 0.7, 0.5, -6), (-4.2, 1.3, 0.6, 0.36, 3)):
            parts.append(box(rust, (0.035, pw, ph), (sx * (Wd + 0.02), py, pz), (R(rz), 0, 0), bevel=0.01))
            for cx in (-1, 1):
                for cz in (-1, 1):
                    parts.append(ball(s, (0.045, 0.045, 0.045), (sx * (Wd + 0.045), py + cx * (pw / 2 - 0.06), pz + cz * (ph / 2 - 0.06)), seg=6))
        # Tail lights.
        parts += [box(red, (0.3, 0.05, 0.22), (sx * 1.05, B - 0.03, 1.2), bevel=0.03), box('#ffb03a', (0.2, 0.05, 0.14), (sx * 1.05, B - 0.03, 1.48), bevel=0.02)]
    # The back: bumper, a spare tyre, an exhaust, the engine hatch, a ladder to the roof.
    parts += [box(k, (2.8, 0.26, 0.3), (0, B - 0.12, 0.58), bevel=0.07), box(m, (1.5, 0.05, 0.75), (0, B - 0.02, 1.25), bevel=0.02),
              cyl(k, 0.5, 0.26, (0, B - 0.2, 1.3), FWD, seg=16), cyl(s, 0.22, 0.28, (0, B - 0.2, 1.3), FWD, seg=10),
              tube(s, (0.9, B + 0.4, 0.4), (0.9, B - 0.35, 0.36), 0.06), tube(k, (0.9, B - 0.3, 0.36), (0.9, B - 0.42, 0.36), 0.07)]
    for i in range(5):
        parts.append(box(k, (1.4, 0.06, 0.03), (0, B - 0.03, 0.98 + i * 0.13), bevel=0.01))
    for sx in (-0.95, -0.6):
        parts.append(tube(s, (sx, B - 0.08, 1.7), (sx, B - 0.08, 3.1), 0.025))
    for i in range(5):
        parts.append(tube(s, (-0.95, B - 0.08, 1.85 + i * 0.28), (-0.6, B - 0.08, 1.85 + i * 0.28), 0.02))
    # A folded stop arm on the driver's side, roof marker lights.
    parts += [cyl(red, 0.26, 0.04, (-Wd - 0.06, 2.2, 1.35), (0, R(90), 0), seg=8, smooth=False), cyl('#ffffff', 0.2, 0.05, (-Wd - 0.065, 2.2, 1.35), (0, R(90), 0), seg=8, smooth=False)]
    for i in range(5):
        parts.append(blob('#ffb03a', (0.14, 0.08, 0.07), ((i - 2) * 0.4, F - 0.08, 2.93)))
    join('bus_body', parts, grad=(0.78, 1.08))
    # A wheel: a chunky tyre with tread blocks, a dished hub, lug nuts. Its axle is X.
    tyre = [cyl('#1b1b20', 0.5, 0.42, (0, 0, 0), (0, R(90), 0), seg=20), cyl('#2a2a31', 0.34, 0.44, (0, 0, 0), (0, R(90), 0), seg=16),
            cyl(s, 0.2, 0.47, (0, 0, 0), (0, R(90), 0), seg=10), cyl(y, 0.1, 0.5, (0, 0, 0), (0, R(90), 0), seg=8)]
    for a in range(14):
        ang = a * math.pi * 2 / 14
        tyre.append(box('#1b1b20', (0.44, 0.12, 0.09), (0, math.cos(ang) * 0.51, math.sin(ang) * 0.51), (ang - math.pi / 2, 0, 0), bevel=0.02))
    for a in range(6):
        ang = a * math.pi / 3
        tyre += [ball(k, (0.06, 0.06, 0.06), (0.23, math.cos(ang) * 0.15, math.sin(ang) * 0.15), seg=6), ball(k, (0.06, 0.06, 0.06), (-0.23, math.cos(ang) * 0.15, math.sin(ang) * 0.15), seg=6)]
    join('bus_wheel', tyre, grad=None)
    # --- The parts you buy at the store.
    hzd, blk = '#ffd23f', '#1e1e24'
    plow = []
    for sx in (-1, 1):
        # A V snow blade: two curved halves in hazard stripes, a cutting edge, struts back to the bumper.
        for i in range(5):
            t = i / 4
            plow.append(box(hzd if i % 2 == 0 else blk, (1.75, 0.07, 0.3), (sx * 0.86, F + 1.1 - 0.42 + 0.0, 0.3 + i * 0.27), (R(-8 + t * 34), 0, R(sx * -24)), bevel=0.02))
        plow += [box(s, (1.8, 0.05, 0.12), (sx * 0.86, F + 0.72, 0.16), (R(-12), 0, R(sx * -24)), bevel=0.01),
                 tube(m, (sx * 0.9, F + 0.2, 0.6), (sx * 0.9, F + 0.62, 0.7), 0.05), tube(m, (sx * 0.4, F + 0.2, 0.75), (sx * 0.4, F + 0.95, 1.1), 0.04)]
    plow.append(box(m, (0.16, 0.2, 1.3), (0, F + 1.1, 0.85), (R(14), 0, 0), bevel=0.04))
    join('bus_plow', plow, grad=(0.8, 1.08))
    def fork(sx, yy, zz, tilt):
        base = Vector((sx * (Wd + 0.02), yy, zz)); d = Vector((sx * math.cos(R(tilt)), 0.25, math.sin(R(tilt)))).normalized()
        tip = base + d * 0.85
        out = [tube('#8a6238', base - d * 0.1, tip, 0.03), box(m, (0.06, 0.3, 0.05), tuple(tip), (0, 0, 0), bevel=0.01), box(m, (0.1, 0.12, 0.1), tuple(base), bevel=0.02)]
        for o in (-0.13, 0, 0.13):
            a = tip + Vector((0, o, 0))
            out.append(tube(s, a, a + d * 0.42, 0.018, 0.004, seg=6))
        return out
    f1, f2 = [], []
    for sx in (-1, 1):
        for i, yy in enumerate((4.3, 2.3, 0.3, -1.7, -3.9)):
            (f1 if i % 2 == 0 else f2).extend(fork(sx, yy, 1.15, 8))
        for yy in (3.3, -0.7, -2.8):
            f2.extend(fork(sx, yy, 1.5, 22))
    join('bus_forks_1', f1, grad=None); join('bus_forks_2', f2, grad=None)
    a1, a2 = [], []
    plate = lambda sx, yy, zz, w_, h_, rot, c: [box(c, (0.05, w_, h_), (sx * (Wd + 0.05), yy, zz), (R(rot), 0, 0), bevel=0.012)] + [ball(s, (0.05, 0.05, 0.05), (sx * (Wd + 0.085), yy + cx * (w_ / 2 - 0.07), zz + cz * (h_ / 2 - 0.07)), seg=6) for cx in (-1, 1) for cz in (-1, 1)]
    for sx in (-1, 1):
        for i, (yy, w_, rot, c) in enumerate(((4.4, 1.5, 2, m), (2.6, 1.7, -3, '#5a5f70'), (0.7, 1.6, 4, m), (-1.2, 1.8, -2, '#6a5a4a'), (-3.0, 1.5, 3, m), (-4.6, 1.4, -4, '#5a5f70'))):
            (a1 if i % 2 == 0 else a2).extend(plate(sx, yy, 1.32, w_, 0.62, rot, c))
        a2 += [box(m, (0.06, 10.4, 0.1), (sx * (Wd + 0.05), 0, 2.72), bevel=0.02)]
        for i in range(9):
            a2.append(tube(s, (sx * (Wd + 0.05), -4.6 + i * 1.15, 2.76), (sx * (Wd + 0.28), -4.6 + i * 1.15, 2.98), 0.03, 0.004, seg=6))
    a1 += [tube(m, (-1.0, F + 0.3, 0.6), (-1.0, F + 0.34, 1.5), 0.045), tube(m, (1.0, F + 0.3, 0.6), (1.0, F + 0.34, 1.5), 0.045), tube(m, (-1.0, F + 0.34, 1.5), (1.0, F + 0.34, 1.5), 0.045), tube(m, (-1.0, F + 0.33, 1.05), (1.0, F + 0.33, 1.05), 0.04)]
    join('bus_armor_1', a1, grad=(0.8, 1.06)); join('bus_armor_2', a2, grad=(0.8, 1.06))
    eng = []
    for sx in (-1, 1):
        eng += [tube(s, (sx * (Wd + 0.12), -4.6, 0.9), (sx * (Wd + 0.12), -4.6, 3.75), 0.085), tube(k, (sx * (Wd + 0.12), -4.6, 3.6), (sx * (Wd + 0.12), -4.6, 3.95), 0.1, 0.11),
                box(m, (0.12, 0.2, 0.08), (sx * (Wd + 0.06), -4.6, 1.6), bevel=0.02), box(m, (0.12, 0.2, 0.08), (sx * (Wd + 0.06), -4.6, 2.7), bevel=0.02)]
    eng += [box(red, (0.9, 0.5, 0.36), (0, F + 0.05, 1.62), bevel=0.06), box(k, (0.8, 0.1, 0.24), (0, F + 0.3, 1.62), bevel=0.02)] + [box(s, (0.76, 0.03, 0.03), (0, F + 0.35, 1.54 + i * 0.07), bevel=0.005) for i in range(3)]
    join('bus_engine', eng, grad=(0.8, 1.08))
    tank = [cyl('#3f7a4a', 0.3, 0.9, (-0.45, B - 0.62, 1.05), seg=14), cyl(red, 0.3, 0.9, (0.55, B - 0.62, 1.05), seg=14), box(k, (1.9, 0.5, 0.08), (0.05, B - 0.55, 0.56), bevel=0.02),
            box(m, (1.95, 0.04, 0.06), (0.05, B - 0.9, 1.25), bevel=0.01), box(m, (1.95, 0.04, 0.06), (0.05, B - 0.9, 0.85), bevel=0.01)]
    for x0 in (-0.45, 0.55):
        tank += [ring(k, 0.305, 0.02, (x0, B - 0.62, 1.3), seg=14), ring(k, 0.305, 0.02, (x0, B - 0.62, 0.8), seg=14), cyl(s, 0.05, 0.08, (x0 + 0.12, B - 0.62, 1.53), seg=8)]
    join('bus_tank', tank, grad=(0.8, 1.08))
    hop = [cyl('#ffffff', 0.34, 0.5, (0.85, 4.2, 3.34), seg=16), cyl(k, 0.36, 0.06, (0.85, 4.2, 3.1), seg=16), cyl(k, 0.2, 0.08, (0.85, 4.2, 3.62), seg=12), tube(m, (0.85, 4.2, 3.1), (0.85, 4.2, 2.95), 0.08)]
    join('bus_hopper', hop, grad=(0.85, 1.08))

with bpy.context.temp_override(window=win, screen=win.screen, area=area):
    reset()
    zombie(); trees(); things(); guns(); boys(); bus()
    tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH'}
    open(os.path.join(HERE, 'log.txt'), 'a').write(str(tris) + '\ntotal ' + str(sum(tris.values())) + '\n')
    export(os.path.join(HERE, 'boys-day.glb'))
    Z = (0, 0, 0)
    pose('zombie', [('z_body', (0, 0, 0.95), Z), ('z_head', (0, 0.08, 1.6), (0, R(10), 0)),
                    ('z_arm', (0.36, 0, 1.35), (R(83), 0, 0)), ('z_arm', (-0.36, 0, 1.35), (R(75), 0, 0)),
                    ('z_leg', (0.14, 0, 0.62), (R(20), 0, 0)), ('z_leg', (-0.14, 0, 0.62), (R(-20), 0, 0))])
    pose('tree', [('p_tree_trunk', Z, Z), ('p_tree_top', Z, Z)]); pose('pine', [('p_pine_trunk', Z, Z), ('p_pine_top', Z, Z)])
    def boy(name, hair, hat=None):
        ps = [(n, Z, Z) for n in ('b_shirt', 'b_trim', 'b_pants', 'b_shoes', 'b_skin', 'b_face', 'b_band', 'h_' + hair)] + ([('hat_' + hat, Z, Z)] if hat else []) + [('g_0', (0.28, 0.3, 0.85), Z), ('g_0_paint', (0.28, 0.3, 0.85), Z)]
        return pose(name, ps)
    for i, (h, hat) in enumerate((('verylong', None), ('short', None), ('buzz', 'cap'), ('medium', None), ('shaggy', 'toque'), ('swept', None))):
        boy('boy%d' % i, h, hat)
    pose('busall', [(n, Z, Z) for n in ('bus_body', 'bus_plow', 'bus_forks_1', 'bus_forks_2', 'bus_armor_1', 'bus_armor_2', 'bus_engine', 'bus_tank', 'bus_hopper')] + [('bus_wheel', (sx * 1.3, wy, 0.55), Z) for sx in (-1, 1) for wy in (3.5, -3.3)])
    preview(os.path.join(HERE, 'boys.png'), names=['boy%d' % i for i in range(6)], cols=6, gap=1.1, res=(1600, 700), close=(1.0, 4.6, 1.6))
    pose('gunall0', [('g_0', Z, Z), ('g_0_paint', Z, Z)]); pose('gunall1', [('g_1', Z, Z), ('g_1_paint', Z, Z)]); pose('gunall2', [('g_2', Z, Z), ('g_2_paint', Z, Z)])
    pose('gunall3', [('g_3', Z, Z), ('g_3_paint', Z, Z)]); pose('gunall4', [('g_4', Z, Z), ('g_4_paint', Z, Z), ('g_4_drum', Z, Z)])
    for i in range(5):
        o = bpy.data.objects['gunall%d' % i]; o.location.z = 0.6
    preview(os.path.join(HERE, 'guns.png'), names=['gunall%d' % i for i in range(5)], cols=5, gap=0.9, res=(1800, 700), close=(0.6, 3.0, 1.5), side=True)
    preview(os.path.join(HERE, 'bus.png'), names=['busall'], cols=1, gap=1, res=(1600, 900), close=(1.6, 15, 6.5))
    preview(os.path.join(HERE, 'bus2.png'), names=['busall'], cols=1, gap=1, res=(1600, 900), close=(1.6, -15, 5.5))
    for n in ['zombie', 'tree', 'pine', 'busall'] + ['boy%d' % i for i in range(6)] + ['gunall%d' % i for i in range(5)]:
        bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)
