// The referee's logic, pure: lobby picks and settings, roles, the night's phases and clock, takeouts, reports and
// the bell, meetings and votes, evictions, chores and every win. The host's browser runs it (game.ts) and sends
// everyone the public view, and each player their private one.

import { CHAR_IDS, tagFor, type CharId } from './cast.ts';
import { CASES, caseById } from './cases.ts';
import { PLANTS_PER_NIGHT, caseTexts, commitCrime, log, newMystery, nextRand, type Mystery } from './clues.ts';
import { CHORE_KINDS, FLOOR_Y, ROOMS, SEATS, SPOTS, roomAt } from './house.ts';
import type { Vec3 } from '../../shared/math.ts';

// ---------------------------------------------------------------------------------------------
// Settings

export interface Settings {
  /** A case id or 'random'. */
  caseId: string;
  /** 0 = by player count. */
  degenerates: number;
  nightMin: number;
  killCd: number;
  discuss: number;
  vote: number;
  /** Say whether the evicted player was a Degenerate. */
  reveal: boolean;
  /** Hide who voted for whom. */
  anon: boolean;
}

export const DEFAULT_SETTINGS: Settings = { caseId: 'random', degenerates: 0, nightMin: 10, killCd: 30, discuss: 60, vote: 30, reveal: true, anon: false };

/** What each numeric setting can be (the lobby cycles through them). */
export const CHOICES = {
  degenerates: [0, 1, 2, 3],
  nightMin: [6, 8, 10, 12, 15],
  killCd: [20, 30, 45, 60],
  discuss: [30, 45, 60, 90, 120],
  vote: [20, 30, 45, 60],
} as const;

export function cleanSettings(v: unknown): Settings | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  const pick = <K extends keyof typeof CHOICES>(k: K): number | null => ((CHOICES[k] as readonly number[]).includes(s[k] as number) ? (s[k] as number) : null);
  const caseOk = s.caseId === 'random' || CASES.some((c) => c.id === s.caseId);
  const deg = pick('degenerates');
  const night = pick('nightMin');
  const cd = pick('killCd');
  const disc = pick('discuss');
  const vote = pick('vote');
  if (!caseOk || deg === null || night === null || cd === null || disc === null || vote === null) return null;
  if (typeof s.reveal !== 'boolean' || typeof s.anon !== 'boolean') return null;
  return { caseId: s.caseId as string, degenerates: deg, nightMin: night, killCd: cd, discuss: disc, vote, reveal: s.reveal, anon: s.anon };
}

/** Degenerates for a night: 1 for 4–6 players, 2 for 7–10, 3 for 11–12, never so many the night starts won. */
export function degeneratesFor(players: number, setting: number): number {
  const auto = players >= 11 ? 3 : players >= 7 ? 2 : 1;
  return Math.max(0, Math.min(setting || auto, Math.floor((players - 1) / 2)));
}

export const MIN_PLAYERS = 4;

// ---------------------------------------------------------------------------------------------
// Lobby picks: the cast are one each, guests are unlimited

/** Tries to give `who` the character `want`; false if someone else has them. */
export function pickCharacter(picks: Map<number, CharId>, who: number, want: CharId): boolean {
  if (want !== 'guest') for (const [id, c] of picks) if (c === want && id !== who) return false;
  picks.set(who, want);
  return true;
}

