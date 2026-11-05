// Procedural car models. Each body is lofted from its design's curves (carkits.ts, carloft.ts): a painted
// lower body with flared arches and dark sills, and a greenhouse with real pillars. Then the car's own kit
// of parts, the garage options (paint, rims, spoiler, stripes, underglow), and four wheels. Static parts are
// merged by material at the end. The model's origin is the centre of gravity, like the physics.

import * as THREE from 'three';
import { CARS, type CarSpec, GLOWS, type OwnedCar, carSpec, isBike } from '../shared/cars.ts';
import { buildBike } from './bikemodel.ts';
import { type Rider, defaultRider } from '../shared/rider.ts';
import { type DriverRig, arrive } from './driver.ts';
import { DESIGNS, type Design, type Kit, makeKitHelpers } from './carkits.ts';
import { type Section, centreTop, curve, loft, smooth, surface, zAt } from './carloft.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLASS, MAT, glowMaterial, isShared, mergeByMaterial, paintMaterial, plateMaterial, rbox, stripeTexture, wheel } from './carparts.ts';
import { equipped } from '../shared/cosmetics.ts';
import { caliperMaterial, coverMaterial, cosPaint, cosPlateMaterial, exhaustMaterials, frameMaterial, headMaterials, rimMaterial, windowMaterial } from './cosmeticsview.ts';

