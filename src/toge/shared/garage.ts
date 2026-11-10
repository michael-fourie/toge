// Your garage: money, the cars you own (each with its upgrades, paint and tuning) and the rules for
// spending it: buying cars, gambling on upgrade crates, and what a race pays. Pure and shared: the server
// runs it for signed-in players (their garage lives in the Accounts Durable Object), the client runs the
// same code against localStorage for guests.

import { CARS, type CarId, type Look, MAX_LEVEL, type OwnedCar, PARTS, type Part, type Tune, cleanCar, cleanLook, cleanTune, decodeCar, encodeCar, isCarId, newOwnedCar } from './cars.ts';
import { COS_ITEMS, COS_SLOTS, type CaseId, type CosSlot, RARITY, cleanPlate, cosById, cosCaseById, passOnly, rollCosCase } from './cosmetics.ts';
import { clampDrift, driftPay } from './drift.ts';
import { decodeLook, encodeLook } from './look.ts';
import { type BgId, PASS, type PassState, STAGES, TIERS, TITLES, type TitleId, lockedLookParts, ownedLook, owns, raceXp, tierFor, tierOf, unlocked } from './pass.ts';
import { type Rider, cleanRider, defaultRider } from './rider.ts';
import type { TrackId } from './track.ts';
import { TRACK_DEFS } from './track.ts';

export const START_MONEY = 4000;
export const MAX_CARS = 12;

export interface Garage extends PassState {
  money: number;
  cars: OwnedCar[];
  /** Index of the car you race. */
  sel: number;
  races: number;
  wins: number;
  /** When a solo race last paid out (ms), so payouts can't be spammed. */
  lastReward: number;
  /** Cosmetic item ids won from cases (cosmetics.ts), each once. */
  cos: string[];
  /** Your driver (rider.ts): stands by your car at home and with your crew in a lobby. Free to change. */
  rider: Rider;
  /** Your own driver as last made in the creator (a look code; '' before you've made one), kept while you drive a
   * legend. */
  look: string;
  /** The home background (pass.ts `STAGES`; '' = the garage bay). */
  bg: BgId | '';
  /** The title on your player card (pass.ts `TITLES`; '' = none). */
  title: TitleId | '';
}

export const newGarage = (): Garage => ({ money: START_MONEY, cars: [newOwnedCar('pebble', 0)], sel: 0, races: 0, wins: 0, lastReward: 0, cos: [], rider: defaultRider(), look: '', xp: 0, pass: false, given: 0, bg: '', title: '' });

/** Anything (stored JSON, a request body) to a valid garage. */
export function cleanGarage(x: unknown): Garage {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const g = newGarage();
  const cars = Array.isArray(o.cars) ? o.cars.map(cleanCar).filter((c): c is OwnedCar => !!c).slice(0, MAX_CARS) : [];
  if (cars.length) g.cars = cars;
  const whole = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  if (typeof o.money === 'number') g.money = whole(o.money);
  g.sel = Math.min(g.cars.length - 1, whole(o.sel));
  g.races = whole(o.races);
  g.wins = whole(o.wins);
  g.lastReward = whole(o.lastReward);
  g.xp = whole(o.xp);
  g.pass = o.pass === true;
  g.given = g.pass ? Math.min(whole(o.given), tierOf(g.xp)) : 0;
  // Pass cosmetics only while the pass has them unlocked (they're handed over by givePass, never rolled).
  g.cos = Array.isArray(o.cos) ? [...new Set(o.cos.filter((id) => { const it = cosById(id); return it && (!passOnly(it) || unlocked(g, tierFor('cos', it.id))); }))].slice(0, COS_ITEMS.length) as string[] : [];
  g.rider = ownedRider(g, cleanRider(o.rider));
  g.look = typeof o.look === 'string' && decodeLook(o.look) ? ownedRider(g, o.look as Rider) : '';
  g.bg = typeof o.bg === 'string' && o.bg in STAGES && owns(g, 'bg', o.bg) ? (o.bg as BgId) : '';
  g.title = typeof o.title === 'string' && o.title in TITLES && owns(g, 'title', o.title) ? (o.title as TitleId) : '';
  // A car can only wear what the garage owns.
  const owned = new Set(g.cos);
  for (const c of g.cars) for (const s of COS_SLOTS) if (c.cos[s] && !owned.has(c.cos[s]!)) delete c.cos[s];
  return g;
}

