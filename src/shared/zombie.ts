import { type Box, moveAndCollide, newContacts, snapToGround } from './collision.ts';
import { BOSS, JOBS, MOVE, ZOMBIE } from './constants.ts';
import { type Vec3, copy, v3 } from './math.ts';
import { launchTo } from './movement.ts';
import { WORKSHOP } from './contraptions.ts';

// Survival zombies: a dumb, deterministic chase AI on top of the shared collision. The server runs it.
// They shamble straight at the nearest player, swipe when close, hop over roots and crates, and
// pounce (a ballistic leap, like a launch pad) up onto ledges, across gaps, or when they're stuck.

export interface Zombie {
  id: number;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  onGround: boolean;
  hp: number;
  speed: number;
  damage: number;
  /** > 0 while winding up a swipe; it lands when this reaches 0. */
  claw: number;
  clawCooldown: number;
  /** > 0 while crouched for a pounce at `leapTo`. */
  crouch: number;
  leapCooldown: number;
  leapTo: Vec3;
  /** Seconds without making progress while trying to walk. */
  stuck: number;
  /** > 0 while walking sideways around a wall, on side `detourSide` (±1). */
  detour: number;
  detourSide: number;
  /** Survival: the window this zombie is breaking in through (-1 once it is inside). */
  gate: number;
  /** Seconds spent ripping at the current board. */
  tear: number;
  /** Bosses only: which boss this is (1 at round 5, 2 at round 10, ...) and the health it started with. */
  boss?: number;
  maxHp?: number;
  /** A zombie with a job (JOBS): its outfit and its quirk. */
  job?: JobId;
  /** Seconds of Goo Sprayer goo left on it (contraptions.ts): it walks at WORKSHOP.gooSlow of its speed meanwhile. */
  goo?: number;
}

export type JobId = 'welder' | 'courier' | 'stoker';
const JOB_IDS: JobId[] = ['welder', 'courier', 'stoker'];

/** The job a new zombie turns up with, if any: none before JOBS.from, then a growing share. `a`, `b` are dice in [0, 1). */
export function pickJob(round: number, a: number, b: number): JobId | undefined {
  if (round < JOBS.from) return undefined;
  const chance = Math.min(JOBS.chanceMax, JOBS.chancePerRound * (round - JOBS.from + 1));
  return a < chance ? JOB_IDS[Math.min(JOB_IDS.length - 1, Math.floor(b * JOB_IDS.length))] : undefined;
}

export interface ZombieTarget {
  id: number;
  pos: Vec3;
}

/** Where a zombie is headed this step. `claw` = may swipe at players; `hold` = stand and wait there (tearing a board). */
export interface Aim {
  pos: Vec3;
  claw: boolean;
  hold: boolean;
}

/** Optional route-finding: the Survival map plugs its rooms-and-doorways graph and window sieges in here. */
export interface Brain {
  /** How far a zombie at `from` is from a target at `to` for ranking who to chase. */
  cost(from: Vec3, to: Vec3): number;
  steer(z: Zombie, target: ZombieTarget | null): Aim | null;
}

/** A swipe that connected. */
interface Claw {
  zombie: Zombie;
  target: number;
}

/** Zombies get a bit faster and stronger every round. */
export function zombieStats(round: number) {
  const r = Math.max(0, round - 1);
  return {
    hp: ZOMBIE.hpBase + ZOMBIE.hpPerRound * r,
    speed: Math.min(ZOMBIE.speedMax, ZOMBIE.speedBase + ZOMBIE.speedPerRound * r),
    damage: Math.min(ZOMBIE.damageMax, ZOMBIE.damageBase + ZOMBIE.damagePerRound * r),
  };
}

/** Is this a boss round? */
export const bossRound = (round: number) => round > 0 && round % BOSS.every === 0;

/** The boss for a boss round: much more health (and more with more players), a harder swipe, a little slower. */
export function bossStats(round: number, players: number) {
  const tier = Math.max(1, Math.floor(round / BOSS.every));
  const z = zombieStats(round);
  const hp = Math.round((BOSS.hpBase + BOSS.hpPerTier * (tier - 1)) * (1 + BOSS.hpPerExtraPlayer * Math.max(0, players - 1)));
  return { tier, hp, speed: z.speed * BOSS.speedMult, damage: Math.round(z.damage * BOSS.damageMult) };
}

export function createBoss(id: number, pos: Vec3, round: number, players: number, gate = -1): Zombie {
  const b = bossStats(round, players);
  return { ...createZombie(id, pos, round, gate), hp: b.hp, maxHp: b.hp, speed: b.speed, damage: b.damage, boss: b.tier };
}

