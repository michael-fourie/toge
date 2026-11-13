// BOYS DAY's rules, pure (no three.js, no DOM): the bus, walking (on it and off it), the run and its checkpoints' jobs,
// upgrades, the zombies' numbers, the minigames' maths.
// Units are metres and seconds, Y up, yaw 0 faces -Z.

import { FITS } from './roster.ts';

/** Seeded random in [0, 1) (mulberry32): the same seed builds the same run on every screen. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MAX_PLAYERS = 8;

/** Seeds are whole numbers in [0, SEED_MAX). The host rolls one per run; readMsg checks against the same range. */
export const SEED_MAX = 2 ** 31;
export const newSeed = () => Math.floor(Math.random() * SEED_MAX);

// ---------------------------------------------------------------------------------------------
// The bus

export const BUS = {
  length: 11,
  width: 2.7,
  /** Inside: the floor's height, the windows' band (bottom and top), the roof (whose deck you can climb up to). */
  floor: 0.9,
  sill: 1.75,
  lintel: 2.6,
  top: 2.9,
  /** The roof deck you stand on up top. */
  deck: 3.04,
  /** Eye height above what you stand on, and sitting at the wheel. */
  eye: 1.5,
  driverEye: 1.05,
  /** Wheelbase for the steering (m). */
  wheelbase: 6.2,
  maxSpeed: 24,
  reverseSpeed: 7,
  accel: 6.5,
  brake: 16,
  /** Rolling drag (m/s² per m/s): coasting slows the bus, it never stops dead. */
  drag: 0.12,
  handbrake: 22,
  steerMax: 0.62,
  /** At top speed the wheels only turn this fraction of steerMax (a bus at 90 km/h doesn't hairpin). */
  steerAtSpeed: 0.38,
  steerRate: 2.6,
  /** Off the road the grass holds the bus to this fraction of top speed, and drags harder. */
  grass: 0.55,
  grassDrag: 0.45,
  hp: 1000,
  /** Circles down the bus's length that collide with trees and wrecks (offsets from the centre, m). */
  hull: [-3.8, 0, 3.8],
  hullR: 1.5,
  /** Hills: gravity along the slope (m/s² per unit of grade, a bus is heavy and its engine weak). */
  grade: 8.5,
  /** Downhill the bus can run on to this much of its top speed. */
  runaway: 1.2,
  /** Mud: extra drag, and how much grip the steering keeps. */
  mudDrag: 0.9,
  mudGrip: 0.45,
  /** Out of fuel, the bus only splutters along at this (m/s). */
  fumes: 3,
} as const;

/** Where the bus is driving: the hills and the surface under it. */
export interface Ground {
  /** Rise over run along the bus's heading (positive: uphill). */
  grade: number;
  onRoad: boolean;
  mud: boolean;
  /** No fuel left. */
  fumes: boolean;
  /** The engine's pull (1: stock; the engine upgrade raises it). */
  power?: number;
  /** The horde hanging off one side dragging the wheel that way (-1 to 1: see `pullOf`). */
  pull?: number;
}

export const FLAT: Ground = { grade: 0, onRoad: true, mud: false, fumes: false };

export interface Bus {
  x: number;
  z: number;
  /** Heading (yaw): 0 faces -Z. */
  h: number;
  /** Speed along the heading (m/s, negative in reverse). */
  v: number;
  steer: number;
}

export interface Drive {
  /** 0-1 */
  throttle: number;
  /** 0-1: brakes, then reverses once stopped. */
  brake: number;
  /** -1 (left) to 1 (right). */
  steer: number;
  handbrake: boolean;
}

export const NO_DRIVE: Drive = { throttle: 0, brake: 0, steer: 0, handbrake: false };

export const fwdOf = (h: number) => ({ x: -Math.sin(h), z: -Math.cos(h) });
/** The bus's right-hand side. */
export const rightOf = (h: number) => ({ x: Math.cos(h), z: -Math.sin(h) });

/** One step of the bus: a bicycle model with arcade grip, slowed by grass, mud and hills (and an empty tank). */
export function stepBus(b: Bus, d: Drive, dt: number, g: Ground = FLAT): void {
  const onRoad = g.onRoad;
  const speedK = Math.min(1, Math.abs(b.v) / BUS.maxSpeed);
  const maxSteer = BUS.steerMax * (1 - (1 - BUS.steerAtSpeed) * speedK);
  // Zombies hanging off one side haul the wheel that way: you can still steer out of it, from further over.
  const want = Math.max(-1, Math.min(1, d.steer + (g.pull ?? 0))) * maxSteer * (g.mud ? BUS.mudGrip : 1);
  const ds = want - b.steer;
  b.steer += Math.sign(ds) * Math.min(Math.abs(ds), BUS.steerRate * dt);

  const power = g.power ?? 1;
  let top = (onRoad ? BUS.maxSpeed : BUS.maxSpeed * BUS.grass) * power;
  if (g.fumes) top = Math.min(top, BUS.fumes);
  let a = 0;
  if (d.throttle > 0) a += d.throttle * BUS.accel * power * (b.v < 0 ? 2.5 : 1);
  // Going forward the brake pedal brakes; stopped (or rolling back) it reverses.
  const braking = d.brake > 0 && b.v > 0;
  if (braking) a -= d.brake * BUS.brake;
  else if (d.brake > 0) a -= d.brake * BUS.accel * 0.8;
  if (d.handbrake) a -= Math.sign(b.v) * BUS.handbrake;
  a -= b.v * ((onRoad ? BUS.drag : BUS.grassDrag) + (g.mud ? BUS.mudDrag : 0));
  // Uphill pulls the bus back, downhill runs it on: a steep climb from slow can stall it, or roll it backwards.
  a -= BUS.grade * g.grade;
  const before = b.v;
  b.v += a * dt;
  // Brakes and the handbrake stop the bus where they'd push it past zero; reversing waits for the next tick.
  if ((braking || d.handbrake) && before !== 0 && Math.sign(b.v) !== Math.sign(before)) b.v = 0;
  // Downhill it can run on a little past top speed, never away.
  const cap = g.grade < 0 ? top * BUS.runaway : top;
  if (b.v > cap) b.v = Math.max(cap, b.v - BUS.brake * dt);
  b.v = Math.max(-BUS.reverseSpeed, b.v);

  // Steering: right steer turns right, i.e. the heading (yaw) goes down.
  b.h -= (b.v / BUS.wheelbase) * Math.tan(b.steer) * dt;
  const f = fwdOf(b.h);
  b.x += f.x * b.v * dt;
  b.z += f.z * b.v * dt;
}

