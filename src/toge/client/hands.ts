// Hands that hold on (driver.ts). The drivers' baked clips (tools/drivers/pose.py) held the wheel from inside the rim:
// wrists in toward the hub, the hand lying over the rim, fingers splayed; the bike and standing hands were splayed and
// stiff. The build needs Blender and MakeHuman, so the clips are corrected once per model when it loads, in three.js:
//
// - `drive`: each key's hand goes onto the wheel's own rim (measured from the wheel mesh, so a yoke or a dished wheel
//   works too), palm round it, knuckles along it; the arm follows by two-bone IK, keeping its elbow; then the fingers
//   and thumb close round the rim until they touch it. The rim's angle under each hand comes from the baked key, so
//   the hands still turn with the wheel to full lock.
// - `ride`: the hands stay on the bike's grips; the fingers close round the grip.
// - `idle`: the fingers rest in a soft, natural curl, side by side.
//
// Every key's fingers start from the bind pose (straight, as modelled), so whatever the old curl did is undone.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
const SIDES = ['l', 'r'] as const;
type Side = (typeof SIDES)[number];

export const HANDS = {
  /** Finger thickness (m, centre to skin): a fingertip stops this far off the rim's surface. */
  finger: 0.009,
  /** The thumb is thicker: it stops this much further off. */
  thumb: 0.007,
  /** The bike's grip radius (bikemodel.ts's clip-on rubber). */
  bikeGrip: 0.018,
  /** Most a finger joint bends (rad). */
  maxBend: 1.75,
  /** How far each spread finger is drawn in toward the hand's line before it closes (0 none, 1 all parallel). */
  gather: 0.6,
  /** Where the rim sits in the fist, in the hand's rest frame: along wrist → middle knuckle, off the palm, along the fingers. */
  gripAlong: 0.9,
  gripOffPalm: 0.03,
  gripForward: 0.012,
  /** Palm facing: mostly in toward the hub, partly forward over the rim (unit-less mix). */
  palmIn: 0.9,
  palmForward: 0.35,
  /** Standing: each finger's soft curl, knuckle to tip (rad), index to pinky; the thumb's. */
  relaxed: [
    [0.22, 0.32, 0.2],
    [0.28, 0.38, 0.22],
    [0.34, 0.42, 0.24],
    [0.4, 0.46, 0.26],
  ],
  relaxedThumb: [0.1, 0.18, 0.2],
};

