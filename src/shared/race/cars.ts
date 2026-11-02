// The car catalogue, upgrades, paint and tuning, and `carSpec()`: everything that turns a saved car into
// the numbers the physics runs on. Shared so the garage screen, the race and the server agree.

export type CarId = 'pebble' | 'kitsune' | 'bramble' | 'shiro' | 'vanta';
export type Body = 'hatch' | 'coupe' | 'muscle' | 'super';
export type Drive = 'FWD' | 'RWD' | 'AWD';

export interface BaseCar {
  id: CarId;
  name: string;
  maker: string;
  blurb: string;
  price: number;
  body: Body;
  drive: Drive;
  /** AWD: share of drive torque sent to the front axle. */
  awdFront?: number;
  mass: number; // kg
  frontWeight: number; // static share on the front axle
  wheelbase: number;
  track: number;
  length: number;
  width: number;
  height: number;
  cg: number; // centre of gravity height (m)
  radius: number; // wheel radius
  torque: number; // peak engine torque (Nm)
  peakRpm: number;
  redline: number;
  idle: number;
  cyl: number; // cylinders (engine note)
  gears: number[];
  final: number;
  reverse: number;
  grip: number; // tyre peak friction coefficient
  brake: number; // max brake torque per front wheel (Nm)
  bias: number; // front brake share
  cdA: number; // drag area (m^2)
  clA: number; // lift area (m^2, downforce)
  aeroFront: number;
  freq: number; // suspension natural frequency (Hz)
  steer: number; // max wheel angle (rad)
}

export const CARS: Record<CarId, BaseCar> = {
  pebble: {
    id: 'pebble', name: 'Pebble 1.3', maker: 'Mameko', price: 0, body: 'hatch', drive: 'FWD',
    blurb: 'A light little hatch that loves a hairpin. Slow on the straights, never out of breath in the bends.',
    mass: 960, frontWeight: 0.61, wheelbase: 2.38, track: 1.44, length: 3.75, width: 1.68, height: 1.46, cg: 0.52, radius: 0.29,
    torque: 132, peakRpm: 4400, redline: 6900, idle: 850, cyl: 4,
    gears: [3.55, 1.95, 1.31, 1.03, 0.82], final: 4.1, reverse: 3.3,
    grip: 1.02, brake: 1250, bias: 0.68, cdA: 0.66, clA: 0.04, aeroFront: 0.5, freq: 1.7, steer: 0.62,
  },
  kitsune: {
    id: 'kitsune', name: 'Kitsune RS', maker: 'Inari Works', price: 14000, body: 'hatch', drive: 'AWD', awdFront: 0.42,
    blurb: 'Rally-bred turbo four driving all four wheels. Rockets off hairpins and shrugs off gravel.',
    mass: 1330, frontWeight: 0.6, wheelbase: 2.6, track: 1.53, length: 4.25, width: 1.8, height: 1.42, cg: 0.5, radius: 0.32,
    torque: 395, peakRpm: 3600, redline: 7000, idle: 900, cyl: 4,
    gears: [3.6, 2.19, 1.52, 1.14, 0.97, 0.8], final: 3.9, reverse: 3.4,
    grip: 1.1, brake: 2300, bias: 0.64, cdA: 0.72, clA: 0.28, aeroFront: 0.46, freq: 1.95, steer: 0.6,
  },
  bramble: {
    id: 'bramble', name: 'Bramble V8', maker: 'Calloway', price: 22000, body: 'muscle', drive: 'RWD',
    blurb: 'A heavy V8 with torque to spare and opinions about corners. Brave drivers only.',
    mass: 1690, frontWeight: 0.56, wheelbase: 2.75, track: 1.6, length: 4.8, width: 1.92, height: 1.38, cg: 0.53, radius: 0.34,
    torque: 640, peakRpm: 4300, redline: 6600, idle: 750, cyl: 8,
    gears: [2.97, 2.07, 1.43, 1.0, 0.84, 0.56], final: 3.55, reverse: 2.9,
    grip: 1.06, brake: 2800, bias: 0.62, cdA: 0.78, clA: 0.12, aeroFront: 0.45, freq: 1.7, steer: 0.56,
  },
  shiro: {
    id: 'shiro', name: 'Shiro GT', maker: 'Tsurugi', price: 30000, body: 'coupe', drive: 'RWD',
    blurb: 'A balanced, high-revving coupe. Rewards smooth hands with long, controllable slides.',
    mass: 1320, frontWeight: 0.53, wheelbase: 2.57, track: 1.56, length: 4.4, width: 1.82, height: 1.3, cg: 0.48, radius: 0.33,
    torque: 425, peakRpm: 5400, redline: 8200, idle: 900, cyl: 6,
    gears: [3.62, 2.18, 1.54, 1.21, 1.0, 0.81], final: 3.7, reverse: 3.3,
    grip: 1.15, brake: 2600, bias: 0.63, cdA: 0.64, clA: 0.36, aeroFront: 0.45, freq: 2.0, steer: 0.6,
  },
  vanta: {
    id: 'vanta', name: 'Vanta V10', maker: 'Corvaro', price: 65000, body: 'super', drive: 'RWD',
    blurb: 'Mid-engined, ten cylinders, ground-effect floor. Terrifying, then addictive.',
    mass: 1480, frontWeight: 0.42, wheelbase: 2.65, track: 1.66, length: 4.55, width: 1.98, height: 1.18, cg: 0.43, radius: 0.345,
    torque: 600, peakRpm: 6500, redline: 8700, idle: 1000, cyl: 10,
    gears: [3.13, 2.19, 1.71, 1.39, 1.16, 0.97, 0.81], final: 3.65, reverse: 3.0,
    grip: 1.25, brake: 3300, bias: 0.6, cdA: 0.68, clA: 1.0, aeroFront: 0.42, freq: 2.3, steer: 0.58,
  },
};

