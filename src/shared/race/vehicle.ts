// The car: a rigid body on four raycast wheels, stepped at PHYS_HZ.
//
// - Suspension: spring + damper per corner along the body's up axis, anti-roll bars per axle, a bump stop.
//   Load transfer (squat, dive, roll) falls out of it; nothing is scripted.
// - Tyres: Pacejka-style curves combined by normalised slip (a friction circle), with relaxation lengths so
//   slip builds up over a few centimetres of rolling. That also makes the tyres hold a parked car still.
// - Drivetrain: torque curve, clutch slip at launch, gearbox (auto or manual), limited-slip diffs, AWD split,
//   engine braking; the engine's inertia is felt through the gears when the clutch is in.
// - Aero drag and downforce; brakes with bias, ABS, traction control and a handbrake.
// - Barriers are the track's rails (an impulse at the corner that hits), the body scrapes the ground.
//
// Frame: body x = right, y = up, -z = forward (three.js). Wheels are 0 FL, 1 FR, 2 RL, 3 RR.

import { type CarSpec, torqueAt } from './cars.ts';
import { type Ground, type Loc, type Surface, type Track, groundAt, heightAt, locate, newGround, newLoc, pointAt } from './track.ts';

export const TICK_HZ = 120;
export const TICK_DT = 1 / TICK_HZ;
const SUB = 4;
const H = TICK_DT / SUB;
const G = 9.81;
const RHO = 1.2;

/** Tyre curve: peak at normalised slip 1. C sets how much grip is left when sliding (sin(C·π/2)). */
const TIRE_C = 1.45;
const TIRE_B = Math.tan(Math.PI / (2 * TIRE_C));
const SLIP_PEAK_X = 0.11; // slip ratio at peak longitudinal grip
const SLIP_PEAK_Y = 0.15; // slip angle (rad) at peak lateral grip
const RELAX_X = 0.25; // relaxation lengths (m)
const RELAX_Y = 0.45;
const ROLL_HEIGHT = 0.1; // tyre forces act this far above the contact patch (roll centre)
const LSD_GAIN = 110; // Nm per rad/s of wheel speed difference at full lock
const STEER_RATE = 2.6; // how fast the front wheels turn (rad/s)

const SURF: Record<Surface, { mu: number; roll: number }> = {
  asphalt: { mu: 1, roll: 0.014 },
  shoulder: { mu: 0.88, roll: 0.03 },
  grass: { mu: 0.62, roll: 0.09 },
};

export interface DriveInput {
  steer: number; // -1 left .. 1 right
  throttle: number; // 0..1
  brake: number; // 0..1
  handbrake: number; // 0..1
  shiftUp?: boolean;
  shiftDown?: boolean;
}

export interface Assists {
  abs: boolean;
  tcs: boolean;
  /** Points the front wheels where the car is going when it slides (Forza's "standard" steering). */
  steer: boolean;
  auto: boolean;
}

export const DEFAULT_ASSISTS: Assists = { abs: true, tcs: true, steer: true, auto: true };

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Wheel {
  comp: number; // suspension compression (m)
  w: number; // spin (rad/s), + rolls forward
  angle: number; // accumulated spin angle (rad), for drawing
  sx: number; // slip ratio state
  sy: number; // tan(slip angle) state
  contact: boolean;
  load: number;
  /** Normalised combined slip (1 = at the peak; >1 sliding), for smoke, skids and sound. */
  slip: number;
  surf: Surface;
  fx: number;
}

export interface Car {
  spec: CarSpec;
  p: V3;
  v: V3;
  q: Quat;
  w: V3; // angular velocity (world)
  wheels: Wheel[];
  steer: number; // front wheel angle (rad, + = right)
  rpm: number;
  gear: number; // -1 reverse, 0 neutral, 1..n
  shift: number; // seconds left in a gear change
  /** Throttle actually applied (after traction control / limiter), for sound. */
  load: number;
  /** Track position: last sample index, distance along the road and offset from the centre. */
  hint: number;
  s: number;
  d: number;
  /** Strongest impact speed this tick (barrier, ground or another car), for sound and rumble. */
  hit: number;
  absOn: boolean;
  tcsOn: boolean;
  tcsCut: number;
  stopTime: number;
  /** How long the car has been on its roof or side (auto-reset). */
  upsideDown: number;
}

const newWheel = (): Wheel => ({ comp: 0, w: 0, angle: 0, sx: 0, sy: 0, contact: false, load: 0, slip: 0, surf: 'asphalt', fx: 0 });