const v = () => new THREE.Vector3();
const _a = v(), _b = v(), _c = v(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

function pos(o: THREE.Object3D, out = v()) {
  return out.setFromMatrixPosition(o.matrixWorld);
}

function worldQuat(o: THREE.Object3D, out = new THREE.Quaternion()) {
  o.matrixWorld.decompose(_c, out, _b);
  return out;
}

/** Turns `bone` by `q` in world space (about its own joint). */
function turnWorld(bone: THREE.Object3D, q: THREE.Quaternion) {
  const parent = worldQuat(bone.parent!, _q2);
  // local' = P⁻¹ · q · P · local
  bone.quaternion.premultiply(_q.copy(parent).invert().multiply(q).multiply(parent)).normalize();
  bone.updateMatrixWorld(true);
}

/** Sets `bone`'s world rotation to `q`. */
function setWorldQuat(bone: THREE.Object3D, q: THREE.Quaternion) {
  const parent = worldQuat(bone.parent!, _q2);
  bone.quaternion.copy(parent.invert().multiply(q)).normalize();
  bone.updateMatrixWorld(true);
}

/** The hand's own frame, in its local space (bind pose): fingers' direction, knuckle line (pinky → index), palm normal. */
interface HandFrame {
  d: THREE.Vector3;
  k: THREE.Vector3;
  p: THREE.Vector3;
  grip: THREE.Vector3;
  /** Columns d, k, p. */
  basis: THREE.Matrix4;
}

function handFrame(bones: Map<string, THREE.Bone>, s: Side): HandFrame {
  const hand = bones.get('hand_' + s)!;
  const inv = hand.matrixWorld.clone().invert();
  const at = (name: string) => pos(bones.get(name)!).applyMatrix4(inv);
  const mid = at('middle_01_' + s);
  const tip = at('middle_03_' + s);
  const d = tip.clone().normalize();
  const k = at('index_01_' + s).sub(at('pinky_01_' + s));
  k.addScaledVector(d, -k.dot(d)).normalize();
  const p = v().crossVectors(d, k).normalize();
  if (at('thumb_02_' + s).dot(p) < 0) p.negate();
  const grip = mid.clone().multiplyScalar(HANDS.gripAlong).addScaledVector(p, HANDS.gripOffPalm).addScaledVector(d, HANDS.gripForward);
  return { d, k, p, grip, basis: new THREE.Matrix4().makeBasis(d, k, p) };
}

/** A steering wheel's rim, in its bone's space: centre at the bone, `n` its axis; radius and tube by direction. */
interface Rim {
  n: THREE.Vector3;
  /** The rim's tube radius. */
  tube: number;
  pts: { u: THREE.Vector3; r: number; h: number }[];
}

/** Every vertex of the wheel's meshes (a wheel is several: rim, spokes, hub, a top mark), in the wheel bone's space. */
function wheelPoints(meshes: THREE.SkinnedMesh[], wheel: THREE.Bone): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (const mesh of meshes) {
    const i = mesh.skeleton.bones.indexOf(wheel);
    if (i < 0) continue;
    const m = mesh.skeleton.boneInverses[i].clone().multiply(mesh.bindMatrix);
    const p = mesh.geometry.getAttribute('position');
    for (let j = 0; j < p.count; j++) pts.push(v().fromBufferAttribute(p, j).applyMatrix4(m));
  }
  return pts;
}

function measureRim(pts: THREE.Vector3[]): Rim | null {
  if (pts.length < 50) return null;
  // The axis: the direction the wheel is thinnest in (the smallest principal axis about the hub).
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const x of pts) {
    const e = x.toArray();
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) C[r * 3 + k] += e[r] * e[k];
  }
  const tr = C[0] + C[4] + C[8];
  const n = v().set(0.3, 0.9, 0.2);
  for (let it = 0; it < 60; it++) {
    const e = n.toArray();
    n.set(tr * e[0] - (C[0] * e[0] + C[1] * e[1] + C[2] * e[2]), tr * e[1] - (C[3] * e[0] + C[4] * e[1] + C[5] * e[2]), tr * e[2] - (C[6] * e[0] + C[7] * e[1] + C[8] * e[2])).normalize();
  }
  const ad = Math.abs(n.x) < 0.9 ? v().set(1, 0, 0) : v().set(0, 1, 0);
  // The rim's centre line and tube, every 10°.
  const e1 = ad.clone().addScaledVector(n, -ad.dot(n)).normalize();
  const e2 = v().crossVectors(n, e1);
  const out: Rim['pts'] = [];
  for (let k = 0; k < 36; k++) {
    const t = (k / 36) * Math.PI * 2;
    const u = e1.clone().multiplyScalar(Math.cos(t)).addScaledVector(e2, Math.sin(t));
    let ro = 0;
    const near: THREE.Vector3[] = [];
    for (const x of pts) {
      const h = x.dot(n);
      const flat = _a.copy(x).addScaledVector(n, -h);
      const r = flat.length();
      if (r < 1e-4 || flat.dot(u) / r < Math.cos((8 * Math.PI) / 180)) continue;
      near.push(x);
      ro = Math.max(ro, r);
    }
    if (!near.length) continue;
    let lo = Infinity, hi = -Infinity;
    for (const x of near) {
      if (_a.copy(x).addScaledVector(n, -x.dot(n)).length() < ro - 0.045) continue;
      lo = Math.min(lo, x.dot(n));
      hi = Math.max(hi, x.dot(n));
    }
    const tube = Math.min(0.025, Math.max(0.008, (hi - lo) / 2));
    out.push({ u, r: ro - tube, h: (hi + lo) / 2 });
  }
  return out.length >= 18 ? { n, tube: 0.016, pts: out } : null;
}

