// Procedural sports bikes. A bike is built from painted shells (nose fairing, belly pan, tank, tail unit)
// lofted round smooth cross-sections, with UVs laid out like the cars' bodies (u nose to tail, v round the
// section from the bottom centre), so paint, stripes, finishes and case paint jobs all work on it. Then the
// frame, engine, swingarm, fork and bars, two wheels and a rider in leathers.
//
// The physics drives a bike like a car on a narrow hidden track (cars.ts), so the model does the rest: it
// leans into turns by the cornering force (`pose`'s `lat`), around the line where its tyres meet the road,
// and the fork steers round its raked axis. root (the CG, like the cars) -> lean -> frame (the CG again,
// leaning; the rider's eye and the cockpit ride here) -> body (ground y = 0, mid-wheelbase z = 0, front -Z).

import * as THREE from 'three';
import { CARS, GLOWS, type OwnedCar, carSpec } from '../shared/cars.ts';
import { equipped } from '../shared/cosmetics.ts';
import type { Rider } from '../shared/rider.ts';
import { curve } from './carloft.ts';
import type { CarModel } from './carmodel.ts';
import { MAT, glowMaterial, isShared, mergeByMaterial, paintMaterial, plateMaterial, rbox, stripeTexture, wheel } from './carparts.ts';
import { arrive } from './driver.ts';
import { caliperMaterial, cosPaint, cosPlateMaterial, exhaustMaterials, frameMaterial, coverMaterial, headMaterials, rimMaterial, windowMaterial } from './cosmeticsview.ts';

const UP = new THREE.Vector3(0, 1, 0);
/** The most a bike leans (rad), and how quickly the shown lean follows the cornering force (per frame). */
const MAX_LEAN = 0.85;
const LEAN_FOLLOW = 0.2;

type Keys = [number, number][];

/**
 * A smooth closed shell from z0 (t = 0) to z1 (t = 1): at each t a rounded section centred on yc(t),
 * hy(t) tall and hx(t) wide (half sizes). `p` squares it off (2 = ellipse, higher = boxier).
 */
