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

// ---------------------------------------------------------------------------------------------
// The bus

export const BUS = {
  length: 11,
  width: 2.7,
  /** The roof deck the gunners stand on. */
  roof: 3.3,
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
} as const;

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

/** One step of the bus: a bicycle model with arcade grip. `onRoad` decides the grass slowdown. */
export function stepBus(b: Bus, d: Drive, dt: number, onRoad: boolean): void {
  const speedK = Math.min(1, Math.abs(b.v) / BUS.maxSpeed);
  const maxSteer = BUS.steerMax * (1 - (1 - BUS.steerAtSpeed) * speedK);
  const want = Math.max(-1, Math.min(1, d.steer)) * maxSteer;
  const ds = want - b.steer;
  b.steer += Math.sign(ds) * Math.min(Math.abs(ds), BUS.steerRate * dt);

  const top = onRoad ? BUS.maxSpeed : BUS.maxSpeed * BUS.grass;
  let a = 0;
  if (d.throttle > 0) a += d.throttle * BUS.accel * (b.v < 0 ? 2.5 : 1);
  // Going forward the brake pedal brakes; stopped (or rolling back) it reverses.
  const braking = d.brake > 0 && b.v > 0;
  if (braking) a -= d.brake * BUS.brake;
  else if (d.brake > 0) a -= d.brake * BUS.accel * 0.8;
  if (d.handbrake) a -= Math.sign(b.v) * BUS.handbrake;
  a -= b.v * (onRoad ? BUS.drag : BUS.grassDrag);
  const before = b.v;
  b.v += a * dt;
  // Brakes and the handbrake stop the bus where they'd push it past zero; reversing waits for the next tick.
  if ((braking || d.handbrake) && before !== 0 && Math.sign(b.v) !== Math.sign(before)) b.v = 0;
  if (b.v > top) b.v = Math.max(top, b.v - BUS.brake * dt);
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

/** The roof spots, bus-local (side, along): seat 0 is the driver's, the rest stand on the roof deck. */
export const SEATS: readonly { side: number; along: number }[] = [
  { side: -0.7, along: 4.4 },
  { side: -0.75, along: 2.6 },
  { side: 0.75, along: 2.6 },
  { side: -0.75, along: 0.6 },
  { side: 0.75, along: 0.6 },
  { side: -0.75, along: -1.4 },
  { side: 0.75, along: -1.4 },
  { side: 0, along: -3.4 },
];

// ---------------------------------------------------------------------------------------------
// The run: the stops in order, what each needs

export type StopKind = 'arena' | 'golf' | 'casino' | 'jail' | 'home';
export const STOP_ORDER: readonly StopKind[] = ['arena', 'golf', 'casino', 'jail', 'home'];

export const STOP_INFO: Record<StopKind, { name: string; sign: string; goal: string }> = {
  arena: { name: 'the paintball arena', sign: 'SPLAT ZONE PAINTBALL', goal: 'Wake up. Grab the markers.' },
  golf: { name: 'the driving range', sign: 'TEE TIME DRIVING RANGE', goal: 'Land 3 balls on the green to win the golf club.' },
  casino: { name: 'the casino', sign: 'LUCKY LIMESTONE CASINO', goal: 'Win Gordie’s bail money on the slots.' },
  jail: { name: 'the jail', sign: 'KINGSTON HOLDING CELLS', goal: 'Pay the bail, then hold them off while Gordie’s released.' },
  home: { name: 'the house', sign: 'THE BOYS’ HOUSE', goal: 'Get home. Bong tokes with the boys.' },
};

export const RUN = {
  /** Stop when the bus is this close to a stop's marker, going slower than `parkSpeed`. */
  parkRadius: 16,
  parkSpeed: 4,
  golfGreens: 3,
  bail: 600,
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
} as const;

export type Phase = 'drive' | 'stop' | 'won' | 'lost';

export interface RunState {
  seed: number;
  /** The stop you're heading to (index into STOP_ORDER). Starts at 1: you wake up at the arena. */
  stage: number;
  phase: Phase;
  busHp: number;
  money: number;
  greens: number;
  /** Seconds of the jail hold done. */
  hold: number;
  bailPaid: boolean;
  club: boolean;
  gordie: boolean;
  kills: number;
  yeets: number;
  /** Seconds since waking up. */
  time: number;
}

export function newRun(seed: number): RunState {
  return {
    seed,
    stage: 1,
    phase: 'drive',
    busHp: BUS.hp,
    money: RUN.startMoney,
    greens: 0,
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
  if (k === 'golf') return r.greens >= RUN.golfGreens;
  if (k === 'casino') return r.money >= RUN.bail;
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
    return 'GORDIE IS FREE! He’s on the roof. Home time.';
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
  if (k === 'golf') return `Hit balls onto the green: ${r.greens}/${RUN.golfGreens} (E at the range)`;
  if (k === 'casino') return `Win bail on the slots: $${r.money}/$${RUN.bail} (E at the casino)`;
  if (k === 'jail') return r.bailPaid ? `Hold them off: Gordie’s out in ${Math.ceil(RUN.jailHold - r.hold)} s` : 'Paying bail…';
  return STOP_INFO[k].goal;
}

// ---------------------------------------------------------------------------------------------
// Zombies and guns

export type ZKind = 0 | 1 | 2;
export const ZOMBIE: Record<ZKind, { name: string; speed: number; hp: number; r: number; damage: number }> = {
  0: { name: 'shambler', speed: 5, hp: 3, r: 0.45, damage: 3 },
  1: { name: 'sprinter', speed: 8.5, hp: 2, r: 0.4, damage: 2 },
  2: { name: 'chonk', speed: 3.4, hp: 8, r: 0.75, damage: 6 },
};

export const HORDE = {
  /** How many are about, by stage, while driving and while stopped (for a full bus: see `crewScale`). */
  drive: (stage: number) => 22 + stage * 6,
  stop: (stage: number) => 30 + stage * 8,
  /** Fewer of them for a smaller crew: a solo run gets 45%, four or more get the lot. */
  crewScale: (crew: number) => Math.min(1, 0.3 + 0.175 * Math.max(1, crew)),
  /** Spawn ring round the bus (m), weighted ahead of it. */
  near: 45,
  far: 85,
  /** Gone if they fall this far behind. */
  despawn: 130,
  /** Hit by a bus going faster than this and they fly. Slower, they get shoved. */
  yeetSpeed: 5,
  /** Hanging on the bus, they hurt it (hp/s, by kind) until shot off. */
  climbReach: 0.9,
  /** Spawn cadence (zombies per second at most). */
  rate: 6,
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

/** Gordie on the roof: a shot every `every` s at the nearest zombie in range, hitting `hit` of the time. */
export const GORDIE = { every: 0.7, range: 35, hit: 0.55 } as const;

// ---------------------------------------------------------------------------------------------
// Minigames

/** Golf: the meter's swing (s per back-and-forth), and how close counts as on the green. */
export const GOLF = {
  aimPeriod: 1.3,
  powerPeriod: 1.0,
  /** The green's half-width in aim (−1..1), and its depth in power (0..1) around the target power. */
  aimTol: 0.16,
  powerTol: 0.08,
} as const;

/** A sweep from 0 to 1 and back over `period` seconds. */
export const sweep = (t: number, period: number) => {
  const k = ((t % period) + period) % period / period;
  return k < 0.5 ? k * 2 : 2 - k * 2;
};

/** Golf: does a shot (aim −1..1, power 0..1) land on a green at `target` power? */
export const onGreen = (aim: number, power: number, target: number) =>
  Math.abs(aim) <= GOLF.aimTol && Math.abs(power - target) <= GOLF.powerTol;

/** Slots: the reel symbols, and what a line pays. */
export const SLOTS = ['🧟', '🍺', '🎱', '🍁', '💰', '7'] as const;
export const SLOT_PAY = { triple7: 400, tripleCash: 250, triple: 120, pair: 50 } as const;

export function slotPay(reels: readonly number[]): number {
  const [a, b, c] = reels;
  if (a === b && b === c) return SLOTS[a] === '7' ? SLOT_PAY.triple7 : SLOTS[a] === '💰' ? SLOT_PAY.tripleCash : SLOT_PAY.triple;
  if (a === b || b === c || a === c) return SLOT_PAY.pair;
  return 0;
}

/** The most one pull can pay (the host clamps what it's told). */
export const SLOT_MAX = SLOT_PAY.triple7;
