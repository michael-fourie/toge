import * as THREE from 'three';
import { sfx } from '../sfx.ts';
import { buildProceduralAwp } from './awp.ts';
import { type GunAnim, type GunRig, type Kit, type Plan, builder, cyl, e, glow, hold, palette, pivot, pulse, rbox, seg, v } from './rig.ts';
import type { GunStyle } from '../../shared/weapons.ts';
import { pbr } from '../render/surface.ts';

// Nine guns, each with its own hands-on animation. Models are built from a few boxes and cylinders in the solid palette,
// and every moving part is a named pivot so the animation can just turn and slide them.

const A = new THREE.Vector3();
const B = new THREE.Vector3();
const lerp3 = (out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, t: number) => out.copy(a).lerp(b, t);
const rig = (root: THREE.Group, parts: GunRig['parts'], anchors: GunRig['anchors']): GunRig => ({ root, parts, anchors });
const anchors = (grip: [number, number, number], fore: [number, number, number], mag: [number, number, number], muzzle: [number, number, number], eject: [number, number, number]) => ({
  grip: v(...grip),
  fore: v(...fore),
  mag: v(...mag),
  muzzle: v(...muzzle),
  eject: v(...eject),
});

/** A little brass-and-red shell, for the pump gun and the lever rifle's loading. */
function shellMesh() {
  const g = new THREE.Group();
  const add = builder(g);
  add(cyl(0.01, 0.01, 0.045, 8), pbr({ color: 0xc23b32 }), 0, 0, 0);
  add(cyl(0.0105, 0.0105, 0.012, 8), pbr({ color: 0xd9a84e }), 0, 0, 0.026);
  return g;
}

/**
 * The reload most box-magazine guns share: tilt, left hand to the mag, drop it, hand off the bottom of the screen for a
 * fresh one, bring it back, slide it in with a slap, hand home. `chamber` runs in the last stretch when the gun was empty.
 */
function magSwap(g: GunRig, u: number, p: Plan, k: Kit, o: { mag: THREE.Object3D; below: number; tilt: number; drop?: THREE.Vector3 }) {
  const a = g.anchors;
  const tilt = hold(u, 0, 0.12, 0.8, 0.95);
  p.rot.z -= tilt * o.tilt;
  p.rot.x += tilt * 0.15;
  p.pos.y += tilt * 0.03;
  p.pos.x -= tilt * 0.03;
  o.mag.visible = u < 0.16 || u >= 0.32;
  k.cue(u, 0.16, 'drop', () => {
    sfx.magOut();
    k.dropPart(o.mag, o.drop ?? v(-0.05, -0.5, 0.05));
  });
  k.cue(u, 0.64, 'in', () => sfx.magIn());
  const grab = A.copy(a.mag).add(B.set(0, -o.below, 0));
  const seat = seg(u, 0.5, 0.64);
  if (u >= 0.5) o.mag.position.set(a.mag.x, a.mag.y - 0.1 * (1 - seat), a.mag.z);
  else o.mag.position.copy(a.mag);
  if (u < 0.16) {
    p.left(lerp3(B, a.fore, grab, seg(u, 0.02, 0.14)), 'mag', 0.7);
  } else if (u < 0.5) {
    p.left(grab, 'mag', 0.75);
    p.lOff = u < 0.32 ? seg(u, 0.16, 0.28) : 1 - seg(u, 0.32, 0.5);
    if (u >= 0.32) {
      p.carry = o.mag;
      p.carryOff.set(0, o.below * 0.95, 0);
    }
  } else if (u < 0.72) {
    p.left(B.copy(o.mag.position).add(A.set(0, -o.below, 0)), 'mag', 0.75);
    p.pos.y += hold(u, 0.64, 0.67, 0.67, 0.74) * 0.012; // slap
  } else {
    p.left(lerp3(B, grab, a.fore, seg(u, 0.72, 0.88)), 'mag', 0.7 - seg(u, 0.72, 0.88) * 0.15);
  }
}

const hip = (x: number, y: number, z: number, rx = -0.05, ry = -0.02) => ({ pos: v(x, y, z), rot: e(rx, ry, 0) });

// ---------------------------------------------------------------------------
// 1. Sparrow M1911: a silver-slide pistol. The slide blows back, locks open on the last round, and is released after a reload.

function buildSparrow(accent: number): GunRig {
  const root = new THREE.Group();
  const add = builder(root);
  const m = palette(accent, { steel: 0xc6cbd3, dark: 0x2d2f35, grip: 0x4a3426, brass: 0xd9a84e });
  add(rbox(0.028, 0.024, 0.19, 0.006), m.dark, 0, 0.004, -0.085); // frame
  const slide = pivot(root, 0, 0, 0);
  add(rbox(0.031, 0.034, 0.21, 0.008), m.steel, 0, 0.034, -0.09, slide);
  add(rbox(0.032, 0.006, 0.05, 0.002), m.dark, 0, 0.034, 0.0, slide).scale.set(1, 1.6, 1); // serrations
  add(rbox(0.005, 0.01, 0.012, 0.002), m.dark, 0, 0.055, -0.185, slide);
  add(rbox(0.016, 0.008, 0.014, 0.002), m.dark, 0, 0.055, 0.008, slide);
  add(cyl(0.008, 0.008, 0.026, 10), m.dark, 0, 0.032, -0.2, slide);
  const grip = add(rbox(0.032, 0.105, 0.05, 0.008), m.grip, 0, -0.058, 0.036);
  grip.rotation.x = -0.18;
  add(new THREE.TorusGeometry(0.02, 0.003, 6, 14, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI), m.dark, 0, -0.02, -0.008); // trigger guard
  add(rbox(0.006, 0.02, 0.006, 0.002), m.dark, 0, -0.012, -0.002);
  const hammer = pivot(root, 0, 0.044, 0.012);
  add(rbox(0.008, 0.016, 0.008, 0.002), m.dark, 0, 0.006, 0.004, hammer);
  const mag = pivot(root, 0, -0.04, 0.034); // in line with the grip, so none of it pokes out the back
  mag.rotation.x = -0.18;
  add(rbox(0.026, 0.064, 0.036, 0.004), m.dark, 0, -0.032, 0, mag); // inside the grip: only its baseplate shows
  add(rbox(0.034, 0.009, 0.05, 0.003), m.dark, 0, -0.068, 0, mag);
  return rig(root, { slide, hammer, mag }, anchors([0.014, -0.045, 0.045], [-0.03, -0.072, 0.03], [0, -0.04, 0.034], [0, 0.034, -0.205], [0.018, 0.045, -0.05]));
}

