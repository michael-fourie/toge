// SNAP! rules: the rounds, how a press is judged and how a round is scored. Pure and seeded, so every player
// builds the same match from the host's seed, and the tests can check it without a browser.
//
// Every result is a number of milliseconds where lower is better (a reaction time, or how far off the target
// you stopped), or null for a miss: too soon, the wrong button, or nothing at all. Reactions are timed on each
// player's own screen, so a slow connection never costs anyone a round.

export type Kind = 'draw' | 'clock' | 'ink' | 'ducks' | 'odd' | 'maths' | 'arrow' | 'pour' | 'simon' | 'mash' | 'most' | 'big' | 'which' | 'sweet';

export type Round =
  /** Wait for SNAP! and press. Decoy words flash first (ms after the wait starts); pressing on one is too soon. */
  | { kind: 'draw'; delay: number; decoys: { at: number; word: string }[] }
  /** A stopwatch runs, then hides after SHOW_CLOCK; stop it as close to `target` ms as you can. */
  | { kind: 'clock'; target: number }
  /** A colour's name in a different ink: pick the INK. `word` and `ink` index COLOURS. */
  | { kind: 'ink'; delay: number; word: number; ink: number }
  /** Ducks flash up for DUCK_FLASH ms: pick how many there were. `options[answer]` is right. */
  | { kind: 'ducks'; ducks: { x: number; y: number; flip: boolean }[]; options: number[]; answer: number }
  /** Four lookalikes on the buttons (`pair` indexes ODD_PAIRS): pick the one that's different, `odd`. */
  | { kind: 'odd'; delay: number; pair: number; odd: number }
  /** A sum (`a op b`): pick the answer, `options[answer]`. */
  | { kind: 'maths'; delay: number; a: number; b: number; op: '+' | '−' | '×'; options: number[]; answer: number }
  /** An arrow (`dir` in pick order: ↓ → ← ↑): press that way, or the opposite way when `flip`. */
  | { kind: 'arrow'; delay: number; dir: number; flip: boolean }
  /** A glass fills faster and faster, reaching the brim at `brim` ms: stop at the line (`line`, 0-1 of the glass). */
  | { kind: 'pour'; line: number; brim: number }
  /** Colours flash in order (SIMON_STEP ms each): press them back in the same order. */
  | { kind: 'simon'; seq: number[] }
  /** Press anything `need` times, as fast as you can: timed to the last press. */
  | { kind: 'mash'; need: number }
  /** Coloured dots flash up like the ducks (`c` indexes COLOURS): pick the colour there were most of, `answer`. */
  | { kind: 'most'; dots: { x: number; y: number; c: number }[]; answer: number }
  /** Four lookalike numbers (the same digits shuffled): pick the biggest, `options[answer]`. */
  | { kind: 'big'; delay: number; options: number[]; answer: number }
  /** "Which is a FRUIT?" (`cat` indexes CATEGORIES): four words, one of them is, `options[answer]`. */
  | { kind: 'which'; delay: number; cat: number; options: string[]; answer: number }
  /** A marker sweeps across a bar and back every `period` ms: stop it inside the zone centred on `zone` (0-1). */
  | { kind: 'sweet'; period: number; zone: number };

/** The four pick buttons, in pad order: Ⓐ green, Ⓑ red, Ⓧ blue, Ⓨ yellow (also ↓ → ← ↑ and 1–4). */
export const COLOURS = [
  { name: 'GREEN', hex: '#3ccf6a' },
  { name: 'RED', hex: '#ff4d5e' },
  { name: 'BLUE', hex: '#3d8bff' },
  { name: 'YELLOW', hex: '#ffcf2e' },
] as const;

