// The endless road's checkpoints, generated: every leg ends at a place (a name on a sign and a job to do there), in a
// biome (a whole new world: its own sky, ground, trees and weather), sometimes with a twist. Places × biomes × twists
// is a few thousand different checkpoints, and `checkpointOf(seed, leg)` picks the same one on every screen. Pure.

import { rng, type Job } from './rules.ts';

export type Biome = 'pines' | 'swamp' | 'desert' | 'snow' | 'shroom' | 'ember' | 'neon' | 'grave' | 'crystal';

/** What a biome does to the map (its look is in world.ts `LOOKS`): hill size, and how thick the woods are. */
export const BIOMES: Record<Biome, { name: string; hill: number; woods: number; town: number }> = {
  pines: { name: 'the Back Roads', hill: 1, woods: 1, town: 1 },
  swamp: { name: 'Cataraqui Swamp', hill: 0.45, woods: 1.2, town: 0.3 },
  desert: { name: 'the Dust Bowl', hill: 0.8, woods: 0.5, town: 0.4 },
  snow: { name: 'the Big Freeze', hill: 1.25, woods: 0.9, town: 0.6 },
  shroom: { name: 'the Shroom Woods', hill: 0.9, woods: 1.4, town: 0.1 },
  ember: { name: 'the Burn', hill: 1.1, woods: 1, town: 0.3 },
  neon: { name: 'the Neon Strip', hill: 0.35, woods: 0.15, town: 2.2 },
  grave: { name: 'Boneyard Hollow', hill: 0.7, woods: 0.8, town: 0.3 },
  crystal: { name: 'Glass Canyon', hill: 1.4, woods: 0.6, town: 0.1 },
};
export const BIOME_IDS = Object.keys(BIOMES) as Biome[];

export const PLACES: Record<Job, readonly string[]> = {
  boss: ['The Meat Locker', 'Costco Loading Bay', 'Hog Town Abattoir', 'The Old Brewery', 'Silo Nine', 'Dufferin Quarry', 'The Rendering Plant'],
  rest: [
    'Tee Time Driving Range',
    'Lucky Limestone Casino',
    'Loon Lake Fishing Dock',
    'Chuck’s Arcade & Wings',
    'Big Moose Lounge',
    'Sandbar Beach Club',
    'Bogey’s Mini Golf',
    'Camp Wannabango Boathouse',
    'The 19th Hole',
    'Jackpot Jim’s',
  ],
  holdout: ['Kingston Holding Cells', 'The Drunk Tank', 'Fort Hungover', 'Campus Security Hut', 'The Old Drive-In', 'Homecoming Bleachers'],
  scavenge: ['Maple Leaf Hardware', 'Pete’s Pawn & Bait', 'Brewski Depot (Looted)', 'Dollar Barn', 'U-Wreck-It Scrapyard', 'Value Hamlet', 'Camp Wannabango', 'Poutine Palace'],
  fuel: ['Gas’n’Gulp', 'Petro-Eh', 'Last Chance Fuel', 'Trucker’s Rest', 'Marina Fuel Dock', 'Diesel Dan’s'],
  beacon: ['Campus Radio Tower', 'The Water Tower', 'Hilltop Lookout', 'Ferry Dock Lighthouse', 'Cell Tower Six', 'The Big Apple Pie Stand'],
};
export const JOB_IDS = Object.keys(PLACES) as Job[];

export type Twist = 'none' | 'blood' | 'fog' | 'sprint' | 'chonk' | 'storm' | 'jackpot' | 'quiet';
/** `horde` scales the rounds there, `pay` the scrap. */
export const TWISTS: Record<Twist, { name: string; horde: number; pay: number; note: string }> = {
  none: { name: '', horde: 1, pay: 1, note: '' },
  blood: { name: 'Blood Moon', horde: 1.5, pay: 2, note: 'Blood moon: half again as many zombies, double scrap.' },
  fog: { name: 'Foggy', horde: 1, pay: 1.25, note: 'Thick fog: you can barely see them coming.' },
  sprint: { name: 'Track Meet', horde: 0.9, pay: 1.5, note: 'Track meet: they all sprint.' },
  chonk: { name: 'All-You-Can-Eat', horde: 0.8, pay: 1.5, note: 'All you can eat: chonks everywhere.' },
  storm: { name: 'Stormy', horde: 1.15, pay: 1.25, note: 'A storm’s on top of you.' },
  jackpot: { name: 'Jackpot', horde: 1, pay: 2, note: 'Jackpot: double scrap here.' },
  quiet: { name: 'Suspiciously Quiet', horde: 0.6, pay: 1, note: 'It’s quiet. Too quiet.' },
};
export const TWIST_IDS = Object.keys(TWISTS) as Twist[];

export interface Checkpoint {
  leg: number;
  job: Job;
  place: string;
  biome: Biome;
  twist: Twist;
  /** The sign: the twist and the place ("Blood Moon Putt Putt Palace"). */
  name: string;
}

/** How many different checkpoints there are to find. */
export const CHECKPOINT_COUNT = Object.values(PLACES).reduce((n, l) => n + l.length, 0) * BIOME_IDS.length * TWIST_IDS.length;

/** The first legs are the story: loot the hardware store, win the club at the range, fuel up, then spring Gordie. */
const STORY: readonly { job: Job; place: number }[] = [
  { job: 'scavenge', place: 0 },
  { job: 'rest', place: 0 },
  { job: 'fuel', place: 0 },
  { job: 'holdout', place: 0 },
];

/** What kind of stop leg `n` ends at: work, a pit stop to catch your breath, or the big one. */
export function stopKind(n: number): Job | null {
  if (n < STORY.length) return STORY[n].job;
  // Every fourth stop is a breather, and every seventh is a boss.
  if (n % 4 === 3) return 'rest';
  if (n % 7 === 0) return 'boss';
  return null;
}

const cache = new Map<number, Checkpoint[]>();

/** The checkpoint at the end of leg `leg` of the run with this seed. */
export function checkpointOf(seed: number, leg: number): Checkpoint {
  let list = cache.get(seed);
  if (!list) {
    if (cache.size > 8) cache.clear();
    cache.set(seed, (list = []));
  }
  while (list.length <= leg) {
    const n = list.length;
    const prev = list[n - 1];
    const r = rng((seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0);
    const story = STORY[n];
    // Never the same job or the same world twice running.
    const forced = stopKind(n);
    const jobs = JOB_IDS.filter((j) => j !== prev?.job && j !== 'rest' && j !== 'boss');
    const job = forced ?? jobs[Math.floor(r() * jobs.length)];
    const places = PLACES[job];
    const place = places[story ? story.place : Math.floor(r() * places.length)];
    const biomes = BIOME_IDS.filter((b) => b !== prev?.biome);
    const biome = n < 2 ? 'pines' : biomes[Math.floor(r() * biomes.length)];
    // Twists turn up more the further you get.
    const twisted = !story && r() < Math.min(0.75, 0.25 + n * 0.03);
    const twist = twisted ? TWIST_IDS[1 + Math.floor(r() * (TWIST_IDS.length - 1))] : 'none';
    list.push({ leg: n, job, place, biome, twist, name: TWISTS[twist].name ? `${TWISTS[twist].name} ${place}` : place });
  }
  return list[leg];
}
