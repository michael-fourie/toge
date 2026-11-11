// The course: Skerry Light, a sea stack off a cold northern coast with a dead lighthouse on top. Pure and
// deterministic (no three.js): the solids the climber collides with, the checkpoints, the finish, the decoration
// spots the renderer dresses, and the route an autopilot follows (tests/beacon.test.ts runs it end to end).
//
// Shape: the path is an inward square spiral round the stack, climbing as it goes. Each edge is one stretch of
// pieces (gaps, mantles, wall runs, slides, ramps, beams, stairs) built from a cursor; the last pad of an edge is
// stretched to the corner so the spiral stays square. The rock is not authored: once the path exists, each height
// band of the stack is the biggest box that stays `ROCK.margin` inside every piece at that height, so the stack
// always hugs the route and never blocks it. The top band is the lighthouse tower.

import { MOVE, type Mat, type Solid, World } from './move.ts';

export type V3 = [number, number, number];

export type Act = 'run' | 'jump' | 'slide' | 'wallrun' | 'mantle' | 'climb';

/** One leg of the route: get from where you are to `to`, doing `act` at `at` (a point on the way). */
export interface Leg {
  act: Act;
  at: V3;
  to: V3;
  /** Spiral direction index (0..3) while on this leg. */
  d: number;
  /** Sideways offset from the centre line to take (negative is toward the rock). */
  lane: number;
}

export interface Checkpoint {
  name: string;
  min: V3;
  max: V3;
  spawn: V3;
  yaw: number;
}

export type DecorKind = 'brazier' | 'lamp' | 'crate' | 'barrel' | 'rope' | 'bollard' | 'flag' | 'chain' | 'support' | 'rail';

export interface Decor {
  kind: DecorKind;
  at: V3;
  /** Yaw (radians), or for a support: its length down / inward. */
  rot: number;
  /** A second point (supports, ropes, rails). */
  to?: V3;
}

export interface Course {
  solids: Solid[];
  /** The stack itself (rock bands then the tower), also in `solids`. */
  rock: Solid[];
  checkpoints: Checkpoint[];
  finish: { min: V3; max: V3 };
  /** The lantern room on top (for the renderer). */
  lantern: V3;
  legs: Leg[];
  decor: Decor[];
  start: { spawn: V3; yaw: number };
  /** Below this you're in the sea: back to your checkpoint. */
  sea: number;
  /** Top of the climb (the finish floor), for the height bar. */
  top: number;
  world: World;
}

export const SPIRAL = {
  /** First edge length; every second edge is `shrink` shorter, so each lap is `shrink` inside the last. */
  edge: 84,
  shrink: 4,
  /** Default pad width. */
  w: 3.2,
} as const;

export const ROCK = { margin: 1.6, band: 5, reachAbove: 7, reachBelow: 5 } as const;

const DIRS: [number, number][] = [
  [1, 0],
  [0, -1],
  [-1, 0],
  [0, 1],
];
/** Yaw that looks along direction index d (yaw 0 looks down -Z). */
export const yawOf = (d: number) => Math.atan2(-DIRS[d][0], -DIRS[d][1]);

/** Tags a path solid with the side the rock is on, for carving the stack. */
interface Placed {
  s: Solid;
  d: number;
  /** Shapes the rock (false for the lighthouse climb). */
  carve: boolean;
}

class Builder {
  x: number;
  y: number;
  z: number;
  d = 0;
  edgeNo = 0;
  /** Distance along the current edge from its start line. */
  along = 0;
  placed: Placed[] = [];
  free: Solid[] = [];
  legs: Leg[] = [];
  decor: Decor[] = [];
  checkpoints: Checkpoint[] = [];
  start: { spawn: V3; yaw: number } = { spawn: [0, 0, 0], yaw: 0 };
  /** Theme for the pieces being laid. */
  mat: Mat = 'wood';
  /** Pad width. */
  w: number = SPIRAL.w;
  /** Fixed edge length (the lighthouse ring), else the spiral's. */
  edgeLen: number | null = null;
  /** Laying the lighthouse climb: pieces cling to the tower, they don't shape the rock. */
  tower = false;

  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  get dir() {
    return DIRS[this.d];
  }
  /** Outward (away from the rock) unit vector: right of the direction of travel. */
  get out(): [number, number] {
    const [dx, dz] = this.dir;
    return [-dz, dx];
  }