export const KINDS: Kind[] = ['draw', 'clock', 'ink', 'ducks', 'odd', 'maths', 'arrow', 'pour', 'simon', 'mash', 'most', 'big', 'which', 'sweet'];
export const TITLES: Record<Kind, { title: string; how: string }> = {
  draw: { title: 'QUICKDRAW', how: 'Press when it says SNAP! Not before.' },
  clock: { title: 'BLIND CLOCK', how: 'Stop the clock on the target. It hides after 3 seconds.' },
  ink: { title: 'INK, NOT WORD', how: 'Press the colour of the INK, not what the word says.' },
  ducks: { title: 'DUCK COUNT', how: 'Ducks! Count them, quick.' },
  odd: { title: 'ODD ONE OUT', how: 'Three match. One doesn’t. Pick it.' },
  maths: { title: 'QUICK MATHS', how: 'Pick the answer. No calculators.' },
  arrow: { title: 'WHICH WAY', how: 'Press the way the arrow points. Unless it says OPPOSITE!' },
  pour: { title: 'POUR', how: 'Stop pouring at the line. Over it and it spills.' },
  simon: { title: 'SIMON SNAPS', how: 'Watch the colours, then press them back in order.' },
  mash: { title: 'MASH!', how: 'Hit any button 20 times. As fast as you can.' },
  most: { title: 'MOST DOTS', how: 'Dots! Which colour was there most of?' },
  big: { title: 'BIGGEST', how: 'Same digits, shuffled. Pick the biggest number.' },
  which: { title: 'WHICH IS…?', how: 'One of these four fits. Pick it.' },
  sweet: { title: 'SWEET SPOT', how: 'Stop the marker inside the green zone.' },
};

/** Which Is…?: each category and things in it (every word belongs to exactly one). */
export const CATEGORIES = [
  { name: 'a FRUIT', words: ['MANGO', 'PLUM', 'KIWI', 'LIME', 'PEAR', 'GRAPE', 'MELON', 'PEACH'] },
  { name: 'an ANIMAL', words: ['OTTER', 'MOOSE', 'GECKO', 'LLAMA', 'HIPPO', 'BADGER', 'PANDA', 'SQUID'] },
  { name: 'a VEHICLE', words: ['TRUCK', 'FERRY', 'TRAM', 'BLIMP', 'SCOOTER', 'TAXI', 'CANOE', 'TRACTOR'] },
  { name: 'an INSTRUMENT', words: ['BANJO', 'CELLO', 'TUBA', 'FLUTE', 'DRUM', 'HARP', 'OBOE', 'UKULELE'] },
  { name: 'a SPORT', words: ['RUGBY', 'GOLF', 'POLO', 'SQUASH', 'JUDO', 'DARTS', 'HOCKEY', 'SURFING'] },
  { name: 'a BODY PART', words: ['ELBOW', 'ANKLE', 'KNEE', 'THUMB', 'CHIN', 'WRIST', 'SHIN', 'NOSTRIL'] },
] as const;
/** Mash!: presses needed. */
export const MASH = 20;
/** Sweet Spot: the zone's half-width (fraction of the bar). */
export const SWEET_HALF = 0.07;

/** Lookalikes for Odd One Out: three of the first, one of the second (or the other way round). */
export const ODD_PAIRS = [
  ['🐸', '🐢'], ['😀', '😃'], ['🍎', '🍅'], ['🐶', '🐺'], ['🌕', '🌝'], ['🍩', '🥯'],
  ['🦆', '🐤'], ['🐱', '🐯'], ['⚽', '🏐'], ['🍪', '🥠'], ['🌲', '🌳'], ['🙈', '🙊'],
] as const;
/** Which Way's arrows, in pick order (Ⓐ ↓, Ⓑ →, Ⓧ ←, Ⓨ ↑): the opposite of pick `i` is `3 - i`. */
export const ARROWS = ['⬇', '➡', '⬅', '⬆'] as const;
/** Simon: each colour is lit this long, then a short gap (ms). */
export const SIMON_STEP = 600;
export const SIMON_LIT = 450;
/** Pour: how the level rises, level = (t / brim)^POUR_EASE (it speeds up as it goes). */
export const POUR_EASE = 1.6;