export const CAR_IDS = Object.keys(CARS) as CarId[];
export const isCarId = (x: unknown): x is CarId => typeof x === 'string' && x in CARS;

// ---------------------------------------------------------------------------------------------
// Upgrades (won from crates), looks and tuning

export type Part = 'engine' | 'turbo' | 'tires' | 'brakes' | 'suspension' | 'weight' | 'gearbox' | 'aero';
export const PARTS: Part[] = ['engine', 'turbo', 'tires', 'brakes', 'suspension', 'weight', 'gearbox', 'aero'];
export const MAX_LEVEL = 5;

export const PART_INFO: Record<Part, { name: string; icon: string; effect: string }> = {
  engine: { name: 'Engine', icon: '⚙', effect: '+8% torque per level' },
  turbo: { name: 'Turbo', icon: '🌀', effect: '+7% top-end torque per level' },
  tires: { name: 'Tyres', icon: '◎', effect: '+0.045 grip per level' },
  brakes: { name: 'Brakes', icon: '⛔', effect: '+12% stopping power per level' },
  suspension: { name: 'Suspension', icon: '⇕', effect: 'Stiffer, lower, flatter per level' },
  weight: { name: 'Weight', icon: '🪶', effect: '−3% mass per level' },
  gearbox: { name: 'Gearbox', icon: '⚙︎', effect: '−14% shift time per level' },
  aero: { name: 'Aero', icon: '✈', effect: '+0.18 m² downforce per level' },
};

export type Upgrades = Record<Part, number>;
export const noUpgrades = (): Upgrades => ({ engine: 0, turbo: 0, tires: 0, brakes: 0, suspension: 0, weight: 0, gearbox: 0, aero: 0 });

export const PAINTS = [0xc8102e, 0xf2f2f0, 0x111317, 0x1d4ed8, 0xf5b301, 0x0f9d58, 0xff6a13, 0x7c3aed, 0x9aa3ad, 0x0bb4c9, 0xf472b6, 0x6b3e26];
export const PAINT_NAMES = ['Rosso', 'Chalk', 'Onyx', 'Cobalt', 'Saffron', 'Racing Green', 'Tangerine', 'Violet', 'Gunmetal', 'Lagoon', 'Sakura', 'Mocha'];
export const FINISHES = ['Gloss', 'Metallic', 'Matte', 'Pearl'] as const;
export const RIMS = ['Five-spoke', 'Mesh', 'Turbofan', 'Deep dish'] as const;
export const RIM_COLORS = [0xc9ccd1, 0x1a1b1e, 0xd4a017, 0xffffff, 0xb91c1c];
export const RIM_COLOR_NAMES = ['Silver', 'Black', 'Gold', 'White', 'Red'];
export const SPOILERS = ['None', 'Ducktail', 'Wing'] as const;
export const STRIPES = ['None', 'Twin stripes', 'Side stripe'] as const;
/** Underglow: index 0 is off (its swatch colour is only for the picker). */
export const GLOWS = [0x2a2c31, 0x22e6ff, 0xff2bd6, 0x7dff3a, 0xffa31a, 0xe8f1ff];
export const GLOW_NAMES = ['Off', 'Cyan', 'Magenta', 'Lime', 'Amber', 'Ice'];

