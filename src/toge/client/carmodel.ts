// Procedural car models. Each body is lofted from its design's curves (carkits.ts, carloft.ts): a painted
// lower body with flared arches and dark sills, and a greenhouse with real pillars. Then the car's own kit
// of parts, the garage options (paint, rims, spoiler, stripes, underglow), and four wheels. Static parts are
// merged by material at the end. The model's origin is the centre of gravity, like the physics.

import * as THREE from 'three';
import { CARS, type CarSpec, GLOWS, type OwnedCar, carSpec, isBike } from '../shared/cars.ts';
import { buildBike } from './bikemodel.ts';
import { DESIGNS, type Design, type Kit, makeKitHelpers } from './carkits.ts';
import { type Section, centreTop, curve, loft, smooth, zAt } from './carloft.ts';
import { MAT, glowMaterial, isShared, mergeByMaterial, paintMaterial, plateMaterial, rbox, stripeTexture, wheel } from './carparts.ts';
import { equipped } from '../shared/cosmetics.ts';
import { caliperMaterial, coverMaterial, cosPaint, cosPlateMaterial, exhaustMaterials, frameMaterial, headMaterials, rimMaterial, windowMaterial } from './cosmeticsview.ts';

function bodySection(d: Design, sp: CarSpec, b: { wheelbase: number }, L: number, W: number, H: number, R: number): Section {
  const top = curve(d.top.map(([t, v]) => [t, v * H]));
  const dip = curve(d.dip.map(([t, v]) => [t, v * H]));
  const floor = curve(d.floor);
  const tF = 0.5 - b.wheelbase / (2 * L);
  const tR = 0.5 + b.wheelbase / (2 * L);
  const ar = R + 0.08;
  const sig = (R * 1.3) / L;
  const bump = (x: number) => Math.exp(-(x * x) / (2 * sig * sig));
  const tyre = 0.2 + W * 2 * 0.03;
  const ends = (t: number) => {
    const f = Math.min(1, t / d.nose[0]);
    const r = Math.min(1, (1 - t) / d.tail[0]);
    return (d.nose[1] + (1 - d.nose[1]) * Math.sqrt(1 - (1 - f) ** 2)) * (d.tail[1] + (1 - d.tail[1]) * Math.sqrt(1 - (1 - r) ** 2));
  };
  return {
    length: L,
    t0: 0,
    t1: 1,
    rb: d.rb,
    rt: d.rt,
    top,
    dip,
    floor,
    bottom(t) {
      let y = floor(t);
      for (const ta of [tF, tR]) {
        const dz = (t - ta) * L;
        if (Math.abs(dz) < ar) y = Math.max(y, R + Math.sqrt(ar * ar - dz * dz));
      }
      return y;
    },
    well: () => sp.track / 2 - tyre / 2 - 0.06,
    half(t, v) {
      const arch = Math.max(d.flareF * bump(t - tF), d.flareR * bump(t - tR));
      const bulge = smooth(0.02, 0.3, v) * (1 - 0.6 * smooth(0.75, 1, v));
      return (W - d.waist + arch * bulge) * ends(t) * (1 - d.tumble * smooth(0.5, 1, v));
    },
  };
}

function cabinSection(d: Design, body: Section, W: number, H: number): Section {
  const roof = curve(d.roof.map(([t, v]) => [t, v * H]));
  const t0 = d.roof[0][0];
  const t1 = d.roof[d.roof.length - 1][0];
  const base = (t: number) => centreTop(body, t) - 0.04;
  return {
    length: body.length,
    t0,
    t1,
    rb: 0.02,
    rt: 0.1,
    floor: base,
    bottom: base,
    well: () => 0,
    top: (t) => Math.max(base(t) + 0.005, roof(t)),
    dip: () => 0,
    half(t, v) {
      const e = Math.min(t - t0, t1 - t) / (t1 - t0);
      return W * d.cabin * (1 - d.cabTumble * v) * (0.86 + 0.14 * smooth(0, 0.3, e));
    },
  };
}