// --- small vector helpers ------------------------------------------------------------------

/** Rotates (x, y, z) by q into `o`. */
function rot(q: Quat, x: number, y: number, z: number, o: V3): V3 {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  o.x = x + q.w * tx + (q.y * tz - q.z * ty);
  o.y = y + q.w * ty + (q.z * tx - q.x * tz);
  o.z = z + q.w * tz + (q.x * ty - q.y * tx);
  return o;
}

/** Rotates by the inverse of q. */
const rotInv = (q: Quat, x: number, y: number, z: number, o: V3) => rot({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, x, y, z, o);

export const yawQuat = (yaw: number): Quat => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });

// --- creation and reset --------------------------------------------------------------------

export function newCar(spec: CarSpec, x: number, y: number, z: number, yaw: number): Car {
  const car: Car = {
    spec,
    p: { x, y: y + spec.cg + 0.02, z },
    v: { x: 0, y: 0, z: 0 },
    q: yawQuat(yaw),
    w: { x: 0, y: 0, z: 0 },
    wheels: [newWheel(), newWheel(), newWheel(), newWheel()],
    steer: 0,
    rpm: spec.idle,
    gear: 1,
    shift: 0,
    load: 0,
    hint: -1,
    s: 0,
    d: 0,
    hit: 0,
    absOn: false,
    tcsOn: false,
    tcsCut: 0,
    stopTime: 0,
    upsideDown: 0,
  };
  // Start with the springs at their static compression so the car doesn't drop onto them.
  car.wheels.forEach((wh, i) => {
    const a = i < 2 ? 0 : 1;
    wh.comp = spec.rest + spec.radius - spec.cg - spec.mountY[a];
  });
  return car;
}

/** Puts the car back on the road at distance `s` (default: where it is), facing downhill, stopped. */
export function resetCar(car: Car, t: Track, s = car.s, d = 0) {
  const l = pointAt(t, Math.max(4, Math.min(t.length - 4, s)), d);
  car.p = { x: l.x, y: l.y + car.spec.cg + 0.05, z: l.z };
  car.v = { x: 0, y: 0, z: 0 };
  car.w = { x: 0, y: 0, z: 0 };
  car.q = yawQuat(Math.atan2(-l.tx, -l.tz));
  car.hint = l.i;
  car.steer = 0;
  car.gear = 1;
  car.shift = 0;
  car.rpm = car.spec.idle;
  car.upsideDown = 0;
  for (const w of car.wheels) Object.assign(w, newWheel());
}

export const speedOf = (car: Car) => Math.hypot(car.v.x, car.v.y, car.v.z);

const tmpF = { x: 0, y: 0, z: 0 };
const fwdV = { x: 0, y: 0, z: 0 };
export function forwardSpeed(car: Car): number {
  rot(car.q, 0, 0, -1, fwdV);
  return car.v.x * fwdV.x + car.v.y * fwdV.y + car.v.z * fwdV.z;
}

/** Yaw (three.js convention) of the car's nose. */
export function yawOf(car: Car): number {
  rot(car.q, 0, 0, -1, tmpF);
  return Math.atan2(-tmpF.x, -tmpF.z);
}

// --- the step ---------------------------------------------------------------------------------

const loc: Loc = newLoc();
const right = { x: 0, y: 0, z: 0 };
const up = { x: 0, y: 0, z: 0 };
const fwd = { x: 0, y: 0, z: 0 };
const mount = { x: 0, y: 0, z: 0 };
const tmp = { x: 0, y: 0, z: 0 };
const mounts: V3[] = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, z: 0 }));
const grounds: Ground[] = [0, 1, 2, 3].map(() => newGround());
const dists = [0, 0, 0, 0];
const hasHit = [false, false, false, false];

const gearRatio = (sp: CarSpec, gear: number) => (gear > 0 ? sp.gears[gear - 1] * sp.final : gear < 0 ? -sp.reverse * sp.final : 0);
const driven = (sp: CarSpec, i: number) => sp.drive === 'AWD' || (sp.drive === 'FWD' ? i < 2 : i >= 2);

