// Practice bots: AWP snipers that hunt you. Pure and deterministic given its dice, so it's unit-tested; the client runs
// one per bot at the movement tick. A bot drives the same stepPlayer as you do: this file only decides its keys, where
// it looks, and when it pulls the trigger. Difficulty is reaction time, how fast it turns, how wide it misses, how
// often it can fire and how slippery it moves (Hard strafes and hops while it shoots, and goes for the head).

import type { Box } from './collision.ts';
import { rayBox, rayWorld, raySphere } from './collision.ts';
import { MOVE, PLAYER, WEAPON } from './constants.ts';
import { type Vec3, lookDir, yawForward, yawRight } from '../../shared/math.ts';
import { type MoveInput, type PlayerState, createPlayerState, emptyInput } from './movement.ts';

export type BotLevel = 'easy' | 'normal' | 'hard';
export const BOT_LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];

interface LevelDef {
  name: string;
  count: number; // bots on the map
  reaction: number; // seconds you have to be in its sights before it can fire
  turn: number; // radians per second it can swing its aim
  spread: number; // radians: how far off its shots land, at most
  fireEvery: number; // seconds between its shots
  sight: number; // metres it can spot you from
  strafe: boolean; // ADAD while aiming
  hop: boolean; // bunny hops when it runs
  head: boolean; // aims at your head rather than your chest
  relocate: number; // seconds without seeing you before it slips away to a new angle on you
}

export const BOT: Record<BotLevel, LevelDef> = {
  easy: { name: 'Easy', count: 3, reaction: 2.4, turn: 1.4, spread: 0.045, fireEvery: 4, sight: 45, strafe: false, hop: false, head: false, relocate: 25 },
  normal: { name: 'Normal', count: 4, reaction: 1.5, turn: 2.6, spread: 0.025, fireEvery: 3, sight: 70, strafe: true, hop: false, head: false, relocate: 16 },
  hard: { name: 'Hard', count: 5, reaction: 0.75, turn: 5, spread: 0.009, fireEvery: 1.8, sight: 110, strafe: true, hop: true, head: true, relocate: 10 },
};

/** Seconds after you respawn before a bot may shoot you. */
export const BOT_SPAWN_GRACE = 3;

/** Seconds after any bot fires at you before another may: you never eat a volley from several at once. */
export const BOT_VOLLEY_GAP = 1.2;

/** How the bots behave whatever their level. */
const AI = {
  ledgeAhead: 1.3, // metres ahead it checks for ground before walking on
  dodgeSpeed: 9, // m/s of your speed that doubles a bot's spread (bhop and it struggles)
  ledgeDrop: 1.5, // ...and how far down that ground may be (a drop to a lower deck is fine, a gap isn't)
  strafeEvery: [0.35, 0.9], // seconds between ADAD direction changes
  stuckTime: 1.2, // seconds without progress before it jumps, then picks another way round
  detour: 4, // seconds it heads for a detour spot
  sidestep: 9, // metres to the side it steps to get round something in the way
  flank: [20, 110], // metres from you a relocating bot reappears
  flankCone: 1.2, // radians either side of your view it avoids
  spread: 10, // metres a relocating bot keeps from the other bots
  memory: 5, // seconds it keeps hunting where it last saw you
};

export interface Bot {
  id: number;
  level: BotLevel;
  s: PlayerState;
  yaw: number;
  pitch: number;
  /** Seconds you've been in its sights (0: it can't see you). */
  seen: number;
  lastSeen: Vec3 | null;
  lostAt: number;
  cooldown: number;
  strafe: number;
  strafeAt: number;
  /** Where it's walking when it can't see you, and until when it sticks to a detour. */
  detour: Vec3 | null;
  detourUntil: number;
  progressAt: number;
  progressPos: Vec3;
  /** Which way it last sidestepped round something (±1). */
  side: number;
  clock: number;
}

export function createBot(id: number, level: BotLevel, pos: Vec3, yaw = 0): Bot {
  return {
    id,
    level,
    s: createPlayerState(pos),
    yaw,
    pitch: 0,
    seen: 0,
    lastSeen: null,
    lostAt: 0,
    cooldown: BOT[level].reaction,
    strafe: 1,
    strafeAt: 0,
    detour: null,
    detourUntil: 0,
    progressAt: 0,
    progressPos: { ...pos },
    side: id % 2 ? 1 : -1,
    clock: 0,
  };
}

/** What the bot knows about you this tick. */
export interface BotTarget {
  pos: Vec3;
  alive: boolean;
  /** Seconds of spawn grace left. */
  grace?: number;
  /** Your velocity: the faster you move, the more a bot's shot goes astray. */
  vel?: Vec3;
}

/** A bot's decision for one tick: its keys, and a shot (the direction it fired) if it pulled the trigger. */
export interface BotTick {
  input: MoveInput;
  shot: Vec3 | null;
}

const eye = (p: Vec3): Vec3 => ({ x: p.x, y: p.y + PLAYER.eyeHeight, z: p.z });
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const turnToward = (from: number, to: number, max: number) => {
  const d = wrap(to - from);
  return from + Math.max(-max, Math.min(max, d));
};