/** Fills in anyone who hasn't picked (the first free housemate, else a guest) and drops people who left. */
export function settlePicks(picks: Map<number, CharId>, roster: readonly number[]): Map<number, CharId> {
  const out = new Map<number, CharId>();
  for (const id of roster) {
    const c = picks.get(id);
    if (c) out.set(id, c);
  }
  for (const id of roster) {
    if (out.has(id)) continue;
    const taken = new Set(out.values());
    out.set(id, CHAR_IDS.find((c) => c !== 'guest' && !taken.has(c)) ?? 'guest');
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Dice

function shuffle<T>(arr: T[], r: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------------------------
// The night

export const TIMES = {
  intro: 8,
  result: 7,
  over: 16,
  /** No takeouts in the first seconds of a night, or just after a meeting. */
  firstKill: 15,
  afterMeeting: 10,
  rattle: 30,
};

/** Reach for a takeout (plus slack for 100 ms of interpolation between two moving players). */
export const KILL_RANGE = 1.5;
const KILL_SLACK = 1;
export const REPORT_RANGE = 2;

export type Role = 'housemate' | 'degenerate';
export type Phase = 'intro' | 'night' | 'meeting' | 'vote' | 'result' | 'over';
type Side = 'housemates' | 'degenerates';
export type MeetKind = 'body' | 'bell' | 'last';

interface Task {
  spot: string;
  done: boolean;
}

export interface Player {
  id: number;
  name: string;
  char: CharId;
  role: Role;
  alive: boolean;
  evicted: boolean;
  /** Left the room mid-night (counts as taken out, no body). */
  gone: boolean;
  /** Has used their one bell ring. */
  rang: boolean;
  /** Roam time (s) from which they can take someone out. */
  killAt: number;
  /** Roam time of their last ghost rattle. */
  rattleAt: number;
  tasks: Task[];
}

interface Body {
  id: number;
  pos: Vec3;
}

interface Result {
  out: number | null;
  counts: [number, number][];
  /** Was the evicted one a Degenerate (only if the host reveals it). */
  deg: boolean | null;
  votes: [number, number][];
}

interface Win {
  side: Side;
  why: string;
}

export interface Night {
  settings: Settings;
  caseId: string;
  phase: Phase;
  /** Seconds left in the current phase (the night's own clock is `roam`). */
  left: number;
  /** Free-roam seconds so far; meetings don't count. */
  roam: number;
  /** Roam seconds until the Last Meeting. */
  length: number;
  players: Player[];
  bodies: Body[];
  meet: { kind: MeetKind; by: number; body?: number } | null;
  seats: number[];
  votes: Map<number, number>;
  result: Result | null;
  win: Win | null;
  /** Crimes, clues, plants, the log (clues.ts). */
  mystery: Mystery;
  /** The referee's dice state (clues.ts `nextRand`). */
  rs: number;
}

export interface Joiner {
  id: number;
  name: string;
  char: CharId;
}

const SKIP = -1;

/** Deals roles and chores for a fresh night. */
export function newNight(people: readonly Joiner[], settings: Settings, seed: number): Night {
  const n: Night = {
    settings,
    caseId: CASES[0].id,
    phase: 'intro',
    left: TIMES.intro,
    roam: 0,
    length: settings.nightMin * 60,
    players: [],
    bodies: [],
    meet: null,
    seats: [],
    votes: new Map(),
    result: null,
    win: null,
    mystery: newMystery(),
    rs: seed >>> 0,
  };
  const r = () => nextRand(n);
  n.caseId = settings.caseId === 'random' ? CASES[Math.floor(r() * CASES.length)].id : settings.caseId;
  const degs = degeneratesFor(people.length, settings.degenerates);
  const order = shuffle(people.map((_, i) => i), r);
  n.players = people.map((p, i): Player => ({
    ...p,
    role: order.indexOf(i) < degs ? 'degenerate' : 'housemate',
    alive: true,
    evicted: false,
    gone: false,
    rang: false,
    killAt: TIMES.firstKill,
    rattleAt: -Infinity,
    tasks: CHORE_KINDS.map((kind) => {
      const options = SPOTS.filter((s) => s.chore === kind);
      return { spot: options[Math.floor(r() * options.length)].id, done: false };
    }),
  }));
  // The case's crime happened before the night began: one of the Degenerates did it, and it left clues.
  const c = caseById(n.caseId);
  const culprits = n.players.filter((p) => p.role === 'degenerate');
  if (culprits.length) {
    const by = culprits[Math.floor(r() * culprits.length)];
    const room = ROOMS.find((x) => x.id === c.scene.room)!;
    commitCrime(n, 'case', by.id, { x: c.scene.x, y: FLOOR_Y[room.floor], z: c.scene.z }, room.id, 2, 1);
    log(n, `Before the night began: ${tagFor(by.char, by.name)} ${c.scene.did}.`);
  }
  n.mystery.texts = caseTexts(n, c.texts);
  return n;
}

export const playerOf = (n: Night, id: number) => n.players.find((p) => p.id === id);
/** In the house: not taken out, not evicted, not gone. */
export const living = (p: Player) => p.alive && !p.evicted && !p.gone;

/** The chore bar: real (housemates') chores done, from 0 to 1. Gone players' chores don't count. */
function progress(n: Night): number {
  let done = 0;
  let all = 0;
  for (const p of n.players) {
    if (p.role !== 'housemate' || p.gone) continue;
    all += p.tasks.length;
    done += p.tasks.filter((t) => t.done).length;
  }
  return all ? done / all : 0;
}

/** Who has won, if anyone (the Last Meeting is settled where the vote ends). */
function winner(n: Night): Win | null {
  const degs = n.players.filter((p) => p.role === 'degenerate');
  const inDegs = degs.filter(living).length;
  const inHouse = n.players.filter((p) => p.role === 'housemate' && living(p)).length;
  if (degs.length && !inDegs) return { side: 'housemates', why: 'Every Degenerate is out of the house.' };
  if (progress(n) >= 1) return { side: 'housemates', why: 'The chores are done. The house passes inspection.' };
  if (inDegs && inDegs >= inHouse) return { side: 'degenerates', why: 'The Degenerates outnumber the housemates.' };
  return null;
}

function finish(n: Night, win: Win) {
  n.win = win;
  n.phase = 'over';
  n.left = TIMES.over;
  n.meet = null;
}

/** Ends the night now if someone has won. */
function settle(n: Night): boolean {
  const w = winner(n);
  if (w) finish(n, w);
  return !!w;
}

/** Advances the clock. Returns true when the phase changed (the host then sends everyone the new view). */
export function step(n: Night, dt: number): boolean {
  if (n.phase === 'night') {
    n.roam += dt;
    if (n.roam < n.length) return false;
    startMeeting(n, 'last', -1);
    return true;
  }
  n.left -= dt;
  if (n.phase === 'vote' && everyoneVoted(n)) n.left = Math.min(n.left, 0);
  if (n.left > 0) return false;
  if (n.phase === 'intro') {
    n.phase = 'night';
    n.left = 0;
  } else if (n.phase === 'meeting') {
    n.phase = 'vote';
    n.left = n.settings.vote;
  } else if (n.phase === 'vote') endVote(n);
  else if (n.phase === 'result') afterResult(n);
  else if (n.phase === 'over') return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Takeouts, reports, the bell

/** Why `killer` can't take out `victim` right now (null: they can). `dist` is between their latest poses. */
export function killProblem(n: Night, killerId: number, victimId: number, dist: number): string | null {
  const k = playerOf(n, killerId);
  const v = playerOf(n, victimId);
  if (n.phase !== 'night') return 'not now';
  if (!k || !v || k === v) return 'nobody';
  if (k.role !== 'degenerate' || !living(k)) return 'not a Degenerate';
  if (!living(v) || v.role === 'degenerate') return 'not a target';
  if (n.roam < k.killAt) return 'cooling down';
  if (dist > KILL_RANGE + KILL_SLACK) return 'too far';
  return null;
}

export function takeOut(n: Night, killerId: number, victimId: number, at: Vec3) {
  const k = playerOf(n, killerId)!;
  const v = playerOf(n, victimId)!;
  v.alive = false;
  n.bodies.push({ id: v.id, pos: { ...at } });
  k.killAt = n.roam + n.settings.killCd;
  // A takeout is a crime: a clue by the body, and sometimes one stashed nearby.
  const room = roomAt({ ...at, y: at.y + 0.1 })?.id ?? 'living';
  commitCrime(n, 'takeout', killerId, at, room, 1, nextRand(n) < 0.5 ? 1 : 0, victimId);
  settle(n);
}

/** Why `who` can't call a meeting (`body`: the body they're reporting, or -1 for the bell). */
export function meetingProblem(n: Night, who: number, body: number): string | null {
  const p = playerOf(n, who);
  if (n.phase !== 'night') return 'not now';
  if (!p || !living(p)) return 'ghosts can’t call meetings';
  if (body >= 0) return n.bodies.some((b) => b.id === body) ? null : 'no body';
  return p.rang ? 'you’ve rung the bell tonight' : null;
}

export function startMeeting(n: Night, kind: MeetKind, by: number, body?: number) {
  if (kind === 'bell') playerOf(n, by)!.rang = true;
  const who = playerOf(n, by);
  const dead = body === undefined ? undefined : playerOf(n, body);
  if (kind === 'body' && who && dead) log(n, `${tagFor(who.char, who.name)} found ${tagFor(dead.char, dead.name)}’s body.`);
  else if (kind === 'bell' && who) log(n, `${tagFor(who.char, who.name)} banged the pot for a meeting.`);
  else if (kind === 'last') log(n, 'The Last Meeting.');
  n.phase = 'meeting';
  n.left = n.settings.discuss;
  n.meet = { kind, by, body };
  n.votes = new Map();
  n.result = null;
  n.seats = n.players.filter(living).map((p) => p.id).slice(0, SEATS.length);
}

// ---------------------------------------------------------------------------------------------
// Votes

/** Records a vote (a player id, or -1 to skip). Each living player votes once. */
export function castVote(n: Night, who: number, target: number): boolean {
  const p = playerOf(n, who);
  if (n.phase !== 'vote' || !p || !living(p) || n.votes.has(who)) return false;
  if (target !== SKIP) {
    const t = playerOf(n, target);
    if (!t || !living(t)) return false;
  }
  n.votes.set(who, target);
  return true;
}

const everyoneVoted = (n: Night) => n.players.filter(living).every((p) => n.votes.has(p.id));

/** The count: the most-voted player goes, unless it's a tie or skipping wins. */
export function tally(votes: ReadonlyMap<number, number>): { out: number | null; counts: [number, number][] } {
  const counts = new Map<number, number>();
  for (const t of votes.values()) counts.set(t, (counts.get(t) ?? 0) + 1);
  let best = 0;
  let out: number | null = null;
  for (const [t, c] of counts) {
    if (c > best) {
      best = c;
      out = t;
    } else if (c === best) out = null;
  }
  return { out: out === SKIP ? null : out, counts: [...counts] };
}

function endVote(n: Night) {
  const { out, counts } = tally(n.votes);
  const p = out === null ? undefined : playerOf(n, out);
  if (p) p.evicted = true;
  log(n, p ? `The house evicted ${tagFor(p.char, p.name)}${p.role === 'degenerate' ? ' (a Degenerate!)' : ' (innocent)'}.` : 'The vote evicted nobody.');
  n.result = {
    out: p ? p.id : null,
    counts,
    deg: p && n.settings.reveal ? p.role === 'degenerate' : null,
    votes: n.settings.anon ? [] : [...n.votes],
  };
  n.phase = 'result';
  n.left = TIMES.result;
}

function afterResult(n: Night) {
  const last = n.meet?.kind === 'last';
  n.bodies = [];
  n.seats = [];
  n.meet = null;
  if (settle(n)) return;
  if (last) return finish(n, { side: 'degenerates', why: 'A Degenerate survived the Last Meeting.' });
  n.phase = 'night';
  n.left = 0;
  for (const p of n.players) p.killAt = Math.max(p.killAt, n.roam + TIMES.afterMeeting);
}

// ---------------------------------------------------------------------------------------------
// Chores, ghosts, leaving

/** Marks a chore done; false if it isn't theirs or the night's not on. Degenerates' chores are for show. */
export function doChore(n: Night, who: number, spot: string): boolean {
  const p = playerOf(n, who);
  if (!p || p.gone || n.phase !== 'night') return false;
  const t = p.tasks.find((x) => x.spot === spot && !x.done);
  if (!t) return false;
  t.done = true;
  if (p.role === 'housemate') settle(n);
  return true;
}

/** A ghost's rattle: once every TIMES.rattle seconds of roam. */
export function rattle(n: Night, who: number): boolean {
  const p = playerOf(n, who);
  if (!p || living(p) || p.gone || n.phase !== 'night' || n.roam - p.rattleAt < TIMES.rattle) return false;
  p.rattleAt = n.roam;
  return true;
}

/** Someone dropped out: they count as taken out (no body). */
export function leave(n: Night, id: number) {
  const p = playerOf(n, id);
  if (!p || p.gone) return;
  p.gone = true;
  n.votes.delete(id);
  if (n.phase !== 'over') settle(n);
}

// ---------------------------------------------------------------------------------------------
// What everyone sees, and what only you see

export type Status = 'in' | 'dead' | 'out' | 'gone';

export interface PublicView {
  caseId: string;
  ph: Phase;
  left: number;
  roam: number;
  len: number;
  prog: number;
  people: [number, CharId, Status][];
  bodies: [number, number, number, number][];
  meet: { kind: MeetKind; by: number; body?: number } | null;
  seats: number[];
  voted: number[];
  result: Result | null;
  win: (Win & { roles: [number, Role][]; log: [number, string][] }) | null;
  /** Crimes so far: [0 the case / 1 a takeout, the victim or -1, room id]. */
  crimes: [number, number, string][];
  /** Clues lying on view: [id, crime, category, x, y, z] (what they say is only learned by picking one up). */
  clues: [number, number, string, number, number, number][];
  /** Photos in the group chat: [clue id, category, value, crime, who posted]. */
  posted: [number, string, string, number, number][];
}

export interface PrivateView {
  role: Role;
  mates: number[];
  tasks: [string, boolean][];
  killAt: number;
  rang: boolean;
  rattleAt: number;
  /** Plants left tonight (Degenerates). */
  plants: number;
  /** Your Case File: every clue you've picked up, [id, category, value, crime]. */
  seen: [number, string, string, number][];
}

const status = (p: Player): Status => (p.gone ? 'gone' : p.evicted ? 'out' : p.alive ? 'in' : 'dead');
const r2 = (v: number) => Math.round(v * 100) / 100;

export function publicView(n: Night): PublicView {
  return {
    caseId: n.caseId,
    ph: n.phase,
    left: r2(n.left),
    roam: r2(n.roam),
    len: n.length,
    prog: r2(progress(n)),
    people: n.players.map((p) => [p.id, p.char, status(p)]),
    bodies: n.bodies.map((b) => [b.id, r2(b.pos.x), r2(b.pos.y), r2(b.pos.z)]),
    meet: n.meet,
    seats: n.seats,
    voted: [...n.votes.keys()],
    result: n.result,
    win: n.win && { ...n.win, roles: n.players.map((p) => [p.id, p.role]), log: n.mystery.log },
    crimes: n.mystery.crimes.map((c) => [c.kind === 'case' ? 0 : 1, c.victim ?? -1, c.room]),
    clues: n.mystery.clues.filter((c) => c.state === 'view').map((c) => [c.id, c.crime, c.cat, r2(c.pos.x), r2(c.pos.y), r2(c.pos.z)]),
    posted: [...n.mystery.posted].map(([id, by]) => {
      const c = n.mystery.clues[id];
      return [id, c.cat, c.value, c.crime, by];
    }),
  };
}

export function privateView(n: Night, id: number): PrivateView | null {
  const p = playerOf(n, id);
  if (!p) return null;
  return {
    role: p.role,
    mates: p.role === 'degenerate' ? n.players.filter((q) => q.role === 'degenerate' && q !== p).map((q) => q.id) : [],
    tasks: p.tasks.map((t) => [t.spot, t.done]),
    killAt: p.killAt,
    rang: p.rang,
    rattleAt: Number.isFinite(p.rattleAt) ? p.rattleAt : -999,
    plants: p.role === 'degenerate' ? (n.mystery.plants.get(id) ?? PLANTS_PER_NIGHT) : 0,
    seen: [...(n.mystery.seen.get(id) ?? [])].map((cid) => {
      const c = n.mystery.clues[cid];
      return [cid, c.cat, c.value, c.crime];
    }),
  };
}