/** One TICK_DT step: gearbox and steering once, then SUB physics sub-steps. */
export function stepCar(car: Car, input: DriveInput, t: Track, assists: Assists = DEFAULT_ASSISTS) {
  const sp = car.spec;
  car.hit = 0;
  rot(car.q, 0, 0, -1, fwd);
  rot(car.q, 1, 0, 0, right);
  const vf = car.v.x * fwd.x + car.v.y * fwd.y + car.v.z * fwd.z;
  const vr = car.v.x * right.x + car.v.y * right.y + car.v.z * right.z;
  const speed = Math.hypot(car.v.x, car.v.y, car.v.z);

  // In auto, holding the brake at a standstill selects reverse; the pedals then swap (Forza-style).
  let throttle = clamp01(input.throttle);
  let brake = clamp01(input.brake);
  if (assists.auto) {
    if (car.gear >= 1 && brake > 0.3 && throttle < 0.05 && Math.abs(vf) < 0.8) {
      car.stopTime += TICK_DT;
      if (car.stopTime > 0.25) {
        car.gear = -1;
        car.stopTime = 0;
      }
    } else if (car.gear === -1 && throttle > 0.3 && vf > -0.8) car.gear = 1;
    else car.stopTime = 0;
    if (car.gear === -1) [throttle, brake] = [brake, throttle];
  } else {
    if (input.shiftUp && car.gear < sp.gears.length) {
      car.gear = car.gear === -1 ? 0 : car.gear + 1;
      car.shift = car.gear > 1 ? sp.shiftTime : 0;
    }
    if (input.shiftDown && car.gear > -1) {
      if (car.gear > 1) {
        car.gear--;
        car.shift = sp.shiftTime * 0.7;
      } else if (car.gear === 1) car.gear = 0;
      else if (Math.abs(vf) < 2) car.gear = -1;
    }
  }
  if (assists.auto) autoShift(car, throttle);
  car.shift = Math.max(0, car.shift - TICK_DT);

  // Steering: less lock at speed, and with the assist the wheels follow a slide.
  const lim = sp.steer / (1 + (speed / 24) ** 2);
  let target = clamp(input.steer, -1, 1) * lim;
  if (assists.steer && speed > 4 && car.gear >= 0) {
    const beta = Math.atan2(vr, Math.max(1, Math.abs(vf)));
    target += clamp(beta, -0.45, 0.45) * 0.75;
  }
  target = clamp(target, -sp.steer, sp.steer);
  car.steer += clamp(target - car.steer, -STEER_RATE * TICK_DT, STEER_RATE * TICK_DT);

  car.tcsOn = false;
  car.absOn = false;
  for (let k = 0; k < SUB; k++) substep(car, t, throttle, brake, clamp01(input.handbrake), assists);

  // Auto-reset when stuck on the roof or side.
  rot(car.q, 0, 1, 0, up);
  car.upsideDown = up.y < 0.25 && speed < 3 ? car.upsideDown + TICK_DT : 0;
  if (car.upsideDown > 2.5) resetCar(car, t);
}

function autoShift(car: Car, throttle: number) {
  const sp = car.spec;
  if (car.shift > 0 || car.gear < 1) return;
  const n = sp.gears.length;
  const grounded = car.wheels.some((w) => w.contact);
  if (car.gear < n && car.rpm > sp.redline * 0.955 && grounded) {
    car.gear++;
    car.shift = sp.shiftTime;
    return;
  }
  if (car.gear > 1) {
    const lower = (car.rpm * sp.gears[car.gear - 2]) / sp.gears[car.gear - 1];
    // Off the throttle (braking for a bend) it drops gears early, so you leave the corner in the power band.
    const lugging = car.rpm < sp.idle + (sp.peakRpm - sp.idle) * (throttle > 0.8 ? 0.85 : 0.6);
    if (lower < sp.redline * 0.82 && lugging) {
      car.gear--;
      car.shift = sp.shiftTime * 0.7;
    }
  }
}

