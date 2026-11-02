import { DurableObject } from 'cloudflare:workers';
import type { ActionResult, Garage, GarageAction } from '../shared/race/garage.ts';
import type { Inv } from '../shared/inventory.ts';
import type { StashAction, StashResult } from '../shared/stash.ts';
import { AccountStore, type Result } from './accountStore.ts';
import { GarageStore } from './garageStore.ts';
import { Limiter } from './limiter.ts';
import { StashStore } from './stashStore.ts';

/**
 * One global Durable Object holds every account and session (fine for a group of friends). Password hashing
 * runs here, not in the Worker: a Durable Object request has far more CPU time than a free-plan Worker's 10 ms.
 */
export class Accounts extends DurableObject {
  private store = new AccountStore(this.ctx.storage);
  private garages = new GarageStore(this.ctx.storage);
  private stashes = new StashStore(this.ctx.storage);
  /** Per IP: password guesses (on top of the per-username lockout), and sign-ups (each one is a costly hash). */
  private logins = new Limiter(10, 1 / 6);
  private signups = new Limiter(5, 1 / 600);

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

  /** The driving game's garage for a session (null for guests, who keep theirs in the browser). */
  async garage(token: string | undefined): Promise<Garage | null> {
    const user = await this.store.me(token);
    return user ? this.garages.get(user) : null;
  }

  async garageAct(token: string | undefined, action: GarageAction): Promise<ActionResult> {
    const user = await this.store.me(token);
    if (!user) return { ok: false, error: 'Sign in to save your garage.' };
    return this.garages.act(user, action);
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

  /** A race room pays a signed-in racer (by display name, which for accounts is the username). */
  async raceReward(name: string, amount: number, won: boolean): Promise<void> {
    if (await this.ctx.storage.get(`u:${name.toLowerCase()}`)) await this.garages.award(name, amount, won);
  }
}