/** A round thing the bus bumps into (trees, wrecks, lamp posts). */
export interface Obstacle {
  x: number;
  z: number;
  r: number;
}

/** Pushes the bus out of every obstacle it overlaps and scrubs speed. Returns the hardest hit (m/s lost). */
export function collideBus(b: Bus, obstacles: readonly Obstacle[]): number {
  let worst = 0;
  const f = fwdOf(b.h);
  for (const off of BUS.hull) {
    const cx = b.x + f.x * off;
    const cz = b.z + f.z * off;
    for (const o of obstacles) {
      const dx = cx - o.x;
      const dz = cz - o.z;
      const min = BUS.hullR + o.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.001;
      const push = min - d;
      b.x += (dx / d) * push;
      b.z += (dz / d) * push;
      // Only the part of the speed going into the obstacle is lost.
      const into = -(f.x * (dx / d) + f.z * (dz / d)) * Math.sign(b.v);
      if (into > 0) {
        const lost = Math.abs(b.v) * into * 0.8;
        b.v -= Math.sign(b.v) * lost;
        worst = Math.max(worst, lost);
      }
    }
  }
  return worst;
}

/** Bus-local coordinates of a world point: `side` right of centre, `along` ahead of centre. */
export function toBus(b: Pick<Bus, 'x' | 'z' | 'h'>, x: number, z: number) {
  const f = fwdOf(b.h);
  const r = rightOf(b.h);
  const dx = x - b.x;
  const dz = z - b.z;
  return { side: dx * r.x + dz * r.z, along: dx * f.x + dz * f.z };
}

/** Where a bus-local point is in the world. */
export function fromBus(b: Pick<Bus, 'x' | 'z' | 'h'>, side: number, along: number) {
  const f = fwdOf(b.h);
  const r = rightOf(b.h);
  return { x: b.x + r.x * side + f.x * along, z: b.z + r.z * side + f.z * along };
}

/** Is a world point inside the bus's footprint (plus `pad` metres)? */
export function onBus(b: Pick<Bus, 'x' | 'z' | 'h'>, x: number, z: number, pad = 0) {
  const p = toBus(b, x, z);
  return Math.abs(p.side) < BUS.width / 2 + pad && Math.abs(p.along) < BUS.length / 2 + pad;
}

// ---------------------------------------------------------------------------------------------
// On the bus: walking about inside and on the roof

/** The driver's seat (bus-local), and how far the driver can look round the cab from straight ahead (rad). */
export const DRIVER = { side: -0.65, along: 4.25, look: 1.7 } as const;

/** Where you are on the bus: bus-local, and inside (0) or up on the roof (1). */
export interface Spot {
  side: number;
  along: number;
  level: 0 | 1;
}

export const WALK = {
  speed: 3.4,
  /** The hatch in the roof (with a ladder under it): climb up or down here. */
  hatch: { side: 0, along: -3.4, r: 0.8 },
  /** Close enough to the driver's seat to take the wheel. */
  cab: 1.5,
} as const;

/** How far you can walk: inside (clear of the walls, behind the driver's seat) and on the roof (inside the rail). */
export function walkBounds(level: 0 | 1) {
  return level === 0
    ? { side: BUS.width / 2 - 0.35, back: -BUS.length / 2 + 0.4, front: DRIVER.along - 0.5 }
    : { side: BUS.width / 2 - 0.3, back: -BUS.length / 2 + 0.35, front: BUS.length / 2 - 0.35 };
}

/**
 * Walks you about the bus: `fwd` and `side` input (−1..1), looking `yaw` (relative to the bus: 0 is toward the front,
 * positive turns left). Clamped to where you can stand.
 */
export function walk(p: Spot, fwd: number, strafe: number, yaw: number, dt: number) {
  const l = Math.hypot(fwd, strafe);
  if (l > 0) {
    const k = (WALK.speed * dt) / Math.max(1, l);
    p.side += (-Math.sin(yaw) * fwd + Math.cos(yaw) * strafe) * k;
    p.along += (Math.cos(yaw) * fwd + Math.sin(yaw) * strafe) * k;
  }
  const b = walkBounds(p.level);
  p.side = Math.max(-b.side, Math.min(b.side, p.side));
  p.along = Math.max(b.back, Math.min(b.front, p.along));
}

export const atHatch = (p: Spot) => Math.hypot(p.side - WALK.hatch.side, p.along - WALK.hatch.along) < WALK.hatch.r;
export const atCab = (p: Spot) => p.level === 0 && Math.hypot(p.side - DRIVER.side, p.along - DRIVER.along) < WALK.cab;
/** Where you stand when you get up from the wheel. */
export const OFF_CAB: Spot = { side: 0.2, along: DRIVER.along - 0.9, level: 0 };

/** Where each player starts: down the aisle, in join order. */
export const startSpot = (i: number): Spot => ({ side: i % 2 ? 0.55 : -0.55, along: 2.4 - Math.floor(i / 2) * 1.6, level: 0 });

/**
 * A paintball leaving the bus from inside: does the step from `a` to `b` (bus-local, x across, y up, z toward the
 * back: three.js's frame on the bus model) go through a wall? It only gets out through a window (or the windscreen).
 * Returns where it hit the wall, or null.
 */
export function wallHit(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  const W = BUS.width / 2;
  const L = BUS.length / 2;
  const inside = (p: { x: number; y: number; z: number }) => Math.abs(p.x) < W && Math.abs(p.z) < L && p.y > BUS.floor && p.y < BUS.top;
  if (!inside(a) || inside(b)) return null;
  // The first face the step crosses on its way out.
  let t = Infinity;
  let face = '';
  const tryFace = (from: number, to: number, at: number, name: string) => {
    if ((from - at) * (to - at) >= 0) return;
    const k = (at - from) / (to - from);
    if (k < t) {
      t = k;
      face = name;
    }
  };
  tryFace(a.x, b.x, W, 'side');
  tryFace(a.x, b.x, -W, 'side');
  tryFace(a.z, b.z, L, 'back');
  tryFace(a.z, b.z, -L, 'front');
  tryFace(a.y, b.y, BUS.top, 'roof');
  tryFace(a.y, b.y, BUS.floor, 'floor');
  if (!face) return null;
  const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  const band = p.y > BUS.sill && p.y < BUS.lintel;
  const open = face === 'side' ? band : face === 'back' ? band && Math.abs(p.x) < W - 0.4 : face === 'front' ? p.y > 1.5 && p.y < BUS.lintel : false;
  return open ? null : p;
}

