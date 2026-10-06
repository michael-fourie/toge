// All distances in metres, times in seconds.

export const TICK_RATE = 128; // movement sim rate (like a 128-tick CS server)
export const TICK_DT = 1 / TICK_RATE;

export const NET = {
  clientSendRate: 30, // client -> server state updates per second
  snapshotRate: 20, // server -> client snapshots per second
  interpDelayMs: 100, // remote players are rendered this far in the past
  maxPlayersPerLobby: 12,
};

export const PLAYER = {
  halfWidth: 0.4,
  height: 1.8,
  eyeHeight: 1.62,
  headRadius: 0.28,
  headCenter: 1.58, // above feet
};

/** Hammer units to metres (CS player is 72u ≈ 1.83m tall). */
const U = 0.0254;

/**
 * Movement tuning, ported from CS:GO's gamemovement with combat-surf/bhop server settings:
 * sv_autobunnyhopping 1, sv_enablebunnyhopping 1 (no speed cap), stamina off, sv_airaccelerate 100.
 * Mutable on purpose so the in-game tuning panel can tweak it live.
 */
export const MOVE = {
  gravity: 800 * U, // sv_gravity 800
  jumpSpeed: 301.993 * U, // sqrt(2 * 800 * 57): a 57u jump
  autoHop: true, // sv_autobunnyhopping: hold jump to hop on the landing tick
  jumpBuffer: 0.08, // a press up to 80ms before landing still hops (approximates scroll-wheel spam)

  maxGroundSpeed: 250 * U, // knife/run speed 250 u/s
  groundAccel: 5.5, // sv_accelerate
  friction: 5.2, // sv_friction
  stopSpeed: 80 * U, // sv_stopspeed

  airAccel: 100, // sv_airaccelerate (MM is 12; bhop/combat-surf servers run 100+)
  airSpeedCap: 30 * U, // the 30 u/s air wishspeed cap that makes air-strafing work

  airJumps: 0, // double jumps per airtime; CS has none
  airJumpSpeed: 6.5,

  wallrunMinSpeed: 4,
  wallrunReach: 0.6, // how far from a wall you can be and still latch on (magnetism)
  wallrunSpeed: 11,
  wallrunAccel: 6,
  wallrunMaxTime: 1.75,
  wallrunGravityStart: 2,
  wallrunCooldown: 0.5, // before re-attaching to a wall facing the same way
  wallJumpUp: 7.5,
  wallJumpOut: 7,
  wallJumpBoost: 2, // extra push along the input direction

  // Slide (hold Shift). Not in CS; tuned so it carries momentum rather than creating it.
  slideMinSpeed: 4, // need this much horizontal speed to start a slide
  slideEndSpeed: 3, // slide ends below this
  slideFriction: 0.6, // vs 5.2 normally
  slideBoost: 2, // m/s added on entry...
  slideBoostCooldown: 1, // ...at most once per this many seconds
  slideSteer: 10, // air-strafe-style steering accel (capped like air accel, so it curves, not speeds up)
  slideSlopeGravity: 1, // scale on gravity along the slope (downhill speeds you up)
  slideEyeHeight: 0.95,

  shotRecoilPush: 0, // >0 shoves airborne snipers backwards when they fire. Off: it ate bhop momentum.
  maxSpeed: 45,
};

export const WEAPON = {
  fireCooldown: 1.1,
  scopedFov: 22,
  hipSpread: 0.035, // radians, no-scopes are a gamble
  range: 500,
};

export const RESPAWN_SECONDS = 2.5;