/** The rim's centre line toward in-plane direction `u` (bone space): radius and offset along the axis, interpolated. */
function rimAt(rim: Rim, u: THREE.Vector3) {
  let best = rim.pts[0], second = rim.pts[0], bd = -2, sd = -2;
  for (const p of rim.pts) {
    const d = p.u.dot(u);
    if (d > bd) [second, sd, best, bd] = [best, bd, p, d];
    else if (d > sd) [second, sd] = [p, d];
  }
  const wa = Math.max(1e-3, 1 - sd), wb = Math.max(1e-3, 1 - bd);
  const w = wa / (wa + wb);
  return { r: best.r * w + second.r * (1 - w), h: best.h * w + second.h * (1 - w) };
}

/** Moves the arm so the hand bone sits at `wrist` with world rotation `q`; the elbow stays on its side. */
function reach(bones: Map<string, THREE.Bone>, s: Side, wrist: THREE.Vector3, q: THREE.Quaternion) {
  const up = bones.get('upperarm_' + s)!, lo = bones.get('lowerarm_' + s)!, hand = bones.get('hand_' + s)!;
  const a = pos(up), b = pos(lo), c = pos(hand);
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  const toT = wrist.clone().sub(a);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const axis = toT.normalize();
  // The elbow's side: where it already points, square to shoulder → target.
  const pole = b.clone().sub(a);
  pole.addScaledVector(axis, -pole.dot(axis));
  if (pole.lengthSq() < 1e-8) pole.set(0, -1, 0).addScaledVector(axis, -axis.y);
  pole.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const elbow = a.clone().addScaledVector(axis, x).addScaledVector(pole, Math.sqrt(Math.max(0, l1 * l1 - x * x)));
  turnWorld(up, _q.setFromUnitVectors(b.clone().sub(a).normalize(), elbow.clone().sub(a).normalize()).clone());
  const b2 = pos(lo), c2 = pos(hand);
  const target = a.clone().addScaledVector(axis, d);
  turnWorld(lo, _q.setFromUnitVectors(c2.sub(b2).normalize(), target.sub(b2).normalize()).clone());
  setWorldQuat(hand, q);
}

/** The thing a hand holds: the nearest point of its centre line to `p`, and how far off it a finger's middle runs. */
interface Held {
  nearest(p: THREE.Vector3): THREE.Vector3;
  reach: number;
}

/** Where a joint's bone ends: the next joint, or for the last, the tip (carried on as long as the bone before). */
function endOf(chain: THREE.Bone[], i: number) {
  if (i + 1 < chain.length) return pos(chain[i + 1]);
  const j = pos(chain[i]), prev = pos(chain[i - 1]);
  return j.clone().add(j.clone().sub(prev).multiplyScalar(0.85));
}

/**
 * Brings a spread finger in toward the hand's line (`d`, turning about the palm normal `palm`) by `share`: the
 * modelled hand is splayed like a starfish.
 */
function gather(bone: THREE.Bone, end: THREE.Vector3, d: THREE.Vector3, palm: THREE.Vector3, share: number) {
  const dir = end.sub(pos(bone));
  dir.addScaledVector(palm, -dir.dot(palm));
  const flat = d.clone().addScaledVector(palm, -d.dot(palm));
  if (dir.lengthSq() < 1e-10 || flat.lengthSq() < 1e-10) return;
  const angle = Math.atan2(v().crossVectors(dir, flat).dot(palm), dir.dot(flat));
  turnWorld(bone, _q.setFromAxisAngle(palm, angle * share).clone());
}

/**
 * Closes a finger chain toward the palm about `axis` (knuckle line for a finger), joint by joint: round `held` (each
 * bone's end comes to rest on its surface, solved as two circles meeting in the plane the joint turns in), or by the
 * fixed `bends`.
 */