export const current = (g: Garage): OwnedCar => g.cars[g.sel] ?? g.cars[0];

/** A driver (a legend's id, or your own look's code) with any battle pass piece the garage hasn't unlocked taken off. */
export function ownedRider(p: PassState, r: Rider): Rider {
  const l = decodeLook(r);
  return l && lockedLookParts(p, l).length ? encodeLook(ownedLook(p, l)) : r;
}

// ---------------------------------------------------------------------------------------------
// The battle pass (pass.ts): XP from every race, the pass bought with garage money, tiers handed over

/**
 * Hands over every tier the pass has reached since the last time (money, cosmetics into the locker; backgrounds,
 * titles and driver pieces are simply usable once unlocked). Does nothing without the pass: XP still counts.
 */
export function givePass(g: Garage): Garage {
  const tier = tierOf(g.xp);
  if (!g.pass || tier <= g.given) return g;
  const next = structuredClone(g);
  for (let n = g.given + 1; n <= tier; n++) {
    const r = TIERS[n - 1];
    if (r.kind === 'money') next.money += r.amount;
    else if (r.kind === 'cos' && !next.cos.includes(r.id)) next.cos.push(r.id);
  }
  next.given = tier;
  return next;
}

/** Season XP for a race, then whatever tiers it reached. */
export const addXp = (g: Garage, xp: number): Garage => givePass({ ...g, xp: g.xp + Math.max(0, Math.floor(xp) || 0) });

// ---------------------------------------------------------------------------------------------
// Crates: the only way to upgrade. Pay, spin, see what you get.

export type CrateKind = 'mystery' | 'tuner';

export const CRATES: Record<CrateKind, { name: string; blurb: string }> = {
  mystery: { name: 'Mystery Crate', blurb: 'Always an upgrade, on a random part: 80% +1 level, 15% +2, 5% jackpot (+1 to everything).' },
  tuner: { name: 'Tuner Crate', blurb: 'Always an upgrade, on the part you pick: 85% +1 level, 15% +2. Pricier the higher it goes.' },
};

export const MYSTERY_COST = 1500;
export const tunerCost = (level: number) => 700 * (level + 1);

export type CrateResult = { kind: 'up'; part: Part; levels: number } | { kind: 'jackpot'; parts: Part[] };

const open = (c: OwnedCar) => PARTS.filter((p) => c.up[p] < MAX_LEVEL);

export function crateCost(g: Garage, kind: CrateKind, part?: Part): number {
  return kind === 'mystery' ? MYSTERY_COST : tunerCost(part ? current(g).up[part] : 0);
}

/** Opens a crate on the selected car. `rnd` is the dice (Math.random on the server). */
function openCrate(g: Garage, kind: CrateKind, part: Part | undefined, rnd: () => number): { g: Garage; result: CrateResult } | { error: string } {
  const car = current(g);
  const room = open(car);
  if (!room.length) return { error: 'This car is fully upgraded.' };
  if (kind === 'tuner' && (!part || !PARTS.includes(part))) return { error: 'Pick a part.' };
  if (kind === 'tuner' && car.up[part!] >= MAX_LEVEL) return { error: 'That part is maxed out.' };
  const cost = crateCost(g, kind, part);
  if (g.money < cost) return { error: 'Not enough money.' };
  const next = structuredClone(g);
  next.money -= cost;
  const c = current(next);
  const r = rnd();
  const bump = (p: Part, n: number) => {
    const before = c.up[p];
    c.up[p] = Math.min(MAX_LEVEL, before + n);
    return c.up[p] - before;
  };
  let result: CrateResult;
  // Every crate upgrades something; the gamble is how much, and (mystery) on what.
  if (kind === 'tuner') result = { kind: 'up', part: part!, levels: bump(part!, r < 0.15 ? 2 : 1) };
  else {
    const pick = room[Math.floor(rnd() * room.length) % room.length];
    if (r < 0.05) {
      for (const p of room) bump(p, 1);
      result = { kind: 'jackpot', parts: room };
    } else result = { kind: 'up', part: pick, levels: bump(pick, r < 0.2 ? 2 : 1) };
  }
  return { g: next, result };
}