function shell(z0: number, z1: number, yc: Keys, hy: Keys, hx: Keys, p = 2.6, segs = 28, ring = 24): THREE.BufferGeometry {
  const fy = curve(yc);
  const fh = curve(hy);
  const fw = curve(hx);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const z = z0 + (z1 - z0) * t;
    for (let j = 0; j <= ring; j++) {
      // v: 0 at the bottom centre, 0.5 on top, back to 1 at the bottom.
      const v = j / ring;
      const a = v * Math.PI * 2;
      const s = -Math.sin(a);
      const c = -Math.cos(a);
      const se = (x: number) => Math.sign(x) * Math.abs(x) ** (2 / p);
      pos.push(se(s) * fw(t), fy(t) + se(c) * fh(t), z);
      uv.push(t, v);
    }
  }
  const row = ring + 1;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  // Cap both ends with a fan to the section's centre, so no open end shows a hole.
  for (const [i, t, dir] of [[0, 0, -1], [segs, 1, 1]] as const) {
    const c = pos.length / 3;
    pos.push(0, fy(t), z0 + (z1 - z0) * t);
    uv.push(t, 0.5);
    for (let j = 0; j < ring; j++) {
      const a = i * row + j;
      if (dir < 0) idx.push(c, a + 1, a);
      else idx.push(c, a, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A capsule (or box when `box`) from a to b, for frame tubes, the fork and the rider's limbs. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, box = false): THREE.Mesh {
  const len = a.distanceTo(b);
  const geo = box ? new THREE.BoxGeometry(r * 2, len, r * 1.4) : new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 10);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  return m;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const at = <T extends THREE.Object3D>(o: T, p: THREE.Vector3): T => (o.position.copy(p), o);

export function buildBike(owned: OwnedCar, rider: Rider | null): CarModel {
  const b = CARS[owned.model];
  const sp = carSpec(owned);
  const look = owned.look;
  const R = b.radius;
  const zF = -b.wheelbase / 2;
  const zR = b.wheelbase / 2;

  const root = new THREE.Group();
  const lean = new THREE.Group();
  lean.position.y = -sp.cg;
  root.add(lean);
  const frame = new THREE.Group();
  frame.position.y = sp.cg;
  lean.add(frame);
  const body = new THREE.Group();
  body.position.set(0, -sp.cg, (sp.axleR - sp.axleF) / 2);
  frame.add(body);

  const own: { dispose(): void }[] = [];
  const job = cosPaint(owned);
  const paint = job?.mat ?? paintMaterial(look);
  if (job) own.push(...job.own);
  else if (look.stripe) {
    const tex = stripeTexture(look);
    paint.map = tex;
    paint.color.set(0xffffff);
    own.push(tex);
  }
  const tailFx = equipped(owned.cos, 'tail')?.fx;
  const tail = new THREE.MeshStandardMaterial({ color: tailFx?.lens ?? 0x6a0707, emissive: tailFx?.light ?? 0xff1a12, emissiveIntensity: 3, roughness: 0.2 });
  const pipes = equipped(owned.cos, 'exhaust');
  const pipeMats = pipes ? exhaustMaterials(pipes) : null;
  const pipe = pipeMats?.pipe ?? MAT.chrome;
  const pipeHole = pipeMats?.hole ?? MAT.grille;
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a23a, metalness: 1, roughness: 0.25 });
  own.push(tail, gold);
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], r: [number, number, number] = [0, 0, 0], mirror = false, parent: THREE.Object3D = body) => {
    const make = (s: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p[0] * s, p[1], p[2]);
      m.rotation.set(r[0], r[1] * s, r[2] * s);
      parent.add(m);
      return m;
    };
    if (mirror) make(-1);
    return make(1);
  };
  const add = (m: THREE.Mesh, parent: THREE.Object3D = body) => (parent.add(m), m);

  // --- Bodywork -------------------------------------------------------------------------------
  // Nose fairing: a sharp beak low at the front swelling to the shoulders round the fork, open at the back.
  const nz0 = zF - 0.26;
  const nz1 = zF + 0.62;
  add(new THREE.Mesh(shell(nz0, nz1,
    [[0, 0.77], [0.25, 0.76], [0.6, 0.68], [1, 0.62]],
    [[0, 0.03], [0.12, 0.12], [0.4, 0.23], [0.75, 0.32], [1, 0.35]],
    [[0, 0.03], [0.12, 0.13], [0.45, 0.21], [0.8, 0.26], [1, 0.27]], 2.4), paint));
  // Belly pan and lower side panels round the engine.
  add(new THREE.Mesh(shell(zF + 0.22, zF + 1.02,
    [[0, 0.42], [0.5, 0.36], [1, 0.4]],
    [[0, 0.16], [0.4, 0.2], [1, 0.12]],
    [[0, 0.2], [0.35, 0.22], [1, 0.12]], 3), paint));
  // Tank: tall at the front, sloping down to the seat, knee cut-outs in the plan.
  add(new THREE.Mesh(shell(zF + 0.5, zF + 1.0,
    [[0, 0.93], [0.5, 0.94], [1, 0.88]],
    [[0, 0.1], [0.4, 0.13], [1, 0.07]],
    [[0, 0.17], [0.3, 0.2], [0.75, 0.16], [1, 0.13]], 2.2), paint));
  // Seat (dark) and the tail unit rising behind it to a point.
  add(new THREE.Mesh(shell(zF + 0.96, zF + 1.36,
    [[0, 0.88], [1, 0.9]], [[0, 0.04], [1, 0.04]], [[0, 0.13], [1, 0.11]], 3), MAT.rubber));
  const tz0 = zF + 1.2;
  const tz1 = zR + 0.36;
  add(new THREE.Mesh(shell(tz0, tz1,
    [[0, 0.84], [0.6, 0.93], [1, 1.0]],
    [[0, 0.09], [0.5, 0.08], [1, 0.025]],
    [[0, 0.14], [0.5, 0.11], [1, 0.035]], 2.4), paint));
  // Screen: smoked glass (window tints apply) curving up from the top of the fairing.
  add(new THREE.Mesh(shell(zF + 0.18, zF + 0.5,
    [[0, 0.93], [1, 1.12]], [[0, 0.012], [1, 0.008]], [[0, 0.19], [1, 0.13]], 2), MAT.glass));

  // Twin slit headlamps and a running-light brow in the nose, mirrors on stalks, a fairing intake.
  for (const s of [-1, 1]) {
    const hz = nz0 + 0.12;
    put(rbox(0.13, 0.035, 0.06, 0.015), MAT.gloss, [s * 0.07, 0.77, hz], [0.15, s * 0.45, 0]);
    put(rbox(0.1, 0.02, 0.03, 0.008), MAT.head, [s * 0.07, 0.77, hz - 0.03], [0.15, s * 0.45, 0]);
    put(rbox(0.12, 0.008, 0.012, 0.004), MAT.drl, [s * 0.09, 0.81, hz + 0.02], [0.15, s * 0.5, -s * 0.2]);
    put(rbox(0.13, 0.06, 0.03, 0.02), paint, [s * 0.33, 0.98, nz1 - 0.12], [0, s * -0.2, 0]);
    put(rbox(0.012, 0.012, 0.12, 0.004), MAT.trim, [s * 0.27, 0.97, nz1 - 0.12]);
    put(rbox(0.11, 0.045, 0.006, 0.015), MAT.chrome, [s * 0.33, 0.98, nz1 - 0.105], [0, s * -0.2, 0]);
  }
  put(rbox(0.12, 0.06, 0.05, 0.02), MAT.grille, [0, 0.6, nz0 + 0.12]);
  // Side vents in the fairing, number boards' worth of dark slats.
  for (let i = 0; i < 3; i++) put(rbox(0.012, 0.03, 0.12, 0.005), MAT.grille, [0.265, 0.62 - i * 0.05, nz1 - 0.12], [0, 0.05, 0], true);

  // --- Frame, engine, swingarm, exhaust -----------------------------------------------------------
  const head = v3(0, 0.9, zF + 0.24);
  const pivot = v3(0, 0.5, zF + 1.06);
  for (const s of [-1, 1]) {
    add(limb(v3(s * 0.05, head.y - 0.02, head.z + 0.03), v3(s * 0.2, 0.74, zF + 0.72), 0.035, MAT.alloy, true));
    add(limb(v3(s * 0.2, 0.74, zF + 0.72), v3(s * 0.16, pivot.y + 0.03, pivot.z), 0.035, MAT.alloy, true));
  }
  // Engine: crankcase, a canted block of four with fins, the clutch cover.
  put(rbox(0.36, 0.22, 0.42, 0.05), MAT.trim, [0, 0.36, zF + 0.72]);
  put(rbox(0.32, 0.22, 0.26, 0.04), MAT.trim, [0, 0.55, zF + 0.58], [-0.45, 0, 0]);
  for (let i = 0; i < 4; i++) put(rbox(0.34, 0.012, 0.27, 0.004), MAT.alloy, [0, 0.47 + i * 0.045, zF + 0.6 - i * 0.02], [-0.45, 0, 0]);
  put(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 24), MAT.alloy, [0.19, 0.38, zF + 0.78], [0, 0, Math.PI / 2]);
  // Exhaust: headers sweep down under the engine to a short angled can on the right.
  for (let i = 0; i < 4; i++) {
    const x = -0.09 + i * 0.06;
    add(limb(v3(x, 0.5, zF + 0.46), v3(x * 0.5, 0.2, zF + 0.58), 0.018, MAT.alloy));
  }
  add(limb(v3(0, 0.2, zF + 0.6), v3(0.12, 0.26, zF + 1.0), 0.04, MAT.alloy));
  const can0 = v3(0.17, 0.32, zF + 1.0);
  const can1 = v3(0.21, 0.5, zF + 1.42);
  const can = add(limb(can0, can1, 0.065, pipe));
  can.geometry.dispose();
  can.geometry = new THREE.CylinderGeometry(0.065, 0.07, can0.distanceTo(can1), 18);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.05, 18), pipeHole);
  hole.position.copy(can1).addScaledVector(can1.clone().sub(can0).normalize(), 0.005);
  hole.lookAt(can1.clone().multiplyScalar(2).sub(can0));
  add(hole);
  // Footpegs and rear sets.
  for (const s of [-1, 1]) put(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8), MAT.alloy, [s * 0.2, 0.42, zF + 1.06], [0, 0, Math.PI / 2]);

  // Plate hugger off the tail, with the plate tilted back, and a tail lamp in the point of the tail.
  const plateZ = zR + 0.3;
  const plateY = 0.66;
  add(limb(v3(0, 0.88, zR + 0.16), v3(0, plateY + 0.05, plateZ - 0.03), 0.018, MAT.trim));
  const plate = cosPlateMaterial(owned, 'RAIDEN') ?? plateMaterial(owned.plate || 'RAIDEN');
  own.push(plate);
  put(new THREE.PlaneGeometry(0.26, 0.09), plate, [0, plateY, plateZ], [-0.25, 0, 0]);
  const pframe = equipped(owned.cos, 'frame');
  if (pframe) {
    const fm = frameMaterial(pframe);
    for (const y of [-1, 1]) put(rbox(0.28, 0.012, 0.012, 0.004), fm, [0, plateY + y * 0.05, plateZ + 0.006 + y * 0.012], [-0.25, 0, 0]);
    if (pframe.fx.cover > 0) put(new THREE.PlaneGeometry(0.27, 0.1), coverMaterial(pframe), [0, plateY, plateZ + 0.01], [-0.25, 0, 0]);
  }
  put(rbox(0.12, 0.03, 0.04, 0.012), tail, [0, 0.97, tz1 - 0.04], [0.3, 0, 0]);
  for (const s of [-1, 1]) {
    add(limb(v3(0, plateY + 0.08, plateZ - 0.04), v3(s * 0.12, plateY + 0.08, plateZ - 0.04), 0.008, MAT.trim));
    put(rbox(0.05, 0.022, 0.03, 0.01), MAT.amber, [s * 0.14, plateY + 0.08, plateZ - 0.04]);
  }

  // Underglow: a pool under the bike and a strip down each side of the belly pan.
  const glowFx = equipped(owned.cos, 'glow')?.fx;
  if (look.glow || glowFx) {
    const color = glowFx?.color ?? GLOWS[look.glow];
    const pool = glowMaterial(color);
    if (glowFx) pool.color.multiplyScalar(Math.min(2, glowFx.power));
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4 * (glowFx?.power ?? 1)) });
    own.push(pool, strip);
    const g = put(new THREE.PlaneGeometry(1.4, b.length * 1.2), pool, [0, 0.03, 0], [-Math.PI / 2, 0, 0]);
    g.userData.solo = true;
    g.userData.glow = true;
    g.renderOrder = 1;
    put(rbox(0.02, 0.02, 0.6, 0.008), strip, [0.2, 0.3, zF + 0.62], [0, 0, 0], true);
  }

  // Contact shadow.
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.9, b.length * 1.1), MAT.blob);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.015;
  blob.renderOrder = -1;
  blob.userData.solo = true;
  lean.add(blob);
  blob.position.z = (sp.axleR - sp.axleF) / 2;

  // --- Wheels, swingarm, fork --------------------------------------------------------------------
  const rims = equipped(owned.cos, 'rims');
  const rimMat = rims ? rimMaterial(rims) : undefined;
  const makeWheel = (width: number) => {
    const w = wheel(b, look, rimMat);
    mergeByMaterial(w.spin);
    mergeByMaterial(w.fixed, new Set([w.spin]));
    w.fixed.scale.x = width;
    const holder = new THREE.Group();
    holder.add(w.fixed);
    return { holder, ...w };
  };
  const rear = makeWheel(0.85);
  rear.holder.position.set(0, R, zR);
  body.add(rear.holder);
  // Swingarm: two alloy beams from the pivot to the rear axle, swung as the shock works.
  const arm = new THREE.Group();
  arm.position.copy(pivot);
  const armLen = Math.hypot(zR - pivot.z, R - pivot.y);
  for (const s of [-1, 1]) arm.add(limb(v3(s * 0.12, 0, 0), v3(s * 0.12, 0, armLen), 0.035, MAT.alloy, true));
  arm.add(limb(v3(0.12, 0, armLen * 0.3), v3(0.12, 0.1, armLen * 0.85), 0.012, MAT.alloy, true));
  body.add(arm);
  /** Swings the arm down from the pivot to the rear axle (at height y). */
  const swing = (y: number) => (arm.rotation.x = Math.atan2(pivot.y - y, zR - pivot.z));
  swing(R);
  // Fork and bars steer round the raked steering axis through the head.
  const axleF = v3(0, R, zF);
  const axis = head.clone().sub(axleF).normalize();
  const steerG = new THREE.Group();
  steerG.position.copy(head);
  body.add(steerG);
  const local = (p: THREE.Vector3) => p.clone().sub(head);
  for (const s of [-1, 1]) {
    // Gold upside-down fork: fat tubes up top, slim lowers down to the axle.
    steerG.add(limb(local(v3(s * 0.1, 0.62, zF + 0.1)), local(v3(s * 0.1, head.y + 0.04, head.z + 0.02)), 0.032, gold));
    steerG.add(limb(local(v3(s * 0.1, R, zF)), local(v3(s * 0.1, 0.64, zF + 0.11)), 0.022, MAT.chrome));
    // Clip-ons: a short bar dropping out from each fork leg, a grip and a lever.
    const bar0 = local(v3(s * 0.1, head.y + 0.02, head.z + 0.03));
    const bar1 = local(v3(s * 0.3, head.y - 0.02, head.z + 0.08));
    steerG.add(limb(bar0, bar1, 0.012, MAT.trim));
    steerG.add(limb(bar1, bar1.clone().add(v3(s * 0.06, -0.005, 0.01)), 0.018, MAT.rubber));
    steerG.add(limb(bar0.clone().add(v3(s * 0.04, 0, -0.04)), bar1.clone().add(v3(0, 0.01, -0.07)), 0.006, MAT.alloy));
  }
  // Top yoke and a little front mudguard.
  steerG.add(at(new THREE.Mesh(rbox(0.26, 0.03, 0.1, 0.01), MAT.alloy), local(v3(0, head.y + 0.03, head.z + 0.02))));
  // An arc over the top of the tyre (the torus lies in the wheel's plane, from front-high to back-high).
  const guard = new THREE.Mesh(new THREE.TorusGeometry(R + 0.05, 0.03, 6, 18, Math.PI * 0.55).rotateZ(Math.PI * 0.15).rotateY(Math.PI / 2), paint);
  guard.scale.x = 2.4;
  const front = makeWheel(0.6);
  front.holder.add(guard);
  front.holder.position.copy(local(axleF));
  steerG.add(front.holder);

  // --- Rider ----------------------------------------------------------------------------------
  // The racer's own driver (driver.ts) in the riding pose, hips on the saddle, hands on the bars; null leaves the
  // saddle empty (the showroom stands your driver beside the bike instead). They sit in their own group, so the
  // rider's-eye camera can hide them (racegame.ts reads root.userData.rider), and arrive once their model has
  // loaded. Their meshes are every clone's: never merged, never disposed here.
  const saddle = new THREE.Group();
  saddle.position.set(0, 0.95, zF + 1.14); // the hip point, a hand above the saddle top
  body.add(saddle);

  // Cosmetic tints (screen, headlamps, calipers) and merging, like the cars.
  const swap = new Map<THREE.Material, THREE.Material>();
  const win = equipped(owned.cos, 'window');
  if (win) swap.set(MAT.glass, windowMaterial(win));
  const headCos = equipped(owned.cos, 'head');
  if (headCos) {
    const m = headMaterials(headCos);
    swap.set(MAT.head, m.head);
    swap.set(MAT.drl, m.drl);
  }
  const cal = equipped(owned.cos, 'caliper');
  if (cal) swap.set(MAT.caliper, caliperMaterial(cal));
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material)) m.material = swap.get(m.material) ?? m.material;
  });
  mergeByMaterial(body, new Set([steerG, arm, rear.holder, saddle]));
  mergeByMaterial(steerG, new Set([front.holder]));
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o !== blob && !(o as THREE.Mesh).userData.glow) o.castShadow = true;
  });
  root.userData.rider = saddle;
  root.userData.lean = frame;
  const seat = arrive(root, rider, (rig) => {
    rig.ride();
    saddle.add(rig.root);
  });

  let shown = 0;
  const q = new THREE.Quaternion();
  return {
    root,
    // A bike leans, so its parts aren't in plain CG space: crash damage doesn't dent it (it still smokes and blows up).
    body: new THREE.Group(),
    get driver() {
      return seat.rig;
    },
    pose(ws, steer, braking, lat = 0) {
      // Suspension: the wheels' centres (CG space) move the fork along its axis and swing the arm.
      const yF = (ws[0].y + ws[1].y) / 2 + sp.cg - R;
      const yR = (ws[2].y + ws[3].y) / 2 + sp.cg - R;
      front.holder.position.copy(local(axleF)).addScaledVector(axis, yF / Math.max(0.5, axis.y));
      rear.holder.position.set(0, R + yR, zR);
      swing(R + yR);
      front.spin.rotation.x = -(ws[0].angle + ws[1].angle) / 2;
      rear.spin.rotation.x = -(ws[2].angle + ws[3].angle) / 2;
      steerG.quaternion.copy(q.setFromAxisAngle(axis, -steer * 0.7));
      // Lean into the turn by the cornering force (right turn: lat < 0, lean right).
      const want = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, Math.atan(lat / 9.81)));
      shown += (want - shown) * LEAN_FOLLOW;
      lean.rotation.z = shown;
      tail.emissiveIntensity = braking ? 20 : 3;
    },
    dispose() {
      seat.leave(); // the driver's geometry is every clone's: take it off before freeing the bike's own
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const list = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of list) if (!isShared(mat)) mat.dispose();
      });
      for (const x of own) x.dispose();
    },
  };
}
