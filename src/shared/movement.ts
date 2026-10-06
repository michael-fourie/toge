import { type Box, type Trigger, moveAndCollide, newContacts, probeGround, probeWall, snapToGround, touches } from './collision.ts';
import { MOVE } from './constants.ts';
import { type Vec3, addScaled, copy, dot, hlen, set, v3, yawForward, yawRight } from './math.ts';

export interface MoveInput {
  forward: number; // -1..1
  right: number; // -1..1
  jump: boolean; // held
  jumpPressed: boolean; // went down since the last tick
  slide: boolean; // held
  yaw: number;
}

export const emptyInput = (): MoveInput => ({ forward: 0, right: 0, jump: false, jumpPressed: false, slide: false, yaw: 0 });

/** Bit flags describing what happened during a tick (for sfx, camera effects, network). */
export const Ev = {
  Jump: 1,
  Land: 2,
  WallrunStart: 4,
  WallJump: 8,
  JumpPad: 16,
  SlideStart: 32,
  SlideEnd: 64,
  Boost: 128,
  Bounce: 256,
  AirJump: 512,
} as const;

export interface PlayerState {
  pos: Vec3;
  vel: Vec3;
  onGround: boolean;
  wallrunning: boolean;
  wallNormal: Vec3;
  wallrunTime: number;
  lastWallNormal: Vec3;
  wallCooldown: number;
  /** Mid-air jumps left this airtime (double jump). */
  airJumps: number;
  /** Seconds since leaving the ground. */
  airTime: number;
  /** Seconds left on a buffered jump press (lets a slightly-early press still hop on the landing tick). */
  jumpBuffer: number;
  /** Surface normal of the ground we're standing on; (0,1,0) on flat floors. Set by ground classification. */
  groundNormal: Vec3;
  sliding: boolean;
  /** Seconds until another slide may grant the entry boost (stops slide-spam speed farming). */
  slideBoostCooldown: number;
  /** A slide ended while Shift was still held; Shift must be released (or you must go airborne) to slide again. */
  slideLocked: boolean;
  /** The trigger we were inside last tick, so enter events fire once. */
  inTrigger: Trigger | null;
  events: number;
}

export function createPlayerState(pos: Vec3 = v3()): PlayerState {
  return {
    pos: { ...pos },
    vel: v3(),
    groundNormal: v3(0, 1, 0),
    sliding: false,
    slideBoostCooldown: 0,
    slideLocked: false,
    onGround: false,
    wallrunning: false,
    wallNormal: v3(),
    wallrunTime: 0,
    lastWallNormal: v3(),
    wallCooldown: 0,
    jumpBuffer: 0,
    airJumps: MOVE.airJumps,
    airTime: 0,
    inTrigger: null,
    events: 0,
  };
}

// Scratch vectors (sim is single-threaded and non-reentrant).
const fwd = v3();
const right = v3();
const wish = v3();
const tangent = v3();
const contacts = newContacts();

/** Source NON_JUMP_VELOCITY (140 u/s): moving away from the ground faster than this means airborne. */
const NON_JUMP_VELOCITY = 140 * 0.0254;
/** Source StayOnGround step (18 u): how far below us walkable ground can be and still be snapped to. */
const STEP_DOWN = 18 * 0.0254;

function accelerate(vel: Vec3, dir: Vec3, wishSpeed: number, accel: number, dt: number, cap = Infinity) {
  const current = dot(vel, dir);
  const add = Math.min(wishSpeed, cap) - current;
  if (add <= 0) return;
  addScaled(vel, dir, Math.min(accel * wishSpeed * dt, add));
}

function applyFriction(vel: Vec3, dt: number, friction = MOVE.friction) {
  const speed = hlen(vel);
  if (speed < 1e-4) return;
  const control = Math.max(speed, MOVE.stopSpeed);
  const scale = Math.max(speed - control * friction * dt, 0) / speed;
  vel.x *= scale;
  vel.z *= scale;
}

function endSlide(s: PlayerState, shiftHeld: boolean) {
  if (!s.sliding) return;
  s.sliding = false;
  s.slideLocked = shiftHeld;
  s.events |= Ev.SlideEnd;
}

/**
 * Ground movement while sliding: low friction, air-strafe-style steering (can curve, can't add
 * meaningful speed), and gravity along the slope so downhill slides speed up and uphill ones slow.
 */
function slideMove(s: PlayerState, input: MoveInput, wishAmount: number, dt: number) {
  const vel = s.vel;
  applyFriction(vel, dt, MOVE.slideFriction);
  accelerate(vel, wish, MOVE.maxGroundSpeed * wishAmount, MOVE.slideSteer, dt, MOVE.airSpeedCap);
  // Gravity projected onto the ground plane; only its horizontal part matters here
  // (the vertical part is handled by collision with the ramp). Zero on flat floors.
  const n = s.groundNormal;
  const g = MOVE.gravity * MOVE.slideSlopeGravity;
  vel.x += g * n.y * n.x * dt;
  vel.z += g * n.y * n.z * dt;
  if (hlen(vel) < MOVE.slideEndSpeed) endSlide(s, input.slide);
}