export interface Look {
  paint: number;
  finish: number;
  rims: number;
  rimColor: number;
  spoiler: number;
  stripe: number;
  stripeColor: number;
  glow: number;
}

export interface Tune {
  /** Ride height offset (m), lower is quicker but bottoms out. */
  ride: number;
  /** Front brake share. */
  bias: number;
  /** Limited-slip lock, 0 = open diff. */
  diff: number;
  /** Final drive multiplier: higher = punchier, lower top speed. */
  final: number;
}

export const TUNE_RANGE: Record<keyof Tune, { min: number; max: number; step: number; label: string }> = {
  ride: { min: -0.04, max: 0.04, step: 0.01, label: 'Ride height' },
  bias: { min: 0.5, max: 0.75, step: 0.01, label: 'Brake bias (front)' },
  diff: { min: 0, max: 1, step: 0.05, label: 'Differential lock' },
  final: { min: 0.85, max: 1.15, step: 0.01, label: 'Final drive' },
};

export const defaultLook = (paint = 0): Look => ({ paint, finish: 1, rims: 0, rimColor: 0, spoiler: 0, stripe: 0, stripeColor: 1, glow: 0 });
export const defaultTune = (car: CarId): Tune => ({ ride: 0, bias: CARS[car].bias, diff: 0.35, final: 1 });

export interface OwnedCar {
  model: CarId;
  up: Upgrades;
  look: Look;
  tune: Tune;
}

export const newOwnedCar = (model: CarId, paint = 0): OwnedCar => ({ model, up: noUpgrades(), look: defaultLook(paint), tune: defaultTune(model) });

const LOOK_LIMITS: Record<keyof Look, number> = {
  paint: PAINTS.length,
  finish: FINISHES.length,
  rims: RIMS.length,
  rimColor: RIM_COLORS.length,
  spoiler: SPOILERS.length,
  stripe: STRIPES.length,
  stripeColor: PAINTS.length,
  glow: GLOWS.length,
};

const int = (x: unknown, n: number, fallback: number) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) < n ? (x as number) : fallback);
const num = (x: unknown, lo: number, hi: number, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);

export function cleanLook(x: unknown): Look {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const d = defaultLook();
  const out = { ...d };
  for (const k of Object.keys(LOOK_LIMITS) as (keyof Look)[]) out[k] = int(o[k], LOOK_LIMITS[k], d[k]);
  return out;
}

export function cleanTune(x: unknown, model: CarId): Tune {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const d = defaultTune(model);
  const out = { ...d };
  for (const k of Object.keys(TUNE_RANGE) as (keyof Tune)[]) out[k] = num(o[k], TUNE_RANGE[k].min, TUNE_RANGE[k].max, d[k]);
  return out;
}

export function cleanUpgrades(x: unknown): Upgrades {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const up = noUpgrades();
  for (const p of PARTS) up[p] = int(o[p], MAX_LEVEL + 1, 0);
  return up;
}

export function cleanCar(x: unknown): OwnedCar | null {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  if (!isCarId(o.model)) return null;
  return { model: o.model, up: cleanUpgrades(o.up), look: cleanLook(o.look), tune: cleanTune(o.tune, o.model) };
}

/** What other racers need to draw your car: model, look and the upgrade levels (for the class badge). */
export function encodeCar(c: OwnedCar): string {
  const l = c.look;
  return [c.model, l.paint, l.finish, l.rims, l.rimColor, l.spoiler, l.stripe, l.stripeColor, l.glow, PARTS.map((p) => c.up[p]).join('')].join('.');
}

export function decodeCar(code: string | null | undefined): OwnedCar | null {
  if (typeof code !== 'string' || code.length > 64) return null;
  const [model, ...rest] = code.split('.');
  const keys = Object.keys(LOOK_LIMITS) as (keyof Look)[];
  // Codes from before underglow have one look value fewer; it stays off.
  if (!isCarId(model) || (rest.length !== keys.length + 1 && rest.length !== keys.length)) return null;
  const n = rest.slice(0, -1).map(Number);
  const look = defaultLook();
  for (let i = 0; i < n.length; i++) {
    if (!Number.isInteger(n[i]) || n[i] < 0 || n[i] >= LOOK_LIMITS[keys[i]]) return null;
    look[keys[i]] = n[i];
  }
  const ups = rest[rest.length - 1];
  if (!/^[0-5]{8}$/.test(ups)) return null;
  const up = noUpgrades();
  PARTS.forEach((p, i) => (up[p] = Number(ups[i])));
  return { model, up, look, tune: defaultTune(model) };
}