// ---------------------------------------------------------------------------------------------
// On foot: off the bus at a checkpoint

export const FOOT = {
  speed: 6,
  /** Lugging a jerry can, you walk at this share of your speed (and can't shoot). */
  carry: 0.65,
  r: 0.4,
  eye: 1.6,
  hp: 100,
  /** Health back per second while you're on the bus. */
  regen: 6,
  /** How close you have to be to use something, and to the bus's side to climb aboard (m). */
  reach: 2.8,
  board: 2.8,
  /** How far from the parking spot you can wander. */
  leash: 62,
  /** Bitten down to nothing: the boys drag you back aboard and you sit out this long (s), then wake on this much. */
  ko: 6,
  wake: 50,
  /** Left behind this far from the bus, you sprint back aboard (m). */
  left: 95,
  /** A jump: how fast you leave the ground (m/s) and what pulls you back down. */
  jump: 5.4,
  gravity: 18,
} as const;

/** One tick of a jump: how high you are above the ground and how fast, and whether you've just landed. */
export function stepJump(y: number, vy: number, dt: number): { y: number; vy: number; landed: boolean } {
  if (y <= 0 && vy <= 0) return { y: 0, vy: 0, landed: false };
  const nvy = vy - FOOT.gravity * dt;
  const ny = y + nvy * dt;
  return ny <= 0 ? { y: 0, vy: 0, landed: true } : { y: ny, vy: nvy, landed: false };
}

/**
 * Walks you over the ground: `fwd` and `strafe` input (−1..1), looking `yaw` (world: 0 faces −Z). Pushed out of
 * obstacles and of the bus, and kept within `leash` of `centre`.
 */
export function stepFoot(p: { x: number; z: number }, fwd: number, strafe: number, yaw: number, dt: number, obstacles: readonly Obstacle[], bus: Pick<Bus, 'x' | 'z' | 'h'>, centre: { x: number; z: number }, slow = 1) {
  const l = Math.hypot(fwd, strafe);
  if (l > 0) {
    const k = (FOOT.speed * slow * dt) / Math.max(1, l);
    const f = fwdOf(yaw);
    const r = rightOf(yaw);
    p.x += (f.x * fwd + r.x * strafe) * k;
    p.z += (f.z * fwd + r.z * strafe) * k;
  }
  for (const o of obstacles) {
    const dx = p.x - o.x;
    const dz = p.z - o.z;
    const min = o.r + FOOT.r;
    if (Math.abs(dx) >= min || Math.abs(dz) >= min) continue;
    const d = Math.hypot(dx, dz);
    if (d >= min) continue;
    const k = d > 1e-6 ? min / d : 0;
    p.x = o.x + (d > 1e-6 ? dx * k : min);
    p.z = o.z + dz * k;
  }
  // The bus is a solid box: out through its nearest side.
  const q = toBus(bus, p.x, p.z);
  const W = BUS.width / 2 + FOOT.r;
  const L = BUS.length / 2 + FOOT.r;
  if (Math.abs(q.side) < W && Math.abs(q.along) < L) {
    if (W - Math.abs(q.side) < L - Math.abs(q.along)) q.side = Math.sign(q.side || 1) * W;
    else q.along = Math.sign(q.along || 1) * L;
    const w = fromBus(bus, q.side, q.along);
    p.x = w.x;
    p.z = w.z;
  }
  const dx = p.x - centre.x;
  const dz = p.z - centre.z;
  const d = Math.hypot(dx, dz);
  if (d > FOOT.leash) {
    p.x = centre.x + (dx / d) * FOOT.leash;
    p.z = centre.z + (dz / d) * FOOT.leash;
  }
}

/** Where you land when you hop off the bus from `spot`: just outside the nearer side. */
export function hopOff(bus: Pick<Bus, 'x' | 'z' | 'h'>, spot: Spot) {
  const side = (spot.side >= 0 ? 1 : -1) * (BUS.width / 2 + FOOT.r + 0.5);
  return fromBus(bus, side, Math.max(-BUS.length / 2 + 1, Math.min(BUS.length / 2 - 1, spot.along)));
}

/** Where you stand inside once you climb back aboard from (x, z). */
export function hopOn(bus: Pick<Bus, 'x' | 'z' | 'h'>, x: number, z: number): Spot {
  const q = toBus(bus, x, z);
  const b = walkBounds(0);
  return { side: Math.max(-b.side, Math.min(b.side, q.side * 0.3)), along: Math.max(b.back, Math.min(b.front, q.along)), level: 0 };
}

/** Close enough to the bus's side to climb aboard? */
export const canBoard = (bus: Pick<Bus, 'x' | 'z' | 'h'>, x: number, z: number) => onBus(bus, x, z, FOOT.board);

// ---------------------------------------------------------------------------------------------
// The run: an endless road of checkpoints. Each has a job to do on foot; the bus dies when its health runs out.

/** What a checkpoint asks of you (see checkpoints.ts for where and with what twist). */
/**
 * What a checkpoint wants of you. The minigames aren't jobs any more: golf, the slots and the rod are what you do
 * at a pit stop, for scrap, when you feel like it.
 */
export type Job = 'scavenge' | 'fuel' | 'beacon' | 'holdout' | 'boss' | 'rest';

export const JOBS: Record<Job, { need: (crew: number, stage: number) => number; goal: string }> = {
  /** Supply crates lying about: walk up and grab them. */
  scavenge: { need: (c, s) => 3 + c + Math.min(4, Math.floor(s / 3)), goal: 'Get off the bus and scavenge supply crates' },
  /** Jerry cans from the pump, lugged back to the bus one at a time. */
  fuel: { need: (c, s) => 2 + c + Math.min(3, Math.floor(s / 4)), goal: 'Lug jerry cans from the pump to the bus' },
  /** Seconds with somebody standing in the beacon's ring. */
  beacon: { need: (_, s) => 30 + Math.min(40, s * 3), goal: 'Stand in the ring to crank the beacon' },
  /** Zombies to put down while parked. */
  holdout: { need: (c, s) => Math.round((10 + s * 2) * HORDE.crewScale(c)), goal: 'Hold them off' },
  /** One big one to put down, while it tries to make off with the keg. */
  boss: { need: () => 1, goal: 'Defend the keg: put the big one down' },
  /** A pit stop: nothing to do but enjoy it. */
  rest: { need: () => 0, goal: 'Pit stop: fish, hit a bucket of balls, hang out' },
};