const sparrow: GunAnim = {
  support: 'wrap',
  cycle: null,
  kick: { back: 0.035, flip: 0.12 },
  flash: 0xfff1c4,
  hip: hip(0.17, -0.105, -0.42, -0.04, -0.04),
  rest(g) {
    g.parts.slide.position.z = 0;
    g.parts.hammer.rotation.x = 0;
    g.parts.mag.visible = true;
    g.parts.mag.position.copy(g.anchors.mag);
  },
  fire(g, t, _p, k) {
    const open = hold(t, 0, 0.02, 0.03, 0.11);
    const slide = k.empty ? Math.max(open, seg(t, 0, 0.02)) : open; // locks back on the last round
    g.parts.slide.position.z = 0.036 * slide;
    g.parts.hammer.rotation.x = -0.7 * slide;
    k.cue(t, 0.02, 'eject', () => k.casing());
  },
  reload(g, u, p, k) {
    const go = k.empty ? 0.84 : 1;
    magSwap(g, u / go, p, k, { mag: g.parts.mag, below: 0.07, tilt: 0.3 });
    if (k.empty) {
      g.parts.slide.position.z = 0.036 * (u < 0.86 ? 1 : 1 - seg(u, 0.9, 0.95));
      p.left(B.copy(g.anchors.fore).add(A.set(0, 0.1, -0.04)), 'pinch', 0.4);
      k.cue(u, 0.9, 'release', () => sfx.boltForward());
    } else g.parts.slide.position.z = 0;
  },
};

// ---------------------------------------------------------------------------
// 2. Marshal .44: a big revolver. The cylinder swings out to the left, six casings fall, a speedloader goes in.

function buildMarshal(accent: number): GunRig {
  const root = new THREE.Group();
  const add = builder(root);
  const m = palette(accent, { blue: 0x34424f, steel: 0x8f98a3, wood: 0x8a5a38, dark: 0x1f2227, brass: 0xd9a84e });
  add(rbox(0.032, 0.052, 0.13, 0.008), m.blue, 0, 0.012, -0.035); // frame
  add(rbox(0.026, 0.012, 0.15, 0.004), m.blue, 0, 0.044, -0.06); // top strap
  add(cyl(0.012, 0.011, 0.2, 12), m.blue, 0, 0.032, -0.205); // barrel
  add(cyl(0.01, 0.01, 0.15, 10), m.blue, 0, 0.008, -0.18); // underlug
  add(cyl(0.004, 0.004, 0.13, 6), m.steel, 0, 0.0, -0.18); // ejector rod
  add(rbox(0.005, 0.01, 0.01, 0.002), m.dark, 0, 0.049, -0.3);
  const crane = pivot(root, -0.022, -0.016, -0.045);
  const cylinder = pivot(crane, 0.022, 0.028, 0);
  add(cyl(0.026, 0.026, 0.056, 14), m.steel, 0, 0, 0, cylinder);
  const rounds = new THREE.Group();
  cylinder.add(rounds);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(cyl(0.0065, 0.0065, 0.058, 8), m.dark, Math.cos(a) * 0.016, Math.sin(a) * 0.016, 0, cylinder);
    add(cyl(0.0055, 0.0055, 0.006, 8), m.brass, Math.cos(a) * 0.016, Math.sin(a) * 0.016, 0.03, rounds);
  }
  const hammer = pivot(root, 0, 0.04, 0.03);
  add(rbox(0.01, 0.026, 0.01, 0.003), m.dark, 0, 0.01, 0.004, hammer);
  const grip = add(rbox(0.034, 0.1, 0.05, 0.01), m.wood, 0, -0.06, 0.05);
  grip.rotation.x = -0.32;
  add(rbox(0.006, 0.02, 0.006, 0.002), m.dark, 0, -0.012, 0.01);
  add(new THREE.TorusGeometry(0.02, 0.003, 6, 14, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI), m.blue, 0, -0.026, 0.0);
  const loader = pivot(root, 0, 0, 0);
  add(cyl(0.024, 0.024, 0.01, 12), m.steel, 0, 0, 0, loader);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(cyl(0.0058, 0.0058, 0.04, 8), m.brass, Math.cos(a) * 0.016, Math.sin(a) * 0.016, -0.02, loader);
  }
  loader.visible = false;
  return rig(root, { cylinder, crane, rounds, hammer, loader, mag: cylinder }, anchors([0.016, -0.045, 0.06], [-0.032, -0.075, 0.045], [0, 0.012, -0.045], [0, 0.032, -0.31], [0, 0.0, -0.045]));
}

const marshal: GunAnim = {
  support: 'wrap',
  cycle: null,
  kick: { back: 0.07, flip: 0.34 },
  flash: 0xffd9a0,
  hip: hip(0.17, -0.105, -0.46, -0.04, -0.04),
  rest(g) {
    g.parts.crane.rotation.z = 0;
    g.parts.hammer.rotation.x = 0;
    g.parts.rounds.visible = true;
    g.parts.loader.visible = false;
  },
  fire(g, t, _p, k) {
    g.parts.hammer.rotation.x = -0.75 * hold(t, 0.06, 0.2, 0.28, 0.3); // double action: the hammer rises, then falls for the next
    k.cue(t, 0.0, 'turn', () => (g.parts.cylinder.rotation.z += Math.PI / 3));
  },
  reload(g, u, p, k) {
    const crane = g.parts.crane;
    const open = hold(u, 0.1, 0.22, 0.7, 0.82);
    crane.rotation.z = 1.5 * open;
    const up = hold(u, 0.22, 0.3, 0.34, 0.42); // muzzle up to shake the empties out
    p.rot.x += up * 0.55 + open * 0.08;
    p.rot.z -= open * 0.2;
    p.pos.y += up * 0.03;
    k.cue(u, 0.1, 'open', () => sfx.cover());
    k.cue(u, 0.24, 'eject', () => {
      for (let i = 0; i < 6; i++) setTimeout(() => k.casing(), i * 25);
    });
    g.parts.rounds.visible = u < 0.24 || u >= 0.66;
    // Left hand on the cylinder, then off for the speedloader, and back to push it in.
    const at = g.anchors.mag;
    if (u < 0.34) p.left(B.copy(g.anchors.fore).lerp(A.copy(at).add(v(-0.07, -0.02, 0.02)), seg(u, 0, 0.12)), 'mag', 0.6);
    else if (u < 0.46) {
      p.left(A.copy(at).add(v(-0.07, -0.02, 0.02)), 'mag', 0.7);
      p.lOff = seg(u, 0.34, 0.46);
    } else if (u < 0.6) {
      p.left(A.copy(at).add(v(-0.07, 0.0, 0.0)), 'pinch', 0.6);
      p.lOff = 1 - seg(u, 0.46, 0.6);
      p.carry = g.parts.loader;
      p.carryOff.set(0, 0.02, 0.0);
      g.parts.loader.visible = true;
    } else if (u < 0.68) {
      g.parts.loader.visible = u < 0.66;
      const push = seg(u, 0.6, 0.66);
      p.left(A.copy(at).add(v(-0.07 + push * 0.06, 0.0, 0.0)), 'pinch', 0.6);
      p.carry = g.parts.loader;
      p.carryOff.set(0, 0.0, 0);
    } else p.left(lerp3(B, A.copy(at).add(v(-0.07, -0.02, 0.02)), g.anchors.fore, seg(u, 0.7, 0.9)), 'mag', 0.6);
    k.cue(u, 0.66, 'in', () => sfx.magIn());
    k.cue(u, 0.82, 'shut', () => sfx.cover());
  },
};