  edgeLength() {
    if (this.edgeLen !== null) return this.edgeLen;
    return SPIRAL.edge - SPIRAL.shrink * Math.floor(this.edgeNo / 2);
  }

  /** World point `f` metres ahead of the cursor and `s` metres outward, at height y. */
  pt(f: number, s = 0, y = this.y): V3 {
    const [dx, dz] = this.dir;
    const [ox, oz] = this.out;
    return [this.x + dx * f + ox * s, y, this.z + dz * f + oz * s];
  }

  /** A box from f0..f1 ahead, s0..s1 outward, y0..y1. */
  box(f0: number, f1: number, s0: number, s1: number, y0: number, y1: number, mat: Mat = this.mat, free = false): Solid {
    const a = this.pt(f0, s0, y0);
    const b = this.pt(f1, s1, y1);
    const s: Solid = {
      min: [Math.min(a[0], b[0]), y0, Math.min(a[2], b[2])],
      max: [Math.max(a[0], b[0]), y1, Math.max(a[2], b[2])],
      mat,
    };
    if (free) this.free.push(s);
    else this.placed.push({ s, d: this.d, carve: !this.tower });
    return s;
  }

  advance(f: number, rise = 0) {
    const [dx, dz] = this.dir;
    this.x += dx * f;
    this.z += dz * f;
    this.y += rise;
    this.along += f;
  }

  leg(act: Act, atF: number, toF: number, toY = this.y, lane = 0) {
    this.legs.push({ act, at: this.pt(atF, lane), to: this.pt(toF, lane, toY), d: this.d, lane });
  }

  // ---------------------------------------------------------------- pieces

  /** A pad `len` long ahead of the cursor. */
  pad(len: number, o: { w?: number; mat?: Mat; thick?: number; lane?: number } = {}) {
    const w = o.w ?? this.w;
    const lane = o.lane ?? 0;
    const thick = o.thick ?? 0.7;
    const s = this.box(0, len, lane - w / 2, lane + w / 2, this.y - thick, this.y, o.mat);
    this.support(s);
    this.leg('run', 0, len - 0.4);
    this.advance(len);
    return s;
  }

  /** A gap to jump: the next piece starts `dist` ahead and `rise` higher. */
  gap(dist: number, rise = 0) {
    this.leg('jump', -0.1, dist + 1.2, this.y + rise);
    this.advance(dist, rise);
  }

  /** Stepping stones: `n` small pads `size` long with `gap` between them, each `rise` higher. */
  hops(n: number, gap: number, rise: number, size = 1.6, mat: Mat = this.mat) {
    // A flat-out sprint jump carries about 5.5 m: make each stone long enough to land on from one.
    size = Math.max(size, 5.8 - gap);
    for (let i = 0; i < n; i++) {
      this.gap(gap, rise);
      const lane = (i % 2 ? 0.3 : -0.3) * (size < 2 ? 1 : 0);
      this.box(0, size, lane - size / 2, lane + size / 2, this.y - 1.2, this.y, mat);
      this.support(this.placed[this.placed.length - 1].s);
      this.leg('run', 0, size * 0.6);
      this.advance(size);
    }
  }

  /** A wall face `h` high right ahead: climb it (mantle from a jump; over `MOVE.reach` + jump needs the wall kick). */
  ledge(h: number, len = 5) {
    const act: Act = h > 3.2 ? 'climb' : 'mantle';
    this.leg(act, -0.9, 1.4, this.y + h);
    this.advance(0, h);
    this.pad(len, { thick: h + 0.8 });
  }

  /** A stack of ledges to climb one after another (alternating a mantle and a wall climb). */
  climbs(n: number) {
    for (let i = 0; i < n; i++) this.ledge(i % 2 ? 2.7 : 3.5, 3.4);
  }

  /** Small walkable steps (each under MOVE.step). */
  stairs(n: number, rise = 0.32, run = 0.7, mat: Mat = 'stone') {
    for (let i = 0; i < n; i++) {
      this.advance(0, rise);
      this.box(0, run, -this.w / 2, this.w / 2, this.y - rise - 0.4, this.y, mat);
      this.advance(run);
    }
    this.leg('run', -0.6, -0.5);
  }