/** A new zombie for `round`. A job changes its health and speed; `mult` scales them on top (round modifiers). */
export function createZombie(id: number, pos: Vec3, round: number, gate = -1, job?: JobId, mult: { hp?: number; speed?: number } = {}): Zombie {
  const s = zombieStats(round);
  const j = job ? JOBS[job] : { hp: 1, speed: 1 };
  return {
    id,
    pos: { ...pos },
    vel: v3(),
    yaw: 0,
    onGround: false,
    hp: Math.round(s.hp * j.hp * (mult.hp ?? 1)),
    speed: s.speed * j.speed * (mult.speed ?? 1),
    damage: s.damage,
    job,
    claw: 0,
    clawCooldown: 0,
    crouch: 0,
    leapCooldown: ZOMBIE.leapCooldown * 0.5, // no pouncing the instant they climb up
    leapTo: v3(),
    stuck: 0,
    detour: 0,
    detourSide: id % 2 ? 1 : -1,
    gate,
    tear: 0,
  };
}

/** Steps every zombie (shoving them apart so they don't stack into one blob). Returns swipes that hit. */
export function stepHorde(zombies: readonly Zombie[], targets: readonly ZombieTarget[], dt: number, boxes: readonly Box[], brain?: Brain): Claw[] {
  const claws: Claw[] = [];
  const r = ZOMBIE.separation;
  for (const z of zombies) {
    push.x = push.z = 0;
    for (const o of zombies) {
      if (o === z || Math.abs(o.pos.y - z.pos.y) > 1.5) continue;
      let dx = z.pos.x - o.pos.x;
      let dz = z.pos.z - o.pos.z;
      let d = Math.hypot(dx, dz);
      if (d >= r) continue;
      if (d < 1e-3) [dx, dz, d] = [z.id < o.id ? 1 : -1, 0, 1]; // exactly on top of each other: split along x
      const k = ((r - d) / r) * 3;
      push.x += (dx / d) * k;
      push.z += (dz / d) * k;
    }
    const hit = stepZombie(z, targets, push, dt, boxes, brain);
    if (hit >= 0) claws.push({ zombie: z, target: hit });
  }
  return claws;
}

const push = v3();
const contacts = newContacts();
const LOOK_AHEAD = 1; // metres ahead to check for a drop

function nearest(z: Zombie, targets: readonly ZombieTarget[], brain?: Brain): ZombieTarget | null {
  let best: ZombieTarget | null = null;
  let bestCost = Infinity;
  for (const t of targets) {
    // Height is costly to close, so prefer someone on our level.
    const cost = brain ? brain.cost(z.pos, t.pos) : Math.hypot(t.pos.x - z.pos.x, t.pos.z - z.pos.z) + Math.abs(t.pos.y - z.pos.y) * 1.5;
    if (cost < bestCost) {
      bestCost = cost;
      best = t;
    }
  }
  return best;
}

