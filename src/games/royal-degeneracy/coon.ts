// The raccoon, as a herding game: it wanders the floor-2 rooms until someone comes near, then bolts for the way out
// it knows best (the covered balcony, the front balcony, or the front or back door downstairs) along a little graph
// of doorways and stair landings. Get between it and that exit and it doubles back the other way, so shooing it out
// means coming at it from the right side. It's gone once it's outside. Pure: the referee runs it.

import { rayWorld, type Box } from '../../shared/collision.ts';
import type { Vec3 } from '../../shared/math.ts';
import { DOORS, FLOOR_Y, ROOMS, SOLIDS, roomAt } from './house.ts';
import { newWalker, stepWalker, type Walker } from './move.ts';

/** Raccoon tuning. */
export const COON = {
  /** Someone this close (same floor) spooks it. */
  spook: 3.2,
  /** Walking pace (wandering) and running pace (spooked), as a fraction of a person's walk. */
  amble: 0.55,
  bolt: 0.85,
  /** How long a shout (E) keeps it running. */
  shout: 3,
};

interface Node {
  pos: Vec3;
  /** The rooms it joins (a doorway joins two; a stair landing one, plus its stair neighbours). */
  rooms: string[];
  /** Outside: reaching it means the raccoon's out. */
  exit: boolean;
  /** Its neighbours on the way down the stairs (doorways link through shared rooms). */
  links: number[];
  /** The doorway it stands in, if it's one: the raccoon is as wide as a person, so it lines up square first. */
  axis?: 'x' | 'z';
  /** A doorway's rooms on its low side and its high side. */
  sides?: [string, string];
}

const nodes: Node[] = [];
// Every doorway (both sides' rooms), apart from the eaves hatches and the floor-3 rooms it never goes near.
for (const d of DOORS) {
  if (d.hatch || d.floor === 2) continue;
  const y = FLOOR_Y[d.floor] + 0.1;
  const side = (s: number) => roomAt(d.axis === 'x' ? { x: d.x, y, z: d.z + s } : { x: d.x + s, y, z: d.z });
  const sides = [side(-0.7), side(0.7)];
  const rooms = sides.filter((r) => r !== null);
  nodes.push({
    pos: { x: d.x, y: FLOOR_Y[d.floor], z: d.z },
    rooms: rooms.map((r) => r.id),
    exit: rooms.some((r) => r.outside),
    links: [],
    axis: d.axis,
    sides: [sides[0]?.id ?? '', sides[1]?.id ?? ''],
  });
}
// The stairs down, as a chain: the top of the long flight (on the landing), its corner landing, the hall.
const chain = [
  { pos: { x: 2.8, y: FLOOR_Y[1], z: 10.15 }, rooms: ['landing'] },
  { pos: { x: 0.62, y: 2.1, z: 10.15 }, rooms: ['stairs1'] },
  { pos: { x: 0.62, y: 0.7, z: 13.15 }, rooms: ['stairs1'] },
  { pos: { x: 2.6, y: 0, z: 13.15 }, rooms: ['hall'] },
];
const first = nodes.length;
chain.forEach((c, i) => nodes.push({ ...c, exit: false, links: [i > 0 ? first + i - 1 : -1, i < chain.length - 1 ? first + i + 1 : -1].filter((k) => k >= 0) }));
// Corners it has to go round: the mouth of the passage in front of the stairs (to Will's door).
nodes.push({ pos: { x: 4.85, y: FLOOR_Y[1], z: 11.7 }, rooms: ['landing'], exit: false, links: [] });

/** Raccoons don't do stairs up: an invisible fence (for it alone) across the foot of the flight to the top floor. */
const COON_FENCES: Box[] = [{ min: { x: 3.2, y: FLOOR_Y[1], z: 10.75 }, max: { x: 3.3, y: FLOOR_Y[1] + 1.2, z: 11.75 }, kind: 'wall' }];

/** Is the way from a to b clear (low furniture counts)? `wide`: clear for something as wide as a person. */
function clear(a: Vec3, b: Vec3, wide = false): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) return true;
  const d = { x: dx / len, y: 0, z: dz / len };
  return (wide ? [-0.35, 0, 0.35] : [0]).every((o) => rayWorld({ x: a.x - d.z * o, y: Math.max(a.y, b.y) + 0.3, z: a.z + d.x * o }, d, SOLIDS, len) >= len - 0.05);
}