/** The boxes a bot can stand on: not surf ramps (you slide off those into the void). Cached per box list. */
const standCache = new WeakMap<readonly Box[], Box[]>();
function standable(boxes: readonly Box[]): Box[] {
  let s = standCache.get(boxes);
  if (!s) standCache.set(boxes, (s = boxes.filter((b) => b.kind !== 'surf')));
  return s;
}

/** Is there ground (within ledgeDrop below) a little way along `dir` from `p`, and a little further too? */
function groundAhead(p: Vec3, dir: Vec3, boxes: readonly Box[]): boolean {
  const solid = standable(boxes);
  for (const k of [1, 2]) {
    const o = { x: p.x + dir.x * AI.ledgeAhead * k, y: p.y + 0.6, z: p.z + dir.z * AI.ledgeAhead * k };
    if (rayWorld(o, { x: 0, y: -1, z: 0 }, solid, AI.ledgeDrop + 0.6) >= AI.ledgeDrop + 0.6) return false;
  }
  return true;
}

/** Can the bot see this point (nothing solid in between)? */
function canSee(from: Vec3, to: Vec3, boxes: readonly Box[]): boolean {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const len = Math.hypot(d.x, d.y, d.z);
  if (len < 0.01) return true;
  d.x /= len;
  d.y /= len;
  d.z /= len;
  return rayWorld(from, d, boxes, len) >= len - 0.25;
}

/** A shot from `o` along `d`: does it hit a player standing at `feet` before a wall? Null for a miss. */
export function shotHits(o: Vec3, d: Vec3, feet: Vec3, boxes: readonly Box[], range = WEAPON.range): { head: boolean; dist: number } | null {
  const wall = rayWorld(o, d, boxes, range);
  const head = raySphere(o, d, { x: feet.x, y: feet.y + PLAYER.headCenter, z: feet.z }, PLAYER.headRadius, wall);
  const hw = PLAYER.halfWidth;
  const body = rayBox(o, d, { x: feet.x - hw, y: feet.y, z: feet.z - hw }, { x: feet.x + hw, y: feet.y + PLAYER.headCenter - PLAYER.headRadius, z: feet.z + hw }, wall);
  if (head >= 0 && (body < 0 || head <= body)) return { head: true, dist: head };
  if (body >= 0) return { head: false, dist: body };
  return null;
}

/**
 * One tick of a bot. `spots` are places worth walking to when it can't find you (the map's spawns). `rand` is its dice.
 */