function bodySection(d: Design, sp: CarSpec, b: { wheelbase: number }, L: number, W: number, H: number, R: number): Section {
  const top = curve(d.top.map(([t, v]) => [t, v * H]));
  const dip = curve(d.dip.map(([t, v]) => [t, v * H]));
  const floor = curve(d.floor);
  const tF = 0.5 - b.wheelbase / (2 * L);
  const tR = 0.5 + b.wheelbase / (2 * L);
  // Arch radius: a few fingers of gap over the tyre, like a lowered road car.
  const ar = R + 0.06;
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
    crease: d.crease ?? 0.012,
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

/** The cabin group's name: the race hides it for the car you're sitting in (cockpit camera). */
export const INTERIOR = 'carInterior';
/** Tail lamp glow: running lights, and on the brakes. */
const TAIL_IDLE = 0.9;
const TAIL_BRAKE = 16;

/** Where the hood panel, the cabin floor and the rear deck are, so options and shut lines agree. */
interface Zones {
  /** t from the hood's front edge to the windscreen base. */
  hood: [number, number];
  /** Share of the half width the hood panel spans (inside the fender lines). */
  hoodU: number;
  onHood(t: number, u: number): boolean;
  inCabin(t: number): boolean;
  /** Share of the body's half width the greenhouse covers at t. */
  cabinU(t: number): number;
  /** Rear deck lid (front-engined cars with a boot), or null. */
  deck: [number, number] | null;
  /** Doors: [front edge, rear edge] in t, one or two per side. */
  doors: [number, number][];
}

function panelZones(d: Design, cabin: Section, body: Section, tF: number, R: number): Zones {
  const t0 = d.roof[0][0];
  const t1 = d.roof[d.roof.length - 1][0];
  const hood: [number, number] = [0.05, t0 - 0.008];
  const hoodU = 0.62;
  const L = body.length;
  // Doors start a hand behind the front arch (or at the windscreen base) and run about 1.15 m; a car with a
  // B pillar and a long greenhouse (the hatches) gets rear doors back to the C pillar.
  const front = Math.max(tF + (R + 0.15) / L, t0 - 0.015);
  const firstEnd = d.bPillar ? d.bPillar + 0.006 : Math.min(d.cPillar - 0.01, front + 1.15 / L);
  const doors: [number, number][] = [[front, firstEnd]];
  if (d.bPillar && d.cPillar - d.bPillar > 0.12) doors.push([firstEnd, d.cPillar - 0.02]);
  return {
    hood,
    hoodU,
    onHood: (t, u) => t > hood[0] && t < hood[1] && u < hoodU,
    inCabin: (t) => t > t0 + 0.006 && t < t1 - 0.006,
    cabinU: (t) => cabin.half(t, 0) / Math.max(0.01, body.half(t, 1)),
    deck: t1 < 0.92 && !d.roofSpoiler ? [t1 + 0.012, 0.965] : null,
    doors,
  };
}

/** Where the driver goes: the cockpit camera's eye point, the inside of the roof above it, and the driver's own
 * seat and wheel (hidden once a driver sits down: they bring their own, sized to their reach). */
interface Cockpit {
  eye: THREE.Vector3;
  roofIn: number;
  side: THREE.Group;
}

/**
 * Dash, seats and steering wheel, laid out like the cockpit camera's (right-hand drive): only what shows
 * through the glass, so it's a handful of boxes.
 */
function cabinParts(g: THREE.Group, d: Design, body: Section, cabin: Section, W: number, H: number): Cockpit {
  const roof = curve(d.roof.map(([t, v]) => [t, v * H]));
  const L = body.length;
  const z = (t: number) => zAt(body, t);
  const tAt = (zz: number) => zz / L + 0.5;
  const t0 = d.roof[0][0];
  const halfBase = W * d.cabin * 0.9 - 0.04;
  const halfTop = W * d.cabin * (1 - d.cabTumble) * 0.9 - 0.04;
  const zBase = z(t0);
  const zTop = z(d.roofF);
  const zRear = z(d.roofR);
  const ex = Math.min(0.4, halfTop * 0.5);
  const ez = Math.min(zTop + 0.7, zRear + 0.2);
  const ey = roof(Math.min(d.roofR, tAt(ez))) - 0.25;
  let lid = 0;
  for (let t = t0; t <= tAt(ez) + 0.04; t += 0.01) lid = Math.max(lid, centreTop(body, t));
  const side = new THREE.Group();
  g.add(side);
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, zz: number, rx = 0, ry = 0, rz = 0, to: THREE.Group = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, zz);
    m.rotation.set(rx, ry, rz);
    to.add(m);
    return m;
  };
  // Dash: a slab under the windscreen with a soft top, and a binnacle hood in front of the driver.
  const dashDepth = Math.max(0.3, ez - 0.5 - zBase);
  const dashTop = Math.max(roof(t0) - 0.02, lid + 0.04);
  put(rbox(halfBase * 2 - 0.04, 0.16, dashDepth, 0.05), MAT.cabin, 0, dashTop - 0.08, zBase + dashDepth / 2 + 0.02);
  put(rbox(0.34, 0.08, 0.18, 0.04), MAT.bolster, ex, dashTop + 0.02, zBase + dashDepth - 0.06);
  // Steering wheel on its column, face tipped toward the driver.
  const wz = zBase + dashDepth + 0.04;
  const wy = dashTop - 0.03;
  put(new THREE.TorusGeometry(0.17, 0.018, 8, 28), MAT.bolster, ex, wy, wz, -0.42, 0, 0, side);
  put(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 14), MAT.trim, ex, wy, wz + 0.01, Math.PI / 2 - 0.42, 0, 0, side);
  for (const a of [0, 2.1, -2.1]) put(rbox(0.03, 0.15, 0.015, 0.006), MAT.trim, ex + Math.sin(a) * 0.08, wy - Math.cos(a) * 0.08 * Math.cos(0.42), wz + Math.cos(a) * 0.08 * Math.sin(0.42), -0.42, 0, -a, side);
  // Two bucket seats: cushion, a raked back with bolsters, and a head rest at eye height.
  const sz = ez + 0.2;
  for (const x of [ex, -ex]) {
    const to = x === ex ? side : g;
    const back = new THREE.Group();
    back.position.set(x, ey - 0.62, sz);
    back.rotation.x = 0.22;
    to.add(back);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      back.add(m);
    };
    add(rbox(0.34, 0.56, 0.1, 0.04), MAT.seat, 0, 0.28, 0);
    for (const s of [-1, 1]) add(rbox(0.07, 0.5, 0.15, 0.03), MAT.bolster, s * 0.2, 0.26, -0.02);
    add(rbox(0.26, 0.17, 0.1, 0.05), MAT.bolster, 0, 0.66, 0.01);
    put(rbox(0.46, 0.12, 0.48, 0.04), MAT.seat, x, ey - 0.66, sz - 0.24, 0, 0, 0, to);
  }
  // A rear shelf (or rear seat backs in the hatches) so the back of the cabin isn't an empty hole.
  const tr = Math.min(d.cPillar, d.roof[d.roof.length - 1][0] - 0.02);
  const endZ = z(tr);
  if (endZ - sz > 0.6) {
    // Room for a rear bench: its back against the C pillars, two head rests.
    const bz = Math.max(sz + 0.45, endZ - 0.3);
    put(rbox(halfBase * 1.8, 0.42, 0.12, 0.04), MAT.seat, 0, lid + 0.1, bz, 0.2);
    for (const x of [-ex, ex]) put(rbox(0.24, 0.14, 0.09, 0.045), MAT.bolster, x, lid + 0.38, bz + 0.05, 0.2);
  } else if (endZ > sz + 0.2) put(rbox(halfBase * 1.8, 0.3, 0.12, 0.04), MAT.seat, 0, lid + 0.12, endZ - 0.1, 0.25);
  void cabin;
  return { eye: new THREE.Vector3(ex, ey, ez), roofIn: roof(Math.min(d.roofR, tAt(ez))) - 0.04, side };
}