// ---------------------------------------------------------------------------
// 3. Rattler SMG: a stubby submachine gun with a folded wire stock and a red-dot sight. Open bolt: the handle chatters.

function buildRattler(accent: number): GunRig {
  const root = new THREE.Group();
  const add = builder(root);
  const m = palette(accent, { black: 0x2b2d33, grey: 0x4d525c, polymer: 0x3a3f4a, dot: 0xff4a3a });
  add(rbox(0.04, 0.05, 0.21, 0.008), m.black, 0, 0.012, -0.04);
  add(rbox(0.034, 0.012, 0.2, 0.004), m.grey, 0, 0.044, -0.04);
  add(cyl(0.019, 0.019, 0.15, 12), m.grey, 0, 0.02, -0.21);
  for (let i = 0; i < 5; i++) add(rbox(0.022, 0.006, 0.012, 0.002), m.black, 0, 0.038, -0.15 - i * 0.026);
  add(cyl(0.008, 0.008, 0.03, 8), m.black, 0, 0.02, -0.295);
  const grip = add(rbox(0.034, 0.1, 0.046, 0.008), m.polymer, 0, -0.06, 0.06);
  grip.rotation.x = -0.2;
  add(rbox(0.03, 0.045, 0.04, 0.006), m.polymer, 0, -0.04, -0.18).rotation.x = -0.1; // foregrip
  add(new THREE.TorusGeometry(0.02, 0.003, 6, 14, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI), m.black, 0, -0.016, 0.01);
  // Folded wire stock.
  for (const s of [-1, 1]) add(cyl(0.004, 0.004, 0.2, 6), m.grey, s * 0.017, 0.002, 0.2);
  add(rbox(0.045, 0.07, 0.014, 0.004), m.black, 0, 0.0, 0.3);
  // Red dot.
  add(rbox(0.026, 0.026, 0.05, 0.005), m.black, 0, 0.073, -0.02);
  add(new THREE.CircleGeometry(0.011, 12), glow(0xff5a4a, 0.55), 0, 0.077, -0.0455).rotateY(Math.PI);
  const bolt = pivot(root, 0.026, 0.026, -0.0);
  add(rbox(0.014, 0.014, 0.03, 0.003), m.grey, 0.006, 0, 0, bolt);
  const mag = pivot(root, 0, -0.012, -0.075);
  add(rbox(0.03, 0.14, 0.038, 0.005), m.black, 0, -0.07, 0, mag);
  add(rbox(0.032, 0.008, 0.04, 0.003), m.grey, 0, -0.142, 0, mag);
  return rig(root, { bolt, mag }, anchors([0.018, -0.05, 0.06], [0, -0.052, -0.18], [0, -0.012, -0.075], [0, 0.02, -0.31], [0.026, 0.03, -0.05]));
}

const rattler: GunAnim = {
  cycle: null,
  kick: { back: 0.022, flip: 0.05 },
  flash: 0xffe0a0,
  hip: hip(0.23, -0.19, -0.5),
  rest(g) {
    g.parts.bolt.position.z = 0;
    g.parts.mag.visible = true;
    g.parts.mag.position.copy(g.anchors.mag);
  },
  fire(g, t, _p, k) {
    g.parts.bolt.position.z = 0.03 * hold(t, 0, 0.018, 0.022, 0.06);
    k.cue(t, 0.01, 'eject', () => k.casing());
  },
  reload(g, u, p, k) {
    const go = k.empty ? 0.86 : 1;
    magSwap(g, u / go, p, k, { mag: g.parts.mag, below: 0.15, tilt: 0.3 });
    if (k.empty && u > 0.86) {
      g.parts.bolt.position.z = 0.03 * hold(u, 0.88, 0.92, 0.93, 0.97);
      p.left(B.copy(g.anchors.fore).add(A.set(0.03, 0.06, 0.12)), 'pinch', 0.4);
      k.cue(u, 0.9, 'rack', () => sfx.boltBack());
      k.cue(u, 0.94, 'fwd', () => sfx.boltForward());
    }
  },
};

// ---------------------------------------------------------------------------
// 4. Warden AR: a carbine with a curved mag, a holo sight and a charging handle that gets hauled back after an empty reload.

