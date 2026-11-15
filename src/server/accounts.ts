import { DurableObject } from 'cloudflare:workers';
import type { ActionResult, Garage, GarageAction } from '../kanjo/shared/garage.ts';
import { type Bests, type BoardRow, type MedalRow, type NewBest, type Notice, type KanjoProfile, cleanBests, profileOf } from '../kanjo/shared/records.ts';
import type { TrackId } from '../kanjo/shared/track.ts';
import type { GhostRun, GhostTape } from '../kanjo/shared/ghost.ts';
import type { FriendAction, FriendList, FriendResult } from '../shared/friends.ts';
import { AccountStore, type ResetResult, type Result } from './accountStore.ts';
import { FriendStore } from './friendStore.ts';
import { GarageStore } from '../kanjo/server/garageStore.ts';
import { type ClearReport, RecordStore } from '../kanjo/server/recordStore.ts';
import { Limiter } from './limiter.ts';

/** The tracks `clearRaceRecords` wipes: Kōri Pass, Saltwind Cliffs and Red Mesa Rally. */
const CLEAR_TRACKS: TrackId[] = ['koripass', 'saltwind', 'redmesa'];

/** Most keys in one `exportPage` (a key holds at most one ghost tape, so a page stays a few MB). */
const EXPORT_PAGE_MAX = 50;

/** Most keys one storage `put` takes (Cloudflare's limit). */
const PUT_BATCH = 128;

/**
 * One global Durable Object holds every account and session (fine for a group of friends). Password hashing
 * runs here, not in the Worker: a Durable Object request has far more CPU time than a free-plan Worker's 10 ms.
 */
export class Accounts extends DurableObject {
  private store = new AccountStore(this.ctx.storage);
  private garages = new GarageStore(this.ctx.storage);
  private records = new RecordStore(this.ctx.storage);
  private friendStore = new FriendStore(this.ctx.storage);
  /** Per IP: password guesses (on top of the per-username lockout), and sign-ups (each one is a costly hash). */
  private logins = new Limiter(10, 1 / 6);
  private signups = new Limiter(5, 1 / 600);
  /** Per account: friend adds and removes (each add says whether a username exists). */
  private friendActs = new Limiter(20, 1 / 3);

  register(username: string, password: string, ip = ''): Promise<Result> {
    if (!this.signups.take(ip)) return Promise.resolve({ ok: false, error: 'Too many new accounts from here. Try again later.' });
    return this.store.register(username, password);
  }

  login(username: string, password: string, ip = ''): Promise<Result> {
    if (!this.logins.take(ip)) return Promise.resolve({ ok: false, error: 'Too many tries. Wait a minute and try again.' });
    return this.store.login(username, password);
  }

  changePassword(token: string | undefined, current: unknown, next: unknown, ip = ''): Promise<Result> {
    if (!this.logins.take(ip)) return Promise.resolve({ ok: false, error: 'Too many tries. Wait a minute and try again.' });
    return this.store.changePassword(token, current, next);
  }

  /** Admin only: the Worker checks the admin key before calling this. */
  resetPassword(username: unknown): Promise<ResetResult> {
    return this.store.resetPassword(username);
  }

  me(token: string | undefined): Promise<string | null> {
    return this.store.me(token);
  }

  logout(token: string | undefined): Promise<void> {
    return this.store.logout(token);
  }

  identify(token: string | undefined, guestName: string): Promise<{ name: string; user: boolean }> {
    return this.store.identify(token, guestName);
  }

  /** The driving game's garage and best times for a session (null for guests, who keep theirs in the browser). */
  async garage(token: string | undefined): Promise<{ garage: Garage; bests: Bests } | null> {
    const user = await this.store.me(token);
    return user ? { garage: await this.garages.get(user), bests: await this.records.get(user) } : null;
  }

  /**
   * One garage action. A solo finish never counts as a best time: a solo run is a race, with item boxes, and best
   * times only come from time trials (and hill climbs) a race room timed itself (`raceTime`).
   */
  async garageAct(token: string | undefined, action: GarageAction): Promise<ActionResult> {
    const user = await this.store.me(token);
    if (!user) return { ok: false, error: 'Sign in to save your garage.' };
    return this.garages.act(user, action);
  }

  /**
   * What `token`'s account may see of `name`'s KANJO garage: their own, or a friend's they've added. Null otherwise
   * (guests, strangers, no such account).
   */
  async profile(token: string | undefined, name: string): Promise<KanjoProfile | null> {
    const me = await this.store.me(token);
    if (!me || typeof name !== 'string') return null;
    const user = await this.ctx.storage.get<{ name: string }>(`u:${name.toLowerCase()}`);
    if (!user || (name.toLowerCase() !== me.toLowerCase() && !(await this.friendStore.has(me, name)))) return null;
    return profileOf(user.name, await this.garages.get(user.name), await this.records.get(user.name));
  }

  /**
   * KANJO's all-time boards, open to anyone: one track's board (one row per account, their best there), or with no
   * track every track's record and the medal table (golds, silvers, bronzes across every board's top three).
   */
  async leaderboard(track: string | null): Promise<{ rows: BoardRow[] } | { leaders: Partial<Record<TrackId, BoardRow>>; medals: MedalRow[] }> {
    await this.boardsBuilt();
    return track === null ? await this.records.leaders() : { rows: await this.records.board(track) };
  }

  /** KANJO: a session's unseen "your time was beaten" notices (null for guests, who aren't on the boards). */
  async notices(token: string | undefined): Promise<Notice[] | null> {
    const user = await this.store.me(token);
    return user ? this.records.notices(user) : null;
  }

