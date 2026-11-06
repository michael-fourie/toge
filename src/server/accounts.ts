import { DurableObject } from 'cloudflare:workers';
import type { ActionResult, Garage, GarageAction } from '../toge/shared/garage.ts';
import { modeTracks } from '../toge/shared/protocol.ts';
import { type Bests, type BoardRow, type NewBest, type TogeProfile, cleanBests, profileOf } from '../toge/shared/records.ts';
import type { TrackId } from '../toge/shared/track.ts';
import type { GhostRun, GhostTape } from '../toge/shared/ghost.ts';
import type { FriendAction, FriendList, FriendResult } from '../shared/friends.ts';
import type { Inv } from '../gambol/shared/inventory.ts';
import type { StashAction, StashResult } from '../gambol/shared/stash.ts';
import { AccountStore, type ResetResult, type Result } from './accountStore.ts';
import { FriendStore } from './friendStore.ts';
import { GarageStore } from '../toge/server/garageStore.ts';
import { type ClearReport, RecordStore } from '../toge/server/recordStore.ts';
import { Limiter } from './limiter.ts';
import { StashStore } from '../gambol/server/stashStore.ts';

/**
 * One global Durable Object holds every account and session (fine for a group of friends). Password hashing
 * runs here, not in the Worker: a Durable Object request has far more CPU time than a free-plan Worker's 10 ms.
 */
export class Accounts extends DurableObject {
  private store = new AccountStore(this.ctx.storage);
  private garages = new GarageStore(this.ctx.storage);
  private stashes = new StashStore(this.ctx.storage);
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
   * What `token`'s account may see of `name`'s TŌGE garage: their own, or a friend's they've added. Null otherwise
   * (guests, strangers, no such account).
   */
  async profile(token: string | undefined, name: string): Promise<TogeProfile | null> {
    const me = await this.store.me(token);
    if (!me || typeof name !== 'string') return null;
    const user = await this.ctx.storage.get<{ name: string }>(`u:${name.toLowerCase()}`);
    if (!user || (name.toLowerCase() !== me.toLowerCase() && !(await this.friendStore.has(me, name)))) return null;
    return profileOf(user.name, await this.garages.get(user.name), await this.records.get(user.name));
  }

  /**
   * TŌGE's all-time boards, open to anyone: one track's board (one row per account, their best there), or with no
   * track every track's record.
   */
  async leaderboard(track: string | null): Promise<{ rows: BoardRow[] } | { leaders: Partial<Record<TrackId, BoardRow>> }> {
    await this.boardsBuilt();
    return track === null ? { leaders: await this.records.leaders() } : { rows: await this.records.board(track) };
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

  /**
   * The shooter's stash for a session (null for guests, who keep theirs in the browser). `fresh`: the account has none
   * saved yet, so the browser may bring its old one over once with `adopt`.
   */
  async stash(token: string | undefined, adopt?: unknown): Promise<{ inv: Inv; fresh: boolean } | null> {
    const user = await this.store.me(token);
    if (!user) return null;
    if (adopt !== undefined) return { inv: await this.stashes.adopt(user, adopt), fresh: false };
    return { inv: await this.stashes.get(user), fresh: !(await this.stashes.has(user)) };
  }

  async stashAct(token: string | undefined, action: StashAction): Promise<StashResult> {
    const user = await this.store.me(token);
    if (!user) return { ok: false, error: 'Sign in to save your stash.' };
    return this.stashes.act(user, action);
  }

  /** A shooter room pays a signed-in player (kills, wins, rounds, Workbench refunds). */
  async reward(name: string, coins: number, xp: number): Promise<void> {
    if (await this.ctx.storage.get(`u:${name.toLowerCase()}`)) await this.stashes.reward(name, coins, xp);
  }

  /** A shooter room charges a signed-in player (a Workbench build). False if they can't afford it. */
  async spend(name: string, coins: number): Promise<boolean> {
    if (!(await this.ctx.storage.get(`u:${name.toLowerCase()}`))) return false;
    return this.stashes.spend(name, coins);
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
   * on the tracks a race can run (all but the hill climbs), since those may have been set with items before only time
   * trials counted. Nothing records which mode a time came from, so they can't be told apart. `apply` false: only
   * reports what would go.
   */
  async clearRaceRecords(apply: boolean): Promise<ClearReport> {
    await this.boardsBuilt();
    const users = [...(await this.ctx.storage.list({ prefix: 'b:' })).keys()].map((k) => k.slice(2));
    return this.records.clear(modeTracks('race'), users, apply);
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