function close(chain: THREE.Bone[], palm: THREE.Vector3, axis0: THREE.Vector3 | null, held: Held | null, bends?: number[]) {
  // The joints turn about the knuckle line (the thumb, square to the palm), signed once, while the finger is still
  // straight, so + curls toward the palm.
  const E0 = endOf(chain, 0).sub(pos(chain[0]));
  const axis = axis0 ? axis0.clone() : v().crossVectors(E0, palm);
  if (axis.lengthSq() < 1e-10) return;
  axis.normalize();
  if (v().crossVectors(E0, palm).dot(axis) < 0) axis.negate();
  for (let i = 0; i < chain.length; i++) {
    const bone = chain[i];
    const J = pos(bone);
    const E = endOf(chain, i).sub(J);
    let t: number;
    if (!held) t = bends?.[i] ?? 0;
    else {
      const ha = E.dot(axis);
      const e1 = E.clone().addScaledVector(axis, -ha);
      const L = e1.length();
      if (L < 1e-6) continue;
      e1.divideScalar(L);
      const e2 = v().crossVectors(axis, e1);
      const C = held.nearest(J).sub(J);
      const cx = C.dot(e1), cy = C.dot(e2), ca = C.dot(axis);
      const R0 = Math.hypot(cx, cy);
      const K = (L * L + R0 * R0 + (ha - ca) ** 2 - held.reach ** 2) / 2;
      const phi = Math.atan2(cy, cx);
      const c = R0 > 1e-6 ? K / (L * R0) : -2;
      // Out of reach: point at it. Never off it (the joint is already in it): leave the joint straight.
      t = c >= 1 ? phi : c <= -1 ? 0 : phi - Math.acos(c);
      t = THREE.MathUtils.euclideanModulo(t + Math.PI, Math.PI * 2) - Math.PI;
    }
    t = THREE.MathUtils.clamp(t, -0.15, HANDS.maxBend);
    turnWorld(bone, _q.setFromAxisAngle(axis, t).clone());
  }
}

interface Ctx {
  bones: Map<string, THREE.Bone>;
  bind: Map<THREE.Bone, THREE.Quaternion>;
  frames: Record<Side, HandFrame>;
  rim: Rim | null;
}

function fingers(c: Ctx, s: Side) {
  const chain = (f: string) => [1, 2, 3].map((i) => c.bones.get(`${f}_0${i}_${s}`)!);
  const list = [...FINGERS.map(chain), chain('thumb')];
  for (const ch of list) for (const b of ch) b.quaternion.copy(c.bind.get(b)!);
  c.bones.get('hand_' + s)!.updateMatrixWorld(true);
  return list;
}

function palmWorld(c: Ctx, s: Side) {
  return c.frames[s].p.clone().transformDirection(c.bones.get('hand_' + s)!.matrixWorld);
}

/** Hand onto the rim at the angle it's already at, then the fingers round it. */
function gripWheel(c: Ctx, s: Side) {
  const rim = c.rim!;
  const wheel = c.bones.get('wheel')!;
  const hand = c.bones.get('hand_' + s)!;
  const F = c.frames[s];
  const W = wheel.matrixWorld;
  const Winv = W.clone().invert();
  const scale = _a.setFromMatrixScale(W).x;
  // Where the hand holds now, in the wheel's space, and the rim there.
  const now = F.grip.clone().applyMatrix4(hand.matrixWorld).applyMatrix4(Winv);
  const u = now.addScaledVector(rim.n, -now.dot(rim.n)).normalize();
  const { r, h } = rimAt(rim, u);
  const centre = pos(wheel);
  const toWorld = (x: THREE.Vector3) => x.clone().transformDirection(W);
  const nW = toWorld(rim.n), uW = toWorld(u);
  // The axis toward the driver: the side the pelvis is on.
  if (pos(c.bones.get('pelvis')!).sub(centre).dot(nW) < 0) nW.negate();
  const g = u.clone().multiplyScalar(r).addScaledVector(rim.n, h).applyMatrix4(W);
  const tangent = v().crossVectors(nW, uW).normalize();
  // Knuckles along the rim, the index on the side it's on now.
  const kNow = F.k.clone().transformDirection(hand.matrixWorld);
  if (kNow.dot(tangent) < 0) tangent.negate();
  const pT = uW.clone().multiplyScalar(-HANDS.palmIn).addScaledVector(nW, -HANDS.palmForward);
  pT.addScaledVector(tangent, -pT.dot(tangent)).normalize();
  const handed = v().crossVectors(F.k, F.p).dot(F.d) > 0 ? 1 : -1;
  const dT = v().crossVectors(tangent, pT).multiplyScalar(handed);
  const want = new THREE.Matrix4().makeBasis(dT, tangent, pT).multiply(F.basis.clone().transpose());
  const q = new THREE.Quaternion().setFromRotationMatrix(want);
  const handScale = _b.setFromMatrixScale(hand.matrixWorld).x;
  const wrist = g.clone().sub(F.grip.clone().multiplyScalar(handScale).applyQuaternion(q));
  reach(c.bones, s, wrist, q);
  // Fingers and thumb round the rim (a circle: centre, axis, radius).
  const R = r * scale, H = h * scale;
  const axisW = toWorld(rim.n);
  const rimCentre = centre.clone().addScaledVector(axisW, H);
  const tube = rim.tube * scale;
  const held: Held = {
    nearest(p) {
      const q2 = p.clone().sub(rimCentre);
      q2.addScaledVector(axisW, -q2.dot(axisW));
      return rimCentre.clone().addScaledVector(q2.normalize(), R);
    },
    reach: tube + HANDS.finger,
  };
  wrap(c, s, held);
}