function buildWarden(accent: number): GunRig {
  const root = new THREE.Group();
  const add = builder(root);
  const m = palette(accent, { olive: 0x5a6246, dark: 0x2b2e33, tan: 0x9a8c6a, grey: 0x4a4f58 });
  add(rbox(0.044, 0.062, 0.27, 0.008), m.dark, 0, 0.014, -0.02); // receiver
  add(rbox(0.05, 0.052, 0.3, 0.01), m.olive, 0, 0.012, -0.3); // handguard
  for (let i = 0; i < 6; i++) add(rbox(0.016, 0.004, 0.02, 0.001), m.dark, 0, 0.04, -0.2 - i * 0.045); // rail slots
  add(cyl(0.01, 0.01, 0.12, 8), m.dark, 0, 0.025, -0.52);
  add(cyl(0.017, 0.017, 0.05, 8), m.grey, 0, 0.025, -0.58); // flash hider
  const grip = add(rbox(0.036, 0.1, 0.046, 0.008), m.dark, 0, -0.065, 0.075);
  grip.rotation.x = -0.3;
  add(new THREE.TorusGeometry(0.022, 0.003, 6, 14, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI), m.dark, 0, -0.025, 0.02);
  add(rbox(0.04, 0.07, 0.26, 0.012), m.olive, 0, -0.01, 0.27).rotation.x = 0.05; // stock
  add(rbox(0.046, 0.1, 0.02, 0.006), m.dark, 0, -0.012, 0.4); // butt pad
  // Holo sight.
  add(rbox(0.032, 0.04, 0.06, 0.006), m.dark, 0, 0.078, -0.03);
  add(new THREE.CircleGeometry(0.014, 14), glow(0x9fe6ff, 0.5), 0, 0.085, -0.0605).rotateY(Math.PI);
  const handle = pivot(root, 0, 0.05, 0.1);
  add(rbox(0.026, 0.01, 0.04, 0.003), m.grey, 0, 0, 0.0, handle);
  const bolt = pivot(root, 0.024, 0.03, -0.05);
  add(rbox(0.006, 0.02, 0.05, 0.002), m.grey, 0.002, 0, 0, bolt);
  const mag = pivot(root, 0, -0.018, -0.1);
  add(rbox(0.032, 0.07, 0.04, 0.005), m.dark, 0, -0.035, 0, mag);
  add(rbox(0.032, 0.07, 0.04, 0.005), m.dark, 0, -0.095, -0.012, mag).rotation.x = 0.18; // the curve
  add(rbox(0.034, 0.008, 0.042, 0.003), m.grey, 0, -0.13, -0.022, mag);
  return rig(root, { handle, bolt, mag }, anchors([0.02, -0.06, 0.08], [0, -0.04, -0.33], [0, -0.018, -0.1], [0, 0.025, -0.61], [0.026, 0.03, -0.05]));
}

const warden: GunAnim = {
  cycle: null,
  kick: { back: 0.03, flip: 0.07 },
  flash: 0xffe0a0,
  hip: hip(0.26, -0.2, -0.56),
  rest(g) {
    g.parts.handle.position.z = 0;
    g.parts.bolt.position.z = 0;
    g.parts.mag.visible = true;
    g.parts.mag.position.copy(g.anchors.mag);
  },
  fire(g, t, _p, k) {
    g.parts.bolt.position.z = 0.025 * hold(t, 0, 0.02, 0.025, 0.07);
    k.cue(t, 0.01, 'eject', () => k.casing());
  },
  reload(g, u, p, k) {
    const go = k.empty ? 0.84 : 1;
    magSwap(g, u / go, p, k, { mag: g.parts.mag, below: 0.15, tilt: 0.28 });
    if (k.empty && u > 0.84) {
      const pull = hold(u, 0.86, 0.9, 0.92, 0.96);
      g.parts.handle.position.z = 0.06 * pull;
      g.parts.bolt.position.z = 0.03 * pull;
      p.right(B.copy(g.anchors.grip).add(A.set(0, 0.1, 0.03 + 0.06 * pull)), 'pinch', 0.5);
      k.cue(u, 0.89, 'back', () => sfx.boltBack());
      k.cue(u, 0.93, 'fwd', () => sfx.boltForward());
    }
  },
};

// ---------------------------------------------------------------------------
// 5. Bramble 12g: a pump shotgun. The wooden forend slides back and forth after every shot; reloads thumb in shells one by one.

function buildBramble(accent: number): GunRig {
  const root = new THREE.Group();
  const add = builder(root);
  const m = palette(accent, { wood: 0x8b5a36, woodDark: 0x6a4228, blue: 0x2f343c, brass: 0xd9a84e, steel: 0x6c7480 });
  add(rbox(0.046, 0.062, 0.19, 0.008), m.blue, 0, 0.012, -0.03); // receiver
  add(cyl(0.015, 0.015, 0.62, 12), m.blue, 0, 0.03, -0.43); // barrel
  add(cyl(0.012, 0.012, 0.45, 10), m.steel, 0, -0.012, -0.34); // magazine tube
  add(new THREE.SphereGeometry(0.006, 8, 6), m.brass, 0, 0.049, -0.73);
  add(rbox(0.012, 0.01, 0.02, 0.002), m.blue, 0, 0.052, -0.14); // rib
  const pump = pivot(root, 0, 0, 0);
  add(rbox(0.054, 0.05, 0.16, 0.014), m.wood, 0, -0.016, -0.3, pump);
  for (let i = 0; i < 4; i++) add(rbox(0.056, 0.003, 0.012, 0.001), m.woodDark, 0, -0.016, -0.35 + i * 0.034, pump); // grooves
  for (const s of [-1, 1]) add(cyl(0.003, 0.003, 0.2, 6), m.steel, s * 0.021, 0.0, -0.2, pump); // action bars
  const grip = add(rbox(0.036, 0.075, 0.05, 0.01), m.woodDark, 0, -0.05, 0.065);
  grip.rotation.x = -0.35;
  add(rbox(0.04, 0.085, 0.3, 0.014), m.wood, 0, -0.004, 0.27).rotation.x = 0.1; // stock
  add(rbox(0.044, 0.11, 0.016, 0.006), m.blue, 0, -0.02, 0.43);
  add(new THREE.TorusGeometry(0.022, 0.003, 6, 14, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI), m.blue, 0, -0.026, 0.02);
  add(rbox(0.03, 0.006, 0.05, 0.002), pbr({ color: 0x15171a }), 0, -0.02, -0.07); // the loading port
  const mag = pivot(root, 0, 0, 0); // unused rounds are inside the tube; kept for symmetry with the others
  const shell = shellMesh();
  shell.visible = false;
  root.add(shell);
  return rig(root, { pump, mag, shell }, anchors([0.02, -0.05, 0.075], [0, -0.016, -0.3], [0, -0.03, -0.07], [0, 0.03, -0.75], [0.026, 0.026, -0.03]));
}

