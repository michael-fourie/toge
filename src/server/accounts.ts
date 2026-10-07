import { DurableObject } from 'cloudflare:workers';
import { AccountStore, type Result } from './accountStore.ts';

/**
 * One global Durable Object holds every account and session (fine for a group of friends). Password hashing
 * runs here, not in the Worker: a Durable Object request has far more CPU time than a free-plan Worker's 10 ms.
 */
export class Accounts extends DurableObject {
  private store = new AccountStore(this.ctx.storage);

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
}
