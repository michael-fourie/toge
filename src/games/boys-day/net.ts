// The messages a run sends through the party room, and readMsg, which checks each one's shape before anything uses
// it (party data is untrusted). Host → everyone: start, who's driving, run state, zombies (with the effects since the
// last batch). Players → everyone: the driver's bus pose, where they are on the bus and where they're looking, and
// 'act' (a tenth of a second's shots, hits, pickups and club swings in one message), minigame results, asking for
// the wheel, honks. Batching keeps a busy player well under the
// party relay's 60 messages a second.

import { Z_STATES, type Fx, type FxKind } from './director.ts';
import { POKER_MOVES, readCards, readPoker, type PokerMove, type PokerView } from './poker.ts';
import { isPick } from './roster.ts';
import { BJ_MAX, BUY, MAX_PLAYERS, SEED_MAX, SLOT_MAX, UPGRADES, type Phase, type RunState } from './rules.ts';

export type Msg =
  /** A run begins: the map's seed, who drives first, and who everyone is (roster.ts BOYS, by place in the crew). */
  | { t: 'start'; seed: number; driver: number; boys: number[] }
  /** In the lobby: who I'd like to be (ANY_BOY: surprise me). */
  | { t: 'pick'; b: number }
  | { t: 'driver'; id: number }
  /** The run, the pickups taken on this leg and the crates got at its checkpoint. */
  | { t: 'run'; run: RunState; taken: number[]; got: number[] }
  | { t: 'z'; z: number[]; fx: Fx[]; said: string[] }
  /** The driver's bus, on leg `l` (a pose from the leg before is dropped). */
  | { t: 'bus'; x: number; z: number; h: number; v: number; s: number; l: number }
  /**
   * Where you are and your look. On the bus: bus-local `s`ide and `a`long, `l`evel 0 inside or 1 on the roof, yaw
   * relative to the bus. Off it (`l` 2): `s` and `a` are your world x and z, yaw is the world's; `c`: lugging a can.
   */
  | { t: 'aim'; yaw: number; pitch: number; s: number; a: number; l: 0 | 1 | 2; c?: boolean }
  | Act
  | { t: 'mini'; k: 'golf' | 'slots'; v: number }
  /** A hand of blackjack at the card table: scrap won (or lost). */
  | { t: 'bj'; v: number }
  /** Hold'em (poker.ts): a move to the host; the table for everyone; your own two cards, sent to you alone. */
  | { t: 'poker'; m: PokerMove; n: number }
  | { t: 'table'; v: PokerView }
  | { t: 'hand'; cards: number[] }
  /** On foot: a crate grabbed (its site id), a jerry can brought to the bus, knocked out. On the bus: a toke, a beer. */
  | { t: 'do'; k: 'crate' | 'can' | 'ko' | 'toke' | 'drink'; id: number }
  /** Scrap spent at the bus's store (rules.ts BUY). */
  | { t: 'buy'; k: number }
  /** Take the wheel (true) or get up from it (false). */
  | { t: 'drive'; want: boolean }
  | { t: 'honk' }
  | { t: 'again' };

/** A tenth of a second of one player's doings. `shots` is flat: x·10, y·10, z·10, dx·1000, dy·1000, dz·1000 each. */
export interface Act {
  t: 'act';
  c: number;
  shots: number[];
  hits: number[];
  grabs: number[];
  swing: number[];
  /** Which gun the hits are from, and the zombies a grenade caught. */
  g: number;
  boom: number[];
}

export const ACT_MAX = { shots: 24, hits: 24, grabs: 6, swing: 8, boom: 16 } as const;

const FX: FxKind[] = ['yeet', 'fore', 'splat', 'gordie', 'grab', 'hurt', 'shake', 'heal', 'bump', 'round', 'bite', 'crate', 'can', 'clear', 'buy', 'leg'];
const PHASES: Phase[] = ['drive', 'stop', 'lost'];
const DOS = ['crate', 'can', 'ko', 'toke', 'drink'] as const;

const num = (v: unknown, max = 1e6): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;
const int = (v: unknown, max = 1e9): v is number => Number.isInteger(v) && Math.abs(v as number) <= max;
const seed = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < SEED_MAX;
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

function readRun(r: unknown): RunState | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  if (!seed(o.seed) || !int(o.stage, 1e5) || o.stage < 0 || !PHASES.includes(o.phase as Phase)) return null;
  if (!Array.isArray(o.cash) || o.cash.length !== MAX_PLAYERS || !o.cash.every((v) => int(v, 1e7) && v >= 0)) return null;
  if (!num(o.busHp) || !num(o.prog, 1e5) || !int(o.need, 1e5) || !bool(o.done) || !num(o.time) || !num(o.dist, 1e9)) return null;
  if (!bool(o.club) || !bool(o.gordie) || !int(o.kills) || !int(o.yeets)) return null;
  if (!num(o.fuel, 1000) || !int(o.round, 1e5) || !int(o.left, 9999) || !num(o.calm, 999)) return null;
  if (!Array.isArray(o.up) || o.up.length !== UPGRADES.length || !o.up.every((v, i) => int(v, UPGRADES[i].max) && v >= 0)) return null;
  return {
    seed: o.seed,
    stage: o.stage,
    phase: o.phase as Phase,
    busHp: o.busHp,
    cash: o.cash as number[],
    prog: o.prog,
    need: o.need,
    done: o.done,
    club: o.club,
    gordie: o.gordie,
    kills: o.kills,
    yeets: o.yeets,
    time: o.time,
    dist: o.dist,
    fuel: o.fuel,
    round: o.round,
    left: o.left,
    calm: o.calm,
    up: o.up as number[],
  };
}