// ---------------------------------------------------------------------------------------------
// Cosmetic cases: pay, roll (the server's dice for accounts), keep it, or get money back for a duplicate.

export interface CaseDrop {
  id: string;
  /** Already owned: nothing new, `refund` paid back instead. */
  dup: boolean;
  refund: number;
}

function openCase(g: Garage, id: CaseId, rnd: () => number): { g: Garage; drop: CaseDrop } | { error: string } {
  const box = cosCaseById(id);
  if (!box) return { error: 'No such case.' };
  if (g.money < box.price) return { error: 'Not enough money.' };
  const item = rollCosCase(box.id, rnd);
  const next = structuredClone(g);
  next.money -= box.price;
  const dup = next.cos.includes(item.id);
  const refund = dup ? RARITY[item.rarity].refund : 0;
  if (dup) next.money += refund;
  else next.cos.push(item.id);
  return { g: next, drop: { id: item.id, dup, refund } };
}

/** A race code with any cosmetic the garage doesn't own taken off (the server runs this on accounts' cars). */
export function ownedCarCode(code: string, g: Garage): string {
  const car = decodeCar(code);
  if (!car) return code;
  const owned = new Set(g.cos);
  for (const s of COS_SLOTS) if (car.cos[s] && !owned.has(car.cos[s]!)) delete car.cos[s];
  return encodeCar(car);
}

// ---------------------------------------------------------------------------------------------
// Race payouts

const PLACE_SHARE = [1, 0.7, 0.52, 0.42, 0.35, 0.3, 0.27, 0.25];
export const DNF_PAY = 150;
const TIME_TRIAL_SHARE = 0.3;
/** Solo races (against AI) pay this share, and at most once per this many ms. */
export const SOLO_SHARE = 0.6;
export const SOLO_GAP_MS = 45_000;
/** Longest solo race the drift clamp allows for (s). */
const SOLO_MAX_SECONDS = 600;

/** What a finish pays: by place, a bit more for a bigger field and a longer road. `place` is 1-based, 0 = DNF. */
export function payout(place: number, field: number, track: TrackId, solo: boolean): number {
  if (place <= 0) return DNF_PAY;
  const km = TRACK_LENGTH_KM[track];
  const base = 1300 * km * (1 + 0.12 * Math.max(0, field - 1));
  // Alone on the road there's nobody to beat: a time trial pays like a minor place.
  const share = field <= 1 ? TIME_TRIAL_SHARE : PLACE_SHARE[Math.min(PLACE_SHARE.length - 1, place - 1)];
  return Math.round((base * share * (solo ? SOLO_SHARE : 1)) / 10) * 10;
}

/**
 * The bonus on top of the place prize: drift points (already clamped to the race clock). Solo races pay their usual
 * share of it. Paid to finishers and DNFs alike.
 */
export function raceBonus(drift: number, track: TrackId, solo: boolean): { drift: number } {
  const share = solo ? SOLO_SHARE : 1;
  return { drift: Math.round((driftPay(drift, TRACK_LENGTH_KM[track]) * share) / 10) * 10 };
}

/** Rough race distances (km; every lap of a circuit) so payouts don't need the track built; tests check they stay close. */
export const TRACK_LENGTH_KM: Record<TrackId, number> = { koripass: 5.3, saltwind: 3.6, redmesa: 4.1, tsukiyo: 5.1, momiji: 3.2, sakura: 4.2, monza: 5.6, spa: 5.2, monaco: 5.0, neonbay: 3.2, kodama: 4.4, karasu: 4.1, hachi: 3.7, nagare: 3.16, minato: 5.34, akane: 5.18, kazeoka: 5.52, ryusei: 4.72, hayate: 4.8, seatosky: 5.72, shiden: 5.29, isonami: 5.83, toge: 37 };