function endWallrun(s: PlayerState) {
  if (!s.wallrunning) return;
  s.wallrunning = false;
  s.lastWallNormal = { ...s.wallNormal };
  s.wallCooldown = MOVE.wallrunCooldown;
}

function land(s: PlayerState) {
  if (!s.onGround) s.events |= Ev.Land;
  s.onGround = true;
  endWallrun(s);
  s.wallCooldown = 0;
  s.airJumps = MOVE.airJumps;
  s.airTime = 0;
  set(s.lastWallNormal, 0, 0, 0);
}

/**
 * Push off a wall and up. Speed is never lost:
 * - the speed that was driving you *into* the wall bounces back out instead of being deleted by the collision,
 * - along-the-wall speed is untouched,
 * - the extra boost follows the way you're already travelling (not the keys), so it works hands-off.
 * Refreshes the double jump.
 */
function wallJump(s: PlayerState, n: Vec3, wish: Vec3) {
  const vel = s.vel;
  const into = vel.x * n.x + vel.z * n.z; // negative: moving into the wall
  const out = Math.max(MOVE.wallJumpOut, -into);
  if (into < 0) {
    vel.x -= n.x * into;
    vel.z -= n.z * into;
  }
  vel.x += n.x * out;
  vel.z += n.z * out;
  const h = hlen(vel);
  const bx = h > 0.5 ? vel.x / h : wish.x;
  const bz = h > 0.5 ? vel.z / h : wish.z;
  vel.x += bx * MOVE.wallJumpBoost;
  vel.z += bz * MOVE.wallJumpBoost;
  vel.y = Math.max(vel.y, MOVE.wallJumpUp);
  s.wallrunning = false;
  s.lastWallNormal = { ...n }; // this wall can't be kicked again until you land or use another one
  s.wallCooldown = MOVE.wallrunCooldown;
  s.airJumps = MOVE.airJumps;
  s.jumpBuffer = 0;
  s.events |= Ev.WallJump;
}

