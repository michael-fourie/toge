// Grand Prix cups: four (or five) fixed tracks raced back to back, points for every place, and a cup standings table at the
// end. Solo (you against the AI, hub.ts → racegame.ts) and online (the room runs it, kanjo/server/race.ts).
// Every race track (not the hill climb) sits in a cup, and only the Velocity and Overdrive Cups borrow tracks from the others;
// the cups test checks it.

import { TRACK_DEFS, type TrackId } from './track.ts';

export type CupId = 'torii' | 'mirage' | 'lantern' | 'apex' | 'velocity' | 'rush' | 'sprint' | 'postcard';

export interface CupDef {
  id: CupId;
  name: string;
  /** One line under the name. */
  tag: string;
  /** The cup's colour on its card and trophy (hex). */
  color: string;
  /** The rounds, in order: four, or five for the Postcard Cup (`roundsOf`). */
  tracks: TrackId[];
}

/** The cups, easiest first. Append only (lobbies and saved picks name them by id). */
export const CUPS: Record<CupId, CupDef> = {
  torii: { id: 'torii', name: 'Torii Cup', tag: 'Shrine roads over the Japanese passes', color: '#e5484d', tracks: ['nagare', 'sakura', 'momiji', 'koripass'] },
  mirage: { id: 'mirage', name: 'Mirage Cup', tag: 'Sea cliffs, dunes and red desert', color: '#f5a524', tracks: ['saltwind', 'kazeoka', 'redmesa', 'akane'] },
  lantern: { id: 'lantern', name: 'Lantern Cup', tag: 'Harbour streets and roads after dark', color: '#8e6bff', tracks: ['minato', 'monaco', 'neonbay', 'tsukiyo'] },
  apex: { id: 'apex', name: 'Apex Cup', tag: 'Four grand circuits, lap after lap', color: '#22c3e6', tracks: ['kodama', 'hachi', 'spa', 'monza'] },
  // The fast roads, all four built for speed (Futamata Parkway took Monza's round, 2026-11-16; Monza is the Apex Cup's).
  velocity: { id: 'velocity', name: 'Velocity Cup', tag: 'Flat out: salt flats, the Sea-to-Sky, the forked parkway, the expressway', color: '#3ddc84', tracks: ['hayate', 'seatosky', 'futamata', 'ryusei'] },
  // The two six-lane grand prix roads, with the city and the expressway between. (Its id is from when it was the
  // Rush Hour Cup, every road with traffic, before the grand prix roads lost theirs.)
  rush: { id: 'rush', name: 'Overdrive Cup', tag: 'Flat out, then hard on the brakes: the city, the corniche, the expressway, the boulevard', color: '#ff5ca8', tracks: ['neonbay', 'isonami', 'ryusei', 'shiden'] },
  // The sprint rings, easiest first: four short 4-lap circuits by day, the last two Hibari made harder.
  sprint: { id: 'sprint', name: 'Sprint Cup', tag: 'Short laps, quick hands: the lake, then three clifftop rings, each harder', color: '#ff7a59', tracks: ['mizuumi', 'hibari', 'kamome', 'shiokaze'] },
  // Five storybook towns (Michael, 2026-11-10), easiest first: flat Taketomi to Chefchaouen's hairpins.
  postcard: { id: 'postcard', name: 'Postcard Cup', tag: 'Five storybook towns: Okinawa, the Alps, Cappadocia, Santorini, the Rif', color: '#2ec4b6', tracks: ['taketomi', 'hallstatt', 'goreme', 'oia', 'chefchaouen'] },
};
export const CUP_IDS = Object.keys(CUPS) as CupId[];
/** How many rounds a cup races. */
export const roundsOf = (cup: CupId) => CUPS[cup].tracks.length;

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
  /** A Team Grand Prix: Red (0) or Blue (1) (protocol.ts `TEAMS`). */
  team?: 0 | 1;
}

/**
 * Adds one round's finishing places (`place` 0 = DNF) to the cup table and returns the new table, ranked: most points,
 * then most wins, then most seconds, and so on, then the better place in the latest round. Racers who weren't in this
 * round keep their points (0 for it); newcomers start from nothing.
 */
export function addRound(table: CupRow[], round: number, results: { key: string; name: string; place: number; cpu?: boolean; me?: boolean; team?: 0 | 1 }[]): CupRow[] {
  const rows = new Map(table.map((r) => [r.key, { ...r, last: 0, places: [...r.places] }]));
  for (const res of results) {
    const row = rows.get(res.key) ?? { key: res.key, name: res.name, pts: 0, last: 0, places: [], ...(res.cpu ? { cpu: true } : {}), ...(res.me ? { me: true } : {}) };
    row.name = res.name;
    if (res.team !== undefined) row.team = res.team;
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

/** One team's line in a Team Grand Prix: its racers' points added up. */
export interface TeamRow {
  team: 0 | 1;
  pts: number;
  /** Points from the latest round. */
  last: number;
  /** Rounds won by one of its racers. */
  wins: number;
}

/**
 * The teams' standings from the cup table (each racer's points count for their team): most points, then most round
 * wins, then Red. Both teams are always listed, even one with nobody on it yet.
 */
export function teamTable(table: CupRow[]): TeamRow[] {
  const rows: TeamRow[] = [0, 1].map((team) => ({ team: team as 0 | 1, pts: 0, last: 0, wins: 0 }));
  for (const r of table) {
    if (r.team === undefined) continue;
    const t = rows[r.team];
    t.pts += r.pts;
    t.last += r.last;
    t.wins += r.places.filter((p) => p === 1).length;
  }
  return rows.sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.team - b.team);
}

/** A cup's total distance (km), from the tracks' own lengths (passed in so this file stays free of garage.ts). */
export const cupKm = (cup: CupId, km: Record<TrackId, number>) => Math.round(CUPS[cup].tracks.reduce((a, t) => a + km[t], 0) * 10) / 10;

/** "Round 2 of 4 · Sakura Ridge". */
export const roundLabel = (cup: CupId, round: number) => `Round ${round + 1} of ${roundsOf(cup)} · ${TRACK_DEFS[CUPS[cup].tracks[round]].name}`;
