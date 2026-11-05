// Wire messages and their shape checks. Everyone sends their own pose to everyone (~15 Hz); everything else is a
// request to the host (the referee), who answers with public state for all and private state for one. Every
// message is checked here before anything trusts it.

import { isCharId, type CharId } from './cast.ts';
import { CATS, type Cat } from './clues.ts';
import { SAB_KINDS, type SabKind } from './sabotage.ts';
import { DOORS, ROOMS, SPOTS } from './house.ts';
import { cleanSettings, type Phase, type PrivateView, type PublicView, type Role, type Settings, type Status } from './rules.ts';
import { VOICE_KINDS, type VoiceKind, type VoiceMsg } from './voice.ts';

/** Pose flag bits. */
export const PF = { crouch: 1, torch: 2, ghost: 4, sit: 8, point: 16, busy: 32, phone: 64, bongus: 128, sled: 256, watch: 512, smoke: 1024, high: 2048, wired: 4096, hit: 8192, exhale: 16384, green: 32768, od: 65536, doodle: 131072 } as const;

/** Emotes, sent with your pose (0: none). */
export const EMOTES = ['', 'wave', 'point', 'shrug', 'facepalm', 'dance', 'five', 'hug'] as const;
export type Emote = (typeof EMOTES)[number];

type FxKind = 'bonk' | 'bell' | 'rattle' | 'chore' | 'oof' | 'evict' | 'toboggan' | 'burp';

export type Msg =
  // anyone → everyone
  // h: what's in their hand (vices.ts heldCode: 0 nothing, 1 a joint, 2 lit, 3 + n the n-th bong)
  | { t: 'p'; x: number; y: number; z: number; yaw: number; pitch: number; f: number; e: number; h: number }
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
  | { t: 'inspect'; id: number }
  | { t: 'search'; spot: string }
  | { t: 'post'; id: number }
  | { t: 'plant'; cat: Cat; value: string }
  | { t: 'wipe'; id: number }
  | { t: 'unlock'; id: number }
  /** Your ability: a player (-1: none) and a crime (-1: none) when it needs them. */
  | { t: 'power'; target: number; crime: number }
  | { t: 'duo'; spot: string; on: boolean }
  | { t: 'ping' }
  | { t: 'greet'; to: number; k: 'five' | 'hug' }
  | { t: 'sabotage'; kind: SabKind }
  | { t: 'fix'; spot: string }
  | { t: 'sneak'; spot: string }
  | { t: 'shoo' }
  // Helping someone who's greened out or overdone it (sent while holding E on them)
  | { t: 'aid'; to: number }
  // Drawing a moustache on someone who's down
  | { t: 'doodle'; to: number }
  // host → everyone (or one)
  | { t: 'lobby'; picks: [number, CharId][]; s: Settings; live: boolean }
  | { t: 'go' }
  | { t: 'st'; v: PublicView }
  | { t: 'me'; v: PrivateView }
  | { t: 'doors'; open: string[] }
  | { t: 'shoved'; id: number; x: number; z: number; k?: number }
  | { t: 'fx'; k: FxKind; x: number; y: number; z: number }
  | { t: 'end'; why: string }
  /** What a clue you picked up says (to you only). */
  | { t: 'clue'; id: number; cat: Cat; value: string; crime: number }
  /** What your search turned up: a clue id, or -1 for nothing. */
  | { t: 'found'; spot: string; id: number }
  /** The house group chat: case texts, photos, announcements. */
  | { t: 'feed'; from: string; text: string; clue: number }
  /** Your ability's result (to you only): a line, places to glow, clues to sparkle, until when (roam). */
  | { t: 'pw'; text: string; pos: [number, number, number][]; ids: number[]; until: number }
  /** Your phone buzzes with an arrow to somewhere (Worrier, Always Down). */
  | { t: 'buzz'; x: number; y: number; z: number; text: string }
  /** Bike Stu's randoms: [x, y, z, yaw] each (empty: they've gone home). */
  | { t: 'npcs'; p: [number, number, number, number][] }
  | { t: 'greeted'; a: number; b: number; k: 'five' | 'hug' }
  /** A sneak route: you come out here. */
  | { t: 'warp'; x: number; y: number; z: number }
  // A friend got you through it
  | { t: 'aided'; by: number }
  | { t: 'doodled'; by: number }
  /** The raccoon: [x, y, z, yaw], or null when it's back on its balcony. */
  | { t: 'coon'; p: [number, number, number, number] | null }
  /** At the reveal, a takeout seen from above: who, whom, and frames of [id, x, z, floor]. */
  | { t: 'replay'; k: number; v: number; f: [number, number, number, number][][] };