/** The big one at a boss stop, and the keg it's after. */
export const BOSS = {
  /** It grows with the run and the crew. */
  hp: (stage: number, crew: number) => Math.round((260 + stage * 45) * (0.6 + 0.2 * Math.max(1, Math.min(8, crew)))),
  speed: 3.4,
  r: 1.6,
  /** Keg health a second while it's smashing, and how close it has to be. */
  smash: 26,
  reach: 3.2,
  /** What putting it down pays everyone. */
  pay: 120,
  /** How hard it swats someone on foot who gets in the way. */
  bite: 34,
};

export const KEG = { hp: 300, r: 1.1 };

/** Off the dock: how long the fish takes to bite, how long you have to set the hook, and the fight. */
export const FISH = {
  /** Seconds before a bite, and how long the window to strike is. */
  waitMin: 1.2,
  waitVar: 3.5,
  window: 0.9,
  /** How far out it starts, and how fast reeling brings it in. */
  far: 1,
  reel: 0.3,
  /** The fish pulls back: tension climbs while you reel and falls when you don't; over 1 the line snaps. */
  tension: 0.85,
  ease: 0.75,
  /** How hard it fights, by size, and how the fight wanders. */
  fight: 0.55,
  /** What the biggest one is worth on top of the flat pay. */
  prize: 40,
};

/** How hard a fish of this size pulls at moment `t` (0…1, a wandering surge). */
export const fishPull = (t: number, size: number) => FISH.fight * (0.55 + size * 0.75) * (0.75 + 0.45 * Math.sin(t * 2.3) * Math.sin(t * 0.7 + 1.3));

/** One tick of the fight: reeling raises the tension and brings it in; letting go eases both. */
export function fishStep(far: number, tension: number, size: number, t: number, reeling: boolean, dt: number) {
  const pull = fishPull(t, size);
  const next = Math.max(0, Math.min(1.2, tension + (reeling ? pull : -FISH.ease) * dt));
  return {
    far: Math.max(0, far - (reeling ? FISH.reel * dt : -FISH.reel * 0.35 * dt)),
    tension: next,
    snapped: next >= 1,
  };
}

/** What you can play at a pit stop. */
export type MiniKind = 'golf' | 'slots' | 'fish';

/** What the pit stop's own amusements pay. */
export const PIT = { fish: 14, golf: 10, slots: 1 };

export const RUN = {
  /** Stop when the bus is this close to the checkpoint's marker, going slower than `parkSpeed`. */
  parkRadius: 16,
  parkSpeed: 4,
  /** Scrap in each of your pockets when you wake up. */
  startScrap: 20,
  /** A repair kit's worth of bus; then what everyone gets for a scrap pile, a crate, and a cleared checkpoint
   *  (plus `clearPer` a leg). */
  repair: 250,
  scrap: 15,
  crate: 12,
  /** Paint a zombie dead and it's a little scrap in your own pocket (a chonk's worth more). */
  kill: 1,
  chonk: 3,
  clear: 40,
  clearPer: 6,
  /** Each cleared checkpoint patches the bus up this much (duct tape); a teed-off zombie this much. */
  patch: 150,
  teeHeal: 20,
  /** A full tank, what a metre of driving burns, a gas can by the road, and a jerry can lugged from the pump. */
  fuel: 100,
  burn: 0.045,
  gas: 35,
  jerry: 20,
  /** Getting knocked out costs you this share of your scrap (dropped in the scramble). */
  koLoss: 0.1,
  /** Seconds of calm at the start of each leg. */
  legCalm: 7,
} as const;

/** What scrap buys at the bus's store (B / D-pad up), out of your own pocket. Upgrades cost more a level at a time. */
export const UPGRADES = [
  { id: 'armor', name: 'Scrap armour', what: '+250 max bus health (and fills it)', max: 6, cost: 50 },
  { id: 'plow', name: 'Snow plow', what: 'A blade on the front: zombies bounce off at lower speed', max: 4, cost: 45 },
  { id: 'engine', name: 'Engine swap', what: '+8% speed, pulls harder up hills', max: 5, cost: 40 },
  { id: 'tank', name: 'Jerry-rigged tank', what: '+25 fuel and sips less', max: 4, cost: 35 },
  { id: 'hopper', name: 'Big hoppers', what: '+20 paintballs, quicker reloads for everyone', max: 4, cost: 30 },
  { id: 'forks', name: 'Pitchforks', what: 'Spikes down both sides: zombies chew the bus slower', max: 4, cost: 40 },
] as const;
/** Comforts bolted to the bus: everyone's, and you can sit on them. */
export const COMFORTS = [
  { id: 'couch', name: 'Roof couch', what: 'A couch on the roof deck. Sit down, feel better, watch the world go by', cost: 80 },
  { id: 'boombox', name: 'Boombox', what: 'Tunes on the roof. Everyone aboard heals a little quicker', cost: 60 },
  { id: 'bbq', name: 'Rooftop BBQ', what: 'Burgers up top: a bite back to full health whenever it’s hot', cost: 90 },
] as const;

export const REPAIR = { cost: 30, hp: 200 } as const;
/** For yourself: a paint grenade, and a bandage (back to full health). */
export const STORE = { nade: 15, bandage: 10 } as const;

/** Guns on the rack: what they cost before the run hands them out for free. */
export const GUN_COST = [0, 70, 130, 180, 240] as const;

/** Bolted to your own marker, for the rest of the run. */
export const KITS = [
  { id: 'scope', name: 'Red dot', what: 'Tighter shots with every gun', cost: 55 },
  { id: 'barrel', name: 'Long barrel', what: 'Every paintball hits harder', cost: 75 },
  { id: 'loader', name: 'Speed loader', what: 'Reload in half the time', cost: 50 },
] as const;
export const KIT = { scope: 0, barrel: 1, loader: 2 } as const;

