// The mystery, pure: trait cards (guests get one from their name), what each trait value looks like as a clue,
// picking which traits a crime gives away (a little early in the night, a lot late), and the night's clue state:
// crimes, clues on view and hidden in search spots, inspecting, searching, posting photos, plants and wipes, and the
// log the reveal plays back. The referee (host) runs all of it; only it knows which clues are plants.

import type { Vec3 } from '../../shared/math.ts';
import { CAST, lookFor, tagFor, type CharId, type Traits } from './cast.ts';
import { FLOOR_Y, GROUND, REACH, SPOTS, clearAt, floorOf, floorSpot, roomAt, searchesIn } from './house.ts';
import type { Night, Player } from './rules.ts';

export type Cat = keyof Traits | 'belonging';
export const CATS: Cat[] = ['notes', 'smoke', 'temper', 'room', 'drinking', 'footprint', 'hairColour', 'hairLength', 'belonging'];

export const VALUES: Record<Exclude<Cat, 'belonging'>, string[]> = {
  notes: ['engineering', 'computing', 'teaching', 'commerce', 'science'],
  smoke: ['weed', 'cigarettes', 'none'],
  temper: ['short fuse', 'calm'],
  room: ['spotless', 'tidy', 'messy', 'chaos', 'the couch'],
  drinking: ['heavy', 'light'],
  footprint: ['big', 'medium', 'small'],
  hairColour: ['brown', 'black', 'red'],
  hairLength: ['short', 'medium', 'long'],
};

/** Values that leave nothing behind: the referee never draws them, and nobody can plant them. */
const SILENT = new Set(['none', 'calm']);

export const PLANTS_PER_NIGHT = 3;
export const SEARCH_SECONDS = 2;
export const WIPE_SECONDS = 3;

// ---------------------------------------------------------------------------------------------
// Trait cards

const GUEST_HAIR: Record<string, Traits['hairColour']> = { '#15130f': 'black', '#a14a2a': 'red' };

/** A character's trait card. Guests share a card, so theirs comes from their name (and their hair from their look). */
export function traitsFor(char: CharId, name: string): Traits {
  if (char !== 'guest') return CAST[char].traits;
  let h = 17;
  for (const ch of name) h = (h * 131 + ch.charCodeAt(0)) >>> 0;
  const pick = <T>(list: readonly T[], k: number) => list[(h >>> k) % list.length];
  return {
    notes: pick(VALUES.notes, 0) as Traits['notes'],
    smoke: pick(['weed', 'none', 'none'] as const, 3),
    temper: pick(['short fuse', 'calm'] as const, 6),
    room: 'the couch',
    drinking: pick(['heavy', 'light'] as const, 9),
    footprint: 'medium',
    hairColour: GUEST_HAIR[lookFor('guest', name).hair] ?? 'brown',
    hairLength: 'short',
  };
}

interface Who {
  char: CharId;
  name: string;
}

export const valueOf = (p: Who, cat: Cat): string => (cat === 'belonging' ? p.char : traitsFor(p.char, p.name)[cat]);
export const fits = (p: Who, cat: Cat, value: string) => valueOf(p, cat) === value;
export const traceable = (cat: Cat, value: string) => !SILENT.has(value) && (cat === 'belonging' || VALUES[cat].includes(value));

// ---------------------------------------------------------------------------------------------
// What clues look like and say

/** The front of each kind of clue (what you see lying there before you pick it up). */
export const ITEM: Record<Cat, string> = {
  notes: 'A sheet of homework',
  smoke: 'Something that smells',
  temper: 'A furious sticky note',
  room: 'Something from someone’s room',
  drinking: 'Empties',
  footprint: 'A footprint in spilled beer',
  hairColour: 'A single hair',
  hairLength: 'A hairbrush',
  belonging: 'Someone’s stuff',
};

