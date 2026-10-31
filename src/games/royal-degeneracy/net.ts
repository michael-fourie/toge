// Wire messages and their shape checks. Everyone sends their own pose to everyone (~15 Hz); everything else is a
// request to the host (the referee), who answers with public state for all and private state for one. Every
// message is checked here before anything trusts it.

import { isCharId, type CharId } from './cast.ts';
import { DOORS, SPOTS } from './house.ts';
import { cleanSettings, type Phase, type PrivateView, type PublicView, type Role, type Settings, type Status } from './rules.ts';

/** Pose flag bits. */
export const PF = { crouch: 1, torch: 2, ghost: 4, sit: 8, point: 16, busy: 32, phone: 64 } as const;

type FxKind = 'bonk' | 'bell' | 'rattle' | 'chore' | 'oof' | 'evict';

export type Msg =
  // anyone → everyone
  | { t: 'p'; x: number; y: number; z: number; yaw: number; pitch: number; f: number }
  | { t: 'chat'; text: string }
  // player → host
  | { t: 'hi' }
  | { t: 'pick'; c: CharId }
  | { t: 'door'; id: string }
  | { t: 'shove'; to: number }
  | { t: 'kill'; v: number }
  | { t: 'report'; body: number }
  | { t: 'bell' }
  | { t: 'vote'; v: number }
  | { t: 'chore'; spot: string }
  | { t: 'rattle' }
  // host → everyone (or one)
  | { t: 'lobby'; picks: [number, CharId][]; s: Settings; live: boolean }
  | { t: 'go' }
  | { t: 'st'; v: PublicView }
  | { t: 'me'; v: PrivateView }
  | { t: 'doors'; open: string[] }
  | { t: 'shoved'; id: number; x: number; z: number }
  | { t: 'fx'; k: FxKind; x: number; y: number; z: number }
  | { t: 'end'; why: string };

const num = (v: unknown, lim = 1e6): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= -1 && v < 1e9;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const arr = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max;
const DOOR_IDS = new Set(DOORS.map((d) => d.id));
const SPOT_IDS = new Set(SPOTS.map((s) => s.id));
const PHASES: Phase[] = ['intro', 'night', 'meeting', 'vote', 'result', 'over'];
const STATUSES: Status[] = ['in', 'dead', 'out', 'gone'];
const ROLES: Role[] = ['housemate', 'degenerate'];
const FX: FxKind[] = ['bonk', 'bell', 'rattle', 'chore', 'oof', 'evict'];

function readPublic(v: unknown): PublicView | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (!str(s.caseId, 24) || !PHASES.includes(s.ph as Phase) || !num(s.left) || !num(s.roam) || !num(s.len) || !num(s.prog, 1)) return null;
  if (!arr(s.people, 16) || !arr(s.bodies, 16) || !arr(s.seats, 16) || !arr(s.voted, 16)) return null;
  for (const p of s.people) if (!arr(p, 3) || !int(p[0]) || !isCharId(p[1]) || !STATUSES.includes(p[2] as Status)) return null;
  for (const b of s.bodies) if (!arr(b, 4) || !int(b[0]) || !num(b[1], 100) || !num(b[2], 100) || !num(b[3], 100)) return null;
  if (!s.seats.every(int) || !s.voted.every(int)) return null;
  if (s.meet !== null) {
    const m = s.meet as Record<string, unknown>;
    if (!m || !['body', 'bell', 'last'].includes(m.kind as string) || !int(m.by) || (m.body !== undefined && !int(m.body))) return null;
  }
  if (s.result !== null) {
    const r = s.result as Record<string, unknown>;
    if (!r || !(r.out === null || int(r.out)) || !(r.deg === null || typeof r.deg === 'boolean')) return null;
    if (!arr(r.counts, 16) || !arr(r.votes, 16)) return null;
    for (const c of [...r.counts, ...r.votes]) if (!arr(c, 2) || !int(c[0]) || !int(c[1])) return null;
  }
  if (s.win !== null) {
    const w = s.win as Record<string, unknown>;
    if (!w || !['housemates', 'degenerates'].includes(w.side as string) || !str(w.why, 200) || !arr(w.roles, 16)) return null;
    for (const r of w.roles) if (!arr(r, 2) || !int(r[0]) || !ROLES.includes(r[1] as Role)) return null;
  }
  return v as PublicView;
}

function readPrivate(v: unknown): PrivateView | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (!ROLES.includes(s.role as Role) || !arr(s.mates, 16) || !s.mates.every(int) || !arr(s.tasks, 12)) return null;
  for (const t of s.tasks) if (!arr(t, 2) || !SPOT_IDS.has(t[0] as string) || typeof t[1] !== 'boolean') return null;
  if (!num(s.killAt) || typeof s.rang !== 'boolean' || !num(s.rattleAt)) return null;
  return v as PrivateView;
}

/** Checks a message's shape; null if it's anything unexpected. */
export function readMsg(d: unknown): Msg | null {
  if (!d || typeof d !== 'object') return null;
  const m = d as Record<string, unknown>;
  switch (m.t) {
    case 'p':
      return num(m.x, 100) && num(m.y, 100) && num(m.z, 100) && num(m.yaw, 100) && num(m.pitch, 2) && int(m.f) && m.f >= 0 && m.f < 256
        ? { t: 'p', x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, f: m.f }
        : null;
    case 'chat':
      return str(m.text, 160) && m.text.trim() ? { t: 'chat', text: m.text.trim() } : null;
    case 'hi':
    case 'bell':
    case 'rattle':
    case 'go':
      return { t: m.t };
    case 'pick':
      return isCharId(m.c) ? { t: 'pick', c: m.c } : null;
    case 'door':
      return typeof m.id === 'string' && DOOR_IDS.has(m.id) ? { t: 'door', id: m.id } : null;
    case 'shove':
      return int(m.to) ? { t: 'shove', to: m.to } : null;
    case 'kill':
      return int(m.v) ? { t: 'kill', v: m.v } : null;
    case 'report':
      return int(m.body) ? { t: 'report', body: m.body } : null;
    case 'vote':
      return int(m.v) ? { t: 'vote', v: m.v } : null;
    case 'chore':
      return typeof m.spot === 'string' && SPOT_IDS.has(m.spot) ? { t: 'chore', spot: m.spot } : null;
    case 'lobby': {
      const s = cleanSettings(m.s);
      if (!s || !arr(m.picks, 16) || typeof m.live !== 'boolean') return null;
      const picks: [number, CharId][] = [];
      for (const p of m.picks) if (arr(p, 2) && int(p[0]) && isCharId(p[1])) picks.push([p[0], p[1]]);
      return { t: 'lobby', picks, s, live: m.live };
    }
    case 'st': {
      const v = readPublic(m.v);
      return v ? { t: 'st', v } : null;
    }
    case 'me': {
      const v = readPrivate(m.v);
      return v ? { t: 'me', v } : null;
    }
    case 'doors':
      return arr(m.open, DOORS.length) && m.open.every((id) => typeof id === 'string' && DOOR_IDS.has(id)) ? { t: 'doors', open: m.open as string[] } : null;
    case 'shoved':
      return int(m.id) && num(m.x, 2) && num(m.z, 2) ? { t: 'shoved', id: m.id, x: m.x, z: m.z } : null;
    case 'fx':
      return FX.includes(m.k as FxKind) && num(m.x, 100) && num(m.y, 100) && num(m.z, 100) ? { t: 'fx', k: m.k as FxKind, x: m.x, y: m.y, z: m.z } : null;
    case 'end':
      return str(m.why, 120) ? { t: 'end', why: m.why } : null;
  }
  return null;
}