// ---------------------------------------------------------------------------------------------
// The physics numbers

export interface CarSpec {
  id: CarId;
  drive: Drive;
  awdFront: number;
  mass: number;
  /** Principal moments of inertia about the body's x (pitch), y (yaw), z (roll) axes. */
  inertia: [number, number, number];
  /** Distances from the centre of gravity to the front and rear axles. */
  axleF: number;
  axleR: number;
  track: number;
  cg: number;
  radius: number;
  wheelInertia: number;
  rest: number; // suspension free length
  travel: number; // compression before the bump stop
  /** Per axle [front, rear]. */
  k: [number, number];
  c: [number, number];
  arb: [number, number];
  mountY: [number, number];
  /** Body box for scraping the ground: half width, half length, bottom and top (relative to the CG). */
  body: { hw: number; hl: number; y0: number; y1: number };
  grip: number;
  torque: number;
  turbo: number;
  peakRpm: number;
  redline: number;
  idle: number;
  engineInertia: number;
  gears: number[];
  final: number;
  reverse: number;
  shiftTime: number;
  brake: number; // total brake torque, all four wheels
  bias: number;
  handbrake: number;
  steer: number;
  cdA: number;
  clA: number;
  aeroFront: number;
  diff: number;
  cyl: number;
}

const SUSP_REST = 0.3;
const SUSP_TRAVEL = 0.2;
const DAMPING = 0.42; // damping ratio
const CLEARANCE = 0.13;

export function carSpec(car: OwnedCar): CarSpec {
  const b = CARS[car.model];
  const u = car.up;
  const t = car.tune;
  const mass = b.mass * (1 - 0.03 * u.weight);
  const cg = b.cg - 0.008 * u.suspension + t.ride * 0.9;
  const L = b.wheelbase;
  const axleF = L * (1 - b.frontWeight);
  const axleR = L * b.frontWeight;
  const freq = b.freq * (1 + 0.06 * u.suspension);
  const k: [number, number] = [0, 0];
  const c: [number, number] = [0, 0];
  const mountY: [number, number] = [0, 0];
  const corner = [(mass * b.frontWeight) / 2, (mass * (1 - b.frontWeight)) / 2];
  for (let a = 0; a < 2; a++) {
    k[a] = corner[a] * (2 * Math.PI * freq) ** 2;
    c[a] = 2 * DAMPING * Math.sqrt(k[a] * corner[a]);
    const static0 = (corner[a] * 9.81) / k[a];
    mountY[a] = -cg + b.radius + SUSP_REST - static0;
  }
  const arbScale = 1 + 0.15 * u.suspension;
  const wing = car.look.spoiler === 2;
  const duck = car.look.spoiler === 1;
  const H = b.height;
  return {
    id: b.id,
    drive: b.drive,
    awdFront: b.awdFront ?? 0.4,
    mass,
    inertia: [(mass / 12) * (H * H + b.length * b.length) * 0.85, (mass / 12) * (b.width ** 2 + b.length ** 2) * 0.85, (mass / 12) * (b.width ** 2 + H * H) * 0.9],
    axleF,
    axleR,
    track: b.track,
    cg,
    radius: b.radius,
    wheelInertia: 1.1 + b.radius * 1.2,
    rest: SUSP_REST,
    travel: SUSP_TRAVEL,
    k,
    c,
    arb: [k[0] * 0.55 * arbScale, k[1] * 0.35 * arbScale],
    mountY,
    body: { hw: b.width / 2 - 0.05, hl: b.length / 2 - 0.1, y0: -cg + CLEARANCE + t.ride * 0.9, y1: -cg + H },
    grip: b.grip + 0.045 * u.tires,
    torque: b.torque * (1 + 0.08 * u.engine),
    turbo: 0.07 * u.turbo,
    peakRpm: b.peakRpm,
    redline: b.redline,
    idle: b.idle,
    engineInertia: 0.12 + b.cyl * 0.012,
    gears: b.gears,
    final: b.final * t.final,
    reverse: b.reverse,
    shiftTime: 0.32 * (1 - 0.14 * u.gearbox),
    brake: b.brake * 2 * (1 + 0.12 * u.brakes) / Math.max(0.5, b.bias),
    bias: t.bias,
    handbrake: 2400,
    steer: b.steer,
    cdA: b.cdA + 0.01 * u.aero + (wing ? 0.03 : 0),
    clA: b.clA + 0.18 * u.aero + (wing ? 0.3 : duck ? 0.1 : 0),
    aeroFront: wing ? b.aeroFront - 0.06 : b.aeroFront,
    diff: t.diff,
    cyl: b.cyl,
  };
}

