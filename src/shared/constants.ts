// All distances in metres, times in seconds.

export const TICK_DT = 1 / 128; // movement sim rate (like a 128-tick CS server)

export const NET = {
  clientSendRate: 20, // client -> server state updates per second; no point exceeding snapshotRate, the server only relays that often
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
  airSpeedCap: 50 * U, // CS's air wishspeed cap (30 u/s) is what limits strafe gain; 50 means bhop climbs ~2.8x faster (speed^2 grows with cap^2)

  wallrunMinSpeed: 4,
  wallrunReach: 0.6, // how far from a wall you can be and still latch on (magnetism)
  wallrunSpeed: 11,
  wallrunAccel: 6,
  wallrunMaxTime: 1.75,
  wallrunGravityStart: 2,
  wallrunCooldown: 0.5, // before re-attaching to a wall facing the same way
  wallJumpUp: 7.5,
  wallJumpOut: 4, // minimum push off the wall; hitting it faster bounces the whole into-wall speed back out
  wallJumpBoost: 2, // extra speed along the way you're already travelling

  // Grapple (E). A rope pulls you toward the surface you hit: it only ever raises your speed along the rope
  // (like a wind gate), never slows you, and friction is off while it's taut.
  grappleRange: 40, // a 40 m rope: roughly the width of the centre island, so one pull crosses a lane gap but not the map
  grappleSpeed: 30, // pull until you're moving this fast toward the anchor
  grappleAccel: 90, // how hard it reels you in (m/s^2); gravity is ~20
  grappleCooldown: 1.5, // seconds after letting go (or reaching the anchor) before the next shot
  grappleMissCooldown: 0.5, // a whiff costs less
  grappleArrive: 2, // within this of the anchor the rope lets go and you keep flying
  grappleMaxTime: 4, // a rope can't hold longer than this
  grappleTargetRadius: 0.7, // a player's chest is this big a target for the rope: hook someone and zip to them
  grappleSnap: 0.14, // radians (~8 degrees): hooks (brass rings in the sky) catch the rope from this close to your aim

  // Air jumps. Both only ever *raise* upward speed (and a wall kick adds push), so they never cost momentum.
  airJumps: 1, // extra mid-air jumps per airtime (the double jump); a wall jump refreshes it, landing resets it
  airJumpSpeed: 301.993 * U, // same launch as a ground jump
  airJumpDelay: 0.15, // seconds airborne before a press counts, so a spammed hop doesn't burn it right off the ground

  // Slide (hold Shift). Not in CS; tuned so it carries momentum rather than creating it.
  slideMinSpeed: 4, // need this much horizontal speed to start a slide
  slideEndSpeed: 3, // slide ends below this
  slideFriction: 0.6, // vs 5.2 normally
  slideBoost: 2, // m/s added on entry...
  slideBoostCooldown: 1, // ...at most once per this many seconds
  slideSteer: 10, // air-strafe-style steering accel (capped like air accel, so it curves, not speeds up)
  slideSlopeGravity: 1, // scale on gravity along the slope (downhill speeds you up)
  slideEyeHeight: 0.95,

  maxSpeed: 70, // hard clamp on total speed; a long clean bhop chain runs into it
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

/** The knife: one stab kills a player. The server rate-limits stabs with `cooldown`. */
export const KNIFE = {
  range: 2.8, // metres from the eye
  cooldown: 0.62,
  zombieDamage: 100, // about an AWP body shot
};

export const RESPAWN_SECONDS = 2.5;

/** Survival (co-op vs zombie rounds in the Foundry). Weapon damage lives in weapons.ts; zombies scale up per round. */
export const SURVIVAL = {
  playerHp: 100,
  regenDelay: 6, // seconds without a claw before health comes back...
  regenRate: 25, // ...at this many hp per second
  firstRoundDelay: 8, // seconds after the lobby opens (or a game over) before round 1
  intermission: 10, // breather between rounds; everyone is revived and healed at its start
  gameOverSeconds: 90, // post-game screen: restart anyway after this long
  spawnInterval: 1.1, // one zombie breaks in at an open window this often...
  maxAlive: 24, // ...while fewer than this are up
  zombiesBase: 3, // round 1 has base + perRound zombies
  zombiesPerRound: 3,

  // Points. Per player, server-side, and reset with the run.
  hitPoints: 10, // every shot that connects without killing
  bodyPoints: 60,
  headPoints: 100,
  repairPoints: 10, // per board nailed back up
  boxPrice: 950, // Mystery Box: any gun in the game
  plushChance: 0.14, // the sad plush: the box gives your points back and moves
  plushAfter: 3, // uses before the plush can show up at all
  punchPrice: 5000, // Pack-a-Punch: the gun in your hands, twice as good
  punchAmmoPrice: 4500, // refilling a punched gun from a wall
  punchRange: 2.5, // metres from a station to buy
  jugPrice: 2500, // Juggernog
  jugHp: 250, // maximum health with Juggernog (100 without); lasts until the run restarts
  punchPierceRadius: 0.75, // a punched AWP shot also hits zombies this close to its line, behind the first
  punchPierceRange: 40,

  // Doors, windows and the box.
  useRange: 2.6, // metres from a door, wall gun, window or the box to use it
  boards: 5, // planks across a window
  tearTime: 1.7, // seconds a zombie spends ripping one board off
  repairTime: 0.55, // seconds to nail one back up (hold F)
  boxRoll: 3.6, // seconds the box spins its guns before showing one
  boxHold: 9, // seconds you have to take the gun
  boxLeave: 3, // seconds the plush waves goodbye before the box moves

  // Going down. At 0 hp you drop instead of dying: zombies leave you be, teammates hold F beside you to revive.
  bleedOut: 30, // seconds down before you die for good (and wait for the round to end)
  reviveTime: 4, // seconds a teammate holds F to get you up...
  mendReviveTime: 2, // ...with Swift Mend
  reviveRange: 2, // metres from a downed teammate to revive them
  reviveHp: 0.5, // you come back with this share of your max health
  selfRevive: 4, // Second Wind: seconds down before you get yourself back up
};

/** The boss: one big zombie that joins every `every`th round, tougher each time. */
export const BOSS = {
  every: 5,
  hpBase: 3000, // round 5
  hpPerTier: 2500, // each later boss round adds this
  hpPerExtraPlayer: 0.5, // +50% health for each player past the first
  damageMult: 2.5, // its swipe vs a normal zombie of the same round
  speedMult: 0.85, // a bit slower than the horde: big, not sneaky
  points: 500, // Survival points to whoever lands the kill (everyone gets the coins)
  scale: 1.8, // drawn (and hit-tested) this much bigger than a zombie
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

/** Frag grenade (Q). You get another a fixed time after throwing one. */
export const GRENADE = {
  cooldown: 8, // seconds from the throw until you have another
  fuse: 2.2, // seconds in the air before it goes off
  throwSpeed: 17, // m/s along the look direction (lifted a little by throwLift)
  throwLift: 0.16, // radians added to your pitch so it arcs
  inherit: 1, // fraction of your own velocity added, so throws keep your momentum
  radius: 4.5, // lethal radius (needs line of sight; walls shield)
  knockRadius: 10, // beyond the lethal radius a blast still shoves you, less the farther you are
  knock: 15, // m/s of shove at point blank (the thrower included: grenade jumping, but no self damage)
  knockLift: 0.35, // pushes a bit upward so a blast at your feet launches you
  zombieDamage: 450, // survival: damage to every zombie inside the lethal radius
  bounce: 0.45, // energy kept on a bounce
  friction: 0.3, // tangential speed lost per bounce
  size: 0.09, // metres
};