  /** KANJO: the session has seen its notices up to `upTo` (a notice's `at`). */
  async seenNotices(token: string | undefined, upTo: number): Promise<boolean> {
    const user = await this.store.me(token);
    if (!user || !Number.isFinite(upTo)) return false;
    await this.records.seen(user, upTo);
    return true;
  }

  /** Best times set before there were boards: put them on once (`lb:built` marks it done). */
  private async boardsBuilt(): Promise<void> {
    if (await this.ctx.storage.get('lb:built')) return;
    const racers: { name: string; bests: Bests }[] = [];
    for (const [key, bests] of await this.ctx.storage.list({ prefix: 'b:' })) {
      const user = await this.ctx.storage.get<{ name: string }>(`u:${key.slice(2)}`);
      if (user) racers.push({ name: user.name, bests: cleanBests(bests) });
    }
    await this.records.rebuild(racers);
    await this.ctx.storage.put('lb:built', 1);
  }

  async friends(token: string | undefined): Promise<FriendList | null> {
    const user = await this.store.me(token);
    return user ? this.friendStore.list(user) : null;
  }

  async friendAct(token: string | undefined, action: FriendAction): Promise<FriendResult> {
    const user = await this.store.me(token);
    if (!user) return { ok: false, error: 'Sign in to add friends.' };
    if (!this.friendActs.take(user.toLowerCase())) return { ok: false, error: 'Slow down a little.' };
    return this.friendStore.act(user, action);
  }

  /** A driver code as an account may show it: battle pass pieces it hasn't unlocked are taken off. Guests' pass as they are. */
  async raceRider(name: string, rider: string): Promise<string> {
    if (!(await this.ctx.storage.get(`u:${name.toLowerCase()}`))) return rider;
    return this.garages.raceRider(name, rider);
  }

  /** A race car code as an account may show it: cosmetics it doesn't own are taken off. Guests' codes pass as they are. */
  async raceCar(name: string, code: string): Promise<string> {
    if (!(await this.ctx.storage.get(`u:${name.toLowerCase()}`))) return code;
    return this.garages.raceCar(name, code);
  }

  /**
   * Michael's one-off cleanup (`POST /api/admin/clear-race-records`): wipes every best time, board row and record ghost
   * on `CLEAR_TRACKS`, where times set with items before only time trials counted are unbeatable (Michael picked the
   * three, 2026-11-06; every other track keeps its times). Nothing records which mode a time came from, so they can't be
   * told apart. `apply` false: only reports what would go.
   */
  async clearRaceRecords(apply: boolean): Promise<ClearReport> {
    await this.boardsBuilt();
    const users = [...(await this.ctx.storage.list({ prefix: 'b:' })).keys()].map((k) => k.slice(2));
    return this.records.clear(CLEAR_TRACKS, users, apply);
  }

  /**
   * Admin only (the Worker checks the admin key): one page of every key this object stores, in key order, as JSON text
   * (the reply's body as it is). `after`: the last key of the previous page; `next` is null on the last page. Gambol's
   * site (atrous) has the same route: tools/copy-accounts.mjs reads it there and checks the copy here with it.
   */
  async exportPage(after: string | null, limit: number): Promise<string> {
    const n = Math.max(1, Math.min(EXPORT_PAGE_MAX, Math.floor(limit) || EXPORT_PAGE_MAX));
    const page = await this.ctx.storage.list({ ...(after ? { startAfter: after } : {}), limit: n });
    const entries = [...page.entries()];
    return JSON.stringify({ ok: true, entries, next: entries.length === n ? entries[entries.length - 1][0] : null });
  }

  /**
   * Admin only: writes one exported page (`[key, value]` pairs, JSON text) as it is. `wipe` first deletes everything
   * here, so a copy started over is exact (no leftovers from an earlier run or from accounts made here meanwhile).
   * Returns how many keys it wrote, or null if the page isn't a list of pairs.
   */
  async importPage(json: string, wipe: boolean): Promise<number | null> {
    let entries: unknown;
    try {
      entries = JSON.parse(json);
    } catch {
      return null;
    }
    if (!Array.isArray(entries) || !entries.every((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && e[0].length > 0)) return null;
    if (wipe) await this.ctx.storage.deleteAll();
    for (let i = 0; i < entries.length; i += PUT_BATCH) await this.ctx.storage.put(Object.fromEntries(entries.slice(i, i + PUT_BATCH)));
    return entries.length;
  }

  /** A race room keeps a signed-in racer's finish as a best time if it is one; the new best, or null. */
  async raceTime(name: string, track: string, time: number, car: string, tape?: GhostTape): Promise<NewBest | null> {
    if (!(await this.ctx.storage.get(`u:${name.toLowerCase()}`))) return null;
    await this.boardsBuilt();
    return this.records.record(name, track, time, car, tape);
  }

  /** A track record's run, for a race room whose host turned the record ghost on (null: none kept). */
  async recordGhost(track: string): Promise<GhostRun | null> {
    await this.boardsBuilt();
    return this.records.ghost(track);
  }

  /** A race room pays a signed-in racer (by display name, which for accounts is the username): prize and pass XP. */
  async raceReward(name: string, amount: number, won: boolean, xp = 0): Promise<void> {
    if (await this.ctx.storage.get(`u:${name.toLowerCase()}`)) await this.garages.award(name, amount, won, xp);
  }
}
