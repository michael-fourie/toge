// The driver's head for the cockpit camera: a head on a neck (a damped spring per axis) thrown around by
// what the car does, plus the shake you feel through the seat. Pure numbers (no three.js), so it's tested.
//
// Frames: everything is in the car's own frame as the driver sees it. Offsets in metres: lat + = right,
// up + = up, fwd + = toward the nose. Angles in radians, in three.js camera terms: pitch + = look up,
// yaw + = look left, roll + = head tilts left (the horizon tilts right).

export interface HeadInput {
  /** Acceleration of the car in its own frame (m/s^2): lat + = right, up + = up, fwd + = forward. */
  aLat: number;
  aUp: number;
  aFwd: number;
  /** Speed (m/s), yaw rate (rad/s, + = turning left) and slip angle (rad, + = travelling right of the nose). */
  speed: number;
  yawRate: number;
  slip: number;
  /** Body roll against the horizon (rad, + = rolled left), for the driver's level-the-eyes reflex. */
  bodyRoll: number;
  /** How rough the ground under the tyres is: 1 = asphalt, more on gravel and grass, 0 = airborne. */
  rough: number;
  /** Strongest impact this frame (m/s) and the hardest landing (m/s). */
  hit: number;
  land: number;
  /** Engine speed as a fraction of the redline, for a faint buzz through the wheel. */
  rev: number;
  boost: boolean;
}

export interface HeadPose {
  lat: number;
  up: number;
  fwd: number;
  pitch: number;
  yaw: number;
  roll: number;
  /** Extra field of view (degrees): a touch wider with speed and under boost. */
  fov: number;
}

/** How rough each surface feels through the seat, relative to asphalt. */
export const ROUGH: Record<string, number> = { asphalt: 1, shoulder: 1.6, gravel: 3.2, dirt: 3.6, grass: 4 };

/** Neck spring per axis: natural frequency (rad/s), damping ratio, and how far (m) a hard push can move the head. */
const NECK = {
  lat: { w: 13, z: 0.55, max: 0.06, scale: 16 },
  up: { w: 9, z: 0.32, max: 0.035, scale: 14 },
  fwd: { w: 14, z: 0.6, max: 0.055, scale: 13 },
};
/** Head angles from where the neck has moved it (rad per metre). */
const NOD = 1.4;
const TILT = 2.2;
/** The share of body roll the driver cancels by holding their eyes level. */
const LEVEL = 0.35;
/** Look into the corner: by yaw rate (s) and toward the direction of travel (share of the slip angle), capped. */
const LOOK_RATE = 0.16;
const LOOK_SLIP = 0.45;
const LOOK_MAX = 0.42;
/** Seat shake: road texture (m and rad at RUMBLE_SPEED on asphalt), engine buzz, and impact trauma. */
const RUMBLE_M = 0.0013;
const RUMBLE_RAD = 0.0029;
const RUMBLE_SPEED = 40;
const BUZZ_M = 0.00035;
const TRAUMA_M = 0.035;
const TRAUMA_RAD = 0.05;
const TRAUMA_DECAY = 1.6;
/** Longest step the springs take at once, so a hitch in the frame rate can't blow them up. */
const MAX_STEP = 1 / 120;

/** Smooth noise in [-1, 1]: a few sines at unrelated frequencies. */
function wobble(t: number, seed: number): number {
  return (Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.77 + seed * 2.9) * 0.2);
}

export class Head {
  private x = { lat: 0, up: 0, fwd: 0 };
  private v = { lat: 0, up: 0, fwd: 0 };
  private look = 0;
  /** 0..1, from impacts and landings; the shake goes with its square, so small knocks stay small. */
  trauma = 0;
  /** Phase clocks for the road rumble (runs faster with speed), the engine and the trauma shake. */
  private road = 0;
  private engine = 0;
  private clock = 0;
  private fov = 0;

  reset() {
    this.x = { lat: 0, up: 0, fwd: 0 };
    this.v = { lat: 0, up: 0, fwd: 0 };
    this.look = 0;
    this.trauma = 0;
    this.fov = 0;
  }