const DETAIL: Record<string, string> = {
  'notes:engineering': 'An engineering problem set. Q4: “find the force on the drumstick”. Someone did the free-body diagram.',
  'notes:computing': 'A code printout, 400 lines long. One comment: // TODO fix everything.',
  'notes:teaching': 'A grade-4 lesson plan. Activity 2: “feelings circle”. Feelings were had.',
  'notes:commerce': 'A case-study handout. “Synergy” is highlighted three times.',
  'notes:science': 'A lab report. Hypothesis: “it’ll be fine”. Conclusion: “it wasn’t”.',
  'smoke:weed': 'A roach folded into a receipt. Smells exactly like Bike Stu.',
  'smoke:cigarettes': 'A cigarette butt. An actual cigarette. In this house.',
  'temper:short fuse': 'A sticky note that just says “WHO DID THIS”, underlined so hard it tore. A fist-sized dent nearby.',
  'room:spotless': 'A hand towel folded into a swan. Someone irons their socks.',
  'room:tidy': 'A neat stack of coasters, squared off. Someone uses coasters.',
  'room:messy': 'A crumpled hoodie that has seen things.',
  'room:chaos': 'A sock that stands up on its own.',
  'room:the couch': 'A throw pillow with a face-shaped dent. A couch sleeper was here.',
  'drinking:heavy': 'A pile of empties, stacked into a pyramid. Structurally sound.',
  'drinking:light': 'One warm, half-finished can. Abandoned mid-sip.',
  'footprint:big': 'Big. Size 12 at least. A tall person’s foot.',
  'footprint:medium': 'Medium. Unremarkable. Suspiciously so.',
  'footprint:small': 'Small. Someone short, and light on their feet.',
  'hairColour:brown': 'A brown hair.',
  'hairColour:black': 'A black hair.',
  'hairColour:red': 'A red hair. Very red. Very orange, honestly.',
  'hairLength:short': 'A hairbrush with short hairs in it.',
  'hairLength:medium': 'A hairbrush with medium-length hairs in it.',
  'hairLength:long': 'A hairbrush with long hairs wound round it.',
};

/** The back of the clue: what it actually says about whoever left it. */
export function detail(cat: Cat, value: string): string {
  if (cat === 'belonging') return value in CAST ? `${CAST[value as CharId].belonging.replace(/^a /, 'A ')}. Whose is this?` : 'Something of someone’s.';
  return DETAIL[`${cat}:${value}`] ?? `${ITEM[cat]}: ${value}.`;
}

/** Who a value points at, said the way a text from Donal would say it. */
export function hint(cat: Cat, value: string): string {
  const H: Record<string, string> = {
    'notes:engineering': 'an engineer',
    'notes:computing': 'a comp sci kid',
    'notes:teaching': 'a future teacher',
    'notes:commerce': 'a commerce kid',
    'notes:science': 'a science kid',
    'smoke:weed': 'someone who smelled like weed',
    'smoke:cigarettes': 'someone smoking an actual cigarette',
    'temper:short fuse': 'someone yelling at a door',
    'room:spotless': 'someone who irons their socks',
    'room:tidy': 'someone carrying coasters',
    'room:messy': 'someone in a crusty hoodie',
    'room:chaos': 'someone who lives in total chaos',
    'room:the couch': 'someone who sleeps on couches',
    'drinking:heavy': 'someone carrying a 24',
    'drinking:light': 'someone nursing one warm can',
    'footprint:big': 'someone really tall',
    'footprint:medium': 'someone medium height',
    'footprint:small': 'someone really short',
    'hairColour:brown': 'someone with brown hair',
    'hairColour:black': 'someone with black hair',
    'hairColour:red': 'someone with red hair',
    'hairLength:short': 'someone with short hair',
    'hairLength:medium': 'someone with medium-length hair',
    'hairLength:long': 'someone with long hair',
  };
  return H[`${cat}:${value}`] ?? 'someone';
}

/** A short label for the board ("notes: engineering"). */
export const label = (cat: Cat, value: string) => (cat === 'belonging' ? `${value in CAST ? CAST[value as CharId].tag : value}’s stuff` : `${cat === 'hairColour' ? 'hair' : cat === 'hairLength' ? 'hair length' : cat}: ${value}`);

// ---------------------------------------------------------------------------------------------
// Picking which traits a crime gives away

/**
 * Picks `count` categories to show of `culprit`'s card. Early in the night (stage near 0) it prefers values most
 * of the house shares (they narrow a little); late it prefers rare ones (they narrow a lot). Silent values are never
 * drawn, a belonging only late and rarely, and a category this culprit has already shown counts for less.
 */
