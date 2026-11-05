// Your highs (best drift race, top speed; toge/shared/cardstats.ts) in this browser: the race writes them when you
// finish, the player card reads them.

import { type Highs, cleanHighs, newHighs, noteHighs } from '../shared/cardstats.ts';

const KEY = 'atrous.highs';

export function loadHighs(): Highs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? cleanHighs(JSON.parse(raw)) : newHighs();
  } catch {
    return newHighs();
  }
}

/** Notes a finished race. Never throws (private mode just doesn't keep it). */
export function saveHighs(race: { drift: number; topKmh: number }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(noteHighs(loadHighs(), race)));
  } catch {
    /* private mode */
  }
}