/** The round's title card, before anything can be pressed (ms). */
export const INTRO = 1800;
export const SHOW_CLOCK = 3000;
export const DUCK_WAIT = 600;
export const DUCK_FLASH = 1300;
/** How long after the signal a press still counts (ms). */
const REACT = 2500;
const CLOCK_GRACE = 4000;
const PICK = 3500;
/** Simon: time to press the sequence back, per colour, on top of a base (ms). */
const SIMON_BASE = 1500;
const SIMON_PER = 900;
const MASH_LIMIT = 7000;
/** Sweet Spot: how many sweeps (there and back) before it's a miss. */
const SWEEPS = 3;
/** Silly near-misses for Quickdraw. */
const DECOYS = ['SNACK!', 'SNAIL!', 'SNORE!', 'SNOT!', 'SNAPE?', 'NAPS!', 'SNOOP!', 'SPAN!'];

/** Rounds in a match: a different kind every round (there are more kinds than rounds, so each match is a mix). */
export const ROUNDS = 12;
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
  if (kind === 'odd') return { kind, delay: Math.round(600 + r() * 1400), pair: Math.floor(r() * ODD_PAIRS.length), odd: Math.floor(r() * 4) };
  if (kind === 'maths') return makeMaths(r);
  if (kind === 'arrow') return { kind, delay: Math.round(700 + r() * 1800), dir: Math.floor(r() * 4), flip: r() < 0.5 };
  if (kind === 'pour') return { kind, line: Math.round((0.55 + r() * 0.3) * 100) / 100, brim: Math.round(3600 + r() * 1800) };
  if (kind === 'simon') {
    const seq: number[] = [];
    const n = 4 + Math.floor(r() * 2); // 4 or 5 colours
    // Never the same colour twice in a row: a repeat is hard to see as two flashes.
    while (seq.length < n) {
      const c = Math.floor(r() * 4);
      if (c !== seq[seq.length - 1]) seq.push(c);
    }
    return { kind, seq };
  }
  if (kind === 'mash') return { kind, need: MASH };
  if (kind === 'most') return makeMost(r);
  if (kind === 'big') return makeBig(r);
  if (kind === 'which') return makeWhich(r);
  if (kind === 'sweet') return { kind, period: Math.round(1300 + r() * 700), zone: Math.round((0.2 + r() * 0.6) * 100) / 100 };
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

/** A sum with four close answers: + and − up to 40ish, × up to 9 × 9. */
function makeMaths(r: () => number): Round {
  const op = (['+', '−', '×'] as const)[Math.floor(r() * 3)];
  let a: number;
  let b: number;
  if (op === '×') {
    a = 3 + Math.floor(r() * 7);
    b = 3 + Math.floor(r() * 7);
  } else {
    a = 8 + Math.floor(r() * 32);
    b = 3 + Math.floor(r() * 18);
    if (op === '−' && b > a) [a, b] = [b, a];
  }
  const real = op === '+' ? a + b : op === '−' ? a - b : a * b;
  // Wrong answers a slip away: off by one or two, or by ten (a carry gone wrong).
  const wrong = [real - 10, real - 2, real - 1, real + 1, real + 2, real + 10].filter((v) => v >= 0);
  const options = [real];
  while (options.length < 4) options.push(wrong.splice(Math.floor(r() * wrong.length), 1)[0]);
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { kind: 'maths', delay: Math.round(600 + r() * 1400), a, b, op, options, answer: options.indexOf(real) };
}