function substep(car: Car, t: Track, throttleIn: number, brake: number, handbrake: number, assists: Assists) {
  const sp = car.spec;
  const m = sp.mass;
  const q = car.q;
  rot(q, 1, 0, 0, right);
  rot(q, 0, 1, 0, up);
  rot(q, 0, 0, -1, fwd);
  let Fx = 0;
  let Fy = -m * G;
  let Fz = 0;
  let Tx = 0;
  let Ty = 0;
  let Tz = 0;
  const p = car.p;
  const addForce = (fx: number, fy: number, fz: number, px: number, py: number, pz: number) => {
    Fx += fx;
    Fy += fy;
    Fz += fz;
    const rx = px - p.x;
    const ry = py - p.y;
    const rz = pz - p.z;
    Tx += ry * fz - rz * fy;
    Ty += rz * fx - rx * fz;
    Tz += rx * fy - ry * fx;
  };

  // --- Suspension: find each wheel's ground, then spring + damper + anti-roll
  const len = sp.rest + sp.radius;
  for (let i = 0; i < 4; i++) {
    const a = i < 2 ? 0 : 1;
    const lx = (i % 2 === 0 ? -0.5 : 0.5) * sp.track;
    const lz = a === 0 ? -sp.axleF : sp.axleR;
    rot(q, lx, sp.mountY[a], lz, mount);
    const mt = mounts[i];
    mt.x = p.x + mount.x;
    mt.y = p.y + mount.y;
    mt.z = p.z + mount.z;
    const g = groundAt(t, mt.x, mt.z, grounds[i]);
    // Ray along -up meets the ground's tangent plane at distance d.
    const denom = g.nx * up.x + g.ny * up.y + g.nz * up.z;
    hasHit[i] = false;
    if (denom > 0.2) {
      const d = (g.ny * (mt.y - g.h)) / denom;
      if (d < len && d > -sp.radius) {
        dists[i] = d;
        hasHit[i] = true;
      }
    }
  }
  const comps = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) comps[i] = hasHit[i] ? len - dists[i] : 0;
  for (let i = 0; i < 4; i++) {
    const wh = car.wheels[i];
    const a = i < 2 ? 0 : 1;
    const comp = comps[i];
    const rate = (comp - wh.comp) / H;
    wh.comp = comp;
    wh.contact = hasHit[i];
    if (!hasHit[i]) {
      wh.load = 0;
      wh.slip = 0;
      wh.sx *= 0.9;
      wh.sy *= 0.9;
      continue;
    }
    let fs = sp.k[a] * comp + sp.c[a] * (rate > 0 ? 1 : 1.35) * rate;
    if (comp > sp.travel) fs += sp.k[a] * 9 * (comp - sp.travel) + sp.c[a] * 2 * Math.max(0, rate);
    const other = i % 2 === 0 ? i + 1 : i - 1;
    fs += sp.arb[a] * (comp - comps[other]);
    fs = Math.max(0, fs);
    const mt = mounts[i];
    addForce(up.x * fs, up.y * fs, up.z * fs, mt.x, mt.y, mt.z);
    const g = grounds[i];
    wh.load = fs * Math.max(0, g.nx * up.x + g.ny * up.y + g.nz * up.z);
    wh.surf = g.surf;
  }

  // --- Drivetrain: engine speed, clutch, torque to the driven wheels
  const ratio = gearRatio(sp, car.gear);
  let nDriven = 0;
  let wSum = 0;
  for (let i = 0; i < 4; i++)
    if (driven(sp, i)) {
      nDriven++;
      wSum += car.wheels[i].w;
    }
  const wheelW = wSum / nDriven;
  const tau = Math.PI * 2;
  let throttle = throttleIn * (1 - car.tcsCut);
  if (car.rpm > sp.redline) throttle = 0; // limiter
  let driveT = 0;
  let coupled = false;
  if (ratio !== 0 && car.shift <= 0) {
    const wheelRpm = (wheelW * ratio * 60) / tau;
    // Launch revs follow the pedal (the driver holds them), not traction control's cut.
    const launch = sp.idle + throttleIn * (Math.min(sp.peakRpm, sp.redline * 0.6) - sp.idle);
    if (wheelRpm < launch && wheelRpm < sp.peakRpm) {
      // Clutch slipping: the engine sits at its launch revs and passes its torque on.
      car.rpm += (Math.max(launch, sp.idle) - car.rpm) * Math.min(1, H * 10);
      driveT = throttle > 0.01 ? torqueAt(sp, car.rpm) * throttle * ratio * 0.9 : 0;
    } else {
      coupled = true;
      car.rpm = Math.max(sp.idle * 0.8, wheelRpm);
      const engine = torqueAt(sp, car.rpm) * throttle - (1 - throttleIn) * (12 + car.rpm * 0.006) * (sp.cyl / 6 + 0.4);
      driveT = engine * ratio * 0.9;
    }
  } else {
    const target = car.shift > 0 ? car.rpm * 0.985 : sp.idle + throttle * (sp.redline - sp.idle);
    car.rpm += (target - car.rpm) * Math.min(1, H * (car.shift > 0 ? 6 : 5));
  }
  car.load = throttle;

  // Split between the axles (AWD) and across each axle with a limited-slip diff.
  const axleT = sp.drive === 'AWD' ? [driveT * sp.awdFront, driveT * (1 - sp.awdFront)] : sp.drive === 'FWD' ? [driveT, 0] : [0, driveT];
  const wheelT = [0, 0, 0, 0];
  for (let a = 0; a < 2; a++) {
    if (axleT[a] === 0) continue;
    const L = a * 2;
    const R = L + 1;
    const lock = clamp(sp.diff * LSD_GAIN * (car.wheels[L].w - car.wheels[R].w), -Math.abs(axleT[a]) * 0.45 - 150, Math.abs(axleT[a]) * 0.45 + 150);
    wheelT[L] = axleT[a] / 2 - lock;
    wheelT[R] = axleT[a] / 2 + lock;
  }
  const engineI = coupled ? (sp.engineInertia * ratio * ratio) / nDriven : 0;

  // --- Tyres
  let wantCut = 0;
  for (let i = 0; i < 4; i++) {
    const wh = car.wheels[i];
    const a = i < 2 ? 0 : 1;
    const isDriven = driven(sp, i);
    let brakeT = brake * sp.brake * (a === 0 ? sp.bias : 1 - sp.bias) * 0.5;
    if (a === 1) brakeT += handbrake * sp.handbrake;
    wh.fx = 0;
    if (wh.contact) {
      const g = grounds[i];
      const mt = mounts[i];
      const d = dists[i];
      const cx = mt.x - up.x * d;
      const cy = mt.y - up.y * d;
      const cz = mt.z - up.z * d;
      // Wheel heading, steered (fronts) and laid on the ground plane.
      const st = a === 0 ? car.steer : 0;
      const cs = Math.cos(st);
      const sn = Math.sin(st);
      let hx = fwd.x * cs + right.x * sn;
      let hy = fwd.y * cs + right.y * sn;
      let hz = fwd.z * cs + right.z * sn;
      const dn = hx * g.nx + hy * g.ny + hz * g.nz;
      hx -= g.nx * dn;
      hy -= g.ny * dn;
      hz -= g.nz * dn;
      const hl = Math.hypot(hx, hy, hz) || 1;
      hx /= hl;
      hy /= hl;
      hz /= hl;
      // side = heading × normal (points right)
      const sx = hy * g.nz - hz * g.ny;
      const sy = hz * g.nx - hx * g.nz;
      const sz = hx * g.ny - hy * g.nx;
      // Contact point velocity.
      const rx = cx - p.x;
      const ry = cy - p.y;
      const rz = cz - p.z;
      const w = car.w;
      const pvx = car.v.x + (w.y * rz - w.z * ry);
      const pvy = car.v.y + (w.z * rx - w.x * rz);
      const pvz = car.v.z + (w.x * ry - w.y * rx);
      const vx = pvx * hx + pvy * hy + pvz * hz;
      const vy = pvx * sx + pvy * sy + pvz * sz;
      const avx = Math.abs(vx);
      // Slip with relaxation (implicit, so it's stable at any speed).
      wh.sx = (wh.sx + ((wh.w * sp.radius - vx) / RELAX_X) * H) / (1 + (avx / RELAX_X) * H);
      wh.sy = (wh.sy + (vy / RELAX_Y) * H) / (1 + (avx / RELAX_Y) * H);
      wh.sx = clamp(wh.sx, -3, 3);
      wh.sy = clamp(wh.sy, -3, 3);
      const nx = wh.sx / SLIP_PEAK_X;
      const ny = Math.atan(wh.sy) / SLIP_PEAK_Y;
      const rho = Math.hypot(nx, ny);
      const surf = SURF[wh.surf];
      const loadSens = 1 - 0.08 * (wh.load / ((m * G) / 4) - 1);
      const D = sp.grip * surf.mu * wh.load * clamp(loadSens, 0.75, 1.1);
      let fx = 0;
      let fy = 0;
      if (rho > 1e-6) {
        const mag = D * Math.sin(TIRE_C * Math.atan(TIRE_B * rho));
        fx = (mag * nx) / rho;
        fy = (-mag * ny) / rho;
      }
      // Low-speed damping: near a standstill the relaxation is an undamped spring (wheel against tyre,
      // car against tyre), so without this a stopped car rings instead of settling.
      const slow = Math.max(0, 1 - avx / 3);
      fy = clamp(fy - slow * vy * wh.load * 0.3, -D, D);
      fx = clamp(fx + slow * (wh.w * sp.radius - vx) * wh.load * 0.8, -D, D);
      wh.slip = rho;
      wh.fx = fx;
      const ax = cx + up.x * ROLL_HEIGHT;
      const ay = cy + up.y * ROLL_HEIGHT;
      const az = cz + up.z * ROLL_HEIGHT;
      addForce(hx * fx + sx * fy, hy * fx + sy * fy, hz * fx + sz * fy, ax, ay, az);
      // Rolling resistance acts on the wheel like a light brake.
      brakeT += surf.roll * wh.load * sp.radius;
      // ABS and traction control watch the real slip (wheel surface speed against the ground) and back off
      // in proportion, holding the tyre near its peak rather than pumping.
      const spin = wh.w * sp.radius - vx;
      const allowed = 0.6 + SLIP_PEAK_X * 1.15 * avx;
      if (assists.abs && brake > 0.05 && -spin > allowed && avx > 2) {
        brakeT *= Math.max(0.1, 1 - (-spin - allowed) / allowed);
        car.absOn = true;
      }
      if (isDriven && throttleIn > 0.05 && spin > allowed) wantCut = Math.max(wantCut, Math.min(1, (spin - allowed) / allowed));
    } else brakeT += 4;
    // Wheel spin.
    const I = sp.wheelInertia + (isDriven ? engineI : 0);
    let ww = wh.w + ((wheelT[i] - wh.fx * sp.radius) / I) * H;
    const dw = (brakeT / I) * H;
    if (Math.abs(ww) <= dw) ww = 0;
    else ww -= Math.sign(ww) * dw;
    wh.w = ww;
    wh.angle = (wh.angle + ww * H) % (Math.PI * 2);
  }
  // Traction control eases the throttle while driven wheels spin up.
  if (assists.tcs && wantCut > 0) {
    car.tcsCut = Math.min(1, car.tcsCut + wantCut * H * 40);
    car.tcsOn = true;
  } else car.tcsCut = Math.max(0, car.tcsCut - H * 5);

  // --- Aero
  const v = car.v;
  const speed = Math.hypot(v.x, v.y, v.z);
  const drag = 0.5 * RHO * sp.cdA * speed;
  Fx -= drag * v.x;
  Fy -= drag * v.y;
  Fz -= drag * v.z;
  const vf = v.x * fwd.x + v.y * fwd.y + v.z * fwd.z;
  if (vf > 0) {
    const down = 0.5 * RHO * sp.clA * vf * vf;
    rot(q, 0, 0, -sp.axleF, tmp);
    addForce(-up.x * down * sp.aeroFront, -up.y * down * sp.aeroFront, -up.z * down * sp.aeroFront, p.x + tmp.x, p.y + tmp.y, p.z + tmp.z);
    rot(q, 0, 0, sp.axleR, tmp);
    const r = 1 - sp.aeroFront;
    addForce(-up.x * down * r, -up.y * down * r, -up.z * down * r, p.x + tmp.x, p.y + tmp.y, p.z + tmp.z);
  }

  // --- Body against the ground (bottoming out, rolling over)
  const b = sp.body;
  const kc = m * 420;
  const cc = m * 28;
  const gh = heightAt(t, p.x, p.z);
  if (p.y - gh < 3.2) {
    for (let c = 0; c < 8; c++) {
      rot(q, c & 1 ? b.hw : -b.hw, c & 2 ? b.y1 : b.y0, c & 4 ? b.hl : -b.hl, tmp);
      const px = p.x + tmp.x;
      const py = p.y + tmp.y;
      const pz = p.z + tmp.z;
      const h = heightAt(t, px, pz);
      const pen = h - py;
      if (pen <= 0) continue;
      const w = car.w;
      const pvx = v.x + (w.y * tmp.z - w.z * tmp.y);
      const pvy = v.y + (w.z * tmp.x - w.x * tmp.z);
      const pvz = v.z + (w.x * tmp.y - w.y * tmp.x);
      const fn = Math.max(0, kc * pen - cc * pvy);
      const ht = Math.hypot(pvx, pvz) || 1;
      const mu = 0.55;
      addForce((-pvx / ht) * fn * mu, fn, (-pvz / ht) * fn * mu, px, py, pz);
      if (-pvy > 2) car.hit = Math.max(car.hit, -pvy);
    }
  }

  // --- Integrate
  const im = 1 / m;
  v.x += Fx * im * H;
  v.y += Fy * im * H;
  v.z += Fz * im * H;
  const w = car.w;
  rotInv(q, Tx, Ty, Tz, tmp);
  const [Ix, Iy, Iz] = sp.inertia;
  const lw = rotInv(q, w.x, w.y, w.z, { x: 0, y: 0, z: 0 });
  // Euler's equations (gyroscopic term included; it matters for a spinning, tumbling car).
  lw.x += ((tmp.x - (Iz - Iy) * lw.y * lw.z) / Ix) * H;
  lw.y += ((tmp.y - (Ix - Iz) * lw.z * lw.x) / Iy) * H;
  lw.z += ((tmp.z - (Iy - Ix) * lw.x * lw.y) / Iz) * H;
  rot(q, lw.x, lw.y, lw.z, w);
  p.x += v.x * H;
  p.y += v.y * H;
  p.z += v.z * H;
  integrateQuat(q, w, H);

  // --- Barriers
  locate(t, p.x, p.z, car.hint, loc);
  car.hint = loc.i;
  car.s = loc.s;
  car.d = loc.d;
  barrier(car, t);
}

