import { DurableObject } from 'cloudflare:workers';
import type { ActionResult, Garage, GarageAction } from '../shared/race/garage.ts';
import { AccountStore, type Result } from './accountStore.ts';
import { GarageStore } from './garageStore.ts';

/**
 * One global Durable Object holds every account and session (fine for a group of friends). Password hashing
 * runs here, not in the Worker: a Durable Object request has far more CPU time than a free-plan Worker's 10 ms.
 */
export class Accounts extends DurableObject {
  private store = new AccountStore(this.ctx.storage);
  private garages = new GarageStore(this.ctx.storage);

  register(username: string, password: string): Promise<Result> {
    return this.store.register(username, password);
  }

  login(username: string, password: string): Promise<Result> {
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

  /** A race room pays a signed-in racer (by display name, which for accounts is the username). */
  async raceReward(name: string, amount: number, won: boolean): Promise<void> {
    if (await this.ctx.storage.get(`u:${name.toLowerCase()}`)) await this.garages.award(name, amount, won);
  }
}