/** The fingers round a straight grip where the hand already holds it (the bike's bars). */
function gripBar(c: Ctx, s: Side, radius: number) {
  const hand = c.bones.get('hand_' + s)!;
  const F = c.frames[s];
  const centre = F.grip.clone().applyMatrix4(hand.matrixWorld);
  const along = F.k.clone().transformDirection(hand.matrixWorld);
  const held: Held = {
    nearest: (p) => centre.clone().addScaledVector(along, p.clone().sub(centre).dot(along)),
    reach: radius + HANDS.finger,
  };
  wrap(c, s, held);
}

/** Straightens the fingers back to the model's, draws them together, then closes them (round `held`, or relaxed). */
function wrap(c: Ctx, s: Side, held: Held | null) {
  const hand = c.bones.get('hand_' + s)!;
  const list = fingers(c, s);
  const palm = palmWorld(c, s);
  const d = c.frames[s].d.clone().transformDirection(hand.matrixWorld);
  const k = c.frames[s].k.clone().transformDirection(hand.matrixWorld);
  list.forEach((ch, i) => {
    if (i < 4) gather(ch[0], endOf(ch, 0), d, palm, HANDS.gather);
    const round = held && i === 4 ? { ...held, reach: held.reach + HANDS.thumb } : held;
    close(ch, palm, i < 4 ? k : null, round, i < 4 ? HANDS.relaxed[i] : HANDS.relaxedThumb);
  });
}

const BONES_TOUCHED = (s: Side) => ['upperarm_' + s, 'lowerarm_' + s, 'hand_' + s, ...[...FINGERS, 'thumb'].flatMap((f) => [1, 2, 3].map((i) => `${f}_0${i}_${s}`))];

/** The rim's tube: the wheel's grip is round, so one radius from the thickest stretch of it. */
function withTube(rim: Rim, pts: THREE.Vector3[]): Rim {
  let lo = Infinity, hi = -Infinity;
  // The spread along the axis of the outermost vertices (the rim, not the spokes or hub).
  const rMax = Math.max(...rim.pts.map((x) => x.r));
  for (const p of pts) {
    const x = p.clone();
    const h = x.dot(rim.n);
    const r = x.addScaledVector(rim.n, -h).length();
    if (r < rMax - 0.01) continue;
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const tube = Number.isFinite(lo) ? THREE.MathUtils.clamp((hi - lo) / 2, 0.008, 0.025) : 0.016;
  rim.tube = tube;
  return rim;
}

const cache = new WeakMap<THREE.AnimationClip[], Map<string, THREE.AnimationClip[]>>();

/**
 * `animations` with the hands fixed for this model (its own wheel). Cached per clip set and wheel, since custom
 * drivers share a base's clips but bring their own wheels.
 */
export function gripClips(model: THREE.Object3D, animations: THREE.AnimationClip[]): THREE.AnimationClip[] {
  const names: string[] = [];
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && /^wheel_/.test(o.name)) names.push(o.name);
  });
  const key = names.join(' ');
  let byWheel = cache.get(animations);
  if (!byWheel) cache.set(animations, (byWheel = new Map()));
  const hit = byWheel.get(key);
  if (hit) return hit;
  let out: THREE.AnimationClip[];
  try {
    out = fix(model, animations);
  } catch (e) {
    console.warn('Driver hands not fixed', e);
    out = animations;
  }
  byWheel.set(key, out);
  return out;
}

