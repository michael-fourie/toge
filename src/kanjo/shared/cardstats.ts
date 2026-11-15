// The player card's numbers (kanjo/client/playercard.ts). Best times come from records.ts (the server's for an
// account, this browser's for a guest); the "highs" here, your best drift race and your top speed, are kept in this
// browser only (kanjo/client/highs.ts), since nothing on the server needs them.

import { CARS, type CarClass, type OwnedCar, carSpec, decodeCar, rating } from './cars.ts';
import type { BestTime, Bests } from './records.ts';
import { TRACK_DEFS, type TrackId } from './track.ts';

export interface Highs {
  /** The biggest drift score you've finished a race with. */
  drift: number;
  /** The fastest you've gone in a race, km/h. */
  topKmh: number;
}

export const newHighs = (): Highs => ({ drift: 0, topKmh: 0 });

const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? v : 0);

/** Anything stored to valid highs (silly numbers become 0). */
export function cleanHighs(x: unknown): Highs {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  return { drift: Math.floor(num(o.drift, 1e9)), topKmh: num(o.topKmh, 1000) };
}

/** A finished race's drift score and top speed against your highs. */
export function noteHighs(h: Highs, race: { drift: number; topKmh: number }): Highs {
  return { drift: Math.max(h.drift, Math.floor(num(race.drift, 1e9))), topKmh: Math.max(h.topKmh, num(race.topKmh, 1000)) };
}

/** Your highest-rated car (by PI), for the card's "Best build". */
export function bestBuild(cars: OwnedCar[]): { car: OwnedCar; pi: number; cls: CarClass } | null {
  let best: { car: OwnedCar; pi: number; cls: CarClass } | null = null;
  for (const car of cars) {
    const r = rating(carSpec(car));
    if (!best || r.pi > best.pi) best = { car, ...r };
  }
  return best;
}

/** Wins as a whole percentage of races (0 with none run). */
export const winRate = (races: number, wins: number) => (races > 0 ? Math.round((Math.min(wins, races) / races) * 100) : 0);

/** The best times worth showing on a card: the most recently set first, at most `n`, with the car's name. */
export function cardBests(bests: Bests, n: number): { track: TrackId; name: string; time: number; car: string }[] {
  return (Object.entries(bests) as [TrackId, BestTime][])
    .filter(([id, b]) => b && Object.hasOwn(TRACK_DEFS, id))
    .sort((a, b) => b[1].at - a[1].at || a[1].time - b[1].time)
    .slice(0, n)
    .map(([id, b]) => {
      const car = decodeCar(b.car);
      return { track: id, name: TRACK_DEFS[id].name, time: b.time, car: car ? CARS[car.model].name : '' };
    });
}
