// SNAP! rules: the rounds, how a press is judged and how a round is scored. Pure and seeded, so every player
// builds the same match from the host's seed, and the tests can check it without a browser.
//
// Every result is a number of milliseconds where lower is better (a reaction time, or how far off the target
// you stopped), or null for a miss: too soon, the wrong button, or nothing at all. Reactions are timed on each
// player's own screen, so a slow connection never costs anyone a round.

export type Kind = 'draw' | 'clock' | 'ink' | 'ducks';

export type Round =
  /** Wait for SNAP! and press. Decoy words flash first (ms after the wait starts); pressing on one is too soon. */
  | { kind: 'draw'; delay: number; decoys: { at: number; word: string }[] }
  /** A stopwatch runs, then hides after SHOW_CLOCK; stop it as close to `target` ms as you can. */
  | { kind: 'clock'; target: number }
  /** A colour's name in a different ink: pick the INK. `word` and `ink` index COLOURS. */
  | { kind: 'ink'; delay: number; word: number; ink: number }
  /** Ducks flash up for DUCK_FLASH ms: pick how many there were. `options[answer]` is right. */
  | { kind: 'ducks'; ducks: { x: number; y: number; flip: boolean }[]; options: number[]; answer: number };

/** The four pick buttons, in pad order: Ⓐ green, Ⓑ red, Ⓧ blue, Ⓨ yellow (also ↓ → ← ↑ and 1–4). */
export const COLOURS = [
  { name: 'GREEN', hex: '#3ccf6a' },
  { name: 'RED', hex: '#ff4d5e' },
  { name: 'BLUE', hex: '#3d8bff' },
  { name: 'YELLOW', hex: '#ffcf2e' },
] as const;

export const KINDS: Kind[] = ['draw', 'clock', 'ink', 'ducks'];
export const TITLES: Record<Kind, { title: string; how: string }> = {
  draw: { title: 'QUICKDRAW', how: 'Press when it says SNAP! Not before.' },
  clock: { title: 'BLIND CLOCK', how: 'Stop the clock on the target. It hides after 3 seconds.' },
  ink: { title: 'INK, NOT WORD', how: 'Press the colour of the INK, not what the word says.' },
  ducks: { title: 'DUCK COUNT', how: 'Ducks! Count them, quick.' },
};

/** The round's title card, before anything can be pressed (ms). */
export const INTRO = 1800;
export const SHOW_CLOCK = 3000;
export const DUCK_WAIT = 600;
export const DUCK_FLASH = 1300;
/** How long after the signal a press still counts (ms). */
const REACT = 2500;
const CLOCK_GRACE = 4000;
const PICK = 3500;
/** Silly near-misses for Quickdraw. */
const DECOYS = ['SNACK!', 'SNAIL!', 'SNORE!', 'SNOT!', 'SNAPE?', 'NAPS!', 'SNOOP!', 'SPAN!'];

export const ROUNDS = 8;
/** Points for 1st, 2nd and 3rd; anyone else who didn't miss gets the last entry. */
export const POINTS = [5, 3, 2, 1];

/** Small seeded generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A match: `count` rounds, every kind once per lap of four, in a shuffled order. */
export function makeMatch(seed: number, count = ROUNDS): Round[] {
  const r = rng(seed);
  const kinds: Kind[] = [];
  while (kinds.length < count) {
    const lap = [...KINDS];
    for (let i = lap.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [lap[i], lap[j]] = [lap[j], lap[i]];
    }
    // Never the same kind twice in a row across laps.
    if (kinds.length && lap[0] === kinds[kinds.length - 1]) lap.push(lap.shift()!);
    kinds.push(...lap);
  }
  return kinds.slice(0, count).map((k) => makeRound(k, r));
}

