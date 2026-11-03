// Each character's ability, pure: what it's called, its uses or cooldown, and the referee's side of each one
// (who was where for Router Logs, Jung's Proof, what Bongus Mode lights up, Inspection, Trip Wire, Swab, Spill the Tea). Quirks
// that only change how your own screen works (Rock Hound, Supervisor, Couch Lock, Illogical!) live in night.ts.
// Guests draw from the guest pool by name. An ability helps; it never decides a night alone.

import type { Vec3 } from '../../shared/math.ts';
import { tagFor, type CharId } from './cast.ts';
import { fits, traitsFor } from './clues.ts';
import { ROOMS, roomAt } from './house.ts';
import type { Night } from './rules.ts';

export type Power =
  | 'toboggan' | 'router' | 'proof' | 'bongus' | 'bikestu' | 'lookout' | 'legend' | 'inspection' | 'wallhack' | 'ruck' | 'tripwire'
  | 'swab' | 'tea' | 'objection' | 'eavesdrop';

export interface PowerDef {
  name: string;
  /** Uses a night (none: unlimited, on a cooldown). */
  uses?: number;
  /** Seconds of roam between uses. */
  cd?: number;
  /** How long it lasts (s), for the ones that last. */
  dur?: number;
  /** One line for the HUD and the guest card. */
  text: string;
}

export const POWERS: Record<Power, PowerDef> = {
  toboggan: { name: 'Toboggan Run', cd: 45, dur: 2.5, text: 'Q: ride the concrete toboggan straight ahead at 3× speed. Loud.' },
  router: { name: 'Router Logs', cd: 30, text: 'Q at the router (in the hall): which room everyone was in over the last 90 s.' },
  proof: { name: 'Proof', uses: 2, text: 'Q: pick a player and a crime: consistent or contradiction with its real photos.' },
  bongus: { name: 'Bongus Mode', uses: 2, dur: 15, text: 'Q: one huge rip. Hidden clues within 6 m glow. You walk slower.' },
  bikestu: { name: 'Bike Stu Session', uses: 2, dur: 45, text: 'Q: two randoms from the studio wander for 45 s and text you if they see a crime.' },
  lookout: { name: 'Look Out', cd: 45, dur: 30, text: 'Q at a friend: nobody can take them out for 30 s, and you hear if someone tries.' },
  legend: { name: 'Campus Legend', uses: 1, text: 'Once a night, at a vote: your vote counts double (everyone sees).' },
  inspection: { name: 'Inspection', cd: 40, text: 'Q, then stand still 3 s: anything planted in this room sparkles.' },
  wallhack: { name: 'Wallhack', uses: 2, dur: 4, text: 'Q: for 4 s, everyone within 12 m glows through walls and floors.' },
  ruck: { name: 'Ruck', cd: 30, text: 'Q: burst through every door in front of you and bowl over whoever’s there.' },
  tripwire: { name: 'Trip Wire', uses: 2, dur: 60, text: 'Q in a room: for 60 s, anyone who walks in trips your sensor, and you get a text about their footsteps.' },
  swab: { name: 'Swab', uses: 2, text: 'Q at a clue: real or planted. Twice a night.' },
  tea: { name: 'Spill the Tea', uses: 1, text: 'Q: one true thing from tonight (who was where, when).' },
  objection: { name: 'Objection!', uses: 1, text: 'Once a night, at a vote: void it and vote again.' },
  eavesdrop: { name: 'Eavesdrop', cd: 40, dur: 5, text: 'Q: for 5 s, everyone within 9 m glows through walls.' },
};

const BY_CHAR: Record<Exclude<CharId, 'guest'>, Power> = {
  dev: 'toboggan',
  mikol: 'router',
  jung: 'proof',
  xang: 'bongus',
  selby: 'bikestu',
  wags: 'lookout',
  will: 'legend',
  jj: 'inspection',
  nash: 'wallhack',
  shota: 'ruck',
  gare: 'tripwire',
};
const GUEST_POOL: Power[] = ['swab', 'tea', 'objection', 'eavesdrop'];

export function powerOf(char: CharId, name: string): Power {
  if (char !== 'guest') return BY_CHAR[char];
  let h = 5;
  for (const ch of name) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return GUEST_POOL[h % GUEST_POOL.length];
}

/** Bongus Mode's reach, Look Out's, the range at which a Bike Stu random notices a crime. */
export const BONGUS_RANGE = 6;
export const LOOKOUT_RANGE = 2.5;
export const NPC_SIGHT = 10;
/** How far back Router Logs remember. */
const ROUTER_SPAN = 90;

/** The referee's ability bookkeeping (part of the Night). */
export interface Powers {
  used: Map<number, number>;
  readyAt: Map<number, number>;
  /** Guarded player → who's guarding and until when (roam). */
  guard: Map<number, { by: number; until: number }>;
  /** Room changes per player: [roam time, room id]. */
  history: Map<number, [number, string][]>;
  /** Whose vote counts double at this meeting. */
  doubled: number | null;
  /** Bike Stu's randoms are out until this roam time (for Selby). */
  stuUntil: number;
  stuBy: number;
  /** Gare's Trip Wire: the wired room, whose sensor it is, and until when (roam). */
  wire: { room: string; by: number; until: number } | null;
}

export const newPowers = (): Powers => ({ used: new Map(), readyAt: new Map(), guard: new Map(), history: new Map(), doubled: null, stuUntil: -1, stuBy: -1, wire: null });

const player = (n: Night, id: number) => n.players.find((p) => p.id === id);

