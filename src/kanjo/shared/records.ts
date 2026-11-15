// Best times: each racer's quickest finish on every track, and what a friend sees of your garage.
// Kept by the server for accounts (kanjo/server/recordStore.ts), in localStorage for guests; the same rules run on both.

import { encodeCar, decodeCar } from './cars.ts';
import { type Garage, TRACK_LENGTH_KM } from './garage.ts';
import { encodeRider } from './rider.ts';
import { TRACK_DEFS, type TrackId } from './track.ts';

/** A racer's quickest finish on one track. */
export interface BestTime {
  /** Seconds, to the millisecond. */
  time: number;
  /** The car code it was set in ('' if unknown). */
  car: string;
  /** When (ms since 1970). */
  at: number;
}

export type Bests = Partial<Record<TrackId, BestTime>>;

/** A finish that beat the racer's best on that track. `prev` is the old best (null: their first finish there). */
export interface NewBest {
  track: TrackId;
  time: number;
  prev: number | null;
  /**
   * Where it put them on the track's all-time board (1: the track record), or null (a guest, or off the board).
   * Absent from guests' own bests, which never reach the board.
   */
  rank?: number | null;
  /** When `rank` is 1: the record it beat (null: the track had none). It may be the racer's own. */
  beat?: { name: string; time: number } | null;
}

export const RECORDS = {
  /**
   * No car averages more than this over a whole race (m/s, about 468 km/h): a time quicker than the track's length at
   * this speed is refused (`minTime`). It must stay above every car's top speed (a maxed Vanta on the shortest final
   * drive tops out near 120 m/s; records.test.ts checks every car). It was 90 until 2026-11-10, below what a maxed
   * Vanta averages flat out on the fast highways, so Sea-to-Sky, Hayate and Ryusei threw away every quick time.
   */
  maxAvgSpeed: 130,
  /** Slower than this isn't a finish worth keeping (s). */
  maxTime: 3600,
} as const;

/** The quickest time a track will accept. */
export const minTime = (track: TrackId) => (TRACK_LENGTH_KM[track] * 1000) / RECORDS.maxAvgSpeed;

const isTrack = (x: unknown): x is TrackId => typeof x === 'string' && Object.hasOwn(TRACK_DEFS, x);

/** A plausible finish time for `track`, rounded to the millisecond, or null. */
export function cleanTime(track: TrackId, time: unknown): number | null {
  if (typeof time !== 'number' || !Number.isFinite(time) || time < minTime(track) || time > RECORDS.maxTime) return null;
  return Math.round(time * 1000) / 1000;
}

/** Bests as stored (or sent): unknown tracks and bad entries dropped. */
export function cleanBests(x: unknown): Bests {
  const out: Bests = {};
  if (!x || typeof x !== 'object') return out;
  for (const [k, v] of Object.entries(x)) {
    if (!isTrack(k) || !v || typeof v !== 'object') continue;
    const b = v as Partial<BestTime>;
    const time = cleanTime(k, b.time);
    if (time === null) continue;
    out[k] = { time, car: typeof b.car === 'string' && decodeCar(b.car) ? b.car : '', at: Number.isFinite(b.at) ? Number(b.at) : 0 };
  }
  return out;
}

/** Keeps `time` if it's a plausible finish and beats the best on `track`; null (nothing changes) otherwise. */
export function recordTime(b: Bests, track: unknown, time: unknown, car: string, at: number): { bests: Bests; best: NewBest } | null {
  if (!isTrack(track)) return null;
  const t = cleanTime(track, time);
  if (t === null) return null;
  const old = b[track];
  if (old && old.time <= t) return null;
  return { bests: { ...b, [track]: { time: t, car: decodeCar(car) ? car : '', at } }, best: { track, time: t, prev: old?.time ?? null } };
}

// --- The all-time board ----------------------------------------------------------------------------------------

/** One racer's line on a track's all-time board: their best there. */
export interface BoardRow {
  name: string;
  time: number;
  car: string;
  at: number;
}

export const BOARD = {
  /** Racers kept per track. */
  size: 50,
} as const;

/**
 * The tracks the Leaderboard shows and the medal table counts: the ones you can pick for a time trial from the Race
 * page (2026-11-13, Andrew: "remove maps from the Leaderboard that are not playable ... Karasu Peak isn't available").
 * Not the hill climb (it runs only in a lobby's Hill climb mode) or battle royale arenas (a royale keeps no times).
 * Their boards stay stored; they're just not listed or counted.
 */
export const BOARD_TRACKS = (Object.keys(TRACK_DEFS) as TrackId[]).filter((id) => !TRACK_DEFS[id].world && !TRACK_DEFS[id].climb && !TRACK_DEFS[id].royale);

/** A board as stored: bad rows dropped, one row per racer (their quickest), quickest first, at most BOARD.size. */
export function cleanBoard(track: TrackId, x: unknown): BoardRow[] {
  if (!Array.isArray(x)) return [];
  const best = new Map<string, BoardRow>();
  for (const r of x) {
    if (!r || typeof r !== 'object') continue;
    const row = r as Partial<BoardRow>;
    const time = cleanTime(track, row.time);
    if (time === null || typeof row.name !== 'string' || !row.name || row.name.length > 32) continue;
    const key = row.name.toLowerCase();
    const old = best.get(key);
    if (old && old.time <= time) continue;
    best.set(key, { name: row.name, time, car: typeof row.car === 'string' && decodeCar(row.car) ? row.car : '', at: Number.isFinite(row.at) ? Number(row.at) : 0 });
  }
  return sortBoard([...best.values()]);
}