/**
 * The small things that make it read as a real car: shut lines round the doors, hood and boot, door handles
 * in the trim finish, side repeaters, a fuel flap, wipers, a third brake light and a badge.
 */
function details(k: Kit, d: Design, zones: Zones, beltMat: THREE.Material) {
  const body = k.body;
  const off = 0.0035;
  /** A groove up the flank at t, from just above the sill to the shoulder. */
  const doorLine = (t: number, v0 = 0.12, v1 = 0.94) => {
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) pts.push(body_side(body, t, v0 + ((v1 - v0) * i) / 10, side, off));
      k.put(ribbon(pts, new THREE.Vector3(0, 0, 1), 0.006), MAT.seam, [0, 0, 0]);
    }
  };
  /** A groove across or along the top. */
  const topLine = (pts: THREE.Vector3[], across: THREE.Vector3) => k.put(ribbon(pts, across, 0.006), MAT.seam, [0, 0, 0]);
  const onTop = (t: number, x: number) => new THREE.Vector3(x, k.height(t, x) + off, k.z(t));
  // Doors: the front edge, the rear edge and the handle.
  for (const [a, b] of zones.doors) {
    doorLine(a);
    doorLine(b);
    const ht = b - 0.11 / k.L;
    for (const side of [-1, 1]) {
      const p = body_side(body, ht, 0.8, side, 0.012);
      k.put(rbox(0.024, 0.026, 0.15, 0.01), beltMat, [p.x, p.y, p.z]);
    }
  }
  // Hood: the front edge across, and down each side along the fender line.
  const [h0, h1] = zones.hood;
  const hx = (t: number) => body.half(t, 1) * zones.hoodU;
  {
    const across: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) across.push(onTop(h0, -hx(h0) + (2 * hx(h0) * i) / 12));
    topLine(across, new THREE.Vector3(0, 0, 1));
    for (const s of [-1, 1]) {
      const along: THREE.Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = h0 + ((h1 - h0) * i) / 16;
        along.push(onTop(t, s * hx(t)));
      }
      topLine(along, new THREE.Vector3(1, 0, 0));
    }
  }
  // Boot lid.
  if (zones.deck) {
    const [b0, b1] = zones.deck;
    const bx = (t: number) => body.half(t, 1) * 0.66;
    const across: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) across.push(onTop(b0, -bx(b0) + (2 * bx(b0) * i) / 12));
    topLine(across, new THREE.Vector3(0, 0, 1));
    for (const s of [-1, 1]) {
      const along: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = b0 + ((b1 - b0) * i) / 10;
        along.push(onTop(t, s * bx(t)));
      }
      topLine(along, new THREE.Vector3(1, 0, 0));
    }
  }
  // Side repeaters behind the front arches, and a fuel flap on the right rear quarter.
  const rt = k.tF + (k.b.radius + 0.24) / k.L;
  for (const side of [-1, 1]) {
    const p = body_side(body, rt, 0.72, side, 0.004);
    k.put(rbox(0.012, 0.022, 0.07, 0.008), MAT.amber, [p.x, p.y, p.z]);
  }
  // The fuel flap goes on the rear quarter, clear of the door and the arch; a car with no room there has none.
  const doorEnd = Math.max(...zones.doors.map(([, b]) => b));
  const ft = Math.min(k.tR - (k.b.radius + 0.2) / k.L, doorEnd + 0.2 / k.L);
  if (ft > doorEnd + 0.14 / k.L) {
    const fp = body_side(body, ft, 0.74, 1, 0.002);
    k.put(new THREE.CylinderGeometry(0.07, 0.07, 0.004, 24), k.paint, [fp.x, fp.y, fp.z], [0, 0, Math.PI / 2]);
    k.put(new THREE.TorusGeometry(0.071, 0.003, 4, 28), MAT.seam, [fp.x + 0.001, fp.y, fp.z], [0, Math.PI / 2, 0]);
  }
  // Wipers parked along the windscreen's foot.
  const ws = d.roof[0][0] + 0.01;
  const wy = k.top(ws) + 0.035;
  for (const x of [-0.42, 0.18]) k.put(rbox(0.6, 0.012, 0.022, 0.005), MAT.trim, [x * k.W, wy, k.z(ws) + 0.02], [0, 0, 0.05]);
  // Third brake light along the top of the rear glass.
  const tb = d.roofR + 0.012;
  k.put(rbox(0.32, 0.022, 0.03, 0.008), k.tail, [0, k.cabin.top(tb) + 0.004, k.z(tb)], [0.5, 0, 0]);
  // A badge on the nose.
  const by = k.top(0.02) - 0.05;
  k.put(new THREE.CylinderGeometry(0.035, 0.035, 0.008, 24), MAT.chrome, [0, by, k.front(0, by) + 0.002], [Math.PI / 2, 0, 0]);
}