function makeRound(kind: Kind, r: () => number): Round {
  if (kind === 'draw') {
    const delay = Math.round(1500 + r() * 3500);
    const decoys: { at: number; word: string }[] = [];
    const n = Math.floor(r() * 3); // 0-2 fake-outs
    for (let i = 0; i < n; i++) {
      const at = Math.round(500 + r() * (delay - 1200));
      if (at > 300 && delay - at > 700 && decoys.every((d) => Math.abs(d.at - at) > 700)) decoys.push({ at, word: DECOYS[Math.floor(r() * DECOYS.length)] });
    }
    decoys.sort((a, b) => a.at - b.at);
    return { kind, delay, decoys };
  }
  if (kind === 'clock') return { kind, target: 5000 + Math.floor(r() * 9) * 500 };
  if (kind === 'ink') {
    const word = Math.floor(r() * 4);
    const ink = (word + 1 + Math.floor(r() * 3)) % 4; // never the colour it names
    return { kind, delay: Math.round(800 + r() * 1700), word, ink };
  }
  const n = 5 + Math.floor(r() * 9); // 5-13 ducks
  const ducks: { x: number; y: number; flip: boolean }[] = [];
  let tries = 0;
  while (ducks.length < n && tries++ < 500) {
    const x = 0.08 + r() * 0.84;
    const y = 0.12 + r() * 0.72;
    // Keep them apart so they can be counted.
    if (ducks.every((d) => Math.hypot(d.x - x, (d.y - y) * 0.6) > 0.11)) ducks.push({ x, y, flip: r() < 0.5 });
  }
  const real = ducks.length;
  const wrong = [real - 2, real - 1, real + 1, real + 2, real + 3].filter((v) => v > 0);
  const options = [real];
  while (options.length < 4) {
    const v = wrong.splice(Math.floor(r() * wrong.length), 1)[0];
    options.push(v);
  }
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { kind, ducks, options, answer: options.indexOf(real) };
}

/** When a round's picks or presses open, ms after the title card (the "go" moment the reaction is timed from). */
export function goAt(round: Round): number {
  if (round.kind === 'draw' || round.kind === 'ink') return round.delay;
  if (round.kind === 'ducks') return DUCK_WAIT + DUCK_FLASH;
  return 0;
}

/** After this (ms after the title card) a player who hasn't answered has missed. */
export function timeLimit(round: Round): number {
  if (round.kind === 'draw') return round.delay + REACT;
  if (round.kind === 'clock') return round.target + CLOCK_GRACE;
  return goAt(round) + PICK;
}

/** Does this round want a single press (any button) or one of four picks? */
export const picks = (round: Round) => round.kind === 'ink' || round.kind === 'ducks';

/**
 * Judges one answer. `at` is when it came, ms after the title card; `shown` is when the go moment actually
 * reached the screen (a frame after `goAt`), so reactions are timed from what the player saw. `pick` is
 * 0-3 for the pick rounds. Returns the result (lower is better) or null for a miss.
 */
export function judge(round: Round, at: number | null, pick = -1, shown = goAt(round)): number | null {
  if (at === null || !Number.isFinite(at) || at > timeLimit(round)) return null;
  if (round.kind === 'clock') return Math.round(Math.abs(at - round.target));
  if (at < goAt(round)) return null; // too soon (or a decoy)
  if (round.kind === 'ink' && pick !== round.ink) return null;
  if (round.kind === 'ducks' && pick !== round.answer) return null;
  return Math.round(Math.max(0, at - Math.max(shown, goAt(round))));
}

/** A result from another player, checked before it's trusted (null = a miss). */
export function cleanResult(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 60_000 ? Math.round(v) : null;
}

/** Points per player for one round: by rank, ties share the better place, misses get nothing. */
export function scoreRound(results: Map<number, number | null>): Map<number, number> {
  const out = new Map<number, number>();
  const done = [...results].filter((e): e is [number, number] => e[1] !== null).sort((a, b) => a[1] - b[1]);
  for (const [id, v] of results) if (v === null) out.set(id, 0);
  done.forEach(([id, v]) => {
    const place = done.findIndex((e) => e[1] === v); // ties share the first index
    out.set(id, POINTS[Math.min(place, POINTS.length - 1)]);
  });
  return out;
}

/** Players by total points, best first (ties broken by name, so everyone shows the same order). */
export function standings(totals: Map<number, number>, names: Map<number, string>): { id: number; name: string; points: number }[] {
  return [...totals]
    .map(([id, points]) => ({ id, name: names.get(id) ?? '?', points }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

/** "212 ms", "0.31 s off" or "missed", for the results board. */
export function describe(round: Round, v: number | null): string {
  if (v === null) return 'missed';
  if (round.kind === 'clock') return v < 10 ? 'dead on!' : `${(v / 1000).toFixed(2)} s off`;
  return `${v} ms`;
}
