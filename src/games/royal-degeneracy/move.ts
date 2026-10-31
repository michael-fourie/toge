// The first-person walker on Gambol's collision (src/shared/collision.ts, imported as-is): walk, crouch, jump,
// stairs (walkable ramps), snapping down steps; no bhop, no air control. Ghosts fly through everything. Also the
// gentle nudge apart when players overlap, and the shove's stagger. Pure: no three.js, no DOM.

import { moveAndCollide, newContacts, snapToGround, type Box } from '../../shared/collision.ts';
import { yawForward, yawRight, type Vec3 } from '../../shared/math.ts';

export const WALK = {
  speed: 3.2,
  crouch: 1.4,
  ghost: 4.2,
  /** Ground acceleration toward the wanted velocity (m/s²): snappy, house-sized. */
  accel: 28,
  airAccel: 4,
  gravity: 16,
  jump: 4.2,
  /** How far down a step or the top of a stair you stick to the floor instead of falling. */
  snap: 0.35,
  /** Players closer than this (m, centre to centre) drift apart. */
  personal: 0.6,
  nudge: 0.9,
  /** A shove: this speed for this long, about half a metre of stagger. */
  shoveSpeed: 2.2,
  shoveTime: 0.24,
};

export interface Walker {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  crouch: boolean;
  onGround: boolean;
  ghost: boolean;
  /** A shove in progress: direction × speed, and seconds left. */
  push: Vec3;
  pushLeft: number;
}

export interface WalkInput {
  /** -1..1 each: forward and right. */
  fwd: number;
  side: number;
  jump: boolean;
  crouch: boolean;
  /** Ghosts: Space rises, crouch sinks. */
  up: boolean;
  /** Bongus Mode and friends (1 = normal). */
  speedMult?: number;
}

export const newWalker = (pos: Vec3, yaw = 0): Walker => ({
  pos: { ...pos },
  vel: { x: 0, y: 0, z: 0 },
  yaw,
  pitch: 0,
  crouch: false,
  onGround: true,
  ghost: false,
  push: { x: 0, y: 0, z: 0 },
  pushLeft: 0,
});

const contacts = newContacts();
const fwd = { x: 0, y: 0, z: 0 };
const right = { x: 0, y: 0, z: 0 };

/** Where the input wants to go, on the horizontal plane (length ≤ 1). */
function wish(w: Walker, inp: WalkInput) {
  yawForward(w.yaw, fwd);
  yawRight(w.yaw, right);
  let x = fwd.x * inp.fwd + right.x * inp.side;
  let z = fwd.z * inp.fwd + right.z * inp.side;
  const l = Math.hypot(x, z);
  if (l > 1) {
    x /= l;
    z /= l;
  }
  return { x, z };
}

/** Bounds a ghost can float in: the house and its yards. */
const GHOST_BOUNDS = { min: { x: -1.2, y: -0.5, z: -10 }, max: { x: 10.8, y: 8.6, z: 29 } };

export function stepWalker(w: Walker, inp: WalkInput, dt: number, boxes: readonly Box[]) {
  const d = wish(w, inp);
  if (w.ghost) {
    const s = WALK.ghost * (inp.speedMult ?? 1);
    w.pos.x += d.x * s * dt;
    w.pos.z += d.z * s * dt;
    w.pos.y += ((inp.up ? 1 : 0) - (inp.crouch ? 1 : 0)) * s * 0.7 * dt;
    for (const k of ['x', 'y', 'z'] as const) w.pos[k] = Math.min(GHOST_BOUNDS.max[k], Math.max(GHOST_BOUNDS.min[k], w.pos[k]));
    w.vel.x = w.vel.y = w.vel.z = 0;
    w.crouch = false;
    w.onGround = false;
    return;
  }
  w.crouch = inp.crouch;
  const speed = (w.crouch ? WALK.crouch : WALK.speed) * (inp.speedMult ?? 1);
  const a = (w.onGround ? WALK.accel : WALK.airAccel) * dt;
  for (const [k, target] of [
    ['x', d.x * speed],
    ['z', d.z * speed],
  ] as const) {
    const diff = target - w.vel[k];
    w.vel[k] += Math.max(-a, Math.min(a, diff));
  }
  const jumped = inp.jump && w.onGround && !w.crouch;
  if (jumped) w.vel.y = WALK.jump;
  // Gravity half before and half after the move, like the shooter.
  w.vel.y -= WALK.gravity * dt * 0.5;
  // A shove rides on top of walking for a moment (and never through a wall: it's moved with the rest).
  const px = w.pushLeft > 0 ? w.push.x : 0;
  const pz = w.pushLeft > 0 ? w.push.z : 0;
  w.pushLeft = Math.max(0, w.pushLeft - dt);
  const vx = w.vel.x;
  const vz = w.vel.z;
  w.vel.x += px;
  w.vel.z += pz;
  const wasGround = w.onGround;
  moveAndCollide(w.pos, w.vel, dt, boxes, contacts);
  // Take the push back out of the velocity (keep whatever the walls cut off).
  w.vel.x = Math.abs(w.vel.x) < 1e-9 ? 0 : vx;
  w.vel.z = Math.abs(w.vel.z) < 1e-9 ? 0 : vz;
  w.onGround = !!contacts.ground;
  if (!w.onGround && wasGround && !jumped && w.vel.y <= 0) w.onGround = !!snapToGround(w.pos, boxes, WALK.snap);
  if (w.onGround) w.vel.y = Math.max(0, w.vel.y);
  else w.vel.y -= WALK.gravity * dt * 0.5;
  if (w.onGround && w.vel.y < 0) w.vel.y = 0;
}

/** Players pass through each other; each client drifts its own player out of an overlap, gently. */
export function nudgeApart(w: Walker, others: readonly Vec3[], dt: number, boxes: readonly Box[]) {
  if (w.ghost) return;
  let x = 0;
  let z = 0;
  for (const o of others) {
    if (Math.abs(o.y - w.pos.y) > 1.2) continue;
    const dx = w.pos.x - o.x;
    const dz = w.pos.z - o.z;
    const l = Math.hypot(dx, dz);
    if (l >= WALK.personal) continue;
    const k = 1 - l / WALK.personal;
    // Exactly on top of each other: split along a fixed direction so both don't pick the same way.
    x += l > 1e-4 ? (dx / l) * k : k;
    z += l > 1e-4 ? (dz / l) * k : 0;
  }
  if (!x && !z) return;
  const l = Math.hypot(x, z);
  const vel = { x: (x / Math.max(1, l)) * WALK.nudge, y: 0, z: (z / Math.max(1, l)) * WALK.nudge };
  const y = w.pos.y;
  moveAndCollide(w.pos, vel, dt, boxes, contacts);
  w.pos.y = Math.max(w.pos.y, y);
}

/** Starts a shove's stagger away from `from` (horizontal). */
export function shove(w: Walker, dir: { x: number; z: number }) {
  const l = Math.hypot(dir.x, dir.z) || 1;
  w.push.x = (dir.x / l) * WALK.shoveSpeed;
  w.push.z = (dir.z / l) * WALK.shoveSpeed;
  w.pushLeft = WALK.shoveTime;
}