// Neighbours: anything sharing a room, in a straight line.
nodes.forEach((a, i) => {
  nodes.forEach((b, j) => {
    if (i !== j && a.rooms.some((r) => b.rooms.includes(r)) && !a.links.includes(j) && (Math.abs(a.pos.y - b.pos.y) > 0.5 || clear(a.pos, b.pos))) a.links.push(j);
  });
});

/** Each node's cost (metres) to the nearest exit, and the next node on the way (Dijkstra from the exits). */
const cost = nodes.map((n) => (n.exit ? 0 : Infinity));
const next = nodes.map(() => -1);
{
  const done = new Set<number>();
  for (;;) {
    let i = -1;
    for (let k = 0; k < nodes.length; k++) if (!done.has(k) && cost[k] < Infinity && (i < 0 || cost[k] < cost[i])) i = k;
    if (i < 0) break;
    done.add(i);
    for (const j of nodes[i].links) {
      const c = cost[i] + Math.hypot(nodes[i].pos.x - nodes[j].pos.x, (nodes[i].pos.y - nodes[j].pos.y) * 2, nodes[i].pos.z - nodes[j].pos.z);
      if (c < cost[j]) {
        cost[j] = c;
        next[j] = i;
      }
    }
  }
}

/** For each doorway, the room on its way-out side (once the raccoon's in it, that doorway is behind it). */
const forward = nodes.map((n, i) => {
  if (!n.sides) return '';
  if (n.exit) return n.sides.find((id) => ROOMS.some((r) => r.id === id && r.outside)) ?? '';
  const j = next[i];
  return j >= 0 ? (n.sides.find((id) => id && nodes[j].rooms.includes(id)) ?? '') : '';
});

/** The best waypoint to start from here: cheapest way out among the ones it can run straight at (or at least see). */
function pickNode(p: Vec3, room: string): number {
  const pick = (wide: boolean) => {
    let best = -1;
    let bestCost = Infinity;
    nodes.forEach((n, i) => {
      const d = Math.hypot(n.pos.x - p.x, (n.pos.y - p.y) * 2, n.pos.z - p.z);
      if ((!n.rooms.includes(room) && d > 0.8) || (forward[i] === room && d > 0.6)) return;
      if (d + cost[i] >= bestCost || (Math.abs(n.pos.y - p.y) < 0.5 && d > 0.6 && !clear(p, n.pos, wide))) return;
      bestCost = d + cost[i];
      best = i;
    });
    return best;
  };
  const best = pick(true);
  return best >= 0 ? best : pick(false);
}

/**
 * The way out from here: the point to run for next (null once outside, or somewhere off the graph). With a route
 * (`c`), it sticks to the waypoint it chose and moves on as it passes each one; without, it picks afresh.
 */
export function escapeTarget(p: Vec3, c: { wp: number } = { wp: -1 }): Vec3 | null {
  const r = roomAt({ ...p, y: p.y + 0.1 });
  if (!r || r.outside) return null;
  if (c.wp < 0) c.wp = pickNode(p, r.id);
  const i = c.wp;
  if (i < 0) return null;
  const n = nodes[i];
  const after = () => {
    if (n.exit) return exitBeyond(n);
    c.wp = next[i];
    return c.wp >= 0 ? nodes[c.wp].pos : null;
  };
  if (n.axis) {
    // A doorway: get square in front of it, then straight through (to its way-out side), then on.
    const lat = n.axis === 'x' ? p.x - n.pos.x : p.z - n.pos.z;
    const nor = n.axis === 'x' ? p.z - n.pos.z : p.x - n.pos.x;
    const far = n.sides![1] === forward[i] ? 1 : -1;
    const at = (through: number): Vec3 => (n.axis === 'x' ? { x: n.pos.x, y: n.pos.y, z: n.pos.z + through } : { x: n.pos.x + through, y: n.pos.y, z: n.pos.z });
    if (nor * far > 0.45) return after();
    if (Math.abs(lat) > 0.07 && nor * far < -0.4) return at(-far * 0.8);
    return at(far * 0.8);
  }
  if (Math.hypot(n.pos.x - p.x, n.pos.z - p.z) < 0.45 && Math.abs(n.pos.y - p.y) < 0.6) return after();
  return n.pos;
}

