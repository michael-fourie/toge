import { type Bests, type NewBest, cleanBests, recordTime } from '../shared/records.ts';
import type { KV } from '../../server/accountStore.ts';

/** Signed-in racers' best times (`b:<user>`), next to their garages. The rules are toge/shared/records.ts. */
export class RecordStore {
  constructor(
    private kv: KV,
    private now: () => number = Date.now,
  ) {}

  private key = (user: string) => `b:${user.toLowerCase()}`;

  async get(user: string): Promise<Bests> {
    return cleanBests(await this.kv.get(this.key(user)));
  }

  /** Keeps a finish if it beats the racer's best on that track; the new best, or null. */
  async record(user: string, track: unknown, time: unknown, car: string): Promise<NewBest | null> {
    const r = recordTime(await this.get(user), track, time, car, this.now());
    if (!r) return null;
    await this.kv.put(this.key(user), r.bests);
    return r.best;
  }
}
