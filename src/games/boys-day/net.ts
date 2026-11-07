// The messages a run sends through the party room, and readMsg, which checks each one's shape before anything uses
// it (party data is untrusted). Host → everyone: start, who's driving, run state, zombies (with the effects since the
// last batch). Players → everyone: the driver's bus pose, where they are on the bus and where they're looking, and
// 'act' (a tenth of a second's shots, hits, pickups and club swings in one message), minigame results, asking for
// the wheel, honks. Batching keeps a busy player well under the
// party relay's 60 messages a second.

import { Z_STATES, type FxKind } from './director.ts';
import { BUS, SEED_MAX, SLOT_MAX, type Phase, type RunState } from './rules.ts';

export type Msg =
  | { t: 'start'; seed: number; driver: number }
  | { t: 'driver'; id: number }
  | { t: 'run'; run: RunState; taken: number[] }
  | { t: 'z'; z: number[]; fx: { k: FxKind; x: number; y: number; z: number; n: number }[]; said: string[] }
  | { t: 'bus'; x: number; z: number; h: number; v: number; s: number }
  /** Where you are on the bus (bus-local `s`ide and `a`long, `l`evel 0 inside or 1 on the roof) and your look. */
  | { t: 'aim'; yaw: number; pitch: number; s: number; a: number; l: 0 | 1 }
  | Act
  | { t: 'mini'; k: 'golf' | 'casino'; v: number }
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
}

export const ACT_MAX = { shots: 20, hits: 20, grabs: 6, swing: 8 } as const;

const FX: FxKind[] = ['yeet', 'fore', 'splat', 'gordie', 'grab', 'hurt', 'shake', 'heal', 'bump', 'round'];
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
  if (!num(o.busHp) || !int(o.money) || !int(o.teed, 99) || !num(o.hold, 999) || !num(o.time)) return null;
  if (!bool(o.bailPaid) || !bool(o.club) || !bool(o.gordie) || !int(o.kills) || !int(o.yeets)) return null;
  if (!int(o.tees, 99) || !int(o.bail, 1e5) || !num(o.fuel, 1000) || !int(o.round, 999) || !int(o.left, 9999) || !num(o.calm, 999)) return null;
  return {
    seed: o.seed,
    stage: o.stage,
    phase: o.phase as Phase,
    busHp: o.busHp,
    money: o.money,
    teed: o.teed,
    tees: o.tees,
    bail: o.bail,
    fuel: o.fuel,
    round: o.round,
    left: o.left,
    calm: o.calm,
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
      return seed(m.seed) && int(m.driver) ? { t: 'start', seed: m.seed, driver: m.driver } : null;
    case 'driver':
      return int(m.id) ? { t: 'driver', id: m.id } : null;
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
      return num(m.yaw, 100) && num(m.pitch, 2) && num(m.s, BUS.width) && num(m.a, BUS.length) && (m.l === 0 || m.l === 1)
        ? { t: 'aim', yaw: m.yaw, pitch: m.pitch, s: m.s, a: m.a, l: m.l }
        : null;
    case 'act': {
      const list = (v: unknown, n: number, max: number) => Array.isArray(v) && v.length <= n && v.every((x) => int(x, max));
      if (!int(m.c, 16) || !list(m.shots, ACT_MAX.shots * 6, 1e7) || (m.shots as number[]).length % 6 !== 0) return null;
      if (!list(m.hits, ACT_MAX.hits, 1e9) || !list(m.grabs, ACT_MAX.grabs, 9999) || !list(m.swing, ACT_MAX.swing, 1e9)) return null;
      return { t: 'act', c: m.c, shots: m.shots as number[], hits: m.hits as number[], grabs: m.grabs as number[], swing: m.swing as number[] };
    }
    case 'mini':
      return (m.k === 'golf' || m.k === 'casino') && num(m.v, SLOT_MAX) && m.v >= 0 ? { t: 'mini', k: m.k, v: m.v } : null;
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