  /** A gap `len` long with a wall on the rock side to run along. Lands `rise` higher or lower. */
  wallrun(len: number, rise = 0, mat: Mat = this.mat) {
    const lane = -0.55;
    const face = -0.95;
    this.box(-0.5, len + 0.5, face - 0.5, face, this.y - 3.5, this.y + 4.2, mat);
    this.leg('wallrun', -0.1, len + 1.6, this.y + rise, lane);
    this.decor.push({ kind: 'rope', at: this.pt(0, face, this.y + 4.2), rot: 0, to: this.pt(len, face, this.y + 4.2) });
    this.advance(len, rise);
  }

  /** A gap run along the lighthouse wall itself (no wall of its own). */
  towerRun(len: number, rise = 0) {
    this.leg('wallrun', -0.1, len + 1.2, this.y + rise, -0.55);
    this.advance(len, rise);
  }

  /** Two walls, one each side, offset: run the first, jump off to the second. */
  wallChain(len: number) {
    const face = -0.95;
    this.box(-0.5, len * 0.55, face - 0.5, face, this.y - 3.5, this.y + 4.5);
    const of = 2.6;
    this.box(len * 0.45, len + 0.5, of, of + 0.5, this.y - 3, this.y + 5);
    this.leg('wallrun', -0.1, len * 0.45, this.y, -0.55);
    this.leg('wallrun', len * 0.45, len + 1.6, this.y, 0.4);
    this.advance(len);
  }

  /** A low slab across the path: only a slide (or a crouch walk) gets under. */
  slideUnder(depth = 2.2, before = 6, after = 4) {
    this.pad(before);
    const clear = 1.2;
    this.box(0, depth, -this.w / 2 - 0.4, this.w / 2 + 0.4, this.y + clear, this.y + 4.5, this.mat === 'wood' ? 'wood' : 'concrete');
    this.legs.pop();
    this.legs.push({ act: 'slide', at: this.pt(-before + 1.8), to: this.pt(depth + 0.6), d: this.d, lane: 0 });
    this.pad(depth + after);
  }

  /** Downhill ramp `len` long dropping `drop`, then a long gap: slide down it for the speed to clear the gap. */
  rampJump(len: number, drop: number, gapLen: number, rise = 0) {
    const [dx, dz] = this.dir;
    const a = this.pt(0, -this.w / 2, this.y - drop);
    const b = this.pt(len, this.w / 2, this.y);
    const axis: 0 | 2 = dx !== 0 ? 0 : 2;
    // The top is highest where the ramp starts: it rises against the direction of travel.
    const dir = ((dx !== 0 ? dx : dz) > 0 ? -1 : 1) as 1 | -1;
    const s: Solid = { min: [Math.min(a[0], b[0]), this.y - drop - 0.3, Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), this.y, Math.max(a[2], b[2])], mat: this.mat, ramp: { axis, dir } };
    // A ramp's low edge is min.y: keep its surface from (y - drop) to y.
    s.min[1] = this.y - drop;
    this.placed.push({ s, d: this.d, carve: !this.tower });
    this.support(s);
    this.legs.push({ act: 'slide', at: this.pt(0.2), to: this.pt(len - 0.3, 0, this.y - drop), d: this.d, lane: 0 });
    this.advance(len, -drop);
    this.gap(gapLen, rise);
  }

  /** A narrow beam. */
  beam(len: number, w = 0.42) {
    this.pad(len, { w, mat: 'steel', thick: 0.3 });
  }

  /** A checkpoint on the pad just laid (whose far end is the cursor). */
  checkpoint(name: string) {
    const c = this.pt(-1.6, 0);
    const half = this.w / 2 + 0.3;
    this.checkpoints.push({
      name,
      min: [c[0] - half, this.y - 0.5, c[2] - half],
      max: [c[0] + half, this.y + 3, c[2] + half],
      spawn: [c[0], this.y + 0.01, c[2]],
      yaw: yawOf(this.d),
    });
    this.decor.push({ kind: 'brazier', at: this.pt(-1.6, this.w / 2 - 0.45), rot: yawOf(this.d) });
  }

  /** Stretch a pad to the end of this edge, turn the corner, start the next edge. */
  corner(o: { mat?: Mat; runup?: boolean } = {}) {
    const w = this.w;
    const left = this.edgeLength() - this.along;
    if (left < w) throw new Error(`edge ${this.edgeNo} is overfull by ${(w - left).toFixed(1)} m`);
    this.pad(left, o);
    this.decor.push({ kind: 'lamp', at: this.pt(-w / 2, w / 2 - 0.3), rot: yawOf(this.d) });
    this.advance(-w / 2);
    this.d = (this.d + 1) % 4;
    this.edgeNo++;
    this.advance(w / 2);
    this.along = w / 2;
    this.leg('run', -0.9, -0.6);
    // A short run-up out of every corner, so no move starts mid-turn.
    if (o.runup !== false) this.pad(2.6, o);
  }

  /** Visual hint that a pad hangs off the rock (the renderer draws a beam or strut toward the stack). */
  support(s: Solid) {
    if (this.tower) return;
    const [ox, oz] = this.out;
    const cx = (s.min[0] + s.max[0]) / 2;
    const cz = (s.min[2] + s.max[2]) / 2;
    const half = Math.abs(ox) * (s.max[0] - s.min[0]) / 2 + Math.abs(oz) * (s.max[2] - s.min[2]) / 2;
    const inner: V3 = [cx - ox * half, s.min[1], cz - oz * half];
    this.decor.push({ kind: 'support', at: inner, rot: 0, to: [inner[0] - ox * (ROCK.margin + 0.6), s.min[1] - 1.5, inner[2] - oz * (ROCK.margin + 0.6)] });
  }
}

