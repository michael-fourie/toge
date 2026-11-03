import { DurableObject } from 'cloudflare:workers';
import { type ActionResult, type Garage, type GarageAction, current } from '../toge/shared/garage.ts';
import { encodeCar } from '../toge/shared/cars.ts';
import { type Bests, type NewBest, type TogeProfile, profileOf } from '../toge/shared/records.ts';
import type { FriendAction, FriendList, FriendResult } from '../shared/friends.ts';
import type { Inv } from '../gambol/shared/inventory.ts';
import type { StashAction, StashResult } from '../gambol/shared/stash.ts';
import { AccountStore, type Result } from './accountStore.ts';
import { FriendStore } from './friendStore.ts';
import { GarageStore } from '../toge/server/garageStore.ts';
import { RecordStore } from '../toge/server/recordStore.ts';
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

  /** One garage action. A solo finish's time is also kept as a best time, paid or not (solo prizes have a cooldown). */
  async garageAct(token: string | undefined, action: GarageAction): Promise<ActionResult> {
    const user = await this.store.me(token);
    if (!user) return { ok: false, error: 'Sign in to save your garage.' };
    const before = action && typeof action === 'object' && action.a === 'solo' ? await this.garages.get(user) : null;
    const result = await this.garages.act(user, action);
    if (before && action.a === 'solo' && Number(action.place) >= 1) {
      return { ...result, best: await this.records.record(user, action.track, action.time, encodeCar(current(before))) };
    }
    return result;
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

  /** A race car code as an account may show it: cosmetics it doesn't own are taken off. Guests' codes pass as they are. */
  async raceCar(name: string, code: string): Promise<string> {
    if (!(await this.ctx.storage.get(`u:${name.toLowerCase()}`))) return code;
    return this.garages.raceCar(name, code);
  }

  /** A race room keeps a signed-in racer's finish as a best time if it is one; the new best, or null. */
  async raceTime(name: string, track: string, time: number, car: string): Promise<NewBest | null> {
    if (!(await this.ctx.storage.get(`u:${name.toLowerCase()}`))) return null;
    return this.records.record(name, track, time, car);
  }

  /** A race room pays a signed-in racer (by display name, which for accounts is the username). */
  async raceReward(name: string, amount: number, won: boolean): Promise<void> {
    if (await this.ctx.storage.get(`u:${name.toLowerCase()}`)) await this.garages.award(name, amount, won);
  }
}
