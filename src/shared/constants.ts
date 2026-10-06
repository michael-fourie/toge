// All distances in metres, times in seconds.

export const TICK_DT = 1 / 128; // movement sim rate (like a 128-tick CS server)

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

  maxSpeed: 45,
};

export const WEAPON = {
  // A shot is: recoil (boltDelay) -> a quick bolt cycle (boltTime). The server uses fireCooldown as its rate limit.
  boltDelay: 0.1,
  boltTime: 0.5,
  fireCooldown: 0.62,
  magSize: 10, // AWP: 10 in the mag, unlimited reserve (combat-surf style)
  reloadTime: 1.7, // mag swap; +boltTime when reloading from empty
  scopedFov: 22,
  hipSpread: 0.035, // radians, no-scopes are a gamble
  range: 500,
};

export const RESPAWN_SECONDS = 2.5;

/** Survival (co-op vs zombie rounds). Damage numbers are CS-ish AWP values; zombies scale up per round. */
export const SURVIVAL = {
  playerHp: 100,
  bodyDamage: 115, // AWP body shot
  headDamage: 450, // AWP headshot
  firstRoundDelay: 6, // seconds after the lobby opens (or a game over) before round 1
  intermission: 8, // breather between rounds; everyone is revived and healed at its start
  gameOverSeconds: 7,
  spawnInterval: 0.7, // one zombie climbs out of the clouds this often...
  maxAlive: 24, // ...while fewer than this are up
  zombiesBase: 4, // round 1 has base + perRound zombies
  zombiesPerRound: 3,
};

/** Zombie stats and AI tuning. Per-round values grow linearly up to their caps. */
export const ZOMBIE = {
  hpBase: 80, // round 1: a body shot kills; from round 3 only headshots one-shot
  hpPerRound: 18,
  speedBase: 3.2, // m/s; players walk at 6.35 and bhop far faster, so movement is always the out
  speedPerRound: 0.35,
  speedMax: 7,
  damageBase: 14,
  damagePerRound: 3,
  damageMax: 60,

  clawRange: 1.4, // horizontal reach to start a swipe
  clawHitRange: 2.1, // still in reach when the swipe lands
  clawWindup: 0.45, // telegraphed: stand still and raise the claws
  clawCooldown: 0.9,

  leapRange: 15, // max horizontal distance for a pounce onto a ledge, branch or the next island
  leapMinRange: 3, // closer than this to something above, back off first (else they bonk the underside)
  leapMaxUp: 16,
  leapApex: 1.6, // the arc peaks this far above the higher end
  leapWindup: 0.4,
  leapCooldown: 2.5,
  hopSpeed: 7.5, // little hop over roots and crates when blocked
  detour: 1.2, // blocked by a wall: walk sideways along it this long, alternating sides
  stuckLeap: 2.5, // still blocked after that: pounce
  stepUp: 1.6, // targets higher than this need a leap
  ledgeDrop: 4, // walking off a drop deeper than this counts as a ledge
  separation: 0.9, // zombies shove apart inside this radius
};