/** A point on the flank at (t, v), pushed `out` metres along the surface normal. */
function body_side(s: Section, t: number, v: number, side: number, out: number): THREE.Vector3 {
  const p = surface(s, t, v, side);
  const a = surface(s, t, Math.max(0, v - 0.02), side);
  const b = surface(s, t, Math.min(1, v + 0.02), side);
  // In the section's plane, the normal is the up-the-flank tangent turned outward.
  const n = new THREE.Vector3(b.y - a.y, -(b.x - a.x), 0);
  if (n.x * side < 0) n.negate();
  if (n.lengthSq() < 1e-9) n.set(side, 0, 0);
  return p.addScaledVector(n.normalize(), out);
}

/** A thin flat strip through `pts`, `width` wide across `side`. */
function ribbon(pts: THREE.Vector3[], side: THREE.Vector3, width: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  pts.forEach((p, i) => {
    pos.push(p.x - side.x * width / 2, p.y - side.y * width / 2, p.z - side.z * width / 2);
    pos.push(p.x + side.x * width / 2, p.y + side.y * width / 2, p.z + side.z * width / 2);
    if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Seen from either side of the flank: make it double-faced.
  const back = g.clone();
  const bi = [...idx];
  for (let i = 0; i < bi.length; i += 3) [bi[i + 1], bi[i + 2]] = [bi[i + 2], bi[i + 1]];
  back.setIndex(bi);
  back.computeVertexNormals();
  const merged = mergeGeometries([g, back]);
  return merged ?? g;
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
  /** Who's in it, once their model has loaded (null: nobody yet, or an empty showroom car). */
  readonly driver: DriverRig | null;
  dispose(): void;
}


/** `rider`: who sits on a bike (null: nobody; the showroom stands them beside it). Cars keep their drivers inside. */
export function buildCar(owned: OwnedCar, rider: Rider | null = defaultRider()): CarModel {
  if (isBike(owned.model)) return buildBike(owned, rider);
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
  // A deep red: any green in a bright emissive tips over into orange through the tone mapping.
  const tail = new THREE.MeshPhysicalMaterial({ color: tailFx?.lens ?? 0x3a0204, emissive: tailFx?.light ?? 0xff0404, emissiveIntensity: TAIL_IDLE, roughness: 0.12, clearcoat: 1 });
  const pipes = equipped(owned.cos, 'exhaust');
  const pipeMats = pipes ? exhaustMaterials(pipes) : null;

  const lower = bodySection(d, sp, b, L, W, H, b.radius);
  const cabin = cabinSection(d, lower, W, H);
  const zones = panelZones(d, cabin, lower, 0.5 - b.wheelbase / (2 * L), b.radius);
  const beltMat = look.trim === 1 ? MAT.chrome : look.trim === 2 ? paint : MAT.trim;
  // Material slots for the lofts.
  const PAINT = 0;
  const TRIM = 1;
  const GLAZE = 2;
  const FLOOR = 3;
  const HOOD = 4;
  const ROOF = 5;
  const BELT = 6;
  const mats = [paint, MAT.trim, GLASS[look.tint] ?? GLASS[1], MAT.cabin, [paint, MAT.carbonSkin, MAT.matte][look.hood] ?? paint, [paint, MAT.gloss, MAT.carbonSkin][look.roof] ?? paint, beltMat];
  // Lower body: paint, with dark sills and underside; the hood panel takes its option, and its top inside the
  // greenhouse is the cabin floor, seen through the glass.
  const lowerGeos = loft(lower, 84, mats.length, (t, zone, _v, u) => {
    if (zone === 'bottom' || zone === 'lower') return TRIM;
    if (zone === 'top' && zones.inCabin(t) && u < zones.cabinU(t)) return FLOOR;
    if (zone === 'top' && zones.onHood(t, u)) return HOOD;
    return PAINT;
  }, PAINT);
  // Greenhouse: glass framed by painted pillars and roof, a black B pillar, and the window seals in the trim finish.
  const glazed = (t: number, zone: string, v: number) => {
    if (zone === 'bottom' || zone === 'lower' || zone === 'shoulder') return false;
    if (zone === 'top') return !(t > d.roofF + 0.004 && t < d.roofR - 0.004);
    if (d.bPillar && Math.abs(t - d.bPillar) < 0.012) return false;
    return t <= d.cPillar && v >= 0.12;
  };
  const cabinGeos = loft(cabin, 44, mats.length, (t, zone, v) => {
    if (zone === 'bottom' || zone === 'lower') return TRIM;
    if (zone === 'shoulder') return t > d.roofF + 0.004 && t < d.roofR - 0.004 ? ROOF : PAINT;
    if (zone === 'top') return t > d.roofF + 0.004 && t < d.roofR - 0.004 ? ROOF : GLAZE;
    if (d.bPillar && Math.abs(t - d.bPillar) < 0.012) return TRIM;
    if (t > d.cPillar) return PAINT;
    return v < 0.12 ? BELT : GLAZE;
  });
  for (const geos of [lowerGeos, cabinGeos]) geos.forEach((g, i) => g.index!.count && body.add(new THREE.Mesh(g, mats[i])));

  // The inside of the cabin, seen through the glass: the pillars and headliner from inside (the same loft,
  // drawn from its back), dash, seats and wheel. Hidden while you're in it (the cockpit camera has its own).
  const inside = new THREE.Group();
  inside.name = INTERIOR;
  body.add(inside);
  const [liner] = loft(cabin, 44, 1, (t, zone, v) => (glazed(t, zone, v) ? -1 : 0));
  inside.add(new THREE.Mesh(liner, MAT.liner));
  const cockpit = cabinParts(inside, d, lower, cabin, W, H);

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
    pipeHole: pipeMats?.hole ?? MAT.hole,
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
  details(kit, d, zones, beltMat);
  tintParts(body, owned);

  // Contact shadow so the car sits on the road even outside the shadow map.
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(b.width * 1.2, L * 1.08), MAT.blob);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.015;
  blob.renderOrder = -1;
  blob.userData.solo = true;
  body.add(blob);

  mergeByMaterial(body, new Set([inside]));
  mergeByMaterial(inside, new Set([cockpit.side]));
  mergeByMaterial(cockpit.side);
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
  // The cabin sits in the body's shadow and shades nothing outside it.
  inside.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = false;
      o.receiveShadow = true;
    }
  });

  // The driver gets in once their model has loaded: eyes where the cockpit camera's are, never through the roof.
  const seat = arrive(root, rider, (rig) => {
    rig.sit();
    const at = cockpit.eye.clone().sub(rig.fit.eye);
    at.y = Math.min(at.y, cockpit.roofIn - rig.fit.headTop);
    rig.root.position.copy(at);
    cockpit.side.visible = false;
    inside.add(rig.root);
  });

  return {
    root,
    body,
    get driver() {
      return seat.rig;
    },
    pose(ws, steer, braking) {
      wheels.forEach((w, i) => {
        const front = i < 2;
        w.holder.position.set((i % 2 === 0 ? -0.5 : 0.5) * sp.track, ws[i].y, front ? -sp.axleF : sp.axleR);
        w.holder.rotation.y = front ? -steer : 0;
        w.spin.rotation.x = -ws[i].angle * (w.outward < 0 ? -1 : 1);
      });
      tail.emissiveIntensity = braking ? TAIL_BRAKE : TAIL_IDLE;
      // The wheel turns further than the road wheels (a steering ratio), so small corrections still read.
      const x = steer / sp.steer;
      seat.rig?.steer(Math.sign(x) * Math.abs(x) ** 0.6);
    },
    dispose() {
      seat.leave();
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
  const cap = [k.paint, MAT.gloss, MAT.carbon][owned.look.mirrors] ?? k.paint;
  k.put(rbox(0.16, 0.025, 0.05, 0.01), MAT.trim, [mx, my - 0.03, mz + 0.02], [0, 0, 0], true);
  k.put(rbox(0.19, 0.105, 0.13, 0.045), cap, [mx + 0.13, my, mz], [0, -0.15, 0], true);
  k.put(rbox(0.17, 0.085, 0.02, 0.012), MAT.trim, [mx + 0.13, my, mz + 0.058], [0, -0.15, 0], true);
  k.put(new THREE.PlaneGeometry(0.15, 0.068), MAT.lens, [mx + 0.13 - 0.01, my, mz + 0.07], [0, -0.15, 0], true);
  // An indicator strip along the cap's outer edge.
  k.put(rbox(0.06, 0.012, 0.03, 0.005), MAT.amber, [mx + 0.2, my - 0.035, mz - 0.02], [0, -0.15, 0], true);

  // Front lip: a thin black blade under the nose, or a carbon splitter with end plates.
  const lip = owned.look.lip;
  if (lip) {
    const ly = Math.max(0.09, k.body.floor(0.02) - 0.03);
    const lz = k.front(0, ly + 0.05) + 0.02;
    const lw = k.body.half(0.06, 0.2) * 1.9;
    if (lip === 1) k.put(rbox(lw, 0.03, 0.12, 0.012), MAT.gloss, [0, ly + 0.02, lz + 0.04]);
    else {
      k.put(rbox(lw * 1.04, 0.022, 0.26, 0.008), MAT.carbon, [0, ly, lz + 0.08]);
      k.put(rbox(0.015, 0.09, 0.22, 0.005), MAT.carbon, [lw * 0.52, ly + 0.04, lz + 0.09], [0, 0, 0], true);
    }
  }

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
  model.root.userData.ghost = opacity;
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