/** Is there something to stand on (or a wall to walk into) just ahead, rather than a drop into the void? */
function groundAhead(pos: Vec3, ux: number, uz: number, boxes: readonly Box[]): boolean {
  const x = pos.x + ux * LOOK_AHEAD;
  const z = pos.z + uz * LOOK_AHEAD;
  const hi = pos.y + 1.2;
  const lo = pos.y - ZOMBIE.ledgeDrop;
  for (const b of boxes) {
    if (b.kind === 'surf' || x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
    if (b.max.y > lo && b.min.y < hi) return true;
  }
  return false;
}

/** The first heading veering off (ux, uz) that has ground ahead, favouring the zombie's detour side; else none. */
function alongEdge(z: Zombie, ux: number, uz: number, boxes: readonly Box[]): [number, number] {
  for (const a of [0.6, -0.6, 1.2, -1.2]) {
    const r = a * z.detourSide;
    const x = ux * Math.cos(r) - uz * Math.sin(r);
    const w = ux * Math.sin(r) + uz * Math.cos(r);
    if (groundAhead(z.pos, x, w, boxes)) return [x, w];
  }
  return [0, 0];
}

/** One AI + physics step. Returns the id of the player clawed this step, or -1. */
function stepZombie(z: Zombie, targets: readonly ZombieTarget[], shove: Vec3, dt: number, boxes: readonly Box[], brain?: Brain): number {
  z.clawCooldown = Math.max(0, z.clawCooldown - dt);
  z.leapCooldown = Math.max(0, z.leapCooldown - dt);
  z.detour = Math.max(0, z.detour - dt);
  const speed = z.goo ? z.speed * WORKSHOP.gooSlow : z.speed;
  if (z.goo) z.goo = Math.max(0, z.goo - dt);
  let hit = -1;
  let wantX = 0;
  let wantZ = 0;

  const t = nearest(z, targets, brain);
  const aim: Aim | null = brain ? brain.steer(z, t) : t && { pos: t.pos, claw: true, hold: false };
  if (aim) {
    const dx = aim.pos.x - z.pos.x;
    const dz = aim.pos.z - z.pos.z;
    const dy = aim.pos.y - z.pos.y;
    const dist = Math.hypot(dx, dz);
    // How far the player we might claw really is (the aim can be a doorway on the way to them).
    const rx = t && aim.claw ? t.pos.x - z.pos.x : Infinity;
    const rz = t && aim.claw ? t.pos.z - z.pos.z : Infinity;
    const rdist = Math.hypot(rx, rz);
    const rdy = t ? t.pos.y - z.pos.y : 0;
    if (dist > 0.01 && z.crouch <= 0) z.yaw = Math.atan2(-dx, -dz);
    if (z.claw > 0) {
      z.claw -= dt;
      if (z.claw <= 0) {
        z.claw = 0;
        z.clawCooldown = ZOMBIE.clawCooldown;
        if (t && rdist < ZOMBIE.clawHitRange && Math.abs(rdy) < 1.8) hit = t.id;
      }
    } else if (z.crouch > 0) {
      z.crouch -= dt;
      if (z.crouch <= 0) {
        z.crouch = 0;
        copy(z.vel, launchTo(z.pos, z.leapTo, ZOMBIE.leapApex));
        z.onGround = false;
        z.leapCooldown = ZOMBIE.leapCooldown;
        z.stuck = 0;
      }
    } else if (z.onGround && dist > 0.01 && !aim.hold) {
      const inReach = rdist < ZOMBIE.clawRange && Math.abs(rdy) < 1.6;
      const ux = dx / dist;
      const uz = dz / dist;
      if (inReach) {
        if (z.clawCooldown === 0) z.claw = ZOMBIE.clawWindup;
      } else {
        const above = dy > ZOMBIE.stepUp;
        const canLeap = z.leapCooldown === 0 && dist <= ZOMBIE.leapRange && dy <= ZOMBIE.leapMaxUp;
        const ledge = !groundAhead(z.pos, ux, uz, boxes);
        if (above && dist < ZOMBIE.leapMinRange) {
          // Right underneath them: back out so the pounce doesn't bonk the underside.
          if (groundAhead(z.pos, -ux, -uz, boxes)) [wantX, wantZ] = [-ux, -uz];
        } else if (canLeap && (above || ledge || z.stuck > ZOMBIE.stuckLeap)) {
          z.crouch = ZOMBIE.leapWindup;
          copy(z.leapTo, aim.pos);
        } else if (z.detour > 0) {
          // Around the wall: perpendicular to the chase, flipping sides if that way is a drop.
          let [px, pz] = [-uz * z.detourSide, ux * z.detourSide];
          if (!groundAhead(z.pos, px, pz, boxes)) {
            z.detourSide = -z.detourSide;
            [px, pz] = [-px, -pz];
          }
          [wantX, wantZ] = [px, pz];
        } else if (!ledge) {
          [wantX, wantZ] = [ux, uz];
        } else {
          // At an edge with them out of reach: feel along it. Nowhere to go: wait there, groaning.
          [wantX, wantZ] = alongEdge(z, ux, uz, boxes);
        }
      }
    }
  }

  const walking = wantX !== 0 || wantZ !== 0;
  if (z.onGround) {
    z.vel.x = wantX * speed + shove.x;
    z.vel.z = wantZ * speed + shove.z;
  } else if (z.stuck > 0) {
    // Mid-hop over an obstacle: keep pressing toward them, or its face stops us dead on the way up.
    z.vel.x = -Math.sin(z.yaw) * speed;
    z.vel.z = -Math.cos(z.yaw) * speed;
  }
  const wasGround = z.onGround;
  const x0 = z.pos.x;
  const z0 = z.pos.z;
  const expected = Math.hypot(z.vel.x, z.vel.z) * dt;
  z.vel.y -= MOVE.gravity * dt;
  moveAndCollide(z.pos, z.vel, dt, boxes, contacts);

  let ground = contacts.ground;
  if (!ground && wasGround && z.vel.y <= 0) ground = snapToGround(z.pos, boxes, 0.6); // stick to slopes going down
  z.onGround = !!ground;
  if (ground) z.vel.y = Math.max(0, z.vel.y);
  if (ground?.launch) {
    copy(z.vel, ground.launch); // zombies ride launch pads too
    z.onGround = false;
  }

  // Blocked by a root or crate: hop over it. Still blocked (a wall): detour sideways, then pounce.
  if (z.onGround && walking) {
    const moved = Math.hypot(z.pos.x - x0, z.pos.z - z0);
    if (moved < expected * 0.5) {
      z.stuck += dt;
      if (z.stuck > 1 && z.detour === 0) {
        z.detour = ZOMBIE.detour;
        z.detourSide = -z.detourSide;
      } else if (z.stuck > 0.15) {
        z.vel.y = ZOMBIE.hopSpeed;
        z.onGround = false;
      }
    } else z.stuck = 0;
  } else if (!z.onGround && z.stuck > 0) z.stuck += dt;
  return hit;
}