/**
 * What `buy` takes: the bus upgrades first, then the one-offs, then the comforts, the guns, the kit and the
 * costumes, so a client's number always means the same thing.
 */
export const BUY = {
  repair: UPGRADES.length,
  nade: UPGRADES.length + 1,
  bandage: UPGRADES.length + 2,
  comfort: UPGRADES.length + 3,
  gun: UPGRADES.length + 3 + COMFORTS.length,
  kit: UPGRADES.length + 3 + COMFORTS.length + GUN_COST.length,
  fit: UPGRADES.length + 3 + COMFORTS.length + GUN_COST.length + KITS.length,
} as const;
/** How many different things the store sells (the highest `k` a client may send). */
export const BUY_MAX = BUY.fit + FITS.length;
/** Index of each upgrade in `RunState.up`. */
export const UP = { armor: 0, plow: 1, engine: 2, tank: 3, hopper: 4, forks: 5 } as const;
export const upCost = (k: number, level: number) => UPGRADES[k].cost * (level + 1);

export type Phase = 'drive' | 'stop' | 'lost';

export interface RunState {
  seed: number;
  /** The leg you're on, from 0: its checkpoint is `checkpointOf(seed, stage)`. */
  stage: number;
  phase: Phase;
  busHp: number;
  /** Everyone's own scrap, by their place in the crew (join order). Yours to spend at the store, or to bet. */
  cash: number[];
  /** The checkpoint's job: how far along, how much it needs, and whether it's done (the gate's open). */
  prog: number;
  need: number;
  done: boolean;
  club: boolean;
  gordie: boolean;
  kills: number;
  yeets: number;
  /** Seconds since waking up, and metres driven. */
  time: number;
  dist: number;
  fuel: number;
  /** The zombie round: which one, how many are left in it, and the seconds of calm before the next. */
  round: number;
  left: number;
  calm: number;
  /** Upgrade levels, in UPGRADES' order. */
  up: number[];
  /** How many times the bus has gone over (CLING.rolls ends the run), and how long it's lying on its side. */
  rolls: number;
  /** A boss stop's keg, while it's standing (0: no keg, or it's been smashed). */
  keg: number;
  /** Bought by each player, by their place: the guns and the kit they own, and the costume they're wearing. */
  guns: number[];
  kit: number[];
  fit: number[];
  /** The comforts bolted to the bus, for everyone (a bit each, COMFORTS). */
  comfort: number;
  down: number;
}

export function newRun(seed: number, crew = 1): RunState {
  return {
    seed,
    stage: 0,
    phase: 'drive',
    busHp: BUS.hp,
    cash: Array.from({ length: MAX_PLAYERS }, (_, i) => (i < Math.max(1, crew) ? RUN.startScrap : 0)),
    prog: 0,
    need: 1,
    done: false,
    club: false,
    gordie: false,
    kills: 0,
    yeets: 0,
    time: 0,
    dist: 0,
    fuel: RUN.fuel,
    round: 0,
    left: 0,
    calm: ROUNDS.first,
    up: UPGRADES.map(() => 0),
    rolls: 0,
    keg: 0,
    guns: new Array(MAX_PLAYERS).fill(0),
    kit: new Array(MAX_PLAYERS).fill(0),
    fit: new Array(MAX_PLAYERS).fill(0),
    comfort: 0,
    down: 0,
  };
}

export const maxHp = (r: Pick<RunState, 'up'>) => BUS.hp + r.up[UP.armor] * 250;
export const maxFuel = (r: Pick<RunState, 'up'>) => RUN.fuel + r.up[UP.tank] * 25;
export const burnOf = (r: Pick<RunState, 'up'>) => RUN.burn * (1 - r.up[UP.tank] * 0.08);
export const hopperOf = (r: Pick<RunState, 'up'>) => GUN.hopper + r.up[UP.hopper] * 20;
export const reloadKit = (r: Pick<RunState, 'kit'>, who: number) => (hasKit(r, who, KIT.loader) ? 0.5 : 1);
export const reloadOf = (r: Pick<RunState, 'up'>) => GUN.reload * (1 - r.up[UP.hopper] * 0.12);
/** The engine's pull (top speed, acceleration and climbing), from the engine upgrade. */
export const powerOf = (r: Pick<RunState, 'up'>) => 1 + r.up[UP.engine] * 0.08;
export const yeetSpeedOf = (r: Pick<RunState, 'up'>) => HORDE.yeetSpeed - r.up[UP.plow] * 1.1;
export const chewOf = (r: Pick<RunState, 'up'>) => 1 - r.up[UP.forks] * 0.15;

/** What `k` costs right now (Infinity: it can't be bought, e.g. maxed out or the bus is already whole). */
export function priceOf(r: RunState, k: number, who = 0): number {
  if (k === BUY.repair) return r.busHp >= maxHp(r) ? Infinity : REPAIR.cost;
  if (k === BUY.nade) return STORE.nade;
  if (k === BUY.bandage) return STORE.bandage;
  if (k >= BUY.fit) {
    const f = FITS[k - BUY.fit];
    return !f || (r.fit[who] ?? 0) === k - BUY.fit ? Infinity : f.cost;
  }
  if (k >= BUY.kit) {
    const i = k - BUY.kit;
    return !KITS[i] || hasKit(r, who, i) ? Infinity : KITS[i].cost;
  }
  if (k >= BUY.gun) {
    const i = k - BUY.gun;
    return !GUNS[i] || ownsGun(r, who, i) ? Infinity : GUN_COST[i];
  }
  if (k >= BUY.comfort) {
    const i = k - BUY.comfort;
    return !COMFORTS[i] || hasComfort(r, i) ? Infinity : COMFORTS[i].cost;
  }
  const u = UPGRADES[k];
  return !u || r.up[k] >= u.max ? Infinity : upCost(k, r.up[k]);
}

/** Whether `who` can pick gun `g` up: the run hands them out as you clear stops, or you buy them early. */
export const ownsGun = (r: Pick<RunState, 'stage' | 'done' | 'guns'>, who: number, g: number) =>
  g < gunsUnlocked(r.stage + (r.done ? 1 : 0)) || (((r.guns[who] ?? 0) >> g) & 1) === 1;
export const hasKit = (r: Pick<RunState, 'kit'>, who: number, i: number) => (((r.kit[who] ?? 0) >> i) & 1) === 1;
export const hasComfort = (r: Pick<RunState, 'comfort'>, i: number) => ((r.comfort >> i) & 1) === 1;

