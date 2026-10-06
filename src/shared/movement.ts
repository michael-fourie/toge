import { type Box, type Contacts, moveAndCollide, probeGround, probeWall } from './collision.ts';
import { MOVE } from './constants.ts';
import { type Vec3, addScaled, dot, hlen, set, v3, yawForward, yawRight } from './math.ts';

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
  WallrunEnd: 8,
  WallJump: 16,
  AirJump: 32,
  JumpPad: 64,
  SlideStart: 128,
  SlideEnd: 256,
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
  airJumpsLeft: number;
  /** Seconds left on a buffered jump press (lets a slightly-early press still hop on the landing tick). */
  jumpBuffer: number;
  /** Surface normal of the ground we're standing on; (0,1,0) on flat floors. Set by ground classification. */
  groundNormal: Vec3;
  sliding: boolean;
  /** Seconds until another slide may grant the entry boost (stops slide-spam speed farming). */
  slideBoostCooldown: number;
  /** A slide ended while Shift was still held; Shift must be released (or you must go airborne) to slide again. */
  slideLocked: boolean;
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
    airJumpsLeft: MOVE.airJumps,
    jumpBuffer: 0,
    events: 0,
  };
}

// Scratch vectors (sim is single-threaded and non-reentrant).
const fwd = v3();
const right = v3();
const wish = v3();
const tangent = v3();
const contacts: Contacts = { ground: null, ceiling: false, hitX: false, hitZ: false };

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
  s.events |= Ev.WallrunEnd;
}

function land(s: PlayerState) {
  if (!s.onGround) s.events |= Ev.Land;
  s.onGround = true;
  endWallrun(s);
  s.airJumpsLeft = MOVE.airJumps;
  s.wallCooldown = 0;
}

/** Advances one player by one fixed tick. Deterministic given the same inputs and world. */
export function stepPlayer(s: PlayerState, input: MoveInput, dt: number, boxes: readonly Box[]): void {
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
    const n = s.wallNormal;
    vel.x += n.x * MOVE.wallJumpOut + wish.x * MOVE.wallJumpBoost;
    vel.z += n.z * MOVE.wallJumpOut + wish.z * MOVE.wallJumpBoost;
    vel.y = MOVE.wallJumpUp;
    endWallrun(s);
    s.airJumpsLeft = MOVE.airJumps;
    s.jumpBuffer = 0;
    s.events |= Ev.WallJump;
  } else if (!s.onGround && !s.wallrunning && input.jumpPressed && s.airJumpsLeft > 0) {
    // Optional double jump (off by default, CS has none). Purely vertical so it never eats momentum.
    s.airJumpsLeft--;
    s.jumpBuffer = 0;
    vel.y = Math.max(vel.y, MOVE.airJumpSpeed);
    s.events |= Ev.AirJump;
  }

  // --- Acceleration --------------------------------------------------------
  let gravity = MOVE.gravity;
  if (s.onGround) {
    if (s.sliding && !input.slide) endSlide(s, false);
    if (!s.sliding && input.slide && !s.slideLocked && hlen(vel) >= MOVE.slideMinSpeed) {
      // Enter a slide. The entry boost has a cooldown so tapping Shift can't farm speed.
      s.sliding = true;
      s.events |= Ev.SlideStart;
      if (s.slideBoostCooldown === 0) {
        const sp = hlen(vel);
        vel.x += (vel.x / sp) * MOVE.slideBoost;
        vel.z += (vel.z / sp) * MOVE.slideBoost;
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
  const ground = contacts.ground ?? (vel.y <= 0 ? probeGround(s.pos, boxes) : null);
  if (ground && vel.y <= 0) {
    land(s);
    if (ground.kind === 'pad' && ground.launch) {
      set(vel, ground.launch.x, ground.launch.y, ground.launch.z);
      s.onGround = false;
      s.events |= Ev.JumpPad;
    }
  } else {
    s.onGround = false;
    vel.y -= gravity * dt * 0.5;
  }

  if (s.wallrunning) {
    // Still touching the same wall?
    const n = probeWall(s.pos, boxes, vel, MOVE.wallrunReach);
    if (!n || n.x !== s.wallNormal.x || n.z !== s.wallNormal.z) endWallrun(s);
  } else if (!s.onGround && wishAmount > 0) {
    tryStartWallrun(s, boxes);
  }
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
  s.airJumpsLeft = MOVE.airJumps;
  vel.x = alongX;
  vel.z = alongZ;
  vel.y = Math.min(Math.max(vel.y, 0.5), 3); // catch falls, tame launches
  s.events |= Ev.WallrunStart;
}