/** Most Dots: one colour has the most (by at least two), the rest fewer; spread apart like the ducks. */
function makeMost(r: () => number): Round {
  const answer = Math.floor(r() * 4);
  const top = 6 + Math.floor(r() * 3); // 6-8
  const counts = [0, 1, 2, 3].map((c) => (c === answer ? top : 2 + Math.floor(r() * (top - 3))));
  const want = counts.flatMap((n, c) => Array<number>(n).fill(c));
  const dots: { x: number; y: number; c: number }[] = [];
  let tries = 0;
  while (dots.length < want.length && tries++ < 3000) {
    const x = 0.06 + r() * 0.88;
    const y = 0.1 + r() * 0.76;
    if (dots.every((d) => Math.hypot(d.x - x, (d.y - y) * 0.6) > 0.075)) dots.push({ x, y, c: want[dots.length] });
  }
  // If the screen ran out of room, make sure the answer still has the most of what was placed.
  const placed = [0, 1, 2, 3].map((c) => dots.filter((d) => d.c === c).length);
  return { kind: 'most', dots, answer: placed.indexOf(Math.max(...placed)) };
}

/** Biggest: three different digits in four different orders. */
function makeBig(r: () => number): Round {
  const digits: number[] = [];
  while (digits.length < 3) {
    const d = 1 + Math.floor(r() * 9);
    if (!digits.includes(d)) digits.push(d);
  }
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map((p) => p.reduce((n, i) => n * 10 + digits[i], 0));
  const options: number[] = [];
  while (options.length < 4) options.push(perms.splice(Math.floor(r() * perms.length), 1)[0]);
  return { kind: 'big', delay: Math.round(600 + r() * 1400), options, answer: options.indexOf(Math.max(...options)) };
}

/** Which Is…?: one word from the category, three from three other categories. */
function makeWhich(r: () => number): Round {
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)];
  const cat = Math.floor(r() * CATEGORIES.length);
  const others = CATEGORIES.map((_, i) => i).filter((i) => i !== cat);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const options: string[] = [pick(CATEGORIES[cat].words), ...others.slice(0, 3).map((i) => pick(CATEGORIES[i].words))];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { kind: 'which', delay: Math.round(600 + r() * 1400), cat, options, answer: options.findIndex((w) => (CATEGORIES[cat].words as readonly string[]).includes(w)) };
}

/** Sweet Spot: where the marker is (0-1 across the bar) `t` ms in: across and back each period. */
export function sweetAt(round: { period: number }, t: number): number {
  const k = (((t % round.period) + round.period) % round.period) / round.period;
  return k < 0.5 ? k * 2 : 2 - k * 2;
}

/** Pour: how full the glass is (0-1+) `t` ms into the round. */
export const pourLevel = (round: { brim: number }, t: number) => (t <= 0 ? 0 : (t / round.brim) ** POUR_EASE);
/** Pour: when the level reaches the line (ms). */
export const pourLine = (round: { line: number; brim: number }) => round.brim * round.line ** (1 / POUR_EASE);

/** The right pick for a one-pick round (-1 for the rounds that aren't). */
export function rightPick(round: Round): number {
  if (round.kind === 'ink') return round.ink;
  if (round.kind === 'ducks' || round.kind === 'maths' || round.kind === 'most' || round.kind === 'big' || round.kind === 'which') return round.answer;
  if (round.kind === 'odd') return round.odd;
  if (round.kind === 'arrow') return round.flip ? 3 - round.dir : round.dir;
  return -1;
}

/** When a round's picks or presses open, ms after the title card (the "go" moment the reaction is timed from). */
export function goAt(round: Round): number {
  if (round.kind === 'draw' || round.kind === 'ink' || round.kind === 'odd' || round.kind === 'maths' || round.kind === 'arrow' || round.kind === 'big' || round.kind === 'which') return round.delay;
  if (round.kind === 'ducks' || round.kind === 'most') return DUCK_WAIT + DUCK_FLASH;
  if (round.kind === 'simon') return round.seq.length * SIMON_STEP + 300;
  return 0;
}

