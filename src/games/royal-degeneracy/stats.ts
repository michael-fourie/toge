// Your nights at 282, kept in this browser: nights played, wins on each side, evictions, takeouts, favourite
// character. Guests and accounts alike; it's only ever yours.

import { CAST, type CharId } from './cast.ts';

const KEY = 'royal-degeneracy.stats';

export interface Stats {
  nights: number;
  housemateWins: number;
  degenerateWins: number;
  evicted: number;
  takenOut: number;
  chars: Partial<Record<CharId, number>>;
}

const EMPTY: Stats = { nights: 0, housemateWins: 0, degenerateWins: 0, evicted: 0, takenOut: 0, chars: {} };

export function loadStats(): Stats {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...EMPTY, chars: {} };
  }
}

/** Adds a finished night (pure: returns the new stats). */
export function addNight(s: Stats, n: { char: CharId; won: boolean; degenerate: boolean; evicted: boolean; takenOut: boolean }): Stats {
  return {
    nights: s.nights + 1,
    housemateWins: s.housemateWins + (n.won && !n.degenerate ? 1 : 0),
    degenerateWins: s.degenerateWins + (n.won && n.degenerate ? 1 : 0),
    evicted: s.evicted + (n.evicted ? 1 : 0),
    takenOut: s.takenOut + (n.takenOut ? 1 : 0),
    chars: { ...s.chars, [n.char]: (s.chars[n.char] ?? 0) + 1 },
  };
}

export function saveNight(n: Parameters<typeof addNight>[1]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(addNight(loadStats(), n)));
  } catch {
    /* private mode: no stats */
  }
}

/** One line for the menu. */
export function statsLine(s: Stats): string {
  if (!s.nights) return '';
  const fav = (Object.entries(s.chars) as [CharId, number][]).sort((a, b) => b[1] - a[1])[0];
  return `${s.nights} night${s.nights > 1 ? 's' : ''} at 282 · ${s.housemateWins} housemate win${s.housemateWins === 1 ? '' : 's'} · ${s.degenerateWins} as a Degenerate · evicted ${s.evicted}× · taken out ${s.takenOut}×${fav ? ` · usually ${CAST[fav[0]].tag}` : ''}`;
}