export function chooseCats(people: readonly Who[], culprit: Who, count: number, stage: number, rand: () => number, shown: readonly Cat[] = []): Cat[] {
  const target = 0.6 - 0.45 * stage;
  const pool = CATS.filter((c) => traceable(c, valueOf(culprit, c)) && (c !== 'belonging' || (stage > 0.5 && rand() < 0.25))).map((c) => {
    const v = valueOf(culprit, c);
    const share = people.filter((p) => valueOf(p, c) === v).length / Math.max(1, people.length);
    const w = Math.exp(-((share - target) ** 2) / 0.05) * (shown.includes(c) ? 0.35 : 1) + 0.02;
    return { c, w };
  });
  const out: Cat[] = [];
  while (out.length < count && pool.length) {
    const total = pool.reduce((a, p) => a + p.w, 0);
    let x = rand() * total;
    const i = pool.findIndex((p) => (x -= p.w) <= 0);
    out.push(pool.splice(i < 0 ? pool.length - 1 : i, 1)[0].c);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The night's crimes and clues

export interface Crime {
  id: number;
  kind: 'case' | 'takeout';
  by: number;
  victim: number | null;
  room: string;
  /** Roam time (s). */
  at: number;
  pos: Vec3;
}

export interface Clue {
  id: number;
  crime: number;
  cat: Cat;
  value: string;
  planted: boolean;
  /** The culprit (real clues) or the planter. */
  by: number;
  pos: Vec3;
  /** Hidden in this search spot until someone finds it. */
  spot: string | null;
  /** A locked phone or a knotted bin bag: it has to be opened before anyone can read it. */
  lock: 'phone' | 'bag' | null;
  state: 'view' | 'hidden' | 'gone';
}

/** What the referee keeps about the mystery (part of the Night). */
export interface Mystery {
  crimes: Crime[];
  clues: Clue[];
  /** Posted clue id → who posted it. */
  posted: Map<number, number>;
  /** Who has inspected which clues (their Case File). */
  seen: Map<number, Set<number>>;
  plants: Map<number, number>;
  /** [roam time, text] for the reveal's timeline. */
  log: [number, string][];
  /** The case's texts with their hints filled in: [roam time, from, text]. */
  texts: [number, string, string][];
}

export const newMystery = (): Mystery => ({ crimes: [], clues: [], posted: new Map(), seen: new Map(), plants: new Map(), log: [], texts: [] });

const nameOf = (p: Player) => tagFor(p.char, p.name);
const roomName = (p: Vec3) => roomAt({ ...p, y: p.y + 0.1 })?.name ?? 'somewhere';

/** A clear spot on the floor near `p` (for a clue by a body), within a metre. */
function near(p: Vec3, rand: () => number, taken: readonly Vec3[]): Vec3 {
  for (let k = 0; k < 30; k++) {
    const a = rand() * Math.PI * 2;
    const r = 0.5 + rand() * 0.5;
    const q = { x: p.x + Math.cos(a) * r, y: p.y, z: p.z + Math.sin(a) * r };
    if (clearAt(q) && roomAt({ ...q, y: q.y + 0.1 })?.id === roomAt({ ...p, y: p.y + 0.1 })?.id && taken.every((t) => Math.hypot(t.x - q.x, t.z - q.z) > 0.4))
      return q;
  }
  return { ...p };
}

/** The search spot a hidden clue goes in: one in the room, else the nearest on the same floor (within 8 m). */
function hideSpot(room: string, p: Vec3, rand: () => number): string | null {
  const here = searchesIn(room);
  if (here.length) return here[Math.floor(rand() * here.length)].id;
  const f = floorOf(p.y + 0.1);
  const near = SPOTS.filter((s) => s.kind === 'search' && floorOf(s.pos.y) === f)
    .map((s) => ({ s, d: Math.hypot(s.pos.x - p.x, s.pos.z - p.z) }))
    .filter((x) => x.d < 8)
    .sort((a, b) => a.d - b.d);
  return near[0]?.s.id ?? null;
}

/**
 * A crime happened: it's recorded, and it leaves clues showing true traits of whoever did it, `view` on the floor
 * near `pos` and `hidden` in a nearby search spot.
 */
export function commitCrime(n: Night, kind: Crime['kind'], by: number, pos: Vec3, room: string, view: number, hidden: number, victim: number | null = null): Crime {
  const m = n.mystery;
  const culprit = n.players.find((p) => p.id === by)!;
  const crime: Crime = { id: m.crimes.length, kind, by, victim, room, at: n.roam, pos: { ...pos } };
  m.crimes.push(crime);
  const rand = () => nextRand(n);
  const shown = m.clues.filter((c) => !c.planted && c.by === by).map((c) => c.cat);
  const cats = chooseCats(n.players, culprit, view + hidden, Math.min(1, n.roam / Math.max(1, n.length)), rand, shown);
  const taken: Vec3[] = [];
  cats.forEach((cat, i) => {
    const isHidden = i >= view;
    const spot = isHidden ? hideSpot(room, pos, rand) : null;
    if (isHidden && !spot) return;
    const at = isHidden ? { ...SPOTS.find((s) => s.id === spot)!.pos } : kind === 'case' ? floorSpot(room, rand, taken) : near(pos, rand, taken);
    taken.push(at);
    // Now and then a clue on view comes locked: a phone with a passcode, a knotted bin bag.
    const lock = !isHidden && rand() < 0.35 ? (rand() < 0.5 ? 'phone' : 'bag') : null;
    m.clues.push({ id: m.clues.length, crime: crime.id, cat, value: valueOf(culprit, cat), planted: false, by, pos: at, spot, state: isHidden ? 'hidden' : 'view', lock });
  });
  if (kind === 'takeout') {
    const v = n.players.find((p) => p.id === victim)!;
    log(n, `${nameOf(culprit)} took out ${nameOf(v)} in ${roomName(pos)}.`);
  }
  return crime;
}

/** The referee's dice, kept in the Night (so a night replays from its seed). */
export function nextRand(n: Night): number {
  let t = (n.rs = (n.rs + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function log(n: Night, text: string) {
  n.mystery.log.push([Math.round(n.roam), text]);
}

const near2 = (a: Vec3, b: Vec3, r: number) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= r;
/** Range checks get slack for 100 ms of interpolation and where a body's eyes are. */
const SLACK = 1.5;

/** Picks up a clue on view: its owner learns what it says. Returns the clue, or null. */
export function inspect(n: Night, who: number, clueId: number, at: Vec3): Clue | null {
  const c = n.mystery.clues[clueId];
  const p = n.players.find((x) => x.id === who);
  if (!c || !p || c.state !== 'view' || c.lock || p.gone || !near2(c.pos, at, REACH + SLACK)) return null;
  const seen = n.mystery.seen.get(who) ?? new Set<number>();
  seen.add(clueId);
  n.mystery.seen.set(who, seen);
  return c;
}

/**
 * Digs through a search spot. A hidden clue there comes out onto the floor (and the finder has inspected it).
 * Returns the clue, null for nothing, or false if they can't search it.
 */
export function search(n: Night, who: number, spotId: string, at: Vec3): Clue | null | false {
  const s = SPOTS.find((x) => x.id === spotId && x.kind === 'search');
  const p = n.players.find((x) => x.id === who);
  if (!s || !p || p.gone || n.phase !== 'night' || !near2(s.pos, at, REACH + SLACK)) return false;
  const c = n.mystery.clues.find((x) => x.state === 'hidden' && x.spot === spotId);
  if (!c) return null;
  // It comes out at the finder's feet (the spot itself may be under a bed).
  c.state = 'view';
  c.spot = null;
  c.pos = { x: at.x, y: floorAt(s.pos), z: at.z };
  inspect(n, who, c.id, c.pos);
  return c;
}

function floorAt(p: Vec3) {
  const r = roomAt(p);
  return r?.outside && r.surface !== 'porch' ? GROUND : FLOOR_Y[floorOf(p.y)];
}

/** Seconds to open a locked clue: a slow fiddle for anyone, 2 s for JJ's spare keys (bags) or Mikol (phones). */
export function unlockTime(char: CharId, lock: 'phone' | 'bag'): number {
  return (lock === 'bag' && char === 'jj') || (lock === 'phone' && char === 'mikol') ? 2 : 30;
}

/** Opens a locked clue (and the opener reads it). */
export function unlock(n: Night, who: number, clueId: number, at: Vec3): Clue | null {
  const c = n.mystery.clues[clueId];
  const p = n.players.find((x) => x.id === who);
  if (!c || !p || p.gone || c.state !== 'view' || !c.lock || n.phase !== 'night' || !near2(c.pos, at, REACH + SLACK)) return null;
  c.lock = null;
  return inspect(n, who, clueId, at);
}

/** Posts a clue's photo to the group chat (you must have looked at it, and nobody has posted it yet). */
export function post(n: Night, who: number, clueId: number): Clue | null {
  const c = n.mystery.clues[clueId];
  if (!c || c.state === 'hidden' || n.mystery.posted.has(clueId) || !n.mystery.seen.get(who)?.has(clueId)) return null;
  n.mystery.posted.set(clueId, who);
  return c;
}

const plantsLeft = (n: Night, who: number) => n.mystery.plants.get(who) ?? PLANTS_PER_NIGHT;

/** Can this value be planted? Only things that leave a trace; belongings of someone in the house. */
function plantable(n: Night, cat: Cat, value: string): boolean {
  if (cat === 'belonging') return n.players.some((p) => p.char === value);
  return CATS.includes(cat) && traceable(cat, value);
}

/** A Degenerate drops a fake clue. It's tagged with the nearest crime (that's what it's pretending to be from). */
export function plant(n: Night, who: number, cat: Cat, value: string, at: Vec3): Clue | null {
  const p = n.players.find((x) => x.id === who);
  const m = n.mystery;
  if (!p || p.role !== 'degenerate' || !p.alive || p.evicted || n.phase !== 'night' || plantsLeft(n, who) <= 0) return null;
  if (!plantable(n, cat, value) || !m.crimes.length || !clearAt({ ...at, y: at.y + 0.02 })) return null;
  const crime = m.crimes.reduce((a, b) => (Math.hypot(b.pos.x - at.x, b.pos.y - at.y, b.pos.z - at.z) < Math.hypot(a.pos.x - at.x, a.pos.y - at.y, a.pos.z - at.z) ? b : a));
  m.plants.set(who, plantsLeft(n, who) - 1);
  const c: Clue = { id: m.clues.length, crime: crime.id, cat, value, planted: true, by: who, pos: { ...at }, spot: null, state: 'view', lock: null };
  m.clues.push(c);
  const seen = m.seen.get(who) ?? new Set<number>();
  seen.add(c.id);
  m.seen.set(who, seen);
  log(n, `${nameOf(p)} planted ${ITEM[cat].toLowerCase()} (${label(cat, value)}) in ${roomName(at)}.`);
  return c;
}

/** A Degenerate destroys a clue on view. */
export function wipe(n: Night, who: number, clueId: number, at: Vec3): boolean {
  const p = n.players.find((x) => x.id === who);
  const c = n.mystery.clues[clueId];
  if (!p || p.role !== 'degenerate' || !p.alive || p.evicted || n.phase !== 'night' || !c || c.state !== 'view' || !near2(c.pos, at, REACH + SLACK)) return false;
  c.state = 'gone';
  log(n, `${nameOf(p)} wiped away ${ITEM[c.cat].toLowerCase()} (${label(c.cat, c.value)}) in ${roomName(c.pos)}.`);
  return true;
}

/** Fills the case's texts: `{hint}` becomes a true trait of the case's culprit that no clue shows yet. */
export function caseTexts(n: Night, texts: readonly [number, string, string][]): [number, string, string][] {
  const crime = n.mystery.crimes.find((c) => c.kind === 'case');
  const culprit = crime && n.players.find((p) => p.id === crime.by);
  let fill = 'someone';
  if (culprit) {
    const shown = new Set(n.mystery.clues.filter((c) => c.by === culprit.id).map((c) => c.cat));
    const cats = CATS.filter((c) => c !== 'belonging' && !shown.has(c) && traceable(c, valueOf(culprit, c)));
    if (cats.length) {
      const cat = cats[Math.floor(nextRand(n) * cats.length)];
      fill = hint(cat, valueOf(culprit, cat));
    }
  }
  return texts.map(([at, from, text]) => [Math.round(at * n.length), from, text.replace('{hint}', fill)]);
}
