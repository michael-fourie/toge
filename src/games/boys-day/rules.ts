// BOYS DAY's rules, pure (no three.js, no DOM): the bus, the stops, the zombies' numbers, the minigames' maths.
// Units are metres and seconds, Y up, yaw 0 faces -Z.

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
  const want = Math.max(-1, Math.min(1, d.steer)) * maxSteer * (g.mud ? BUS.mudGrip : 1);
  const ds = want - b.steer;
  b.steer += Math.sign(ds) * Math.min(Math.abs(ds), BUS.steerRate * dt);

  let top = onRoad ? BUS.maxSpeed : BUS.maxSpeed * BUS.grass;
  if (g.fumes) top = Math.min(top, BUS.fumes);
  let a = 0;
  if (d.throttle > 0) a += d.throttle * BUS.accel * (b.v < 0 ? 2.5 : 1);
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
// The run: the stops in order, what each needs

export type StopKind = 'arena' | 'golf' | 'casino' | 'jail' | 'home';
export const STOP_ORDER: readonly StopKind[] = ['arena', 'golf', 'casino', 'jail', 'home'];

export const STOP_INFO: Record<StopKind, { name: string; sign: string; goal: string }> = {
  arena: { name: 'the paintball arena', sign: 'SPLAT ZONE PAINTBALL', goal: 'Wake up. Grab the markers.' },
  golf: { name: 'the driving range', sign: 'TEE TIME DRIVING RANGE', goal: 'Tee off zombies on the range to win the golf club.' },
  casino: { name: 'the casino', sign: 'LUCKY LIMESTONE CASINO', goal: 'Win Gordie’s bail money on the slots.' },
  jail: { name: 'the jail', sign: 'KINGSTON HOLDING CELLS', goal: 'Pay the bail, then hold them off while Gordie’s released.' },
  home: { name: 'the house', sign: 'THE BOYS’ HOUSE', goal: 'Get home. Bong tokes with the boys.' },
};

export const RUN = {
  /** Stop when the bus is this close to a stop's marker, going slower than `parkSpeed`. */
  parkRadius: 16,
  parkSpeed: 4,
  /** Money you wake up with (whatever's left in your pockets). */
  startMoney: 40,
  /** How long the jail takes to release Gordie (s), while you hold them off. */
  jailHold: 40,
  /** A repair kit's worth of bus. */
  repair: 250,
  /** A cash bag. */
  cash: 25,
  /** Each finished stop patches the bus up this much (duct tape). */
  patch: 150,
  /** A full tank, what a metre of driving burns, and a gas can's worth. */
  fuel: 100,
  burn: 0.045,
  gas: 35,
} as const;

/**
 * The stops' goals grow with the crew, so everyone gets a go before the job's done: zombies to tee off at the range,
 * and Gordie's bail.
 */
export const goals = (crew: number) => {
  const n = Math.max(1, Math.min(8, crew));
  return { tees: 2 + 2 * n, bail: 250 + 100 * n };
};

export type Phase = 'drive' | 'stop' | 'won' | 'lost';

export interface RunState {
  seed: number;
  /** The stop you're heading to (index into STOP_ORDER). Starts at 1: you wake up at the arena. */
  stage: number;
  phase: Phase;
  busHp: number;
  money: number;
  teed: number;
  /** Seconds of the jail hold done. */
  hold: number;
  bailPaid: boolean;
  club: boolean;
  gordie: boolean;
  kills: number;
  yeets: number;
  /** Seconds since waking up. */
  time: number;
  /** This crew's goals (see `goals`). */
  tees: number;
  bail: number;
  fuel: number;
  /** The zombie round: which one, how many are left in it, and the seconds of calm before the next. */
  round: number;
  left: number;
  calm: number;
}

export function newRun(seed: number, crew = 1): RunState {
  return {
    ...goals(crew),
    fuel: RUN.fuel,
    round: 0,
    left: 0,
    calm: ROUNDS.first,
    seed,
    stage: 1,
    phase: 'drive',
    busHp: BUS.hp,
    money: RUN.startMoney,
    teed: 0,
    hold: 0,
    bailPaid: false,
    club: false,
    gordie: false,
    kills: 0,
    yeets: 0,
    time: 0,
  };
}

export const stopOf = (r: RunState): StopKind => STOP_ORDER[Math.min(r.stage, STOP_ORDER.length - 1)];

/** Is this stop's job done? (Then the bus can go on to the next one.) */
export function stopDone(r: RunState): boolean {
  const k = stopOf(r);
  if (k === 'golf') return r.teed >= r.tees;
  if (k === 'casino') return r.money >= r.bail;
  if (k === 'jail') return r.hold >= RUN.jailHold;
  return k === 'home';
}

/** Moves on once the stop is done: the prize, then the next stage (or the win). Returns what to announce. */
export function finishStop(r: RunState): string {
  const k = stopOf(r);
  r.phase = 'drive';
  r.busHp = Math.min(BUS.hp, r.busHp + RUN.patch);
  if (k === 'golf') {
    r.club = true;
    r.stage++;
    return 'GOLF CLUB GET! Swing it at zombies: FORE!';
  }
  if (k === 'casino') {
    r.stage++;
    return `Bail money: $${r.money}. To the jail!`;
  }
  if (k === 'jail') {
    r.gordie = true;
    r.stage++;
    return 'GORDIE IS FREE! He’s on the bus. Home time.';
  }
  r.phase = 'won';
  return 'HOME! Bong tokes with the boys.';
}

/** A short line for the HUD: what to do now. */
export function objective(r: RunState): string {
  const k = stopOf(r);
  if (r.phase === 'won') return 'Home. Pack the bong.';
  if (r.phase === 'lost') return 'The bus is done.';
  if (r.phase === 'drive') return `Drive to ${STOP_INFO[k].name}`;
  if (k === 'golf') return `Tee off zombies on the range: ${r.teed}/${r.tees}`;
  if (k === 'casino') return `Win bail on the slots: $${r.money}/$${r.bail}`;
  if (k === 'jail') return r.bailPaid ? `Hold them off: Gordie’s out in ${Math.ceil(RUN.jailHold - r.hold)} s` : 'Paying bail…';
  return STOP_INFO[k].goal;
}

// ---------------------------------------------------------------------------------------------
// Zombies and guns

export type ZKind = 0 | 1 | 2;
export const ZOMBIE: Record<ZKind, { name: string; speed: number; hp: number; r: number; damage: number }> = {
  0: { name: 'shambler', speed: 4.5, hp: 3, r: 0.45, damage: 2 },
  1: { name: 'sprinter', speed: 7.5, hp: 2, r: 0.4, damage: 1.5 },
  2: { name: 'chonk', speed: 3.2, hp: 7, r: 0.75, damage: 4 },
};

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
} as const;

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

export const CLUB = {
  /** A swing reaches this far from the bus's side, in a cone this wide, and launches them. */
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