/** Builds Skerry Light. Deterministic: same course every time. */
export function buildCourse(): Course {
  const L = SPIRAL.edge;
  const b = new Builder(-L / 2, 1.2, L / 2);

  // ---------------------------------------------------------------- Lap 1: the tide line (wood, wet rock)
  b.mat = 'wood';
  b.pad(8, { w: 5 });
  b.start = { spawn: b.pt(-5, 0, b.y + 0.01), yaw: yawOf(0) };
  b.mat = 'rock';
  b.hops(4, 1.6, 0, 2.2);
  b.mat = 'wood';
  b.pad(6);
  b.gap(3.2, 0);
  b.pad(5);
  b.slideUnder(2.4, 6, 3);
  b.ledge(1.6, 6);
  b.checkpoint('The Jetty');
  b.gap(3.5, 0.6);
  b.pad(4);
  b.corner();

  b.mat = 'stone';
  b.stairs(8);
  b.pad(4);
  b.hops(3, 2.4, 0.5, 1.8);
  b.pad(4);
  b.ledge(2.4, 5);
  b.gap(4, 0);
  b.pad(5);
  b.checkpoint('Kelp Stair');
  b.corner();

  b.mat = 'wood';
  b.wallrun(9);
  b.pad(5);
  b.gap(3.6, 0.8);
  b.pad(4);
  b.beam(6);
  b.pad(3);
  b.ledge(2.0, 5);
  b.climbs(1);
  b.corner();

  b.mat = 'stone';
  b.hops(3, 2.2, 0.8, 1.8);
  b.pad(5);
  b.checkpoint('Boathouse Roof');
  b.ledge(3.6, 5);
  b.stairs(6);
  b.pad(3);
  b.climbs(2);
  b.corner();

  // ---------------------------------------------------------------- Lap 2: the old keeper's path (stone ruins)
  b.mat = 'stone';
  b.gap(4.2, 0);
  b.pad(4);
  b.wallrun(10, 0.4);
  b.pad(5);
  b.checkpoint('Ruined Wall');
  b.ledge(2.6, 4);
  b.hops(4, 2.4, 0.6, 1.6);
  b.pad(3);
  b.climbs(1);
  b.corner();

  b.slideUnder(2.6, 5, 2);
  b.gap(3.8, 0.5);
  b.pad(4);
  b.stairs(7);
  b.pad(3);
  b.wallrun(9.5, -0.5);
  b.pad(4);
  b.climbs(1);
  b.corner();

  b.mat = 'brick';
  b.ledge(3.0, 4);
  b.beam(7);
  b.pad(4);
  b.checkpoint('Signal Hut');
  b.gap(4.4, -0.5);
  b.pad(3);
  b.hops(3, 2.6, 0.9, 1.6);
  b.pad(3);
  b.climbs(2);
  b.corner();

  b.mat = 'stone';
  b.ledge(3.8, 4);
  b.wallrun(10, 0.5);
  b.pad(4);
  b.stairs(6);
  b.climbs(1);
  b.corner();

  // ---------------------------------------------------------------- Lap 3: the quarry gantry (rusted steel)
  b.mat = 'steel';
  b.pad(4);
  b.checkpoint('Quarry Gantry');
  b.beam(6);
  b.pad(3);
  b.rampJump(9, 2.8, 6.6, 0);
  b.pad(5);
  b.climbs(1);
  b.corner();

  b.mat = 'steel';
  b.hops(4, 2.8, 0.7, 1.4);
  b.pad(4);
  b.wallChain(13);
  b.pad(4);
  b.checkpoint('Crane Jib');
  b.climbs(2);
  b.corner();

  b.mat = 'concrete';
  b.ledge(3.4, 4);
  b.slideUnder(2.8, 4, 2);
  b.gap(4, 0.8);
  b.pad(3);
  b.ledge(2.8, 4);
  b.climbs(1);
  b.corner();

  b.mat = 'steel';
  b.wallrun(10, 0.6);
  b.pad(4);
  b.beam(5, 0.36);
  b.pad(3);
  b.ledge(3.9, 4);
  b.climbs(1);
  b.corner();

  // ---------------------------------------------------------------- Lap 4: the cable pylons (concrete)
  b.mat = 'concrete';
  b.checkpoint('Cable Pylons');
  b.hops(4, 3.0, 0.6, 1.5);
  b.pad(3);
  b.rampJump(8, 2.4, 6.4, 0.4);
  b.pad(3);
  b.climbs(2);
  b.corner();

  b.mat = 'concrete';
  b.wallrun(10.5, 0.4);
  b.pad(3);
  b.ledge(3.4, 3);
  b.wallrun(9.5, 0);
  b.pad(3);
  b.checkpoint('The Saddle');
  b.climbs(1);
  b.corner();

  b.mat = 'steel';
  b.beam(6, 0.36);
  b.pad(3);
  b.hops(3, 3.0, 1.0, 1.4);
  b.pad(3);
  b.slideUnder(2.6, 4, 2);
  b.climbs(1);
  b.corner();

  b.mat = 'concrete';
  b.ledge(3.6, 3);
  b.wallChain(13);
  b.pad(3);
  b.ledge(3.0, 3);
  b.climbs(2);
  b.corner();

  // ---------------------------------------------------------------- Lap 5: the keeper's stair (round the tower)
  b.mat = 'brick';
  b.checkpoint("Keeper's Stair");
  b.stairs(8, 0.34, 0.7, 'brick');
  b.gap(4.2, 0.4);
  b.pad(3);
  b.wallrun(10, 0.6);
  b.pad(3);
  b.climbs(1);
  b.corner();

  b.mat = 'plaster';
  b.ledge(3.4, 3);
  b.hops(3, 3.0, 0.8, 1.4, 'stone');
  b.pad(3);
  b.checkpoint('Bell Gallery');
  b.climbs(1);
  b.corner();

  b.mat = 'plaster';
  b.wallrun(10.5, 0.8);
  b.pad(3);
  b.beam(5, 0.34);
  b.pad(2);
  b.ledge(3.8, 3);
  b.climbs(2);
  b.corner();

  b.mat = 'brick';
  b.rampJump(7, 2.2, 6.2, 0.6);
  b.pad(3);
  b.hops(2, 3.2, 1.1, 1.4, 'stone');
  b.pad(3);
  b.checkpoint('Last Light');
  b.climbs(1);
  b.corner();

  // ---------------------------------------------------------------- The summit: onto the plateau, up the lighthouse
  b.mat = 'stone';
  b.pad(3);
  return finish(b);
}

