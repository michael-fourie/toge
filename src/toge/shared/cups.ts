// Grand Prix cups: four fixed tracks raced back to back, points for every place, and a cup standings table at the
// end. Solo (you against the AI, hub.ts → racegame.ts) and online (the room runs it, toge/server/race.ts).
// Every race track (not the hill climb) sits in a cup, and only the Velocity and Overdrive Cups borrow tracks from the others;
// the cups test checks it.

import { TRACK_DEFS, type TrackId } from './track.ts';

export type CupId = 'torii' | 'mirage' | 'lantern' | 'apex' | 'velocity' | 'rush';

export interface CupDef {
  id: CupId;
  name: string;
  /** One line under the name. */
  tag: string;
  /** The cup's colour on its card and trophy (hex). */
  color: string;
  /** The four rounds, in order. */
  tracks: [TrackId, TrackId, TrackId, TrackId];
}

/** The cups, easiest first. Append only (lobbies and saved picks name them by id). */
export const CUPS: Record<CupId, CupDef> = {
  torii: { id: 'torii', name: 'Torii Cup', tag: 'Shrine roads over the Japanese passes', color: '#e5484d', tracks: ['nagare', 'sakura', 'momiji', 'koripass'] },
  mirage: { id: 'mirage', name: 'Mirage Cup', tag: 'Sea cliffs, dunes and red desert', color: '#f5a524', tracks: ['saltwind', 'kazeoka', 'redmesa', 'akane'] },
  lantern: { id: 'lantern', name: 'Lantern Cup', tag: 'Harbour streets and roads after dark', color: '#8e6bff', tracks: ['minato', 'monaco', 'neonbay', 'tsukiyo'] },
  apex: { id: 'apex', name: 'Apex Cup', tag: 'Four grand circuits, lap after lap', color: '#22c3e6', tracks: ['kodama', 'hachi', 'spa', 'monza'] },
  // The fast roads: the three built for speed, with Monza (from the Apex Cup) between them.
  velocity: { id: 'velocity', name: 'Velocity Cup', tag: 'Flat out: salt flats, the Sea-to-Sky, the expressway', color: '#3ddc84', tracks: ['hayate', 'seatosky', 'monza', 'ryusei'] },
  // The two six-lane grand prix roads, with the city and the expressway between. (Its id is from when it was the
  // Rush Hour Cup, every road with traffic, before the grand prix roads lost theirs.)
  rush: { id: 'rush', name: 'Overdrive Cup', tag: 'Flat out, then hard on the brakes: the city, the corniche, the expressway, the boulevard', color: '#ff5ca8', tracks: ['neonbay', 'isonami', 'ryusei', 'shiden'] },
};
export const CUP_IDS = Object.keys(CUPS) as CupId[];
export const ROUNDS = 4;

export const isCup = (id: unknown): id is CupId => typeof id === 'string' && Object.hasOwn(CUPS, id);

/** Points by finishing place (1st..8th). A DNF scores nothing. */
export const GP_POINTS = [15, 12, 10, 8, 6, 4, 2, 1];
export const pointsFor = (place: number) => (place >= 1 ? (GP_POINTS[place - 1] ?? 0) : 0);

/** One racer's line on the cup table. `key` is whatever names them across races (a room id, or a solo name). */
export interface CupRow {
  key: string;
  name: string;
  /** Points so far. */
  pts: number;
  /** Points from the latest round. */
  last: number;
  /** Finishing place in each round raced (0: DNF or not in it). */
  places: number[];
  cpu?: boolean;
  me?: boolean;
}

/**
 * Adds one round's finishing places (`place` 0 = DNF) to the cup table and returns the new table, ranked: most points,
 * then most wins, then most seconds, and so on, then the better place in the latest round. Racers who weren't in this
 * round keep their points (0 for it); newcomers start from nothing.
 */
export function addRound(table: CupRow[], round: number, results: { key: string; name: string; place: number; cpu?: boolean; me?: boolean }[]): CupRow[] {
  const rows = new Map(table.map((r) => [r.key, { ...r, last: 0, places: [...r.places] }]));
  for (const res of results) {
    const row = rows.get(res.key) ?? { key: res.key, name: res.name, pts: 0, last: 0, places: [], ...(res.cpu ? { cpu: true } : {}), ...(res.me ? { me: true } : {}) };
    row.name = res.name;
    const got = pointsFor(res.place);
    row.pts += got;
    row.last = got;
    while (row.places.length < round) row.places.push(0);
    row.places[round] = res.place;
    rows.set(res.key, row);
  }
  for (const r of rows.values()) while (r.places.length <= round) r.places.push(0);
  return rankCup([...rows.values()], round);
}

/** The cup table in order (see addRound). */
export function rankCup(rows: CupRow[], round: number): CupRow[] {
  const count = (r: CupRow, p: number) => r.places.filter((x) => x === p).length;
  return rows.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    for (let p = 1; p <= GP_POINTS.length; p++) if (count(b, p) !== count(a, p)) return count(b, p) - count(a, p);
    const la = a.places[round] || 99;
    const lb = b.places[round] || 99;
    return la - lb;
  });
}

/** A cup's total distance (km), from the tracks' own lengths (passed in so this file stays free of garage.ts). */
export const cupKm = (cup: CupId, km: Record<TrackId, number>) => Math.round(CUPS[cup].tracks.reduce((a, t) => a + km[t], 0) * 10) / 10;

/** "Round 2 of 4 · Sakura Ridge". */
export const roundLabel = (cup: CupId, round: number) => `Round ${round + 1} of ${ROUNDS} · ${TRACK_DEFS[CUPS[cup].tracks[round]].name}`;