export function readMsg(d: unknown): Msg | null {
  if (!d || typeof d !== 'object') return null;
  const m = d as Record<string, unknown>;
  switch (m.t) {
    case 'start':
{
      const boys = Array.isArray(m.boys) && m.boys.length <= MAX_PLAYERS && m.boys.every((b) => isPick(b) && b >= 0) ? (m.boys as number[]) : null;
      return seed(m.seed) && int(m.driver) && boys ? { t: 'start', seed: m.seed, driver: m.driver, boys } : null;
    }
    case 'pick':
      return isPick(m.b) ? { t: 'pick', b: m.b } : null;
    case 'driver':
      return int(m.id) ? { t: 'driver', id: m.id } : null;
    case 'run': {
      const run = readRun(m.run);
      const ids = (v: unknown) => (Array.isArray(v) && v.length <= 500 && v.every((i) => int(i, 9999)) ? (v as number[]) : null);
      const taken = ids(m.taken);
      const got = ids(m.got);
      return run && taken && got ? { t: 'run', run, taken, got } : null;
    }
    case 'z': {
      const ok = Array.isArray(m.z) && m.z.length <= 7 * 120 && m.z.length % 7 === 0 && m.z.every((v) => int(v, 1e7)) && (m.z as number[]).every((v, i) => i % 7 !== 5 || (v >= 0 && v < Z_STATES.length));
      if (!ok || !Array.isArray(m.fx) || m.fx.length > 60 || !Array.isArray(m.said) || m.said.length > 6 || !m.said.every((s) => str(s, 120))) return null;
      const fx: Fx[] = [];
      for (const f of m.fx as Record<string, unknown>[]) {
        if (!f || !FX.includes(f.k as FxKind) || !num(f.x) || !num(f.y) || !num(f.z) || !num(f.n) || !(f.w === undefined || int(f.w))) return null;
        fx.push(f.w === undefined ? { k: f.k as FxKind, x: f.x, y: f.y, z: f.z, n: f.n } : { k: f.k as FxKind, x: f.x, y: f.y, z: f.z, n: f.n, w: f.w });
      }
      return { t: 'z', z: m.z as number[], fx, said: m.said as string[] };
    }
    case 'bus':
      return num(m.x) && num(m.z) && num(m.h, 1e4) && num(m.v, 60) && num(m.s, 2) && int(m.l, 1e5) ? { t: 'bus', x: m.x, z: m.z, h: m.h, v: m.v, s: m.s, l: m.l } : null;
    case 'aim': {
      if (!num(m.yaw, 100) || !num(m.pitch, 2) || !(m.l === 0 || m.l === 1 || m.l === 2)) return null;
      // On the bus the spot is within the bus; off it, anywhere on the map.
      const far = m.l === 2 ? 1e5 : 6;
      if (!num(m.s, far) || !num(m.a, far)) return null;
      return { t: 'aim', yaw: m.yaw, pitch: m.pitch, s: m.s, a: m.a, l: m.l, ...(m.c === true ? { c: true } : {}) };
    }
    case 'act': {
      const list = (v: unknown, n: number, max: number) => Array.isArray(v) && v.length <= n && v.every((x) => int(x, max));
      if (!int(m.c, 16) || !list(m.shots, ACT_MAX.shots * 6, 1e7) || (m.shots as number[]).length % 6 !== 0) return null;
      if (!list(m.hits, ACT_MAX.hits, 1e9) || !list(m.grabs, ACT_MAX.grabs, 9999) || !list(m.swing, ACT_MAX.swing, 1e9)) return null;
      if (!int(m.g, 16) || !list(m.boom, ACT_MAX.boom, 1e9)) return null;
      return { t: 'act', c: m.c, shots: m.shots as number[], hits: m.hits as number[], grabs: m.grabs as number[], swing: m.swing as number[], g: m.g, boom: m.boom as number[] };
    }
    case 'mini':
      return (m.k === 'golf' || m.k === 'slots') && num(m.v, SLOT_MAX) && m.v >= 0 ? { t: 'mini', k: m.k, v: m.v } : null;
    case 'bj':
      return int(m.v, BJ_MAX) ? { t: 'bj', v: m.v } : null;
    case 'poker':
      return POKER_MOVES.includes(m.m as PokerMove) && int(m.n, 31) && m.n >= 0 ? { t: 'poker', m: m.m as PokerMove, n: m.n } : null;
    case 'table': {
      const v = readPoker(m.v);
      return v ? { t: 'table', v } : null;
    }
    case 'hand': {
      const cards = readCards(m.cards, 2);
      return cards ? { t: 'hand', cards } : null;
    }
    case 'do':
      return DOS.includes(m.k as (typeof DOS)[number]) && int(m.id, 9999) && m.id >= 0 ? { t: 'do', k: m.k as (typeof DOS)[number], id: m.id } : null;
    case 'buy':
      return int(m.k, BUY.bandage) && m.k >= 0 ? { t: 'buy', k: m.k } : null;
    case 'drive':
      return bool(m.want) ? { t: 'drive', want: m.want } : null;
    case 'honk':
      return { t: 'honk' };
    case 'again':
      return { t: 'again' };
  }
  return null;
}

/** Who's driving (-1: nobody) after `who` asks to take the wheel (`want`) or get up: the wheel is first come. */
export function takeWheel(driver: number, who: number, want: boolean): number {
  if (want) return driver === -1 ? who : driver;
  return driver === who ? -1 : driver;
}