/** After this (ms after the title card) a player who hasn't answered has missed. */
export function timeLimit(round: Round): number {
  if (round.kind === 'draw') return round.delay + REACT;
  if (round.kind === 'clock') return round.target + CLOCK_GRACE;
  // A pour nobody stops overflows soon after the brim.
  if (round.kind === 'pour') return round.brim * 1.1;
  if (round.kind === 'simon') return goAt(round) + SIMON_BASE + SIMON_PER * round.seq.length;
  if (round.kind === 'mash') return MASH_LIMIT;
  if (round.kind === 'sweet') return round.period * SWEEPS;
  return goAt(round) + PICK;
}

/** Does this round want a single press (any button) or one of four picks? */
export const picks = (round: Round) => !['draw', 'clock', 'pour', 'mash', 'sweet'].includes(round.kind);
/** Rounds you watch and stop (no go moment to react to): reactions aren't timed from a frame. */
export const untimed = (round: Round) => round.kind === 'clock' || round.kind === 'pour' || round.kind === 'sweet';

/**
 * Judges one answer. `at` is when it came, ms after the title card; `shown` is when the go moment actually
 * reached the screen (a frame after `goAt`), so reactions are timed from what the player saw. `pick` is
 * 0-3 for the pick rounds. Returns the result (lower is better) or null for a miss.
 */
export function judge(round: Round, at: number | null, pick = -1, shown = goAt(round)): number | null {
  if (at === null || !Number.isFinite(at) || at > timeLimit(round)) return null;
  if (round.kind === 'clock') return Math.round(Math.abs(at - round.target));
  // Pour: over the line spills; the result is how far short of it you stopped (ms of pouring).
  if (round.kind === 'pour') return at < 0 || at > pourLine(round) ? null : Math.round(pourLine(round) - at);
  if (round.kind === 'simon' || round.kind === 'mash') return null; // judged press by press: judgeSimon, judgeMash
  // Sweet Spot: outside the zone misses; inside, how far off centre, in ms of the marker's travel.
  if (round.kind === 'sweet') {
    const off = Math.abs(sweetAt(round, at) - round.zone);
    return at < 0 || off > SWEET_HALF ? null : Math.round((off * round.period) / 2);
  }
  if (at < goAt(round)) return null; // too soon (or a decoy)
  const right = rightPick(round);
  if (right >= 0 && pick !== right) return null;
  return Math.round(Math.max(0, at - Math.max(shown, goAt(round))));
}

/**
 * Simon: the presses so far (ms after the title card, and which colour). 'more' while they're right but not done;
 * null on a wrong colour, a press before the sequence finished, or too late; otherwise the time from the go
 * moment to the last press.
 */
export function judgeSimon(round: { kind: 'simon'; seq: number[] }, presses: { at: number; pick: number }[], shown = goAt(round)): number | null | 'more' {
  const go = Math.max(shown, goAt(round));
  for (let i = 0; i < presses.length; i++) {
    const p = presses[i];
    if (i >= round.seq.length || p.pick !== round.seq[i] || p.at < goAt(round) || p.at > timeLimit(round)) return null;
  }
  if (presses.length < round.seq.length) return 'more';
  return Math.round(Math.max(0, presses[presses.length - 1].at - go));
}

/** Mash!: the presses so far (ms after the title card). 'more' until there are enough; the time of the last. */
export function judgeMash(round: { kind: 'mash'; need: number }, presses: number[]): number | null | 'more' {
  if (presses.some((at) => at < 0 || at > timeLimit(round))) return null;
  if (presses.length < round.need) return 'more';
  return Math.round(presses[round.need - 1]);
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
  if (round.kind === 'pour') return v < 40 ? 'right on the line!' : `${(v / 1000).toFixed(2)} s short`;
  if (round.kind === 'sweet') return v < 15 ? 'bullseye!' : `${v} ms off centre`;
  if (round.kind === 'mash') return `${(v / 1000).toFixed(2)} s`;
  return `${v} ms`;
}