/** Crew member `who` buys `k` (see BUY) if they can afford it. Grenades and bandages are theirs: their screen hands them over. */
export function buy(r: RunState, k: number, who: number): boolean {
  const cost = priceOf(r, k, who);
  if (!(r.cash[who] >= cost)) return false;
  r.cash[who] -= cost;
  if (k === BUY.repair) r.busHp = Math.min(maxHp(r), r.busHp + REPAIR.hp);
  else if (k >= BUY.fit) r.fit[who] = k - BUY.fit;
  else if (k >= BUY.kit) r.kit[who] |= 1 << (k - BUY.kit);
  else if (k >= BUY.gun) r.guns[who] |= 1 << (k - BUY.gun);
  else if (k >= BUY.comfort) r.comfort |= 1 << (k - BUY.comfort);
  else if (k < UPGRADES.length) {
    r.up[k]++;
    if (k === UP.armor) r.busHp = maxHp(r);
    if (k === UP.tank) r.fuel = Math.min(maxFuel(r), r.fuel + 25);
  }
  return true;
}

/** A short line for the HUD: what to do now. */
export function objective(r: RunState, job: Job, place: string): string {
  if (r.phase === 'lost') return 'The bus is done.';
  if (r.phase === 'drive') return r.done ? 'Checkpoint cleared! Drive on through the gate' : `Drive to ${place}`;
  if (r.done) return 'Cleared! Everyone aboard, then drive on through the gate';
  const n = `${Math.floor(r.prog)}/${r.need}`;
  if (job === 'scavenge') return `Scavenge supply crates: ${n}`;
  if (job === 'fuel') return `Lug jerry cans from the pump to the bus: ${n}`;
  if (job === 'beacon') return `Stand in the ring to crank the beacon: ${Math.ceil(r.need - r.prog)} s`;
  if (job === 'holdout') return `Hold them off: ${n}`;
  if (job === 'boss') return `Defend the keg from the big one${r.keg > 0 ? '' : ' (the keg’s gone)'}`;
  return 'Pit stop: fish, hit some balls, hang out';
}

// ---------------------------------------------------------------------------------------------
// Zombies and guns

export type ZKind = 0 | 1 | 2 | 3 | 4;
/** `damage`: bus health a second while it hangs on. `bite`: what one bite takes off a player on foot. */
export const ZOMBIE: Record<ZKind, { name: string; speed: number; hp: number; r: number; damage: number; bite: number }> = {
  0: { name: 'shambler', speed: 4.5, hp: 3, r: 0.45, damage: 2, bite: 12 },
  1: { name: 'sprinter', speed: 7.5, hp: 2, r: 0.4, damage: 1.5, bite: 9 },
  2: { name: 'chonk', speed: 3.2, hp: 7, r: 0.75, damage: 4, bite: 24 },
  3: { name: 'leaper', speed: 6.5, hp: 2, r: 0.38, damage: 1.5, bite: 10 },
  4: { name: 'the big one', speed: 3.4, hp: 300, r: 1.6, damage: 9, bite: 34 },
};
/** The further you get, the faster they come (a share on top per leg, capped). */
export const zSpeed = (stage: number) => 1 + Math.min(0.45, stage * 0.025);

/**
 * Rounds, like CoD Zombies: each round sends a set number of zombies (no more than `alive` at once), and when every
 * one of them is dead (or left behind), there's a calm before the next, bigger round.
 */
export const ROUNDS = {
  size: (round: number, crew: number) => Math.round((5 + round * 4) * HORDE.crewScale(crew)),
  alive: (round: number, crew: number) => Math.max(3, Math.round(Math.min(60, 5 + round * 3) * HORDE.crewScale(crew))),
  /** Zombies per second while a round's still sending them. */
  rate: 1.8,
  /** Seconds of calm between rounds, and before the first. */
  calm: 15,
  first: 8,
} as const;

export const HORDE = {
  /** The horde grows with the crew: solo gets half, four get the lot, a full bus of eight about half again. */
  crewScale: (crew: number) => 0.35 + 0.15 * Math.max(1, Math.min(8, crew)),
  /** Spawn ring round the bus (m), weighted ahead of it. */
  near: 45,
  far: 85,
  /** Gone if they fall this far behind. */
  despawn: 130,
  /** Hit by a bus going faster than this and they fly. Slower, they get shoved. */
  yeetSpeed: 5,
  /** Hanging on the bus, they hurt it (hp/s, by kind) until shot off. */
  climbReach: 0.9,
  /** A leaper jumps for the side from this far out, so speed alone won't keep them off. */
  leapReach: 4.2,
  /** They go for someone on foot within this (m) rather than the bus, and bite every `bite` s within `biteReach`. */
  chase: 40,
  bite: 0.9,
  biteReach: 0.7,
} as const;

/**
 * Zombies hanging off the sides, like Zombie Highway: their weight hauls the wheel their way and leans the bus,
 * and far enough over it rolls. Scrape them along something solid (a wreck, a boulder, a gate post) and they come
 * off — cheaper than paint, and the whole point of the plow and the pitchforks.
 */
export const CLING = {
  /** What one of each kind weighs on the side it's hanging from. */
  weight: [1, 0.8, 2.3, 0.9, 4] as const,
  /** How hard a zombie of weight 1 pulls the wheel, and how far it leans the bus (radians). */
  pull: 0.085,
  lean: 0.05,
  /** Cornering at speed with a load on leans it further. */
  corner: 0.5,
  /** How fast the lean follows what's hanging on (rad/s). */
  settle: 1.6,
  /** Over this far (radians) and the bus goes over; armour plate lowers the bus and buys you a bit more. */
  tip: 0.68,
  tipPerArmor: 0.035,
  /** A roll: the damage, how long the bus lies there, and how many the run survives. */
  rollDamage: 260,
  rollTime: 3,
  rolls: 3,
  /** Scraping: how close the side has to pass something solid, and how fast you have to be going. */
  scrape: 1.1,
  scrapeSpeed: 5,
  /** Scraping one off pays the driver this. */
  scrapePay: 2,
} as const;

/** The net weight hanging off the sides: negative to the left, positive to the right. */
export function clingLoad(on: readonly { side: number; k: ZKind }[]): number {
  let load = 0;
  for (const z of on) load += Math.sign(z.side) * (CLING.weight[z.k] ?? 1);
  return load;
}