const bramble: GunAnim = {
  cycle: { delay: 0.14, dur: 0.5 },
  kick: { back: 0.09, flip: 0.24 },
  flash: 0xffc890,
  hip: hip(0.25, -0.2, -0.56),
  rest(g) {
    g.parts.pump.position.z = 0;
    g.parts.shell.visible = false;
  },
  fire(g, t, p, k) {
    const s = t - 0.14; // time into the pump
    const back = hold(s, 0.0, 0.17, 0.24, 0.45);
    g.parts.pump.position.z = 0.13 * back;
    p.left(B.copy(g.anchors.fore).add(A.set(0, 0.0, 0.13 * back)), 'fore', 0.6);
    k.cue(s, 0.04, 'back', () => {
      sfx.pump();
      k.casing();
    });
    k.cue(s, 0.3, 'fwd', () => sfx.boltForward());
    p.rot.z += pulse(s, 0.0, 0.45) * 0.03;
  },
  reload(g, u, p, k) {
    const port = g.anchors.mag;
    const tilt = hold(u, 0, 0.1, 0.8, 0.88);
    p.rot.z += tilt * 0.45; // port toward the left hand
    p.rot.x += tilt * 0.2;
    p.pos.y += tilt * 0.03;
    const N = 4;
    const loop = (u - 0.1) / 0.7;
    if (loop >= 0 && loop < 1) {
      const i = Math.min(N - 1, Math.floor(loop * N));
      const s = loop * N - i; // 0..1 within this shell
      p.lOff = 1 - seg(s, 0.0, 0.4) + seg(s, 0.85, 1);
      p.lOff = Math.min(1, Math.max(0, p.lOff));
      const push = hold(s, 0.45, 0.65, 0.65, 0.8);
      p.left(A.copy(port).add(B.set(-0.06 + push * 0.045, -0.04, 0.0)), 'pinch', 0.55);
      p.carry = g.parts.shell;
      p.carryOff.set(0, 0.0, 0);
      g.parts.shell.visible = s > 0.2 && s < 0.7;
      g.parts.shell.rotation.set(0, 0, Math.PI / 2);
      k.cue(u, 0.1 + ((i + 0.65) / N) * 0.7, `shell${i}`, () => sfx.shell());
    } else {
      p.left(g.anchors.fore, 'fore', 0.6);
    }
    // The last thing is a pump to chamber a shell.
    const pumpU = (u - 0.84) / 0.16;
    if (pumpU > 0) {
      const back = hold(pumpU, 0.0, 0.4, 0.5, 0.95);
      g.parts.pump.position.z = 0.13 * back;
      p.left(B.copy(g.anchors.fore).add(A.set(0, 0, 0.13 * back)), 'fore', 0.6);
      k.cue(pumpU, 0.3, 'pump', () => sfx.pump());
    }
  },
};

// ---------------------------------------------------------------------------
// 6. Kestrel Lever: a lever-action rifle. The lever loop swings down and back with the right hand on it; shells go in through a side gate.

function buildKestrel(accent: number): GunRig {
  const root = new THREE.Group();
  const add = builder(root);
  const m = palette(accent, { wood: 0x8a5632, brass: 0xc9a14a, blue: 0x2d3138, steel: 0x7b838e });
  add(rbox(0.036, 0.056, 0.18, 0.008), m.brass, 0, 0.012, -0.03); // receiver
  add(new THREE.CylinderGeometry(0.0125, 0.0125, 0.55, 8).rotateX(Math.PI / 2), m.blue, 0, 0.03, -0.4); // octagon barrel
  add(cyl(0.01, 0.01, 0.4, 10), m.steel, 0, -0.004, -0.33); // tube
  add(rbox(0.04, 0.045, 0.25, 0.012), m.wood, 0, -0.012, -0.27); // forend
  add(rbox(0.006, 0.012, 0.01, 0.002), m.blue, 0, 0.049, -0.66);
  add(rbox(0.012, 0.01, 0.014, 0.002), m.blue, 0, 0.049, -0.06);
  const grip = add(rbox(0.034, 0.08, 0.05, 0.01), m.wood, 0, -0.04, 0.08);
  grip.rotation.x = -0.4;
  add(rbox(0.04, 0.085, 0.3, 0.014), m.wood, 0, -0.01, 0.28).rotation.x = 0.1;
  add(rbox(0.046, 0.12, 0.014, 0.006), m.brass, 0, -0.025, 0.44);
  const lever = pivot(root, 0, -0.02, -0.04);
  add(new THREE.TorusGeometry(0.04, 0.004, 6, 20, Math.PI * 1.2).rotateY(Math.PI / 2).rotateZ(Math.PI * 0.4), m.brass, 0, -0.025, 0.06, lever);
  add(rbox(0.008, 0.012, 0.1, 0.002), m.brass, 0, 0.0, 0.05, lever);
  const hammer = pivot(root, 0, 0.044, 0.07);
  add(rbox(0.008, 0.02, 0.012, 0.003), m.blue, 0, 0.007, 0.004, hammer);
  const gate = add(rbox(0.004, 0.018, 0.03, 0.001), m.brass, 0.0185, 0.012, -0.0);
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.04, 8).rotateX(Math.PI / 2), pbr({ color: 0xd9a84e }));
  shell.visible = false;
  root.add(shell);
  return rig(root, { lever, hammer, gate, shell, mag: gate }, anchors([0.018, -0.05, 0.08], [0, -0.03, -0.27], [0.03, 0.012, -0.0], [0, 0.03, -0.68], [0.022, 0.034, -0.04]));
}

/** Cycles the lever: down and forward, back up. Returns how open it is (0..1). */
function leverCycle(g: GunRig, s: number, p: Plan, k: Kit) {
  const open = hold(s, 0.0, 0.14, 0.2, 0.34);
  g.parts.lever.rotation.x = 0.95 * open;
  g.parts.hammer.rotation.x = -0.8 * hold(s, 0.04, 0.14, 0.3, 0.34);
  // The right hand rides the lever loop.
  const loop = A.set(0, -0.06 - 0.03 * open, 0.07 + 0.05 * open);
  p.right(loop, 'knob', 0.7 + open * 0.15);
  k.cue(s, 0.08, 'down', () => sfx.lever());
  k.cue(s, 0.12, 'eject', () => k.casing());
  return open;
}

