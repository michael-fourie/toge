import { BOARD_TRACKS, type Bests, type BoardRow, type MedalRow, NOTICES, type NewBest, type Notice, cleanBests, cleanBoard, cleanNotices, medalTable, overtaken, placeOnBoard, recordTime } from '../shared/records.ts';
import { type GhostRun, type GhostTape, cleanRun, cleanTape } from '../shared/ghost.ts';
import { RACE_TRACKS, TRACK_DEFS, type TrackId } from '../shared/track.ts';
import type { KV } from '../../server/accountStore.ts';

/** The tracks that keep records (not the open world). */
const TRACKS = RACE_TRACKS;

/** What `RecordStore.clear` wiped (or, not `applied`, would wipe). */
export interface ClearReport {
  applied: boolean;
  tracks: TrackId[];
  /** Each racer who had a best on one of `tracks`, and which. */
  bests: { user: string; tracks: TrackId[] }[];
  /** Each board that had rows: how many, and its record. */
  boards: Partial<Record<TrackId, { rows: number; record: { name: string; time: number } }>>;
  /** Tracks whose record ghost was kept. */
  ghosts: TrackId[];
}
const isTrack = (x: unknown): x is TrackId => typeof x === 'string' && Object.hasOwn(TRACK_DEFS, x);

/**
 * Signed-in racers' best times (`b:<user>`), next to their garages, each track's all-time board (`lb:<track>`:
 * one row per racer, their best there, quickest first) and the record run's ghost (`gh:<track>`, ghost.ts). The rules
 * are toge/shared/records.ts.
 */
export class RecordStore {
  constructor(
    private kv: KV,
    private now: () => number = Date.now,
  ) {}

  private key = (user: string) => `b:${user.toLowerCase()}`;
  private boardKey = (track: TrackId) => `lb:${track}`;
  private ghostKey = (track: TrackId) => `gh:${track}`;
  /** An account's unseen "your time was beaten" notices (records.ts `Notice`). */
  private noticeKey = (user: string) => `nt:${user.toLowerCase()}`;

  /** The track record's run, to race against (null: no record yet, or it was set without a recording). */
  async ghost(track: unknown): Promise<GhostRun | null> {
    if (!isTrack(track)) return null;
    const run = cleanRun(await this.kv.get(this.ghostKey(track)));
    // A ghost only stands for the record it was recorded with.
    const top = (await this.board(track))[0];
    return run && top && top.name.toLowerCase() === run.name.toLowerCase() && top.time === run.time ? run : null;
  }

  async get(user: string): Promise<Bests> {
    return cleanBests(await this.kv.get(this.key(user)));
  }

  async board(track: unknown): Promise<BoardRow[]> {
    return isTrack(track) ? cleanBoard(track, await this.kv.get(this.boardKey(track))) : [];
  }

  /** Every track's record (its board's top row), for the track list, and the medal table over every board's top three. */
  async leaders(): Promise<{ leaders: Partial<Record<TrackId, BoardRow>>; medals: MedalRow[] }> {
    const leaders: Partial<Record<TrackId, BoardRow>> = {};
    const boards: BoardRow[][] = [];
    // Only the boards the Leaderboard lists (BOARD_TRACKS): a hidden board's medals would count with no board to show them.
    for (const t of BOARD_TRACKS) {
      const rows = await this.board(t);
      boards.push(rows);
      if (rows[0]) leaders[t] = rows[0];
    }
    return { leaders, medals: medalTable(boards) };
  }

  /** `user`'s unseen notices, newest first. */
  async notices(user: string): Promise<Notice[]> {
    return cleanNotices(await this.kv.get(this.noticeKey(user)));
  }

  /** `user` has seen every notice up to `upTo` (its `at`); later ones stay. */
  async seen(user: string, upTo: number): Promise<void> {
    const left = (await this.notices(user)).filter((n) => n.at > upTo);
    if (left.length) await this.kv.put(this.noticeKey(user), left);
    else await this.kv.delete(this.noticeKey(user));
  }

  /**
   * Keeps a finish if it beats the racer's best on that track, and puts it on the track's board; the new best (with
   * its place on the board), or null. `user` is the account's display name, which the board shows. `tape`: the run
   * itself (ghost.ts), kept as the track's ghost when it's the new record.
   */
  async record(user: string, track: unknown, time: unknown, car: string, tape?: unknown): Promise<NewBest | null> {
    const r = recordTime(await this.get(user), track, time, car, this.now());
    if (!r) return null;
    await this.kv.put(this.key(user), r.bests);
    const t = r.best.track;
    const before = await this.board(t);
    const placed = placeOnBoard(before, { name: user, ...r.bests[t]! });
    await this.kv.put(this.boardKey(t), placed.board);
    // Everyone it moved down (or off) the board hears about it.
    const at = this.now();
    for (const p of overtaken(before, placed.board, user)) {
      const n: Notice = { track: t, by: user, time: r.best.time, yours: p.yours, was: p.was, rank: p.rank, at };
      await this.kv.put(this.noticeKey(p.name), [n, ...(await this.notices(p.name))].slice(0, NOTICES.keep));
    }
    if (placed.rank === 1) {
      const clean: GhostTape | null = tape === undefined ? null : cleanTape(tape, r.best.time);
      if (clean) await this.kv.put(this.ghostKey(t), { name: user, time: r.best.time, ...clean } satisfies GhostRun);
      else await this.kv.delete(this.ghostKey(t));
    }
    return { ...r.best, rank: placed.rank, beat: placed.beat };
  }

  /**
   * Wipes the best times, board rows and record ghosts kept on `tracks`, for every racer in `racers` (their `b:` keys'
   * users). With `apply` false nothing changes: it only says what would go. Other tracks are left as they are.
   */
  async clear(tracks: TrackId[], racers: Iterable<string>, apply: boolean): Promise<ClearReport> {
    const on = tracks.filter(isTrack);
    const report: ClearReport = { applied: apply, tracks: on, bests: [], boards: {}, ghosts: [] };
    for (const user of racers) {
      const bests = await this.get(user);
      const gone = on.filter((t) => bests[t]);
      if (!gone.length) continue;
      report.bests.push({ user, tracks: gone });
      if (!apply) continue;
      const left: Bests = { ...bests };
      for (const t of gone) delete left[t];
      if (Object.keys(left).length) await this.kv.put(this.key(user), left);
      else await this.kv.delete(this.key(user));
    }
    for (const t of on) {
      const rows = await this.board(t);
      if (rows.length) report.boards[t] = { rows: rows.length, record: { name: rows[0].name, time: rows[0].time } };
      if (await this.kv.get(this.ghostKey(t))) report.ghosts.push(t);
      if (!apply) continue;
      await this.kv.delete(this.boardKey(t));
      await this.kv.delete(this.ghostKey(t));
    }
    return report;
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