/** Why `who` can't use their ability now (null: they can). */
export function powerProblem(n: Night, who: number): string | null {
  const p = player(n, who);
  if (!p || p.gone || !p.alive || p.evicted) return 'not now';
  const def = POWERS[powerOf(p.char, p.name)];
  if (def.uses !== undefined && (n.powers.used.get(who) ?? 0) >= def.uses) return 'used up';
  if (n.roam < (n.powers.readyAt.get(who) ?? 0)) return 'cooling down';
  return null;
}

/** Marks a use (and starts the cooldown). */
export function spend(n: Night, who: number) {
  const p = player(n, who)!;
  const def = POWERS[powerOf(p.char, p.name)];
  n.powers.used.set(who, (n.powers.used.get(who) ?? 0) + 1);
  if (def.cd) n.powers.readyAt.set(who, n.roam + def.cd);
}

/** What the HUD shows: uses left (-1: unlimited) and when it's ready (roam). */
export function powerView(n: Night, who: number): { uses: number; readyAt: number } {
  const p = player(n, who)!;
  const def = POWERS[powerOf(p.char, p.name)];
  return { uses: def.uses === undefined ? -1 : def.uses - (n.powers.used.get(who) ?? 0), readyAt: n.powers.readyAt.get(who) ?? 0 };
}

/** Notes which room everyone's in (the referee calls this about once a second). */
export function recordRooms(n: Night, poses: ReadonlyMap<number, Vec3>) {
  for (const [id, pos] of poses) {
    const room = roomAt({ ...pos, y: pos.y + 0.1 })?.id;
    if (!room) continue;
    const h = n.powers.history.get(id) ?? [];
    if (h.at(-1)?.[1] !== room) h.push([n.roam, room]);
    while (h.length > 2 && h[1][0] < n.roam - ROUTER_SPAN * 2) h.shift();
    n.powers.history.set(id, h);
  }
}

const roomName = (id: string) => ROOMS.find((r) => r.id === id)?.name ?? id;

const ago = (s: number) => (s < 1 ? 'now' : `${Math.round(s)} s ago`);

/** Router Logs: for each living phone, the rooms it was in over the last 90 s. */
export function routerLog(n: Night): string[] {
  return n.players
    .filter((p) => p.alive && !p.evicted && !p.gone)
    .map((p) => {
      const h = n.powers.history.get(p.id) ?? [];
      const recent = h.filter(([t], i) => t >= n.roam - ROUTER_SPAN || h[i + 1]?.[0] >= n.roam - ROUTER_SPAN);
      const trail = recent.map(([t, r]) => `${roomName(r)} (${ago(n.roam - Math.max(t, n.roam - ROUTER_SPAN))})`).join(' → ');
      return `${tagFor(p.char, p.name)}: ${trail || 'no signal'}`;
    });
}

/** Jung's Proof: is `target` consistent with every real posted clue from `crime`? null: nothing posted to go on. */
export function proof(n: Night, target: number, crime: number): 'consistent' | 'contradiction' | null {
  const p = player(n, target);
  const real = [...n.mystery.posted.keys()].map((id) => n.mystery.clues[id]).filter((c) => c.crime === crime && !c.planted);
  if (!p || !real.length) return null;
  return real.every((c) => fits(p, c.cat, c.value)) ? 'consistent' : 'contradiction';
}

/** Bongus Mode: hidden clues within reach (through walls and floors). */
export const hiddenNear = (n: Night, at: Vec3, r = BONGUS_RANGE): [number, number, number][] =>
  n.mystery.clues.filter((c) => c.state === 'hidden' && Math.hypot(c.pos.x - at.x, c.pos.y - at.y, c.pos.z - at.z) <= r).map((c) => [c.pos.x, c.pos.y, c.pos.z]);

/** JJ's Inspection: clues on view in this room that were planted. */
export const plantedIn = (n: Night, room: string) =>
  n.mystery.clues.filter((c) => c.planted && c.state === 'view' && roomAt({ ...c.pos, y: c.pos.y + 0.1 })?.id === room).map((c) => c.id);

/** Spill the Tea: one true thing from the night (someone was somewhere at some time), picked with `rand`. */
export function teaFact(n: Night, about: number, rand: () => number): string | null {
  const facts: string[] = [];
  for (const [id, h] of n.powers.history) {
    const p = player(n, id);
    if (!p || id === about) continue;
    for (const [t, r] of h) if (t > 1) facts.push(`${tagFor(p.char, p.name)} went into ${roomName(r)} at ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.`);
  }
  return facts.length ? facts[Math.floor(rand() * facts.length)] : null;
}

/** The room each player was last seen in (what `recordRooms` will compare against). */
export const lastRooms = (n: Night) => new Map([...n.powers.history].map(([id, h]) => [id, h.at(-1)?.[1]]));

/**
 * Trip Wire: who just walked into the wired room (since `before`, from `lastRooms`), as the texts Gare gets.
 * Only their footsteps: big, medium or small. Gare tripping his own sensor doesn't count.
 */
export function wireTrips(n: Night, before: ReadonlyMap<number, string | undefined>): string[] {
  const w = n.powers.wire;
  if (!w || w.until <= n.roam) return [];
  const name = roomName(w.room);
  const out: string[] = [];
  for (const [id, h] of n.powers.history) {
    const p = player(n, id);
    const now = h.at(-1)?.[1];
    if (!p || id === w.by || now !== w.room || before.get(id) === w.room) continue;
    out.push(`Sensor tripped in ${name}: ${traitsFor(p.char, p.name).footprint} footsteps.`);
  }
  return out;
}

/** Look Out: is `who` being guarded right now? */
export const guarded = (n: Night, who: number) => (n.powers.guard.get(who)?.until ?? -1) > n.roam;