export interface CarModel {
  root: THREE.Group;
  /** The body (everything but the wheels), offset from the CG by its position; its meshes are the car's own (crash dents). */
  body: THREE.Group;
  /**
   * Turns the wheels and suspension and the brake lights. Positions are body-space wheel centres. `lat` is the
   * cornering force (m/s², + to the left): bikes lean with it, cars ignore it.
   */
  pose(wheels: { y: number; angle: number }[], steer: number, braking: boolean, lat?: number): void;
  dispose(): void;
}

export function buildCar(owned: OwnedCar): CarModel {
  if (isBike(owned.model)) return buildBike(owned);
  const b = CARS[owned.model];
  const d = DESIGNS[owned.model as keyof typeof DESIGNS];
  const sp = carSpec(owned);
  const look = owned.look;
  const L = b.length;
  const W = b.width / 2;
  const H = b.height;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  // Body space: ground at y = 0, mid-wheelbase at z = 0; the root is the CG.
  body.position.set(0, -sp.cg, (sp.axleR - sp.axleF) / 2);

  const own: { dispose(): void }[] = [];
  // A paint job or decal from a case replaces the stock paint (cosmeticsview.ts).
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

  const lower = bodySection(d, sp, b, L, W, H, b.radius);
  const cabin = cabinSection(d, lower, W, H);
  // Lower body: paint, with dark sills and underside.
  const PAINT = 0;
  const TRIM = 1;
  const GLASS = 2;
  const mats = [paint, MAT.trim, MAT.glass];
  const lowerGeos = loft(lower, 84, 3, (_t, zone) => (zone === 'bottom' || zone === 'lower' ? TRIM : PAINT), PAINT);
  // Greenhouse: glass framed by painted pillars and roof, black B pillar and window seals.
  const cabinGeos = loft(cabin, 44, 3, (t, zone, v) => {
    if (zone === 'bottom' || zone === 'lower') return TRIM;
    if (zone === 'shoulder') return PAINT;
    if (zone === 'top') return t > d.roofF + 0.004 && t < d.roofR - 0.004 ? PAINT : GLASS;
    if (d.bPillar && Math.abs(t - d.bPillar) < 0.012) return TRIM;
    if (t > d.cPillar) return PAINT;
    return v < 0.12 ? TRIM : GLASS;
  });
  for (const geos of [lowerGeos, cabinGeos]) geos.forEach((g, i) => g.index!.count && body.add(new THREE.Mesh(g, mats[i])));

  const kit: Kit = {
    b,
    L,
    W,
    H,
    body: lower,
    cabin,
    paint,
    tail,
    pipe: pipeMats?.pipe ?? MAT.chrome,
    pipeHole: pipeMats?.hole ?? MAT.grille,
    tF: 0.5 - b.wheelbase / (2 * L),
    tR: 0.5 + b.wheelbase / (2 * L),
    ...makeKitHelpers(lower),
    put(geo, mat, p, r = [0, 0, 0], mirror = false) {
      const make = (s: number) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(p[0] * s, p[1], p[2]);
        m.rotation.set(r[0], r[1] * s, r[2] * s);
        body.add(m);
        return m;
      };
      if (mirror) make(-1);
      return make(1);
    },
  };
  d.kit(kit);
  common(kit, d, owned, own);
  tintParts(body, owned);

  // Contact shadow so the car sits on the road even outside the shadow map.
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(b.width * 1.2, L * 1.08), MAT.blob);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.015;
  blob.renderOrder = -1;
  blob.userData.solo = true;
  body.add(blob);

  mergeByMaterial(body);
  blob.castShadow = false;

  const rims = equipped(owned.cos, 'rims');
  const rimMat = rims ? rimMaterial(rims) : undefined;
  const wheels = [0, 1, 2, 3].map((i) => {
    const w = wheel(b, look, rimMat);
    tintParts(w.fixed, owned);
    mergeByMaterial(w.spin);
    mergeByMaterial(w.fixed, new Set([w.spin]));
    const outward = i % 2 === 0 ? -1 : 1;
    if (outward < 0) w.fixed.rotation.y = Math.PI; // the rim's face points out on both sides
    const holder = new THREE.Group();
    holder.add(w.fixed);
    root.add(holder);
    return { holder, ...w, outward };
  });
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o !== blob && !(o as THREE.Mesh).userData.glow) o.castShadow = true;
  });

  return {
    root,
    body,
    pose(ws, steer, braking) {
      wheels.forEach((w, i) => {
        const front = i < 2;
        w.holder.position.set((i % 2 === 0 ? -0.5 : 0.5) * sp.track, ws[i].y, front ? -sp.axleF : sp.axleR);
        w.holder.rotation.y = front ? -steer : 0;
        w.spin.rotation.x = -ws[i].angle * (w.outward < 0 ? -1 : 1);
      });
      tail.emissiveIntensity = braking ? 20 : 3;
    },
    dispose() {
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

/** Swaps shared materials for the car's cosmetic ones: window tint, headlamp tint, brake calipers. */
function tintParts(root: THREE.Object3D, owned: OwnedCar) {
  const swap = new Map<THREE.Material, THREE.Material>();
  const win = equipped(owned.cos, 'window');
  if (win) swap.set(MAT.glass, windowMaterial(win));
  const head = equipped(owned.cos, 'head');
  if (head) {
    const m = headMaterials(head);
    swap.set(MAT.head, m.head);
    swap.set(MAT.drl, m.drl);
  }
  const cal = equipped(owned.cos, 'caliper');
  if (cal) swap.set(MAT.caliper, caliperMaterial(cal));
  if (!swap.size) return;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material)) m.material = swap.get(m.material) ?? m.material;
  });
}

