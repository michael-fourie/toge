// The messages a run sends through the party room, and readMsg, which checks each one's shape before anything uses
// it (party data is untrusted). Host → everyone: start, seats, run state, zombies (with the effects since the last
// batch). Players → everyone: the driver's bus pose, aim, and 'act' (a tenth of a second's shots, hits, pickups and
// club swings in one message), minigame results, seat requests, honks. Batching keeps a busy player well under the
// party relay's 60 messages a second.

import { Z_STATES, type FxKind } from './director.ts';
import { MAX_PLAYERS, SEED_MAX, SLOT_MAX, type Phase, type RunState } from './rules.ts';

export type Msg =
  | { t: 'start'; seed: number; seats: number[] }
  | { t: 'seats'; seats: number[] }
  | { t: 'run'; run: RunState; taken: number[] }
  | { t: 'z'; z: number[]; fx: { k: FxKind; x: number; y: number; z: number; n: number }[]; said: string[] }
  | { t: 'bus'; x: number; z: number; h: number; v: number; s: number }
  | { t: 'aim'; yaw: number; pitch: number }
  | Act
  | { t: 'mini'; k: 'golf' | 'casino'; v: number }
  | { t: 'seat'; want: number }
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
}

export const ACT_MAX = { shots: 20, hits: 20, grabs: 6, swing: 8 } as const;

const FX: FxKind[] = ['yeet', 'fore', 'splat', 'gordie', 'grab', 'hurt', 'shake', 'heal'];
const PHASES: Phase[] = ['drive', 'stop', 'won', 'lost'];

const num = (v: unknown, max = 1e6): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;
const int = (v: unknown, max = 1e9): v is number => Number.isInteger(v) && Math.abs(v as number) <= max;
const seed = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < SEED_MAX;
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

function readRun(r: unknown): RunState | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  if (!seed(o.seed) || !int(o.stage, 10) || !PHASES.includes(o.phase as Phase)) return null;
  if (!num(o.busHp) || !int(o.money) || !int(o.teed, 10) || !num(o.hold, 999) || !num(o.time)) return null;
  if (!bool(o.bailPaid) || !bool(o.club) || !bool(o.gordie) || !int(o.kills) || !int(o.yeets)) return null;
  return {
    seed: o.seed,
    stage: o.stage,
    phase: o.phase as Phase,
    busHp: o.busHp,
    money: o.money,
    teed: o.teed,
    hold: o.hold,
    bailPaid: o.bailPaid,
    club: o.club,
    gordie: o.gordie,
    kills: o.kills,
    yeets: o.yeets,
    time: o.time,
  };
}

export function readMsg(d: unknown): Msg | null {
  if (!d || typeof d !== 'object') return null;
  const m = d as Record<string, unknown>;
  switch (m.t) {
    case 'start':
      return seed(m.seed) && Array.isArray(m.seats) && m.seats.length <= MAX_PLAYERS && m.seats.every((s) => int(s)) ? { t: 'start', seed: m.seed, seats: m.seats as number[] } : null;
    case 'seats':
      return Array.isArray(m.seats) && m.seats.length <= MAX_PLAYERS && m.seats.every((s) => int(s)) ? { t: 'seats', seats: m.seats as number[] } : null;
    case 'run': {
      const run = readRun(m.run);
      const taken = Array.isArray(m.taken) && m.taken.length <= 500 && m.taken.every((i) => int(i, 9999)) ? (m.taken as number[]) : null;
      return run && taken ? { t: 'run', run, taken } : null;
    }
    case 'z': {
      const ok = Array.isArray(m.z) && m.z.length <= 7 * 120 && m.z.length % 7 === 0 && m.z.every((v) => int(v, 1e7)) && (m.z as number[]).every((v, i) => i % 7 !== 5 || (v >= 0 && v < Z_STATES.length));
      if (!ok || !Array.isArray(m.fx) || m.fx.length > 60 || !Array.isArray(m.said) || m.said.length > 6 || !m.said.every((s) => str(s, 120))) return null;
      const fx = [];
      for (const f of m.fx as Record<string, unknown>[]) {
        if (!f || !FX.includes(f.k as FxKind) || !num(f.x) || !num(f.y) || !num(f.z) || !num(f.n)) return null;
        fx.push({ k: f.k as FxKind, x: f.x, y: f.y, z: f.z, n: f.n });
      }
      return { t: 'z', z: m.z as number[], fx, said: m.said as string[] };
    }
    case 'bus':
      return num(m.x) && num(m.z) && num(m.h, 1e4) && num(m.v, 60) && num(m.s, 2) ? { t: 'bus', x: m.x, z: m.z, h: m.h, v: m.v, s: m.s } : null;
    case 'aim':
      return num(m.yaw, 100) && num(m.pitch, 2) ? { t: 'aim', yaw: m.yaw, pitch: m.pitch } : null;
    case 'act': {
      const list = (v: unknown, n: number, max: number) => Array.isArray(v) && v.length <= n && v.every((x) => int(x, max));
      if (!int(m.c, 16) || !list(m.shots, ACT_MAX.shots * 6, 1e7) || (m.shots as number[]).length % 6 !== 0) return null;
      if (!list(m.hits, ACT_MAX.hits, 1e9) || !list(m.grabs, ACT_MAX.grabs, 9999) || !list(m.swing, ACT_MAX.swing, 1e9)) return null;
      return { t: 'act', c: m.c, shots: m.shots as number[], hits: m.hits as number[], grabs: m.grabs as number[], swing: m.swing as number[] };
    }
    case 'mini':
      return (m.k === 'golf' || m.k === 'casino') && num(m.v, SLOT_MAX) && m.v >= 0 ? { t: 'mini', k: m.k, v: m.v } : null;
    case 'seat':
      return int(m.want, MAX_PLAYERS) && m.want >= -1 ? { t: 'seat', want: m.want } : null;
    case 'honk':
      return { t: 'honk' };
    case 'again':
      return { t: 'again' };
  }
  return null;
}

/**
 * Who sits where: `seats[i]` is the player in seat i (0 is the driver), -1 if it's empty. A player asking for a seat
 * gets it if it's free (leaving their old one); asking for -1 means any free window.
 */
export function takeSeat(seats: readonly number[], who: number, want: number): number[] {
  const out = seats.slice();
  const now = out.indexOf(who);
  const free = want >= 0 ? (out[want] === -1 ? want : -1) : out.findIndex((s, i) => i > 0 && s === -1);
  if (free < 0 || free === now) return out;
  if (now >= 0) out[now] = -1;
  out[free] = who;
  return out;
}

/** The opening seats: the host drives, everyone else takes a window in join order. */
export function firstSeats(ids: readonly number[], driver: number): number[] {
  const seats = Array<number>(MAX_PLAYERS).fill(-1);
  seats[0] = driver;
  let i = 1;
  for (const id of ids) if (id !== driver && i < MAX_PLAYERS) seats[i++] = id;
  return seats;
}