const kestrel: GunAnim = {
  cycle: { delay: 0.1, dur: 0.34 },
  kick: { back: 0.06, flip: 0.2 },
  flash: 0xffd9a0,
  hip: hip(0.25, -0.19, -0.55),
  rest(g) {
    g.parts.lever.rotation.x = 0;
    g.parts.hammer.rotation.x = 0;
    g.parts.gate.rotation.z = 0;
    g.parts.shell.visible = false;
  },
  fire(g, t, p, k) {
    leverCycle(g, t - 0.1, p, k);
  },
  reload(g, u, p, k) {
    const tilt = hold(u, 0, 0.1, 0.78, 0.84);
    p.rot.z += tilt * 0.4;
    p.rot.y -= tilt * 0.25;
    p.pos.x -= tilt * 0.03;
    const N = 4;
    const loop = (u - 0.1) / 0.65;
    const gate = g.anchors.mag;
    if (loop >= 0 && loop < 1) {
      g.parts.gate.rotation.z = -0.7;
      const i = Math.min(N - 1, Math.floor(loop * N));
      const s = loop * N - i;
      p.lOff = Math.min(1, Math.max(0, 1 - seg(s, 0.0, 0.4) + seg(s, 0.85, 1)));
      p.left(A.copy(gate).add(B.set(0.06 - hold(s, 0.45, 0.65, 0.65, 0.8) * 0.04, -0.01, 0.02)), 'pinch', 0.55);
      p.carry = g.parts.shell;
      p.carryOff.set(0, 0, 0);
      g.parts.shell.visible = s > 0.2 && s < 0.7;
      g.parts.shell.rotation.set(0, 0.3, 0);
      k.cue(u, 0.1 + ((i + 0.65) / N) * 0.65, `shell${i}`, () => sfx.shell());
    } else p.left(g.anchors.fore, 'fore', 0.6);
    if (u > 0.82) leverCycle(g, (u - 0.82) / 0.18 / 2.6, p, k);
  },
};

// ---------------------------------------------------------------------------
// 7. Hammer LMG: a heavy belt-fed machine gun. The top cover flips up, the ammo box is swapped, the belt laid in, the cover slammed.

function buildHammer(accent: number): GunRig {
  const root = new THREE.Group();
  const add = builder(root);
  const m = palette(accent, { grey: 0x4b525b, dark: 0x2b2e33, olive: 0x59603f, brass: 0xd9a84e, steel: 0x8a929d });
  add(rbox(0.07, 0.074, 0.36, 0.01), m.dark, 0, 0.012, -0.05);
  add(cyl(0.017, 0.017, 0.3, 10), m.grey, 0, 0.03, -0.38); // barrel
  add(cyl(0.028, 0.028, 0.3, 12), m.grey, 0, 0.03, -0.36); // shroud
  for (let i = 0; i < 6; i++) add(new THREE.TorusGeometry(0.029, 0.003, 6, 14), m.dark, 0, 0.03, -0.25 - i * 0.045);
  add(cyl(0.022, 0.022, 0.07, 10), m.dark, 0, 0.03, -0.55);
  for (const s of [-1, 1]) add(cyl(0.004, 0.004, 0.3, 6), m.steel, s * 0.032, -0.025, -0.4).rotation.y = s * 0.05; // folded bipod legs
  add(rbox(0.02, 0.05, 0.1, 0.006), m.dark, 0, 0.088, -0.12); // carry handle
  add(rbox(0.014, 0.01, 0.12, 0.003), m.dark, 0, 0.115, -0.12);
  const grip = add(rbox(0.04, 0.09, 0.05, 0.01), m.dark, 0, -0.07, 0.11);
  grip.rotation.x = -0.25;
  add(new THREE.TorusGeometry(0.024, 0.003, 6, 14, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI), m.dark, 0, -0.03, 0.05);
  add(rbox(0.06, 0.11, 0.26, 0.012), m.olive, 0, -0.01, 0.34); // stock
  add(rbox(0.066, 0.13, 0.02, 0.006), m.dark, 0, -0.01, 0.48);
  // Top cover, hinged at the front.
  const cover = pivot(root, 0, 0.052, -0.18);
  add(rbox(0.068, 0.016, 0.26, 0.004), m.grey, 0, 0.005, 0.13, cover);
  // Feed tray + belt.
  const belt = pivot(root, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    const x = -0.04 + i * 0.012;
    const y = -0.07 + Math.sin(i / 6 * Math.PI) * 0.08 + i * 0.012;
    add(cyl(0.006, 0.006, 0.026, 8), m.brass, x, y, -0.07, belt).rotation.z = Math.PI / 2;
    add(rbox(0.01, 0.01, 0.03, 0.002), m.steel, x, y - 0.001, -0.07, belt);
  }
  const mag = pivot(root, -0.015, -0.062, -0.07);
  add(rbox(0.09, 0.1, 0.14, 0.008), m.olive, -0.04, -0.05, 0, mag);
  add(rbox(0.092, 0.01, 0.142, 0.003), m.grey, -0.04, -0.1, 0, mag);
  add(rbox(0.02, 0.03, 0.04, 0.004), m.dark, -0.01, 0.0, 0, mag);
  const handle = pivot(root, 0.037, 0.026, -0.0);
  add(rbox(0.016, 0.016, 0.034, 0.003), m.steel, 0.008, 0, 0, handle);
  return rig(root, { cover, belt, mag, handle }, anchors([0.022, -0.075, 0.12], [0, -0.045, -0.3], [-0.015, -0.062, -0.07], [0, 0.03, -0.6], [0.036, 0.03, -0.04]));
}