/** Advances one player by one fixed tick. Deterministic given the same inputs and world. */
export function stepPlayer(s: PlayerState, input: MoveInput, dt: number, boxes: readonly Box[], triggers: readonly Trigger[] = []): void {
  s.events = 0;
  s.wallCooldown = Math.max(0, s.wallCooldown - dt);
  s.slideBoostCooldown = Math.max(0, s.slideBoostCooldown - dt);
  // Releasing Shift or leaving the ground re-arms sliding (holding Shift in the air = slide on landing).
  if (!input.slide || !s.onGround) s.slideLocked = false;
  if (s.sliding && !s.onGround) endSlide(s, input.slide);
  const vel = s.vel;

  // Wish direction from input, on the horizontal plane.
  yawForward(input.yaw, fwd);
  yawRight(input.yaw, right);
  set(wish, fwd.x * input.forward + right.x * input.right, 0, fwd.z * input.forward + right.z * input.right);
  const wishLen = hlen(wish);
  const wishAmount = Math.min(1, wishLen);
  if (wishLen > 0) {
    wish.x /= wishLen;
    wish.z /= wishLen;
  }

  // --- Jumps -------------------------------------------------------------
  // Source order of operations: the jump is checked *before* friction, and a successful
  // jump leaves the ground, so friction never runs on that tick. Jumping on the exact
  // tick you land therefore keeps 100% of your speed, whatever keys you are holding.
  s.jumpBuffer = Math.max(0, s.jumpBuffer - dt);
  if (input.jumpPressed) s.jumpBuffer = MOVE.jumpBuffer;
  const wantsJump = (MOVE.autoHop && input.jump) || s.jumpBuffer > 0;
  let jumpedFromGround = false;
  if (s.onGround && wantsJump) {
    vel.y = MOVE.jumpSpeed;
    s.onGround = false;
    s.jumpBuffer = 0;
    jumpedFromGround = true;
    endSlide(s, false); // slide-jump: leaves the ground before friction, so it keeps every bit of speed
    s.events |= Ev.Jump;
  } else if (s.wallrunning && input.jumpPressed) {
    wallJump(s, s.wallNormal, wish);
  } else if (!s.onGround && input.jumpPressed && !landingSoon(s, boxes)) {
    // A fresh press in the air (never the held key, so autohop can't burn it): kick off a nearby wall, else double jump.
    const n = probeWall(s.pos, boxes, vel, MOVE.wallrunReach);
    if (n && dot(n, s.lastWallNormal) < 0.7) wallJump(s, n, wish);
    else if (s.airJumps > 0 && s.airTime >= MOVE.airJumpDelay) {
      vel.y = Math.max(vel.y, MOVE.airJumpSpeed);
      s.airJumps--;
      s.jumpBuffer = 0;
      s.events |= Ev.AirJump;
    }
  }
  if (!s.onGround) s.airTime += dt;

  // --- Acceleration --------------------------------------------------------
  let gravity = MOVE.gravity;
  if (s.onGround) {
    if (s.sliding && !input.slide) endSlide(s, false);
    if (!s.sliding && input.slide && !s.slideLocked && hlen(vel) >= MOVE.slideMinSpeed) {
      // Enter a slide. The entry boost is a "starter" kick: it only tops you up to run speed + boost,
      // so it never adds speed on top of bhop momentum (bhop + held Shift would otherwise farm +2 m/s
      // every landing). The cooldown additionally stops Shift-tapping from re-triggering it.
      s.sliding = true;
      s.events |= Ev.SlideStart;
      const sp = hlen(vel);
      const boost = Math.min(MOVE.slideBoost, MOVE.maxGroundSpeed + MOVE.slideBoost - sp);
      if (s.slideBoostCooldown === 0 && boost > 0) {
        vel.x += (vel.x / sp) * boost;
        vel.z += (vel.z / sp) * boost;
        s.slideBoostCooldown = MOVE.slideBoostCooldown;
      }
    }
    if (s.sliding) slideMove(s, input, wishAmount, dt);
    else {
      if (!jumpedFromGround) applyFriction(vel, dt);
      accelerate(vel, wish, MOVE.maxGroundSpeed * wishAmount, MOVE.groundAccel, dt);
    }
  } else if (s.wallrunning) {
    s.wallrunTime += dt;
    const n = s.wallNormal;
    // Strip velocity into/away from the wall, then pull in so we latch on and stay in contact.
    const into = vel.x * n.x + vel.z * n.z;
    vel.x -= n.x * (into + 4);
    vel.z -= n.z * (into + 4);
    // Accelerate along the wall in whichever direction we're already going.
    set(tangent, -n.z, 0, n.x);
    if (dot(tangent, vel) < 0) set(tangent, n.z, 0, -n.x);
    if (dot(wish, tangent) > 0) accelerate(vel, tangent, MOVE.wallrunSpeed, MOVE.wallrunAccel, dt);
    // Gravity ramps from light to full over the run.
    const t = Math.min(1, s.wallrunTime / MOVE.wallrunMaxTime);
    gravity = MOVE.wallrunGravityStart + (MOVE.gravity - MOVE.wallrunGravityStart) * t * t;

    const along = Math.abs(dot(tangent, vel));
    const pullingAway = wishAmount > 0 && dot(wish, n) > 0.7;
    if (s.wallrunTime >= MOVE.wallrunMaxTime || along < MOVE.wallrunMinSpeed * 0.5 || pullingAway) endWallrun(s);
  } else {
    // Source AirAccelerate: the *added* speed along the wish direction is capped at 30 u/s, but the
    // accel rate uses the full wishspeed. With no keys held nothing is added and nothing is lost:
    // there is no air friction, so you keep flying forward after letting go of W.
    accelerate(vel, wish, MOVE.maxGroundSpeed * wishAmount, MOVE.airAccel, dt, MOVE.airSpeedCap);
  }

  // Gravity is split half before / half after the move, like Source's Start/FinishGravity.
  // Also clamp absurd speeds so collision sub-stepping stays cheap.
  vel.y -= gravity * dt * 0.5;
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  if (speed > MOVE.maxSpeed) {
    const k = MOVE.maxSpeed / speed;
    vel.x *= k;
    vel.y *= k;
    vel.z *= k;
  }

  // --- Move ----------------------------------------------------------------
  moveAndCollide(s.pos, vel, dt, boxes, contacts);

  // --- Post-move classification ---------------------------------------------
  // Grounded = on walkable ground (normal.y >= 0.7; surf ramps never count) and not moving away
  // from it faster than NON_JUMP_VELOCITY. If we were grounded and didn't jump, snap down onto
  // ground just below (Source StayOnGround) so walking or sliding down a ramp sticks to it.
  const wasGrounded = s.onGround; // already cleared above if we jumped this tick
  let ground = contacts.ground;
  if (ground) copy(s.groundNormal, contacts.groundNormal);
  else ground = probeGround(s.pos, boxes, s.groundNormal);
  if (!ground && wasGrounded) ground = snapToGround(s.pos, boxes, STEP_DOWN, s.groundNormal);
  if (ground && dot(vel, s.groundNormal) <= NON_JUMP_VELOCITY) {
    // Keep horizontal speed and make the vertical part follow the surface (0 on flat ground).
    const n = s.groundNormal;
    vel.y = -(n.x * vel.x + n.z * vel.z) / n.y;
    land(s);
    if (ground.kind === 'pad' && ground.launch) {
      set(vel, ground.launch.x, ground.launch.y, ground.launch.z);
      s.onGround = false;
      s.events |= Ev.JumpPad;
    }
  } else {
    s.onGround = false;
    set(s.groundNormal, 0, 1, 0);
    vel.y -= gravity * dt * 0.5;
  }

  applyTriggers(s, input, triggers);

  if (s.wallrunning) {
    // Still touching the same wall?
    const n = probeWall(s.pos, boxes, vel, MOVE.wallrunReach);
    if (!n || n.x !== s.wallNormal.x || n.z !== s.wallNormal.z) endWallrun(s);
  } else if (!s.onGround && wishAmount > 0) {
    tryStartWallrun(s, boxes);
  }
}