const num = (v: unknown, lim = 1e6): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= -1 && v < 1e9;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const arr = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max;
const DOOR_IDS = new Set(DOORS.map((d) => d.id));
const SPOT_IDS = new Set(SPOTS.map((s) => s.id));
const PHASES: Phase[] = ['intro', 'night', 'meeting', 'vote', 'result', 'over'];
const STATUSES: Status[] = ['in', 'dead', 'out', 'gone'];
const ROLES: Role[] = ['housemate', 'degenerate'];
const FX: FxKind[] = ['bonk', 'bell', 'rattle', 'chore', 'oof', 'evict', 'toboggan', 'burp'];
const ROOM_IDS = new Set(ROOMS.map((r) => r.id));
const isCat = (v: unknown): v is Cat => typeof v === 'string' && (CATS as string[]).includes(v);

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
    if (!w || !['housemates', 'degenerates'].includes(w.side as string) || !str(w.why, 200) || !arr(w.roles, 16) || !arr(w.log, 120)) return null;
    for (const r of w.roles) if (!arr(r, 2) || !int(r[0]) || !ROLES.includes(r[1] as Role)) return null;
    for (const l of w.log) if (!arr(l, 2) || !num(l[0]) || !str(l[1], 200)) return null;
    if (!arr(w.awards, 30)) return null;
    for (const a of w.awards) if (!arr(a, 3) || !str(a[0], 30) || !int(a[1]) || !str(a[2], 80)) return null;
  }
  if (!arr(s.crimes, 40) || !arr(s.clues, 120) || !arr(s.posted, 120)) return null;
  for (const c of s.crimes) if (!arr(c, 3) || !(c[0] === 0 || c[0] === 1) || !int(c[1]) || !ROOM_IDS.has(c[2] as string)) return null;
  for (const c of s.clues) if (!arr(c, 7) || !int(c[0]) || !int(c[1]) || !isCat(c[2]) || !num(c[3], 100) || !num(c[4], 100) || !num(c[5], 100) || ![0, 1, 2].includes(c[6] as number)) return null;
  if (!int(s.doubled) || !arr(s.duo, 4) || !s.duo.every((d) => SPOT_IDS.has(d as string))) return null;
  if (s.shirt !== null && (!arr(s.shirt, 3) || !s.shirt.every((v) => num(v, 100)))) return null;
  if (s.sab !== null) {
    const b = s.sab as unknown[];
    if (!arr(b, 4) || !SAB_KINDS.includes(b[0] as SabKind) || !num(b[1]) || !int(b[2]) || !arr(b[3], 4) || !(b[3] as unknown[]).every((x) => SPOT_IDS.has(x as string))) return null;
  }
  for (const c of s.posted) if (!arr(c, 5) || !int(c[0]) || !isCat(c[1]) || !str(c[2], 24) || !int(c[3]) || !int(c[4])) return null;
  return v as PublicView;
}

function readPrivate(v: unknown): PrivateView | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (!ROLES.includes(s.role as Role) || !arr(s.mates, 16) || !s.mates.every(int) || !arr(s.tasks, 12)) return null;
  for (const t of s.tasks) if (!arr(t, 2) || !SPOT_IDS.has(t[0] as string) || typeof t[1] !== 'boolean') return null;
  if (!num(s.killAt) || typeof s.rang !== 'boolean' || !num(s.rattleAt) || !int(s.plants) || !arr(s.seen, 120)) return null;
  if (!arr(s.power, 2) || !int(s.power[0]) || !num(s.power[1]) || !num(s.sabAt)) return null;
  for (const c of s.seen) if (!arr(c, 4) || !int(c[0]) || !isCat(c[1]) || !str(c[2], 24) || !int(c[3])) return null;
  return v as PrivateView;
}

/** A voice-chat signalling message (voice.ts), or null. SDP and ICE are opaque strings to us. */
export function readVoice(d: unknown): VoiceMsg | null {
  if (!d || typeof d !== 'object') return null;
  const m = d as Record<string, unknown>;
  return m.t === 'vc' && VOICE_KINDS.includes(m.k as VoiceKind) && str(m.d, 7000) ? { t: 'vc', k: m.k as VoiceKind, d: m.d } : null;
}