function fix(model: THREE.Object3D, animations: THREE.AnimationClip[]): THREE.AnimationClip[] {
  const root = cloneSkinned(model);
  root.updateMatrixWorld(true);
  const bones = new Map<string, THREE.Bone>();
  const wheelMeshes: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && /^wheel_/.test(o.name)) wheelMeshes.push(o as THREE.SkinnedMesh);
  });
  for (const s of SIDES) for (const n of BONES_TOUCHED(s)) if (!bones.has(n)) return animations;
  // The bind pose (the file's rest) is the straight hand everything starts from.
  const bind = new Map<THREE.Bone, THREE.Quaternion>();
  for (const b of bones.values()) bind.set(b, b.quaternion.clone());
  // Hand frames in the bind pose, before anything plays.
  const frames = { l: handFrame(bones, 'l'), r: handFrame(bones, 'r') };
  const wheel = bones.get('wheel');
  let rim: Rim | null = null;
  if (wheel) {
    const pts = wheelPoints(wheelMeshes, wheel);
    const r = measureRim(pts);
    if (r) rim = withTube(r, pts);
  }
  const c: Ctx = { bones, bind, frames, rim };
  const touched = SIDES.flatMap(BONES_TOUCHED);

  return animations.map((clip) => {
    const how = clip.name === 'drive' ? (rim ? 'wheel' : null) : clip.name === 'ride' ? 'bar' : clip.name === 'idle' ? 'relax' : null;
    if (!how) return clip;
    // Every key time the clip has.
    const times = [...new Set(clip.tracks.flatMap((t) => [...t.times]))].sort((a, b) => a - b);
    // Sampled by hand, not through a mixer: a mixer skips writing a value that hasn't changed since its last
    // update, so the edits below would leak into the next key.
    const samplers = clip.tracks.flatMap((track) => {
      const dot = track.name.lastIndexOf('.');
      const bone = bones.get(track.name.slice(0, dot));
      const prop = track.name.slice(dot + 1);
      if (!bone || (prop !== 'quaternion' && prop !== 'position' && prop !== 'scale')) return [];
      const at = (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();
      return [{ bone, prop: prop as 'quaternion' | 'position' | 'scale', at }];
    });
    const values = new Map<string, number[]>(touched.map((n) => [n, []]));
    for (const t of times) {
      for (const b of bones.values()) b.quaternion.copy(bind.get(b)!);
      for (const { bone, prop, at } of samplers) {
        const r = at.evaluate(t) as ArrayLike<number>;
        if (prop === 'quaternion') bone.quaternion.set(r[0], r[1], r[2], r[3]).normalize();
        else bone[prop].set(r[0], r[1], r[2]);
      }
      root.updateMatrixWorld(true);
      for (const s of SIDES) {
        if (how === 'wheel') gripWheel(c, s);
        else if (how === 'bar') gripBar(c, s, HANDS.bikeGrip);
        else wrap(c, s, null); // a soft, resting curl
      }
      for (const n of touched) values.get(n)!.push(...bones.get(n)!.quaternion.toArray());
    }
    const keep = clip.tracks.filter((t) => !touched.some((n) => t.name === `${n}.quaternion`));
    const tracks = touched.map((n) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, values.get(n)!));
    return new THREE.AnimationClip(clip.name, clip.duration, [...keep, ...tracks]);
  });
}