/** A point a couple of metres past an exit door, on its outside. */
function exitBeyond(n: Node): Vec3 {
  const d = DOORS.find((x) => Math.hypot(x.x - n.pos.x, x.z - n.pos.z) < 0.01)!;
  const y = n.pos.y + 0.1;
  const away = (s: number) => (d.axis === 'x' ? { x: d.x, y, z: d.z + s } : { x: d.x + s, y, z: d.z });
  const s = roomAt(away(1.5))?.outside ? 2 : -2;
  return { ...away(s), y: n.pos.y };
}

export interface Coon {
  w: Walker;
  /** Where it's wandering to when nobody's about. */
  goal: { x: number; z: number };
  /** Spooked until (roam seconds), and by whom (for the credit). */
  scaredUntil: number;
  by: number;
  stuck: number;
  /** Seconds left of a sideways dodge (when it's cornered). */
  dodge: number;
  dodgeSide: 1 | -1;
  /** The waypoint it's running for (-1: none chosen). */
  wp: number;
}

export const newCoon = (at: Vec3, goal: { x: number; z: number }): Coon => ({ w: newWalker(at), goal, scaredUntil: -1, by: -1, stuck: 0, dodge: 0, dodgeSide: 1, wp: -1 });

/** True when the raccoon's out of the house (onto a balcony, a porch or a yard). */
export const coonOut = (c: Coon) => !!roomAt({ ...c.w.pos, y: c.w.pos.y + 0.1 })?.outside;

/**
 * One tick. `people` are the living players' positions with their ids; returns true if the raccoon wants a new
 * wandering goal (it got there, or it's stuck).
 */
export function stepCoon(c: Coon, people: { id: number; pos: Vec3 }[], roam: number, dt: number, walls: readonly Box[]): boolean {
  const p = c.w.pos;
  let near: { id: number; pos: Vec3; d: number } | null = null;
  for (const q of people) {
    if (Math.abs(q.pos.y - p.y) > 1.4) continue;
    const d = Math.hypot(q.pos.x - p.x, q.pos.z - p.z);
    if (d < COON.spook && (!near || d < near.d)) near = { ...q, d };
  }
  if (near) {
    c.scaredUntil = Math.max(c.scaredUntil, roam + 1);
    c.by = near.id;
  }
  const scared = roam < c.scaredUntil;
  let dir: { x: number; z: number };
  let pace = COON.amble;
  let wander = false;
  if (scared) {
    pace = COON.bolt;
    const exit = escapeTarget(p, c);
    const to = exit ? { x: exit.x - p.x, z: exit.z - p.z } : { x: 0, z: 0 };
    const tl = Math.hypot(to.x, to.z) || 1;
    dir = { x: to.x / tl, z: to.z / tl };
    if (near) {
      const ax = (p.x - near.pos.x) / (near.d || 1);
      const az = (p.z - near.pos.z) / (near.d || 1);
      // Someone's in the way of its exit: run from them instead (deeper in), or dart sideways past them when cornered.
      if (!exit || dir.x * ax + dir.z * az < -0.25) dir = { x: ax, z: az };
    }
    if (c.dodge > 0) {
      c.dodge -= dt;
      dir = { x: -dir.z * c.dodgeSide, z: dir.x * c.dodgeSide };
    }
  } else {
    c.wp = -1;
    const dx = c.goal.x - p.x;
    const dz = c.goal.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    dir = { x: dx / l, z: dz / l };
    wander = l < 0.5;
  }
  c.w.yaw = Math.atan2(-dir.x, -dir.z);
  const before = { ...p };
  stepWalker(c.w, { fwd: pace, side: 0, jump: false, crouch: false, up: false }, dt, [...walls, ...COON_FENCES]);
  const moved = Math.hypot(c.w.pos.x - before.x, c.w.pos.z - before.z);
  c.stuck = moved < dt * 0.4 ? c.stuck + dt : 0;
  if (c.stuck > 0.5 && scared && c.dodge <= 0) {
    c.dodge = 0.6;
    c.dodgeSide = c.dodgeSide === 1 ? -1 : 1;
    c.stuck = 0;
    c.wp = -1;
  }
  if (!scared && c.stuck > 1) {
    c.stuck = 0;
    return true;
  }
  return wander;
}