/** Checks a message's shape; null if it's anything unexpected. */
export function readMsg(d: unknown): Msg | null {
  if (!d || typeof d !== 'object') return null;
  const m = d as Record<string, unknown>;
  switch (m.t) {
    case 'p':
      return num(m.x, 100) && num(m.y, 100) && num(m.z, 100) && num(m.yaw, 100) && num(m.pitch, 2) && int(m.f) && m.f >= 0 && m.f < 262144
        ? { t: 'p', x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, f: m.f, e: int(m.e) && m.e > 0 && m.e < EMOTES.length ? m.e : 0, h: int(m.h) && m.h >= 0 && m.h <= 6 ? m.h : 0 }
        : null;
    case 'chat':
      return str(m.text, 160) && m.text.trim() ? { t: 'chat', text: m.text.trim() } : null;
    case 'hi':
    case 'bell':
    case 'rattle':
    case 'go':
    case 'ping':
    case 'shoo':
      return { t: m.t };
    case 'pick':
      return isCharId(m.c) ? { t: 'pick', c: m.c } : null;
    case 'aid':
      return int(m.to) ? { t: 'aid', to: m.to } : null;
    case 'aided':
      return int(m.by) ? { t: 'aided', by: m.by } : null;
    case 'doodle':
      return int(m.to) ? { t: 'doodle', to: m.to } : null;
    case 'doodled':
      return int(m.by) ? { t: 'doodled', by: m.by } : null;
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
    case 'search':
      return typeof m.spot === 'string' && SPOT_IDS.has(m.spot) ? { t: 'search', spot: m.spot } : null;
    case 'inspect':
    case 'post':
    case 'wipe':
    case 'unlock':
      return int(m.id) && m.id >= 0 ? { t: m.t, id: m.id } : null;
    case 'plant':
      return isCat(m.cat) && str(m.value, 24) ? { t: 'plant', cat: m.cat, value: m.value } : null;
    case 'clue':
      return int(m.id) && isCat(m.cat) && str(m.value, 24) && int(m.crime) ? { t: 'clue', id: m.id, cat: m.cat, value: m.value, crime: m.crime } : null;
    case 'found':
      return typeof m.spot === 'string' && SPOT_IDS.has(m.spot) && int(m.id) ? { t: 'found', spot: m.spot, id: m.id } : null;
    case 'sabotage':
      return SAB_KINDS.includes(m.kind as SabKind) ? { t: 'sabotage', kind: m.kind as SabKind } : null;
    case 'fix':
    case 'sneak':
      return typeof m.spot === 'string' && SPOT_IDS.has(m.spot) ? { t: m.t, spot: m.spot } : null;
    case 'warp':
      return num(m.x, 100) && num(m.y, 100) && num(m.z, 100) ? { t: 'warp', x: m.x, y: m.y, z: m.z } : null;
    case 'coon':
      if (m.p === null) return { t: 'coon', p: null };
      return arr(m.p, 4) && m.p.length === 4 && m.p.every((v) => num(v, 100)) ? { t: 'coon', p: m.p as [number, number, number, number] } : null;
    case 'replay': {
      if (!int(m.k) || !int(m.v) || !arr(m.f, 40)) return null;
      for (const fr of m.f) {
        if (!arr(fr, 16)) return null;
        for (const e of fr) if (!arr(e, 4) || e.length !== 4 || !e.every((v) => num(v, 100))) return null;
      }
      return { t: 'replay', k: m.k, v: m.v, f: m.f as [number, number, number, number][][] };
    }
    case 'power':
      return int(m.target) && int(m.crime) ? { t: 'power', target: m.target, crime: m.crime } : null;
    case 'duo':
      return typeof m.spot === 'string' && SPOT_IDS.has(m.spot) && typeof m.on === 'boolean' ? { t: 'duo', spot: m.spot, on: m.on } : null;
    case 'greet':
    case 'greeted': {
      if (m.k !== 'five' && m.k !== 'hug') return null;
      if (m.t === 'greet') return int(m.to) ? { t: 'greet', to: m.to, k: m.k } : null;
      return int(m.a) && int(m.b) ? { t: 'greeted', a: m.a, b: m.b, k: m.k } : null;
    }
    case 'pw': {
      if (!str(m.text, 1500) || !num(m.until) || !arr(m.pos, 30) || !arr(m.ids, 60) || !m.ids.every(int)) return null;
      for (const p of m.pos) if (!arr(p, 3) || p.length !== 3 || !p.every((v) => num(v, 100))) return null;
      return { t: 'pw', text: m.text, pos: m.pos as [number, number, number][], ids: m.ids as number[], until: m.until };
    }
    case 'buzz':
      return num(m.x, 100) && num(m.y, 100) && num(m.z, 100) && str(m.text, 160) ? { t: 'buzz', x: m.x, y: m.y, z: m.z, text: m.text } : null;
    case 'npcs': {
      if (!arr(m.p, 4)) return null;
      for (const p of m.p) if (!arr(p, 4) || p.length !== 4 || !p.every((v) => num(v, 100))) return null;
      return { t: 'npcs', p: m.p as [number, number, number, number][] };
    }
    case 'feed':
      return str(m.from, 40) && str(m.text, 300) && int(m.clue) ? { t: 'feed', from: m.from, text: m.text, clue: m.clue } : null;
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
      if (m.k !== undefined && !(num(m.k, 3) && m.k >= 1)) return null;
      return int(m.id) && num(m.x, 2) && num(m.z, 2) ? { t: 'shoved', id: m.id, x: m.x, z: m.z, ...(m.k !== undefined && { k: m.k }) } : null;
    case 'fx':
      return FX.includes(m.k as FxKind) && num(m.x, 100) && num(m.y, 100) && num(m.z, 100) ? { t: 'fx', k: m.k as FxKind, x: m.x, y: m.y, z: m.z } : null;
    case 'end':
      return str(m.why, 120) ? { t: 'end', why: m.why } : null;
  }
  return null;
}