/** Quickest first; a tie goes to whoever set it first. Cut to BOARD.size. */
const sortBoard = (rows: BoardRow[]) => rows.sort((a, b) => a.time - b.time || a.at - b.at).slice(0, BOARD.size);

/**
 * Puts a racer's new best on a board, replacing their old line. `rank` is where it landed (1: the track record; null:
 * not quick enough for the board); `beat` is the record it took when it's the new one.
 */
export function placeOnBoard(board: BoardRow[], row: BoardRow): { board: BoardRow[]; rank: number | null; beat: { name: string; time: number } | null } {
  const key = row.name.toLowerCase();
  const old = board.find((r) => r.name.toLowerCase() === key);
  if (old && old.time <= row.time) {
    const rank = board.indexOf(old) + 1;
    return { board, rank, beat: null };
  }
  const top = board[0] ?? null;
  const next = sortBoard([...board.filter((r) => r !== old), row]);
  const i = next.indexOf(row);
  const rank = i < 0 ? null : i + 1;
  return { board: next, rank, beat: rank === 1 && top ? { name: top.name, time: top.time } : null };
}

// --- Medals: who holds the most firsts, seconds and thirds across every board -------------------

/** One racer's medals: how many tracks they're 1st, 2nd and 3rd on. */
export interface MedalRow {
  name: string;
  gold: number;
  silver: number;
  bronze: number;
}

/**
 * The overall table (2026-11-10, Andrew: "who has the most #1, #2, #3 lap times of all the maps ... gold, silver,
 * bronze"): the top three of every track's board, counted per racer, ranked like an Olympic medal table (most
 * golds, then silvers, then bronzes; then by name).
 */
export function medalTable(boards: Iterable<BoardRow[]>): MedalRow[] {
  const by = new Map<string, MedalRow>();
  const kinds = ['gold', 'silver', 'bronze'] as const;
  for (const rows of boards)
    rows.slice(0, 3).forEach((r, i) => {
      const key = r.name.toLowerCase();
      const row = by.get(key) ?? { name: r.name, gold: 0, silver: 0, bronze: 0 };
      row[kinds[i]]++;
      by.set(key, row);
    });
  return [...by.values()].sort((a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.name.localeCompare(b.name));
}

// --- Notices: someone beat your time -----------------------------------------------------------

/**
 * Someone's new best moved you down a track's board (2026-11-10, Andrew: "if someone beats my fastest time, I want to
 * know"). Kept per account until they've seen it.
 */
export interface Notice {
  track: TrackId;
  /** Who beat you, and their new time. */
  by: string;
  time: number;
  /** Your time there, and your place before and after (null: pushed off the board). */
  yours: number;
  was: number;
  rank: number | null;
  /** When (ms since 1970); also the notice's id. */
  at: number;
}

export const NOTICES = {
  /** Kept per account, newest first; older ones drop off. */
  keep: 30,
} as const;

/** Everyone `name`'s new best moved down (or off) the board: their name, time and places before and after. */
export function overtaken(before: BoardRow[], after: BoardRow[], name: string): { name: string; yours: number; was: number; rank: number | null }[] {
  const me = name.toLowerCase();
  const now = new Map(after.map((r, i) => [r.name.toLowerCase(), i + 1]));
  const out: { name: string; yours: number; was: number; rank: number | null }[] = [];
  before.forEach((r, i) => {
    const key = r.name.toLowerCase();
    if (key === me) return;
    const rank = now.get(key) ?? null;
    if (rank === null || rank > i + 1) out.push({ name: r.name, yours: r.time, was: i + 1, rank });
  });
  return out;
}

/** A stored notice list: bad entries dropped, newest first, at most NOTICES.keep. */
export function cleanNotices(x: unknown): Notice[] {
  if (!Array.isArray(x)) return [];
  const out: Notice[] = [];
  for (const n of x) {
    if (!n || typeof n !== 'object') continue;
    const v = n as Partial<Notice>;
    if (typeof v.track !== 'string' || !Object.hasOwn(TRACK_DEFS, v.track) || typeof v.by !== 'string' || !v.by || v.by.length > 32) continue;
    const num = (k: unknown) => typeof k === 'number' && Number.isFinite(k);
    if (!num(v.time) || !num(v.yours) || !num(v.was) || !num(v.at) || (v.rank !== null && !num(v.rank))) continue;
    out.push({ track: v.track as TrackId, by: v.by, time: v.time!, yours: v.yours!, was: v.was!, rank: v.rank ?? null, at: v.at! });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, NOTICES.keep);
}

/** What a friend sees of your KANJO garage: cars, driver, record and best times (not your money). */
export interface KanjoProfile {
  name: string;
  races: number;
  wins: number;
  /** Which of `cars` you drive. */
  sel: number;
  /** Car codes (encodeCar), cosmetics included. */
  cars: string[];
  /** encodeRider() */
  rider: string;
  bests: Bests;
}

export function profileOf(name: string, g: Garage, bests: Bests): KanjoProfile {
  return { name, races: g.races, wins: g.wins, sel: g.sel, cars: g.cars.map(encodeCar), rider: encodeRider(g.rider), bests };
}