/** The lighthouse: a square tower on the plateau, climbed round the outside on ledges hugging its walls. */
export const TOWER = { half: 5.5, ledge: 2, room: 2.2 } as const;

function finish(b: Builder): Course {
  const sea = -1.5;
  const plateau = b.y;
  const ring = b.placed.filter((p) => p.carve);
  // Carve the stack: each band is the largest box inside every path piece near its height.
  const bandBox = (y0: number, y1: number): [number, number, number, number] => {
    let x0 = -200;
    let x1 = 200;
    let z0 = -200;
    let z1 = 200;
    for (const { s, d } of ring) {
      if (s.max[1] < y0 - ROCK.reachBelow || s.min[1] > y1 + ROCK.reachAbove) continue;
      const m = ROCK.margin;
      // The rock is on the inward side: d=0 runs east along the south face, so the rock's maxZ is under the piece's minZ…
      if (d === 0) z1 = Math.min(z1, s.min[2] - m);
      else if (d === 1) x1 = Math.min(x1, s.min[0] - m);
      else if (d === 2) z0 = Math.max(z0, s.max[2] + m);
      else x0 = Math.max(x0, s.max[0] + m);
    }
    return [x0, x1, z0, z1];
  };
  // Raw bands first; a side no piece constrains (±FREE) takes the nearest constrained band's value above it,
  // else below, so the foot of the stack is as wide as the first lap, not the whole sea.
  const FREE = 200;
  const raw: { y0: number; y1: number; bb: number[] }[] = [];
  for (let y0 = sea, y1 = sea; y0 < plateau - 0.01; y0 = y1) {
    y1 = plateau - y0 < ROCK.band * 1.5 ? plateau : y0 + ROCK.band;
    raw.push({ y0, y1, bb: bandBox(y0, y1) });
  }
  for (let k = 0; k < 4; k++)
    raw.forEach((r, i) => {
      if (Math.abs(r.bb[k]) < FREE) return;
      const near = [...raw.slice(i + 1), ...raw.slice(0, i).reverse()].find((o) => Math.abs(o.bb[k]) < FREE);
      if (near) r.bb[k] = near.bb[k];
    });
  const rock: Solid[] = [];
  let prev: number[] | null = null;
  for (const { y0, y1, bb: raw0 } of raw) {
    let bb = raw0;
    // Never wider than the band below (plus a little): a stack, not a mushroom.
    if (prev) bb = [Math.max(bb[0], prev[0] - 0.5), Math.min(bb[1], prev[1] + 0.5), Math.max(bb[2], prev[2] - 0.5), Math.min(bb[3], prev[3] + 0.5)];
    if (bb[1] - bb[0] < 12 || bb[3] - bb[2] < 12) throw new Error(`the stack pinches to nothing at ${y0.toFixed(0)} m`);
    rock.push({ min: [bb[0], y0 === sea ? -30 : y0, bb[2]], max: [bb[1], y1, bb[3]], mat: 'rock' });
    prev = bb;
  }
  const top = prev!;
  const cx = (top[0] + top[1]) / 2;
  const cz = (top[2] + top[3]) / 2;

  // A gangway from the last pad across the gap onto the plateau.
  const last = ring[ring.length - 1].s;
  const [dx, dz] = DIRS[b.d];
  const [ox, oz] = [-dz, dx];
  const gang: Solid = {
    min: [ox > 0 ? top[1] - 0.5 : ox < 0 ? last.max[0] : last.min[0], last.min[1], oz > 0 ? top[3] - 0.5 : oz < 0 ? last.max[2] : last.min[2]],
    max: [ox > 0 ? last.min[0] : ox < 0 ? top[0] + 0.5 : last.max[0], last.max[1], oz > 0 ? last.min[2] : oz < 0 ? top[2] + 0.5 : last.max[2]],
    mat: 'wood',
  };
  b.free.push(gang);
  const prevLeg = b.legs[b.legs.length - 1];
  const onPlateau: V3 = [ox !== 0 ? (ox > 0 ? top[1] - 2 : top[0] + 2) : prevLeg.to[0], plateau, oz !== 0 ? (oz > 0 ? top[3] - 2 : top[2] + 2) : prevLeg.to[2]];
  b.legs.push({ act: 'run', at: prevLeg.to, to: onPlateau, d: (b.d + 1) % 4, lane: 0 });

  // The lighthouse ring: start at its corner on this side and go round the same way as the spiral.
  const R = TOWER.half + TOWER.ledge / 2;
  b.tower = true;
  b.w = TOWER.ledge;
  b.edgeLen = 2 * R + b.w / 2; // corners turn w/2 short of the edge length
  b.x = cx + ox * R - dx * R;
  b.z = cz + oz * R - dz * R;
  b.y = plateau;
  b.along = 0;
  b.legs.push({ act: 'run', at: onPlateau, to: b.pt(0.5), d: b.d, lane: 0 });
  b.mat = 'stone';
  b.pad(1.6);
  b.checkpoint('The Lighthouse');
  b.ledge(3.0, 3);
  b.ledge(3.4, 2.4);
  b.corner({ runup: false });
  b.towerRun(5.5, 0.4);
  b.pad(2);
  b.ledge(3.0, 1.5);
  b.corner({ runup: false });
  b.pad(1.5);
  b.ledge(3.4, 2.5);
  b.hops(1, 2.4, 0.8, 2);
  b.corner({ runup: false });
  b.pad(1.5);
  b.ledge(3.0, 2.5);
  b.ledge(3.4, 2.5);
  b.pad(1.5);

  // The gallery: the tower's top, a mantle up off the last ledge.
  const gallery = b.y + 2.6;
  const inward = (b.d + 1) % 4;
  b.legs.push({ act: 'run', at: b.pt(-2), to: b.pt(-1), d: b.d, lane: 0 });
  b.legs.push({ act: 'mantle', at: b.pt(-1), to: b.pt(-1, -2.6, gallery), d: inward, lane: 0 });
  const tower: Solid = { min: [cx - TOWER.half, plateau - 1, cz - TOWER.half], max: [cx + TOWER.half, gallery, cz + TOWER.half], mat: 'plaster' };
  rock.push(tower);
  const room: Solid = { min: [cx - TOWER.room, gallery, cz - TOWER.room], max: [cx + TOWER.room, gallery + 3.4, cz + TOWER.room], mat: 'steel' };
  const solids: Solid[] = [...b.placed.map((p) => p.s), ...b.free, ...rock, room];

  return {
    solids,
    rock,
    checkpoints: b.checkpoints,
    finish: { min: [tower.min[0], gallery - 0.2, tower.min[2]], max: [tower.max[0], gallery + 3.5, tower.max[2]] },
    lantern: [cx, gallery, cz],
    legs: b.legs,
    decor: b.decor,
    start: b.start,
    sea,
    top: gallery,
    world: new World(solids),
  };
}