const hammer: GunAnim = {
  cycle: null,
  kick: { back: 0.03, flip: 0.06 },
  flash: 0xffd090,
  hip: hip(0.28, -0.23, -0.6),
  rest(g) {
    g.parts.cover.rotation.x = 0;
    g.parts.handle.position.z = 0;
    g.parts.belt.visible = true;
    g.parts.belt.position.set(0, 0, 0);
    g.parts.mag.visible = true;
    g.parts.mag.position.copy(g.anchors.mag);
  },
  fire(g, t, _p, k) {
    g.parts.handle.position.z = 0.04 * hold(t, 0, 0.02, 0.03, 0.07);
    g.parts.belt.position.y = 0.004 * Math.sin(t * 160);
    g.parts.mag.position.y = g.anchors.mag.y + 0.0025 * Math.sin(t * 200 + 1);
    k.cue(t, 0.01, 'eject', () => k.casing());
  },
  reload(g, u, p, k) {
    const a = g.anchors;
    const tilt = hold(u, 0, 0.1, 0.84, 0.92);
    p.rot.z -= tilt * 0.3;
    p.rot.x += tilt * 0.12;
    p.pos.y += tilt * 0.03;
    g.parts.cover.rotation.x = -1.15 * hold(u, 0.08, 0.2, 0.74, 0.8);
    k.cue(u, 0.1, 'open', () => sfx.cover());
    k.cue(u, 0.76, 'shut', () => sfx.cover());
    g.parts.belt.visible = u < 0.2 || u >= 0.7;
    g.parts.mag.visible = u < 0.34 || u >= 0.46;
    const cover = A.copy(a.fore).add(B.set(0, 0.17, 0.12));
    if (u < 0.2) p.left(lerpFore(a.fore, cover, seg(u, 0.02, 0.12)), 'pinch', 0.5);
    else if (u < 0.34) {
      // Pull the spent box out and let it fall.
      p.left(A.copy(a.mag).add(B.set(-0.06, -0.05, 0)), 'mag', 0.75);
      k.cue(u, 0.3, 'drop', () => {
        sfx.magOut();
        k.dropPart(g.parts.mag, v(-0.1, -0.5, 0.05));
      });
    } else if (u < 0.6) {
      p.left(A.copy(a.mag).add(B.set(-0.06, -0.05, 0)), 'mag', 0.75);
      p.lOff = u < 0.46 ? seg(u, 0.34, 0.42) : 1 - seg(u, 0.46, 0.6);
      if (u >= 0.46) {
        p.carry = g.parts.mag;
        p.carryOff.set(0.02, 0.05, 0);
      }
    } else if (u < 0.72) {
      g.parts.mag.position.set(a.mag.x, a.mag.y - 0.08 * (1 - seg(u, 0.6, 0.68)), a.mag.z);
      p.left(B.copy(g.parts.mag.position).add(A.set(-0.06, -0.05, 0)), 'mag', 0.75);
      k.cue(u, 0.68, 'in', () => sfx.magIn());
    } else if (u < 0.86) p.left(lerpFore(A.copy(a.mag).add(B.set(-0.06, -0.05, 0)), cover, seg(u, 0.72, 0.8)), 'pinch', 0.5);
    else {
      p.left(lerpFore(cover, a.fore, seg(u, 0.84, 0.92)), 'fore', 0.55);
      const pull = hold(u, 0.9, 0.94, 0.95, 0.98);
      g.parts.handle.position.z = 0.05 * pull;
      p.right(B.copy(a.grip).add(A.set(0.03, 0.1, -0.1 + 0.05 * pull)), 'pinch', 0.5);
      k.cue(u, 0.92, 'back', () => sfx.boltBack());
      k.cue(u, 0.96, 'fwd', () => sfx.boltForward());
    }
  },
};
const lerpFore = (a: THREE.Vector3, b: THREE.Vector3, t: number) => new THREE.Vector3().copy(a).lerp(b, t);

// ---------------------------------------------------------------------------
// 8. The AWP (the original rifle, now in the box): bolt action, with a mag swap and a bolt cycle for an empty chamber.

const awp: GunAnim = {
  cycle: { delay: 0.1, dur: 0.5 },
  kick: { back: 0.07, flip: 0.16 },
  flash: 0xfff1c4,
  hip: hip(0.27, -0.2, -0.64),
  rest(g) {
    g.parts.bolt.rotation.z = 0;
    g.parts.bolt.position.z = 0.03;
    g.parts.mag.visible = true;
    g.parts.mag.position.copy(g.anchors.mag);
  },
  fire(g, t, p, k) {
    this.cycle && boltCycle(g, t - this.cycle.delay, this.cycle.dur, p, k);
  },
  reload(g, u, p, k) {
    const split = k.empty ? 0.78 : 1;
    magSwap(g, Math.min(1, u / split), p, k, { mag: g.parts.mag, below: 0.12, tilt: 0.38 });
    if (k.empty && u >= split) boltCycle(g, u - split, 1 - split, p, k);
  },
};

/** The bolt cycle, kinda fast: hand to knob, lift, rip back (casing flies), slam forward, lock down, hand home. */
function boltCycle(g: GunRig, s: number, dur: number, p: Plan, k: Kit) {
  if (s < 0) return;
  const u = Math.min(1, s / dur);
  const lift = hold(u, 0.14, 0.26, 0.7, 0.8);
  const back = hold(u, 0.28, 0.42, 0.52, 0.66);
  g.parts.bolt.rotation.z = lift * 1.05;
  g.parts.bolt.position.z = 0.03 + back * 0.09;
  const tilt = hold(u, 0, 0.14, 0.82, 1);
  p.rot.z += tilt * 0.2;
  p.rot.x -= tilt * 0.05;
  p.pos.x -= tilt * 0.015;
  p.pos.z += back * 0.012;
  g.parts.knob.updateWorldMatrix(true, false);
  const knob = g.root.worldToLocal(g.parts.knob.getWorldPosition(A)).add(B.set(0.012, 0.004, 0.012));
  const w = hold(u, 0, 0.13, 0.84, 1);
  p.right(lerp3(B, g.anchors.grip, knob, w).clone(), w > 0.5 ? 'knob' : 'grip', 0.95 - w * 0.25);
  k.cue(u, 0.18, 'up', () => sfx.boltUp());
  k.cue(u, 0.36, 'back', () => {
    sfx.boltBack();
    k.casing();
  });
  k.cue(u, 0.6, 'fwd', () => sfx.boltForward());
}

// ---------------------------------------------------------------------------
// 9. Sunbeam: a brass-and-mint ray gun. The coils spin up on every shot; reloads pop the glowing cell out of the top and slot a fresh one in.