  update(dt: number, i: HeadInput): HeadPose {
    dt = Math.max(0, Math.min(dt, 0.1));
    // Inertia: the car accelerates and the head lags, so it moves against the acceleration. Hard pushes saturate
    // (your neck braces), so a 3 g arcade corner doesn't throw the view across the cabin.
    const push = { lat: i.aLat, up: i.aUp, fwd: i.aFwd };
    for (let left = dt; left > 1e-6; left -= MAX_STEP) {
      const h = Math.min(MAX_STEP, left);
      for (const k of ['lat', 'up', 'fwd'] as const) {
        const n = NECK[k];
        const target = -n.max * Math.tanh(push[k] / n.scale);
        const acc = n.w * n.w * (target - this.x[k]) - 2 * n.z * n.w * this.v[k];
        this.v[k] += acc * h;
        this.x[k] += this.v[k] * h;
      }
    }
    // Knocks: a hit throws the head back and sideways, a landing drops it, and both leave the cabin shaking.
    if (i.hit > 0.5) {
      this.v.fwd -= Math.min(1.2, i.hit * 0.05);
      this.v.lat += (Math.sin(this.clock * 13.7) > 0 ? 1 : -1) * Math.min(0.6, i.hit * 0.025);
      this.trauma = Math.min(1, this.trauma + i.hit * 0.05);
    }
    if (i.land > 1) {
      this.v.up -= Math.min(1.5, i.land * 0.12);
      this.trauma = Math.min(1, this.trauma + i.land * 0.06);
    }
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);

    // Where the eyes go: into the corner and, in a slide, toward where the car is actually going.
    const fade = Math.min(1, i.speed / 8);
    const want = Math.max(-LOOK_MAX, Math.min(LOOK_MAX, (i.yawRate * LOOK_RATE - i.slip * LOOK_SLIP) * fade));
    this.look += (want - this.look) * (1 - Math.exp(-dt * 4));

    // Shake. Road texture gets busier and stronger with speed and on loose ground; the engine buzzes faintly.
    const sp = Math.min(1.4, i.speed / RUMBLE_SPEED);
    this.road += dt * (9 + Math.min(16, i.speed * 0.35)) * Math.PI * 2;
    this.engine += dt * (25 + i.rev * 45) * Math.PI * 2;
    this.clock += dt;
    const rumble = sp * i.rough;
    const buzz = BUZZ_M * i.rev * (i.speed < 1 ? 1.5 : 0.6);
    const t2 = this.trauma * this.trauma;
    const tc = this.clock * 32;
    const up = this.x.up + rumble * RUMBLE_M * wobble(this.road, 0.3) + buzz * Math.sin(this.engine) + t2 * TRAUMA_M * wobble(tc, 2.1);
    const lat = this.x.lat + rumble * RUMBLE_M * 0.5 * wobble(this.road * 0.83, 4.2) + t2 * TRAUMA_M * wobble(tc * 0.9, 5.3);
    const fwd = this.x.fwd + t2 * TRAUMA_M * 0.5 * wobble(tc * 1.1, 7.7);
    const pitch = -this.x.fwd * NOD + rumble * RUMBLE_RAD * wobble(this.road * 1.13, 1.1) + t2 * TRAUMA_RAD * wobble(tc * 1.2, 3.4);
    const roll = -this.x.lat * TILT - i.bodyRoll * LEVEL + rumble * RUMBLE_RAD * 0.6 * wobble(this.road * 0.71, 6.6) + t2 * TRAUMA_RAD * wobble(tc * 0.8, 8.8);
    const yaw = this.look + t2 * TRAUMA_RAD * 0.6 * wobble(tc * 0.7, 9.9);
    const fovWant = Math.min(7, i.speed * 0.09) + (i.boost ? 5 : 0);
    this.fov += (fovWant - this.fov) * (1 - Math.exp(-dt * 3));
    return { lat, up, fwd, pitch, yaw, roll, fov: this.fov };
  }
}