// ---------------------------------------------------------------------------------------------
// Progress

export const inBox = (p: { x: number; y: number; z: number }, b: { min: V3; max: V3 }) =>
  p.x >= b.min[0] && p.x <= b.max[0] && p.y >= b.min[1] && p.y <= b.max[1] && p.z >= b.min[2] && p.z <= b.max[2];

/**
 * Where the climber has got to: the checkpoint index reached (−1 = the start), whether they've finished, and
 * whether they fell in the sea (respawn). Checkpoints only count forward, and only the next one or later.
 */
export function progress(c: Course, p: { x: number; y: number; z: number }, cp: number): { cp: number; finished: boolean; drowned: boolean } {
  let n = cp;
  for (let i = cp + 1; i < c.checkpoints.length; i++) if (inBox(p, c.checkpoints[i])) n = i;
  return { cp: n, finished: inBox(p, c.finish), drowned: p.y < c.sea };
}

/** Where you respawn for checkpoint index `cp` (−1: the start). */
export function spawnFor(c: Course, cp: number): { spawn: V3; yaw: number } {
  return cp >= 0 ? c.checkpoints[cp] : c.start;
}

/** Height climbed as a share of the course (0 at the start, 1 on the gallery), for the height bar. */
export const heightShare = (c: Course, y: number) => Math.max(0, Math.min(1, (y - c.start.spawn[1]) / (c.top - c.start.spawn[1])));

export { MOVE };