/** Engine torque (Nm) at full throttle: rises to the peak, sags gently to the redline; turbo fills the top end. */
export function torqueAt(sp: CarSpec, rpm: number): number {
  const r = Math.max(sp.idle * 0.6, rpm);
  let f: number;
  if (r < sp.peakRpm) {
    const x = (sp.peakRpm - r) / (sp.peakRpm - sp.idle);
    f = 0.55 + 0.45 * (1 - x * x);
  } else {
    const x = (r - sp.peakRpm) / (sp.redline - sp.peakRpm);
    f = 1 - 0.22 * x * x;
  }
  const boost = 1 + sp.turbo * Math.min(1, Math.max(0, (r - sp.idle) / (sp.peakRpm - sp.idle)));
  return sp.torque * Math.max(0.2, f) * boost;
}

export function peakPower(sp: CarSpec): { kw: number; rpm: number } {
  let kw = 0;
  let at = 0;
  for (let rpm = sp.idle; rpm <= sp.redline; rpm += 50) {
    const p = (torqueAt(sp, rpm) * rpm * 2 * Math.PI) / 60 / 1000;
    if (p > kw) {
      kw = p;
      at = rpm;
    }
  }
  return { kw, rpm: at };
}

/** Top speed (m/s): where drag + rolling resistance eat all the power, capped by the redline in top gear. */
export function topSpeed(sp: CarSpec): number {
  const geared = ((sp.redline * 2 * Math.PI) / 60) * sp.radius / (sp.gears[sp.gears.length - 1] * sp.final);
  const { kw } = peakPower(sp);
  let v = 10;
  for (let i = 0; i < 60; i++) {
    const need = (0.5 * 1.2 * sp.cdA * v * v + 0.015 * sp.mass * 9.81) * v;
    v *= Math.cbrt((kw * 1000 * 0.9) / need);
  }
  return Math.min(geared, v);
}

export type CarClass = 'D' | 'C' | 'B' | 'A' | 'S' | 'X';

/**
 * A Forza-style performance index and its class. PI starts at 100 and has no ceiling: a fully tuned
 * hypercar passes 1800, and everything above 900 is class X.
 */
export function rating(sp: CarSpec): { pi: number; cls: CarClass } {
  const pw = (peakPower(sp).kw * 1000) / sp.mass;
  const pi = Math.round(Math.max(100, 140 + 1.9 * pw + 430 * (sp.grip - 0.95) + 60 * sp.clA + (sp.drive === 'AWD' ? 25 : 0) + (sp.brake / sp.mass) * 4));
  const cls: CarClass = pi <= 400 ? 'D' : pi <= 500 ? 'C' : pi <= 600 ? 'B' : pi <= 700 ? 'A' : pi <= 900 ? 'S' : 'X';
  return { pi, cls };
}

export const CLASS_COLORS: Record<CarClass, string> = { D: '#3bb7e8', C: '#f2c94c', B: '#f2994a', A: '#eb5757', S: '#9b51e0', X: '#27ae60' };

/** Forza-style 0–10 bars for the garage card. */
export function stats(sp: CarSpec) {
  const pw = (peakPower(sp).kw * 1000) / sp.mass;
  const clamp = (x: number) => Math.round(Math.min(10, Math.max(1, x)) * 10) / 10;
  return {
    speed: clamp((topSpeed(sp) * 3.6 - 120) / 25),
    handling: clamp((sp.grip - 0.85) * 18 + sp.clA * 1.6 + (0.55 - sp.cg) * 12),
    acceleration: clamp(pw / 32),
    launch: clamp(pw / 38 + (sp.drive === 'AWD' ? 2.2 : sp.drive === 'FWD' ? 0.2 : 0.8) + (sp.grip - 1) * 6),
    braking: clamp((sp.brake / sp.mass) * 0.9 + (sp.grip - 0.9) * 10 - 1),
  };
}