// ---------------------------------------------------------------------------------------------
// Everything you can do to a garage, as one action type (the server's API and the guest's local store)

export type GarageAction =
  | { a: 'crate'; kind: CrateKind; part?: Part }
  | { a: 'buy'; model: CarId; paint?: number }
  | { a: 'select'; i: number }
  | { a: 'style'; i: number; look: Look; tune: Tune }
  | { a: 'sell'; i: number }
  /**
   * `drift`: drift points banked (client-reported, clamped). `time`: your finish
   * (s), for best times (records.ts; not part of applyAction, which only pays). `ghost`: the run (ghost.ts), kept as
   * the track's record ghost if the time is the new record.
   */
  | { a: 'solo'; track: TrackId; place: number; field: number; drift?: number }
  | { a: 'case'; id: CaseId }
  | { a: 'equip'; i: number; slot: CosSlot; id: string | null }
  | { a: 'plate'; i: number; text: string }
  /** Who drives; `look` also saves your own driver (kept when you switch to a legend). */
  | { a: 'rider'; rider: Rider; look?: string }
  /** Buy the battle pass. */
  | { a: 'pass' }
  /** Pick the home background or the card title ('' = none): pass rewards you've unlocked. */
  | { a: 'bg'; id: BgId | '' }
  | { a: 'title'; id: TitleId | '' };

/** `best`: a solo finish that set a new best time (filled in by the garage's keeper, not applyAction). */
/** `xp`: season XP the action earned (a solo race). */
export type ActionResult = { ok: true; g: Garage; crate?: CrateResult; drop?: CaseDrop; paid?: number; bonus?: { drift: number }; xp?: number } | { ok: false; error: string };

/** Selling gives back this share of the car's price. */
export const SELL_SHARE = 0.5;