/** What that load does to the wheel (-1 to 1), given the bus's upgrades. */
export const pullOf = (load: number, r: Pick<RunState, 'up'>) => Math.max(-1, Math.min(1, (load * CLING.pull) / (1 + r.up[UP.armor] * 0.12)));

/** How far over the bus can go before it rolls. */
export const tipOf = (r: Pick<RunState, 'up'>) => CLING.tip + r.up[UP.armor] * CLING.tipPerArmor;

/** One tick of the lean: where it settles with that load, plus the cornering, and whether it just went over. */
export function stepLean(lean: number, load: number, b: Bus, dt: number, tip: number): { lean: number; rolled: boolean } {
  const speedK = Math.min(1, Math.abs(b.v) / BUS.maxSpeed);
  const want = load * CLING.lean + Math.sign(load || 1) * Math.abs(b.steer * speedK * CLING.corner * load * CLING.lean);
  const next = lean + (want - lean) * Math.min(1, CLING.settle * dt);
  return Math.abs(next) > tip ? { lean: 0, rolled: true } : { lean: next, rolled: false };
}

/** Which side of the bus is scraping something solid right now (-1 left, 1 right, 0 neither). */
export function scrapeSide(b: Bus, obstacles: readonly Obstacle[]): number {
  if (Math.abs(b.v) < CLING.scrapeSpeed) return 0;
  const f = fwdOf(b.h);
  const rt = rightOf(b.h);
  for (const off of BUS.hull) {
    const cx = b.x + f.x * off;
    const cz = b.z + f.z * off;
    for (const o of obstacles) {
      const dx = o.x - cx;
      const dz = o.z - cz;
      const reach = BUS.hullR + o.r + CLING.scrape;
      if (dx * dx + dz * dz >= reach * reach) continue;
      const lat = rt.x * dx + rt.z * dz;
      const along = f.x * dx + f.z * dz;
      // Beside the bus rather than straight ahead of it: that's a scrape, not a crash.
      if (Math.abs(lat) > Math.abs(along)) return Math.sign(lat) || 1;
    }
  }
  return 0;
}

export const GUN = {
  /** Paintballs per second (held), hopper, reload (s), ball speed (m/s), gravity on the ball. */
  rate: 9,
  hopper: 40,
  reload: 1.4,
  speed: 75,
  gravity: 9,
  /** A ball's life (s). */
  life: 1.6,
  damage: 1,
} as const;

/**
 * The guns, unlocked for the whole crew as checkpoints are cleared (`unlock`: how many). Each fires `pellets`
 * paintballs a shot inside `spread`, `rate` shots a second, each doing `damage`; `hopper` scales the hopper; `splash`
 * (m) paints everything round where it lands; `speed` and `gravity` scale the ball's flight.
 */
export const GUNS = [
  { name: 'Marker', unlock: 0, rate: 9, pellets: 1, spread: 0.025, damage: 1, hopper: 1, splash: 0, speed: 1, gravity: 1 },
  { name: 'Splatter Shotty', unlock: 2, rate: 1.7, pellets: 7, spread: 0.11, damage: 1, hopper: 0.3, splash: 0, speed: 0.9, gravity: 1 },
  { name: 'Paint Minigun', unlock: 4, rate: 22, pellets: 1, spread: 0.06, damage: 1, hopper: 3, splash: 0, speed: 1, gravity: 1 },
  { name: 'Long Tom', unlock: 6, rate: 1.1, pellets: 1, spread: 0.002, damage: 8, hopper: 0.2, splash: 0, speed: 2.2, gravity: 0.3 },
  { name: 'Balloon Launcher', unlock: 9, rate: 0.9, pellets: 1, spread: 0.01, damage: 4, hopper: 0.15, splash: 5.5, speed: 0.5, gravity: 2.2 },
] as const;
/** How many guns the crew has after clearing `cleared` checkpoints. */
export const gunsUnlocked = (cleared: number) => GUNS.filter((g) => g.unlock <= cleared).length;

/** Paint grenades (G / D-pad down): lobbed, they burst where they land. You carry a few; clearing a checkpoint restocks. */
export const NADE = { start: 2, max: 5, perClear: 2, splash: 7, damage: 6, speed: 24, lob: 0.35, gravity: 22, cooldown: 0.8 } as const;

export const CLUB = {
  /** A swing reaches this far from the bus's side (or from you, on foot), in a cone this wide, and launches them. */
  reach: 4.5,
  cone: 1.1,
  cooldown: 0.7,
  damage: 99,
} as const;

/** Gordie on the bus: a shot every `every` s at the nearest zombie in range, hitting `hit` of the time. */
export const GORDIE = { every: 0.7, range: 35, hit: 0.55 } as const;

// ---------------------------------------------------------------------------------------------
// Minigames

/** Golf: Zombie Tee-Off at the driving range. */
/**
 * Zombie Tee-Off: zombies shamble up the floodlit range toward your tee. Aim across (−1..1), hold to wind up the
 * power (how far down the range, 0..1; it swings back if you hold too long), let go to swing. A ball that lands on
 * a zombie tees it off. Let one reach the tee and it grabs you for a moment.
 */
export const GOLF = {
  /** The power meter's swing: up and back down over this long (s). */
  powerPeriod: 1.4,
  /** How close the ball has to land to a zombie: across, and down the range. */
  hitX: 0.11,
  hitD: 0.075,
  /** How fast they shamble toward you (range per second), and how many are out there at once. */
  speedMin: 0.05,
  speedMax: 0.11,
  crowd: 4,
  /** A zombie this close to the tee grabs you (you can't swing for `grabbed` s). */
  reach: 0.04,
  grabbed: 2,
  /** The ball's flight (s). */
  flight: 0.9,
} as const;

/** A sweep from 0 to 1 and back over `period` seconds. */
export const sweep = (t: number, period: number) => {
  const k = ((t % period) + period) % period / period;
  return k < 0.5 ? k * 2 : 2 - k * 2;
};

/** Golf: does a ball landing at (aim, power) tee off a zombie standing at (x, d)? */
export const teesOff = (aim: number, power: number, z: { x: number; d: number }) =>
  Math.abs(aim - z.x) <= GOLF.hitX && Math.abs(power - z.d) <= GOLF.hitD;