function integrateQuat(q: Quat, w: V3, h: number) {
  const hx = w.x * 0.5 * h;
  const hy = w.y * 0.5 * h;
  const hz = w.z * 0.5 * h;
  const x = q.x + (hx * q.w + hy * q.z - hz * q.y);
  const y = q.y + (hy * q.w + hz * q.x - hx * q.z);
  const z = q.z + (hz * q.w + hx * q.y - hy * q.x);
  const ww = q.w - (hx * q.x + hy * q.y + hz * q.z);
  const l = Math.hypot(x, y, z, ww);
  q.x = x / l;
  q.y = y / l;
  q.z = z / l;
  q.w = ww / l;
}

/** Applies an impulse j (world) at offset r from the CG. */
function impulse(car: Car, jx: number, jy: number, jz: number, rx: number, ry: number, rz: number) {
  const im = 1 / car.spec.mass;
  car.v.x += jx * im;
  car.v.y += jy * im;
  car.v.z += jz * im;
  const t = rotInv(car.q, ry * jz - rz * jy, rz * jx - rx * jz, rx * jy - ry * jx, { x: 0, y: 0, z: 0 });
  const [Ix, Iy, Iz] = car.spec.inertia;
  const d = rot(car.q, t.x / Ix, t.y / Iy, t.z / Iz, { x: 0, y: 0, z: 0 });
  car.w.x += d.x;
  car.w.y += d.y;
  car.w.z += d.z;
}