/** Parts every car gets: mirrors, plate (with any cosmetic frame and cover), the chosen spoiler, and underglow. */
function common(k: Kit, d: Design, owned: OwnedCar, own: { dispose(): void }[]) {
  const { W, H } = k;
  // Door mirrors on stalks.
  const mt = d.roof[0][0] + 0.035;
  const my = k.top(mt) + 0.09;
  const mx = k.cabin.half(mt, 0) + 0.04;
  const mz = zAt(k.body, mt);
  k.put(rbox(0.16, 0.025, 0.05, 0.01), MAT.trim, [mx, my - 0.03, mz + 0.02], [0, 0, 0], true);
  k.put(rbox(0.18, 0.1, 0.12, 0.04), k.paint, [mx + 0.13, my, mz], [0, -0.15, 0], true);
  k.put(rbox(0.15, 0.075, 0.01, 0.01), MAT.chrome, [mx + 0.13, my, mz + 0.062], [0, -0.15, 0], true);

  // Rear plate.
  const pz = k.rear(0, d.plateY);
  const plate = cosPlateMaterial(owned, d.plate) ?? plateMaterial(owned.plate || d.plate);
  own.push(plate);
  k.put(new THREE.PlaneGeometry(0.36, 0.115), plate, [0, d.plateY, pz + 0.008]);
  const frame = equipped(owned.cos, 'frame');
  if (frame) {
    const fm = frameMaterial(frame);
    for (const y of [-1, 1]) k.put(rbox(0.39, 0.016, 0.014, 0.005), fm, [0, d.plateY + y * 0.0655, pz + 0.012]);
    k.put(rbox(0.016, 0.115, 0.014, 0.005), fm, [0.187, d.plateY, pz + 0.012], [0, 0, 0], true);
    if (frame.fx.cover > 0) k.put(new THREE.PlaneGeometry(0.37, 0.125), coverMaterial(frame), [0, d.plateY, pz + 0.016]);
  }

  // Spoilers.
  const s = owned.look.spoiler;
  const onRoof = d.roofSpoiler;
  const baseT = onRoof ? d.roofR + 0.02 : 0.955;
  const baseY = onRoof ? H : k.top(baseT);
  const baseZ = k.z(baseT);
  if (s === 1) {
    if (onRoof) {
      k.put(rbox(W * 1.7, 0.035, 0.32, 0.015), k.paint, [0, baseY + 0.025, baseZ + 0.1], [0.12, 0, 0]);
      k.put(rbox(0.03, 0.08, 0.3, 0.012), k.paint, [W * 0.82, baseY - 0.01, baseZ + 0.08], [0.12, 0, 0], true);
    } else {
      k.put(rbox(W * 1.7, 0.05, 0.24, 0.02), k.paint, [0, baseY + 0.02, baseZ + 0.06], [-0.32, 0, 0]);
    }
  } else if (s === 2) {
    // A GT wing on swan necks, with a gurney flap and painted end plates.
    const wy = baseY + (onRoof ? 0.14 : 0.36);
    const wz = baseZ + (onRoof ? 0.18 : 0.05);
    k.put(rbox(W * 1.8, 0.035, 0.34, 0.015), MAT.carbon, [0, wy, wz], [-0.1, 0, 0]);
    k.put(rbox(W * 1.8, 0.04, 0.012, 0.004), MAT.carbon, [0, wy + 0.03, wz + 0.17]);
    k.put(rbox(0.02, 0.24, 0.46, 0.01), k.paint, [W * 0.9, wy - 0.02, wz + 0.01], [0, 0, 0], true);
    for (const x of [-0.42, 0.42]) {
      const path = new THREE.CubicBezierCurve3(
        new THREE.Vector3(x * W, baseY - 0.01, baseZ - 0.06),
        new THREE.Vector3(x * W, baseY + (wy - baseY) * 0.6, baseZ + 0.06),
        new THREE.Vector3(x * W, wy + 0.16, wz - 0.06),
        new THREE.Vector3(x * W, wy + 0.01, wz + 0.02),
      );
      k.put(new THREE.TubeGeometry(path, 16, 0.016, 6), MAT.alloy, [0, 0, 0]);
    }
  }

  // Underglow: a soft pool of light on the road, plus a strip along each sill.
  const glow = equipped(owned.cos, 'glow')?.fx;
  if (owned.look.glow || glow) {
    const color = glow?.color ?? GLOWS[owned.look.glow];
    const pool = glowMaterial(color);
    if (glow) pool.color.multiplyScalar(Math.min(2, glow.power));
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4 * (glow?.power ?? 1)) });
    own.push(pool, strip);
    const g = k.put(new THREE.PlaneGeometry(W * 3, k.L * 1.25), pool, [0, 0.03, 0], [-Math.PI / 2, 0, 0]);
    g.userData.solo = true;
    g.userData.glow = true;
    g.renderOrder = 1;
    const sx = W - d.waist - 0.08;
    k.put(rbox(0.03, 0.03, k.b.wheelbase * 0.62, 0.012), strip, [sx, k.body.floor(0.5) - 0.01, 0], [0, 0, 0], true);
  }
}

/**
 * Time trial: turns a built car into a see-through ghost (no shadow, never hides the road behind it). Materials
 * shared between cars are swapped for clones (dispose() frees them, since clones aren't shared); the car's own
 * are changed in place, so the brake lights still work.
 */
export function ghostly(model: CarModel, opacity = 0.35) {
  const clones = new Map<THREE.Material, THREE.Material>();
  const faded = new Set<THREE.Material>();
  const fade = (m: THREE.Material) => {
    if (faded.has(m)) return m;
    faded.add(m);
    m.transparent = true;
    m.opacity *= opacity;
    m.depthWrite = false;
    return m;
  };
  model.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = false;
    const swap = (mat: THREE.Material) => {
      if (!isShared(mat)) return fade(mat);
      let c = clones.get(mat);
      if (!c) clones.set(mat, (c = fade(mat.clone())));
      return c;
    };
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
  });
}