export function applyAction(g: Garage, act: GarageAction, rnd: () => number, now: number): ActionResult {
  if (!act || typeof act !== 'object') return { ok: false, error: 'Bad request.' };
  switch (act.a) {
    case 'crate': {
      const kind = act.kind === 'tuner' ? 'tuner' : act.kind === 'mystery' ? 'mystery' : null;
      if (!kind) return { ok: false, error: 'Bad crate.' };
      const r = openCrate(g, kind, PARTS.includes(act.part as Part) ? act.part : undefined, rnd);
      return 'error' in r ? { ok: false, error: r.error } : { ok: true, g: r.g, crate: r.result };
    }
    case 'buy': {
      if (!isCarId(act.model)) return { ok: false, error: 'No such car.' };
      if (g.cars.length >= MAX_CARS) return { ok: false, error: 'Your garage is full.' };
      const price = CARS[act.model].price;
      if (g.money < price) return { ok: false, error: 'Not enough money.' };
      const next = structuredClone(g);
      next.money -= price;
      next.cars.push(newOwnedCar(act.model, cleanLook({ paint: act.paint }).paint));
      next.sel = next.cars.length - 1;
      return { ok: true, g: next };
    }
    case 'select': {
      if (!Number.isInteger(act.i) || act.i < 0 || act.i >= g.cars.length) return { ok: false, error: 'No such car.' };
      return { ok: true, g: { ...g, sel: act.i } };
    }
    case 'style': {
      if (!Number.isInteger(act.i) || act.i < 0 || act.i >= g.cars.length) return { ok: false, error: 'No such car.' };
      const next = structuredClone(g);
      const c = next.cars[act.i];
      c.look = cleanLook(act.look);
      c.tune = cleanTune(act.tune, c.model);
      return { ok: true, g: next };
    }
    case 'sell': {
      if (!Number.isInteger(act.i) || act.i < 0 || act.i >= g.cars.length) return { ok: false, error: 'No such car.' };
      if (g.cars.length <= 1) return { ok: false, error: "You can't sell your only car." };
      const next = structuredClone(g);
      const [sold] = next.cars.splice(act.i, 1);
      const paid = Math.round(CARS[sold.model].price * SELL_SHARE);
      next.money += paid;
      if (next.sel >= act.i) next.sel = Math.max(0, next.sel - 1);
      return { ok: true, g: next, paid };
    }
    case 'solo': {
      if (!(act.track in TRACK_DEFS) || TRACK_DEFS[act.track].world) return { ok: false, error: 'No such track.' };
      if (now - g.lastReward < SOLO_GAP_MS) return { ok: false, error: 'Too soon.' };
      const field = Math.max(1, Math.min(8, Math.floor(Number(act.field)) || 1));
      const place = Math.max(0, Math.min(field, Math.floor(Number(act.place)) || 0));
      // Nothing times a solo race on the server, so drift is clamped to the longest race (and driftPay caps it per km).
      const bonus = raceBonus(clampDrift(act.drift, SOLO_MAX_SECONDS), act.track, true);
      const paid = payout(place, field, act.track, true) + bonus.drift;
      const xp = raceXp(place, field, clampDrift(act.drift, SOLO_MAX_SECONDS), true);
      return { ok: true, g: { ...award(g, paid, place === 1 && field > 1, xp), lastReward: now }, paid, bonus, xp };
    }
    case 'case': {
      const r = openCase(g, act.id, rnd);
      return 'error' in r ? { ok: false, error: r.error } : { ok: true, g: r.g, drop: r.drop };
    }
    case 'equip': {
      if (!Number.isInteger(act.i) || act.i < 0 || act.i >= g.cars.length) return { ok: false, error: 'No such car.' };
      if (!COS_SLOTS.includes(act.slot)) return { ok: false, error: 'No such slot.' };
      if (act.id !== null) {
        if (cosById(act.id)?.slot !== act.slot) return { ok: false, error: 'That doesn\'t go there.' };
        if (!g.cos.includes(act.id)) return { ok: false, error: 'You don\'t own that yet.' };
      }
      const next = structuredClone(g);
      if (act.id === null) delete next.cars[act.i].cos[act.slot];
      else next.cars[act.i].cos[act.slot] = act.id;
      return { ok: true, g: next };
    }
    case 'plate': {
      if (!Number.isInteger(act.i) || act.i < 0 || act.i >= g.cars.length) return { ok: false, error: 'No such car.' };
      const next = structuredClone(g);
      next.cars[act.i].plate = cleanPlate(act.text);
      return { ok: true, g: next };
    }
    case 'rider': {
      if (act.look !== undefined && !decodeLook(act.look)) return { ok: false, error: 'That look can’t be worn.' };
      const locked = [act.look, act.rider].flatMap((code) => {
        const l = decodeLook(code);
        return l ? lockedLookParts(g, l) : [];
      });
      if (locked.length) return { ok: false, error: `${locked[0]} is a battle pass reward you haven’t unlocked.` };
      return { ok: true, g: { ...g, rider: cleanRider(act.rider), look: act.look ?? g.look } };
    }
    case 'pass': {
      if (g.pass) return { ok: false, error: 'You already own the battle pass.' };
      if (g.money < PASS.price) return { ok: false, error: 'Not enough money.' };
      return { ok: true, g: givePass({ ...g, money: g.money - PASS.price, pass: true, given: 0 }) };
    }
    case 'bg': {
      if (act.id !== '' && !(typeof act.id === 'string' && act.id in STAGES)) return { ok: false, error: 'No such background.' };
      if (act.id !== '' && !owns(g, 'bg', act.id)) return { ok: false, error: 'Unlock it in the battle pass first.' };
      return { ok: true, g: { ...g, bg: act.id } };
    }
    case 'title': {
      if (act.id !== '' && !(typeof act.id === 'string' && act.id in TITLES)) return { ok: false, error: 'No such title.' };
      if (act.id !== '' && !owns(g, 'title', act.id)) return { ok: false, error: 'Unlock it in the battle pass first.' };
      return { ok: true, g: { ...g, title: act.id } };
    }
  }
  return { ok: false, error: 'Bad request.' };
}

/** Credits a race result: the prize, the race and win counts, and the race's season XP (pass.ts `raceXp`). */
export function award(g: Garage, amount: number, won: boolean, xp = 0): Garage {
  return addXp({ ...g, money: g.money + Math.max(0, Math.floor(amount)), races: g.races + 1, wins: g.wins + (won ? 1 : 0) }, xp);
}