/** Slots: the reel symbols, and what a line pays. */
export const SLOTS = ['🧟', '🍺', '💀', '🎃', '💰', '7'] as const;
/** Each reel spins at its own speed (symbols per second); you stop them one at a time. */
export const REEL_SPEED = [7, 9, 11.5] as const;
/** Which symbol a reel shows `t` seconds after it started at `start`. */
export const reelAt = (t: number, reel: number, start = 0) => Math.floor(start + t * REEL_SPEED[reel]) % SLOTS.length;
export const SLOT_PAY = { triple7: 400, tripleCash: 250, triple: 120, pair: 50 } as const;

export function slotPay(reels: readonly number[]): number {
  const [a, b, c] = reels;
  if (a === b && b === c) return SLOTS[a] === '7' ? SLOT_PAY.triple7 : SLOTS[a] === '💰' ? SLOT_PAY.tripleCash : SLOT_PAY.triple;
  if (a === b || b === c || a === c) return SLOT_PAY.pair;
  return 0;
}

/** The most one pull can pay (the host clamps what it's told). */
export const SLOT_MAX = SLOT_PAY.triple7;

// ---------------------------------------------------------------------------------------------
// Hanging out on the bus: the bong, the cooler, the card table

/** Stations inside the bus (bus-local, like a Spot) and what they do for you. */
export const HANG = {
  bong: { side: 0.75, along: -4.4, heal: 30, high: 12 },
  cooler: { side: -0.75, along: -4.4, heal: 15, tipsy: 14 },
  table: { side: 0.7, along: 0.5 },
  /** Bought and bolted to the roof deck (COMFORTS): a couch to sit on and a BBQ to eat off. */
  couch: { side: -0.55, along: -2.4, heal: 22 },
  bbq: { side: 0.75, along: -4.2, heal: 100 },
  /** How close you have to stand (m). */
  reach: 1.1,
} as const;

export type HangKind = 'bong' | 'cooler' | 'table' | 'couch' | 'bbq';
/** Which station you're standing at, if any: the bong, the cooler and the cards inside, the comforts up top. */
export function hangAt(p: Spot, comfort = 0): HangKind | null {
  const near = (k: HangKind) => Math.hypot(p.side - HANG[k].side, p.along - HANG[k].along) < HANG.reach;
  if (p.level !== 0) {
    if (((comfort >> 0) & 1) === 1 && near('couch')) return 'couch';
    if (((comfort >> 2) & 1) === 1 && near('bbq')) return 'bbq';
    return null;
  }
  for (const k of ['bong', 'cooler', 'table'] as const) if (near(k)) return k;
  return null;
}

/** Your own gear: the red dot tightens every gun, the long barrel hits harder, the speed loader halves reloads. */
export const spreadOf = (r: Pick<RunState, 'kit'>, who: number, g: number) => (GUNS[g]?.spread ?? 0) * (hasKit(r, who, KIT.scope) ? 0.45 : 1);
export const kitDamage = (r: Pick<RunState, 'kit'>, who: number) => (hasKit(r, who, KIT.barrel) ? 1 : 0);
/** The boombox has everyone aboard pulling themselves together quicker. */
export const regenOf = (r: Pick<RunState, 'comfort'>) => FOOT.regen * (hasComfort(r, 1) ? 1.7 : 1);

/** Cards are 0-51: rank c % 13 (0 is a two, 12 an ace), suit ⌊c / 13⌋. */
export const rankOf = (c: number) => c % 13;
export const suitOf = (c: number) => Math.floor(c / 13);

export const HANDS = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'] as const;

/**
 * A five-card poker hand as a list to compare (bigger wins, entry by entry): the kind (index into HANDS), then the
 * ranks that break ties.
 */
export function pokerScore(hand: readonly number[]): number[] {
  const ranks = hand.map(rankOf).sort((a, b) => b - a);
  const flush = hand.every((c) => suitOf(c) === suitOf(hand[0]));
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // Groups first (fours, threes, pairs), each by rank.
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const order = groups.map(([r]) => r);
  const wheel = ranks.join() === '12,3,2,1,0';
  const straight = counts.size === 5 && (ranks[0] - ranks[4] === 4 || wheel);
  const top = wheel ? [3] : [ranks[0]];
  if (straight && flush) return [8, ...top];
  if (groups[0][1] === 4) return [7, ...order];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, ...order];
  if (flush) return [5, ...ranks];
  if (straight) return [4, ...top];
  if (groups[0][1] === 3) return [3, ...order];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, ...order];
  if (groups[0][1] === 2) return [1, ...order];
  return [0, ...ranks];
}

/** > 0 if hand `a` beats `b`, < 0 if it loses, 0 for a split pot. */
export function pokerCompare(a: readonly number[], b: readonly number[]) {
  const x = pokerScore(a);
  const y = pokerScore(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}
export const handName = (hand: readonly number[]) => HANDS[pokerScore(hand)[0]];

/** Blackjack at the card table, against the dealer (who draws to 17). A natural pays 3:2. */
export const BLACKJACK = { bets: [10, 25, 50], dealerStands: 17, natural: 1.5 } as const;
/** The most one hand can win or lose (a doubled top bet), which the host holds results to. */
export const BJ_MAX = BLACKJACK.bets[BLACKJACK.bets.length - 1] * 2;

/** A blackjack hand's best total (aces as 11 while that doesn't bust). */
export function bjTotal(hand: readonly number[]) {
  let t = 0;
  let aces = 0;
  for (const c of hand) {
    const r = rankOf(c);
    if (r === 12) {
      aces++;
      t += 11;
    } else t += r >= 8 ? 10 : r + 2;
  }
  while (t > 21 && aces-- > 0) t -= 10;
  return t;
}

/** What a finished blackjack hand pays on `bet` (negative: lost). The dealer's hand is already drawn out. */
export function bjPay(player: readonly number[], dealer: readonly number[], bet: number) {
  const p = bjTotal(player);
  const d = bjTotal(dealer);
  const natural = (h: readonly number[]) => h.length === 2 && bjTotal(h) === 21;
  if (p > 21) return -bet;
  if (natural(player)) return natural(dealer) ? 0 : Math.round(bet * BLACKJACK.natural);
  if (natural(dealer)) return -bet;
  if (d > 21 || p > d) return bet;
  return p === d ? 0 : -bet;
}

/** A shuffled deck (Fisher-Yates on `rand`). */
export function shuffled(rand: () => number): number[] {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