/** Effective inverse mass at offset r along direction n (for impulses at a point). */
function invMassAt(car: Car, rx: number, ry: number, rz: number, nx: number, ny: number, nz: number): number {
  const cx = ry * nz - rz * ny;
  const cy = rz * nx - rx * nz;
  const cz = rx * ny - ry * nx;
  const l = rotInv(car.q, cx, cy, cz, { x: 0, y: 0, z: 0 });
  const [Ix, Iy, Iz] = car.spec.inertia;
  return 1 / car.spec.mass + (l.x * l.x) / Ix + (l.y * l.y) / Iy + (l.z * l.z) / Iz;
}

const RESTITUTION = 0.22;
const WALL_FRICTION = 0.35;

/** Rails either side of the road, and the walls across both ends: the corner that went through is pushed back. */
function barrier(car: Car, t: Track) {
  const sp = car.spec;
  const rx = -loc.tz;
  const rz = loc.tx;
  let worst = 0;
  let wx = 0;
  let wz = 0;
  let nx = 0;
  let nz = 0;
  for (let c = 0; c < 4; c++) {
    rot(car.q, c & 1 ? sp.body.hw : -sp.body.hw, 0, c & 2 ? sp.body.hl : -sp.body.hl, tmp);
    const px = car.p.x + tmp.x - loc.cx;
    const pz = car.p.z + tmp.z - loc.cz;
    const d = px * rx + pz * rz;
    const along = px * loc.tx + pz * loc.tz + loc.s;
    let pen = Math.abs(d) - t.rail;
    let cnx = -Math.sign(d) * rx;
    let cnz = -Math.sign(d) * rz;
    const back = 3 - along;
    const ahead = along - (t.length - 3);
    if (back > pen) {
      pen = back;
      cnx = loc.tx;
      cnz = loc.tz;
    }
    if (ahead > pen) {
      pen = ahead;
      cnx = -loc.tx;
      cnz = -loc.tz;
    }
    if (pen > worst) {
      worst = pen;
      wx = tmp.x;
      wz = tmp.z;
      nx = cnx;
      nz = cnz;
    }
  }
  if (worst <= 0) return;
  car.p.x += nx * worst;
  car.p.z += nz * worst;
  const w = car.w;
  const vx = car.v.x + w.y * wz;
  const vz = car.v.z - w.y * wx;
  const vn = vx * nx + vz * nz;
  if (vn >= 0) return;
  const k = invMassAt(car, wx, 0, wz, nx, 0, nz);
  const j = (-(1 + RESTITUTION) * vn) / k;
  // Scrape: friction along the rail, capped so it never reverses the slide.
  const tx = vx - vn * nx;
  const tz = vz - vn * nz;
  const tl = Math.hypot(tx, tz);
  let fx = 0;
  let fz = 0;
  if (tl > 1e-3) {
    const kt = invMassAt(car, wx, 0, wz, tx / tl, 0, tz / tl);
    const jt = Math.min(WALL_FRICTION * j, tl / kt);
    fx = (-tx / tl) * jt;
    fz = (-tz / tl) * jt;
  }
  impulse(car, nx * j + fx, 0, nz * j + fz, wx, 0, wz);
  car.hit = Math.max(car.hit, -vn);
}