/** Ground within reach of the jump buffer: a press now is a landing hop (bhop), not an air jump. */
function landingSoon(s: PlayerState, boxes: readonly Box[]): boolean {
  const probe = { ...s.pos };
  return snapToGround(probe, boxes, Math.max(0.15, -s.vel.y * MOVE.jumpBuffer)) !== null;
}

/** Wind gates (either direction) and puffballs. Both only raise velocity, so momentum is never lost. */
function applyTriggers(s: PlayerState, input: MoveInput, triggers: readonly Trigger[]) {
  let inside: Trigger | null = null;
  for (const t of triggers) {
    if (!touches(s.pos, t)) continue;
    inside = t;
    const vel = s.vel;
    if (t.kind === 'boost') {
      // Works both ways: you're pushed the way you're already crossing it, never back. Nearly stationary: the way you face.
      let along = vel.x * t.dir.x + vel.z * t.dir.z;
      if (Math.abs(along) < 0.5) along = -Math.sin(input.yaw) * t.dir.x - Math.cos(input.yaw) * t.dir.z || 1;
      const sign = along < 0 ? -1 : 1;
      const speedAlong = (vel.x * t.dir.x + vel.z * t.dir.z) * sign;
      if (speedAlong < t.speed) {
        vel.x += t.dir.x * sign * (t.speed - speedAlong);
        vel.z += t.dir.z * sign * (t.speed - speedAlong);
      }
      if (s.inTrigger !== t) s.events |= Ev.Boost;
    } else {
      // Puffball: up, plus a shove along whatever direction you're already moving.
      let bounced = false;
      if (vel.y < t.up) {
        vel.y = t.up;
        bounced = true;
      }
      const h = Math.hypot(vel.x, vel.z);
      if (h > 0.5 && h < t.push) {
        vel.x *= t.push / h;
        vel.z *= t.push / h;
        bounced = true;
      }
      if (bounced) {
        s.onGround = false;
        if (s.sliding) endSlide(s, input.slide);
        endWallrun(s);
        if (s.inTrigger !== t) s.events |= Ev.Bounce;
      }
    }
  }
  s.inTrigger = inside;
}

/**
 * Launch velocity that throws a body from `from` to land at `to`, peaking `apex` metres above
 * the higher of the two. Uses the live gravity so retuning keeps pads (and zombie pounces) accurate.
 */
export function launchTo(from: Vec3, to: Vec3, apex: number): Vec3 {
  const g = MOVE.gravity;
  const top = Math.max(from.y, to.y) + apex;
  const vy = Math.sqrt(2 * g * (top - from.y));
  const t = vy / g + Math.sqrt((2 * (top - to.y)) / g);
  return { x: (to.x - from.x) / t, y: vy, z: (to.z - from.z) / t };
}

function tryStartWallrun(s: PlayerState, boxes: readonly Box[]) {
  const vel = s.vel;
  if (hlen(vel) < MOVE.wallrunMinSpeed) return;
  const n = probeWall(s.pos, boxes, vel, MOVE.wallrunReach);
  if (!n) return;
  if (s.wallCooldown > 0 && n.x === s.lastWallNormal.x && n.z === s.lastWallNormal.z) return;
  const into = vel.x * n.x + vel.z * n.z; // negative = moving into the wall
  if (into > 1) return; // moving away from it
  const alongX = vel.x - n.x * into;
  const alongZ = vel.z - n.z * into;
  if (Math.hypot(alongX, alongZ) < MOVE.wallrunMinSpeed * 0.7) return; // hit it head-on, no run

  s.wallrunning = true;
  s.wallrunTime = 0;
  s.wallNormal = { ...n };
  vel.x = alongX;
  vel.z = alongZ;
  vel.y = Math.min(Math.max(vel.y, 0.5), 3); // catch falls, tame launches
  s.events |= Ev.WallrunStart;
}
