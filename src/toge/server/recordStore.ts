import { type Bests, type BoardRow, type NewBest, cleanBests, cleanBoard, placeOnBoard, recordTime } from '../shared/records.ts';
import { TRACK_DEFS, type TrackId } from '../shared/track.ts';
import type { KV } from '../../server/accountStore.ts';

const TRACKS = Object.keys(TRACK_DEFS) as TrackId[];
const isTrack = (x: unknown): x is TrackId => typeof x === 'string' && Object.hasOwn(TRACK_DEFS, x);

/**
 * Signed-in racers' best times (`b:<user>`), next to their garages, and each track's all-time board (`lb:<track>`:
 * one row per racer, their best there, quickest first). The rules are toge/shared/records.ts.
 */
export class RecordStore {
  constructor(
    private kv: KV,
    private now: () => number = Date.now,
  ) {}

  private key = (user: string) => `b:${user.toLowerCase()}`;
  private boardKey = (track: TrackId) => `lb:${track}`;

  async get(user: string): Promise<Bests> {
    return cleanBests(await this.kv.get(this.key(user)));
  }

  async board(track: unknown): Promise<BoardRow[]> {
    return isTrack(track) ? cleanBoard(track, await this.kv.get(this.boardKey(track))) : [];
  }

  /** Every track's record (its board's top row), for the track list. */
  async leaders(): Promise<Partial<Record<TrackId, BoardRow>>> {
    const out: Partial<Record<TrackId, BoardRow>> = {};
    for (const t of TRACKS) {
      const top = (await this.board(t))[0];
      if (top) out[t] = top;
    }
    return out;
  }

  /**
   * Keeps a finish if it beats the racer's best on that track, and puts it on the track's board; the new best (with
   * its place on the board), or null. `user` is the account's display name, which the board shows.
   */
  async record(user: string, track: unknown, time: unknown, car: string): Promise<NewBest | null> {
    const r = recordTime(await this.get(user), track, time, car, this.now());
    if (!r) return null;
    await this.kv.put(this.key(user), r.bests);
    const t = r.best.track;
    const placed = placeOnBoard(await this.board(t), { name: user, ...r.bests[t]! });
    await this.kv.put(this.boardKey(t), placed.board);
    return { ...r.best, rank: placed.rank, beat: placed.beat };
  }

  /** Builds every board from scratch out of racers' bests (once, for the bests kept before there were boards). */
  async rebuild(racers: Iterable<{ name: string; bests: Bests }>): Promise<void> {
    const boards = new Map<TrackId, BoardRow[]>(TRACKS.map((t) => [t, []]));
    for (const { name, bests } of racers) {
      for (const t of TRACKS) {
        const b = bests[t];
        if (b) boards.set(t, placeOnBoard(boards.get(t)!, { name, ...b }).board);
      }
    }
    for (const [t, rows] of boards) await this.kv.put(this.boardKey(t), rows);
  }
}