/**
 * Car against car: two circles per car (nose and tail). `b` may be a remote car we can't push
 * (`bMovable` false): then only `a` takes the impulse, as if bouncing off an equal mass.
 */
export function collideCars(a: Car, b: Car, bMovable: boolean) {
  const dx0 = b.p.x - a.p.x;
  const dz0 = b.p.z - a.p.z;
  if (dx0 * dx0 + dz0 * dz0 > 49 || Math.abs(b.p.y - a.p.y) > 2.5) return;
  const ca = circles(a);
  const cb = circles(b);
  const ra = a.spec.body.hw;
  const rb = b.spec.body.hw;
  for (const pa of ca)
    for (const pb of cb) {
      const dx = pb.x - pa.x;
      const dz = pb.z - pa.z;
      const dist = Math.hypot(dx, dz);
      const pen = ra + rb - dist;
      if (pen <= 0 || dist < 1e-4) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      // Separate.
      const share = bMovable ? 0.5 : 1;
      a.p.x -= nx * pen * share;
      a.p.z -= nz * pen * share;
      if (bMovable) {
        b.p.x += nx * pen * 0.5;
        b.p.z += nz * pen * 0.5;
      }
      // Contact point halfway between the circles.
      const cx = pa.x + nx * ra;
      const cz = pa.z + nz * ra;
      const rax = cx - a.p.x;
      const raz = cz - a.p.z;
      const rbx = cx - b.p.x;
      const rbz = cz - b.p.z;
      const vax = a.v.x + a.w.y * raz;
      const vaz = a.v.z - a.w.y * rax;
      const vbx = b.v.x + b.w.y * rbz;
      const vbz = b.v.z - b.w.y * rbx;
      const vn = (vbx - vax) * nx + (vbz - vaz) * nz;
      if (vn >= 0) continue;
      const ka = invMassAt(a, rax, 0, raz, nx, 0, nz);
      const kb = invMassAt(b, rbx, 0, rbz, nx, 0, nz);
      const j = (-(1 + 0.3) * vn) / (ka + kb);
      impulse(a, -nx * j, 0, -nz * j, rax, 0, raz);
      if (bMovable) impulse(b, nx * j, 0, nz * j, rbx, 0, rbz);
      a.hit = Math.max(a.hit, -vn);
      b.hit = Math.max(b.hit, -vn);
    }
}

function circles(c: Car): V3[] {
  const off = c.spec.body.hl - c.spec.body.hw;
  rot(c.q, 0, 0, -1, tmp);
  const fx = tmp.x;
  const fz = tmp.z;
  return [
    { x: c.p.x + fx * off, y: c.p.y, z: c.p.z + fz * off },
    { x: c.p.x - fx * off, y: c.p.y, z: c.p.z - fz * off },
  ];
}

/** Where wheel i's centre is, in body space, for drawing. */
export function wheelLocal(car: Car, i: number): V3 {
  const sp = car.spec;
  const a = i < 2 ? 0 : 1;
  const ext = car.wheels[i].contact ? sp.rest - car.wheels[i].comp : sp.rest;
  return { x: (i % 2 === 0 ? -0.5 : 0.5) * sp.track, y: sp.mountY[a] - Math.max(-0.05, ext), z: a === 0 ? -sp.axleF : sp.axleR };
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const clamp01 = (x: number) => clamp(x, 0, 1);