export function thinkBot(b: Bot, target: BotTarget, boxes: readonly Box[], spots: readonly Vec3[], dt: number, rand: () => number = Math.random): BotTick {
  const L = BOT[b.level];
  b.clock += dt;
  b.cooldown = Math.max(0, b.cooldown - dt);
  const input = emptyInput();
  const me = eye(b.s.pos);
  const aimAt = { x: target.pos.x, y: target.pos.y + (L.head ? PLAYER.headCenter : 1.15), z: target.pos.z };
  const dist = Math.hypot(aimAt.x - me.x, aimAt.y - me.y, aimAt.z - me.z);
  const visible = target.alive && dist <= L.sight && canSee(me, aimAt, boxes);

  if (visible) {
    b.seen += dt;
    b.lastSeen = { ...target.pos };
    b.lostAt = b.clock;
    b.detour = null;
  } else b.seen = 0;

  // Where it looks: at you while it can see you, else the way it's walking.
  let goal: Vec3 | null = null;
  if (!visible && target.alive) {
    if (b.detour && b.clock < b.detourUntil) goal = b.detour;
    else if (b.lastSeen && b.clock - b.lostAt < AI.memory) goal = b.lastSeen;
    else goal = target.pos; // it knows roughly where you are: practice is a hunt
  }
  const look = visible ? aimAt : goal ? { x: goal.x, y: me.y, z: goal.z } : null;
  if (look) {
    const dx = look.x - me.x;
    const dy = look.y - me.y;
    const dz = look.z - me.z;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = visible ? Math.atan2(dy, Math.hypot(dx, dz)) : 0;
    b.yaw = turnToward(b.yaw, wantYaw, L.turn * dt);
    b.pitch = b.pitch + Math.max(-L.turn * dt, Math.min(L.turn * dt, wantPitch - b.pitch));
  }
  input.yaw = b.yaw;
  input.pitch = b.pitch;

  // Shoot: once it has had you in its sights long enough, its aim has settled on you, and it's ready.
  let shot: Vec3 | null = null;
  if (visible && b.seen >= L.reaction && b.cooldown === 0 && (target.grace ?? 0) <= 0) {
    const dx = aimAt.x - me.x;
    const dz = aimAt.z - me.z;
    const off = Math.abs(wrap(Math.atan2(-dx, -dz) - b.yaw)) + Math.abs(Math.atan2(aimAt.y - me.y, Math.hypot(dx, dz)) - b.pitch);
    if (off < Math.max(0.02, L.spread * 3)) {
      // Wider when it has only just found you, and when you're moving fast: stand still in its sights and it settles in.
      const speed = target.vel ? Math.hypot(target.vel.x, target.vel.z) : 0;
      const spread = L.spread * (1 + 2 * Math.exp(-(b.seen - L.reaction) / 1.5)) * (1 + speed / AI.dodgeSpeed);
      shot = lookDir(b.yaw + (rand() * 2 - 1) * spread, b.pitch + (rand() * 2 - 1) * spread);
      b.cooldown = L.fireEvery;
    }
  }

  // Move.
  const fwd = yawForward(b.yaw);
  const right = yawRight(b.yaw);
  if (visible) {
    if (L.strafe) {
      if (b.clock >= b.strafeAt) {
        b.strafe = rand() < 0.5 ? -1 : 1;
        b.strafeAt = b.clock + AI.strafeEvery[0] + rand() * (AI.strafeEvery[1] - AI.strafeEvery[0]);
      }
      const dir = { x: right.x * b.strafe, y: 0, z: right.z * b.strafe };
      if (!groundAhead(b.s.pos, dir, boxes)) b.strafe = -b.strafe;
      else input.right = b.strafe;
      if (L.hop && b.s.onGround && rand() < dt * 0.8) input.jump = input.jumpPressed = true; // the odd hop to spoil your aim
    }
  } else if (goal) {
    const flat = Math.hypot(goal.x - b.s.pos.x, goal.z - b.s.pos.z);
    if (flat > 2) {
      if (groundAhead(b.s.pos, fwd, boxes)) {
        input.forward = 1;
        if (L.hop && b.s.onGround && Math.hypot(b.s.vel.x, b.s.vel.z) > MOVE.maxGroundSpeed * 0.9 && groundAhead(b.s.pos, { x: fwd.x * 3, y: 0, z: fwd.z * 3 }, boxes)) input.jump = input.jumpPressed = true;
      } else if (!b.detour || b.clock >= b.detourUntil) pickDetour(b, spots, rand);
    } else if (goal === b.detour) b.detour = null;
    // Stuck against something: hop it, then try another way round.
    const moved = Math.hypot(b.s.pos.x - b.progressPos.x, b.s.pos.z - b.progressPos.z);
    if (moved > 1) {
      b.progressPos = { ...b.s.pos };
      b.progressAt = b.clock;
    } else if (b.clock - b.progressAt > AI.stuckTime) {
      if (b.s.onGround) input.jump = input.jumpPressed = true;
      if (b.clock - b.progressAt > AI.stuckTime * 2) {
        // Still stuck: sidestep along the obstacle (alternating sides), or, the second time, head for somewhere else.
        b.side = -b.side;
        if (b.detour && rand() < 0.5) pickDetour(b, spots, rand);
        else {
          b.detour = { x: b.s.pos.x + right.x * b.side * AI.sidestep, y: b.s.pos.y, z: b.s.pos.z + right.z * b.side * AI.sidestep };
          b.detourUntil = b.clock + AI.detour;
        }
        b.progressAt = b.clock;
      }
    }
  }
  return { input, shot };
}

/** Has this bot gone long enough without seeing you that it should find a new angle? */
export const wantsRelocate = (b: Bot) => b.seen === 0 && b.clock - b.lostAt > BOT[b.level].relocate;

/**
 * Where a bot that lost you reappears: a spot with a clear line to you, at sniping range, and outside the way you're
 * looking (so you never see it pop in). The islands are joined by pads, gates and surf, which bots don't path through:
 * this is how they keep finding you. `taken`: where the other bots are (they spread out). Null when no spot qualifies.
 */
export function flankSpot(spots: readonly Vec3[], you: Vec3, look: Vec3, boxes: readonly Box[], rand: () => number = Math.random, taken: readonly Vec3[] = []): Vec3 | null {
  const eyeYou = eye(you);
  const ok = spots.filter((s) => {
    if (taken.some((t) => Math.hypot(t.x - s.x, t.z - s.z) < AI.spread)) return false; // another bot is there
    const d = { x: s.x - you.x, y: s.y - you.y, z: s.z - you.z };
    const len = Math.hypot(d.x, d.y, d.z);
    if (len < AI.flank[0] || len > AI.flank[1]) return false;
    if ((d.x * look.x + d.y * look.y + d.z * look.z) / len > Math.cos(AI.flankCone)) return false; // in front of you
    return canSee(eye(s), eyeYou, boxes);
  });
  return ok.length ? { ...ok[Math.floor(rand() * ok.length)] } : null;
}

/**
 * The world as a bot moves through it: launch pads are plain floor to them (and bots run with no wind gates or
 * puffballs), so they never get flung off an island they can't steer back to.
 */
export const botBoxes = (boxes: readonly Box[]): Box[] => boxes.map((b) => (b.launch ? { ...b, launch: undefined } : b));

/** Heads for a random spot for a few seconds: the way round a gap or a wall. */
function pickDetour(b: Bot, spots: readonly Vec3[], rand: () => number) {
  if (!spots.length) return;
  b.detour = { ...spots[Math.floor(rand() * spots.length)] };
  b.detourUntil = b.clock + AI.detour;
}