function buildSunbeam(accent: number): GunRig {
  const root = new THREE.Group();
  const add = builder(root);
  const m = palette(accent, { mint: 0x8fe0c8, brass: 0xd9a441, cream: 0xf3e8c8, dark: 0x3a3a46 });
  const body = add(new THREE.SphereGeometry(0.05, 18, 12), m.mint, 0, 0.01, -0.02);
  body.scale.set(0.9, 0.85, 2.1);
  add(cyl(0.02, 0.014, 0.22, 12), m.cream, 0, 0.012, -0.2);
  add(new THREE.CylinderGeometry(0.02, 0.05, 0.07, 14, 1, true).rotateX(-Math.PI / 2), glow(0xfff0a0, 0.6), 0, 0.012, -0.34).scale.set(1, 1, 1); // muzzle bell
  const coils = pivot(root, 0, 0.012, 0);
  for (let i = 0; i < 4; i++) {
    add(new THREE.TorusGeometry(0.03 - i * 0.002, 0.005, 6, 18), m.brass, 0, 0, -0.14 - i * 0.045, coils);
    add(rbox(0.008, 0.012, 0.012, 0.002), m.dark, 0.03 - i * 0.002, 0, -0.14 - i * 0.045, coils);
  }
  for (let i = 0; i < 3; i++) add(rbox(0.004, 0.05, 0.05, 0.002), m.brass, 0, 0.05, 0.04 + i * 0.03).rotation.x = -0.4; // fins
  const bulb = add(new THREE.SphereGeometry(0.026, 14, 10), glow(0x9ff4ff), 0, 0.058, -0.07);
  add(new THREE.TorusGeometry(0.028, 0.003, 6, 16), m.brass, 0, 0.058, -0.07).rotation.x = Math.PI / 2;
  const grip = add(rbox(0.034, 0.09, 0.045, 0.012), m.cream, 0, -0.058, 0.055);
  grip.rotation.x = -0.3;
  add(new THREE.TorusGeometry(0.02, 0.003, 6, 14, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI), m.brass, 0, -0.02, 0.01);
  add(new THREE.TorusGeometry(0.012, 0.003, 6, 12), m.brass, 0, 0.04, -0.31); // front sight ring
  // The energy cell, standing in a socket on top.
  const mag = pivot(root, 0, 0.06, 0.04);
  add(new THREE.CylinderGeometry(0.014, 0.014, 0.06, 12), glow(0xff9de0), 0, 0.03, 0, mag);
  add(new THREE.CylinderGeometry(0.016, 0.016, 0.01, 12), m.brass, 0, 0.062, 0, mag);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.008, 12), m.brass, 0, -0.002, 0, root);
  return rig(root, { coils, bulb, mag }, anchors([0.016, -0.05, 0.06], [0, -0.03, -0.16], [0, 0.06, 0.04], [0, 0.012, -0.375], [0, 0.07, 0.04]));
}

const sunbeam: GunAnim = {
  cycle: null,
  kick: { back: 0.04, flip: 0.1 },
  flash: 0xaaffee,
  hip: hip(0.23, -0.18, -0.52, -0.04, -0.04),
  rest(g) {
    g.parts.bulb.scale.setScalar(1);
    g.parts.mag.visible = true;
    g.parts.mag.position.copy(g.anchors.mag);
  },
  fire(g, t, _p) {
    g.parts.coils.rotation.z = (1 - Math.exp(-t * 8)) * 7;
    g.parts.bulb.scale.setScalar(1 + 0.5 * Math.exp(-t * 14));
  },
  reload(g, u, p, k) {
    const a = g.anchors;
    const tilt = hold(u, 0, 0.1, 0.8, 0.92);
    p.rot.z -= tilt * 0.25;
    p.rot.x += tilt * 0.12;
    p.pos.y += tilt * 0.03;
    g.parts.coils.rotation.z = u * 5;
    g.parts.bulb.scale.setScalar(1 - 0.5 * hold(u, 0.2, 0.3, 0.6, 0.7));
    const pop = hold(u, 0.12, 0.24, 0.24, 0.3);
    g.parts.mag.visible = u < 0.28 || u >= 0.36;
    if (u < 0.28) g.parts.mag.position.set(a.mag.x, a.mag.y + 0.07 * pop, a.mag.z);
    k.cue(u, 0.12, 'pop', () => sfx.cell());
    k.cue(u, 0.26, 'toss', () => k.dropPart(g.parts.mag, v(0.05, 0.6, -0.05)));
    k.cue(u, 0.66, 'in', () => sfx.cell());
    const top = A.copy(a.mag).add(B.set(0, 0.05, 0));
    if (u < 0.3) p.left(lerpFore(a.fore, top, seg(u, 0.02, 0.14)), 'pinch', 0.6);
    else if (u < 0.5) {
      p.left(top, 'pinch', 0.7);
      p.lOff = seg(u, 0.3, 0.4);
    } else if (u < 0.64) {
      p.left(top, 'pinch', 0.7);
      p.lOff = 1 - seg(u, 0.5, 0.64);
      p.carry = g.parts.mag;
      p.carryOff.set(0, 0.0, 0);
    } else if (u < 0.8) {
      g.parts.mag.position.set(a.mag.x, a.mag.y + 0.06 * (1 - seg(u, 0.64, 0.72)), a.mag.z);
      p.left(B.copy(g.parts.mag.position).add(A.set(0, 0.05, 0)), 'pinch', 0.7);
    } else p.left(lerpFore(top, a.fore, seg(u, 0.8, 0.94)), 'fore', 0.55);
  },
};

// ---------------------------------------------------------------------------

export const GUN_BUILDERS: Partial<Record<GunStyle, (accent: number) => GunRig>> = {
  pistol: buildSparrow,
  revolver: buildMarshal,
  smg: buildRattler,
  rifle: buildWarden,
  pump: buildBramble,
  lever: buildKestrel,
  lmg: buildHammer,
  ray: buildSunbeam,
};

export const GUN_ANIMS: Record<GunStyle, GunAnim> = { pistol: sparrow, revolver: marshal, smg: rattler, rifle: warden, pump: bramble, lever: kestrel, lmg: hammer, bolt: awp, ray: sunbeam };

/** A free-standing copy of a gun for display (wall buys, the Mystery Box): centred, barrel along +X, right side toward +Z. */
export function buildGunDisplay(style: GunStyle, accent: number): THREE.Group {
  const rigged = style === 'bolt' ? buildProceduralAwp(accent) : GUN_BUILDERS[style]!(accent);
  const box = new THREE.Box3().setFromObject(rigged.root);
  const c = box.getCenter(new THREE.Vector3());
  rigged.root.position.sub(c);
  const g = new THREE.Group();
  g.add(rigged.root);
  g.rotation.y = -Math.PI / 2;
  const wrap = new THREE.Group();
  wrap.add(g);
  wrap.userData.length = box.max.z - box.min.z;
  return wrap;
}
