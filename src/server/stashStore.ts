import { type Inv, newInv, sanitize } from '../shared/inventory.ts';
import { type StashAction, type StashResult, type Table, applyStash, importInv } from '../shared/stash.ts';
import type { KV } from './accountStore.ts';

/** A browser's stash brought over once keeps its items and XP but at most this many coins (see importInv). */
export const STASH_IMPORT_COINS = 5000;

/**
 * Signed-in players' shooter stash (coins, items, XP) and their Casino tables, kept next to their accounts. The rules
 * are shared/inventory.ts and shared/stash.ts; the dice and the clock are the server's, so a client can't pick results.
 */
export class StashStore {
  constructor(
    private kv: KV,
    private rnd: () => number = Math.random,
    private now: () => number = Date.now,
  ) {}

  private key = (user: string) => `i:${user.toLowerCase()}`;
  private tableKey = (user: string) => `t:${user.toLowerCase()}`;

  async get(user: string): Promise<Inv> {
    const stored = await this.kv.get(this.key(user));
    return stored ? sanitize(stored) : newInv();
  }

  async has(user: string): Promise<boolean> {
    return (await this.kv.get(this.key(user))) !== undefined;
  }

  async act(user: string, action: StashAction): Promise<StashResult> {
    const inv = await this.get(user);
    const table = (await this.kv.get<Table>(this.tableKey(user))) ?? {};
    const result = applyStash(inv, table, action, this.rnd, this.now());
    await this.kv.put(this.key(user), inv);
    await this.kv.put(this.tableKey(user), table);
    return result;
  }

  /** Coins and XP the server worked out (match pay, rounds, refunds). Never negative. */
  async reward(user: string, coins: number, xp: number): Promise<void> {
    const inv = await this.get(user);
    inv.coins += Math.max(0, Math.floor(coins) || 0);
    inv.xp += Math.max(0, Math.floor(xp) || 0);
    await this.kv.put(this.key(user), inv);
  }

  /** Takes `coins` if the stash has them (a Workbench build). */
  async spend(user: string, coins: number): Promise<boolean> {
    const n = Math.floor(coins);
    if (!(n >= 0)) return false;
    const inv = await this.get(user);
    if (inv.coins < n) return false;
    inv.coins -= n;
    await this.kv.put(this.key(user), inv);
    return true;
  }

  /**
   * The first time an account's stash is asked for after stashes moved to the server, a browser may bring its old one
   * over (coins capped). Once only: after that (or once the account has a stash at all) this does nothing.
   */
  async adopt(user: string, raw: unknown): Promise<Inv> {
    if (await this.kv.get(this.key(user))) return this.get(user);
    const inv = importInv(raw, STASH_IMPORT_COINS);
    await this.kv.put(this.key(user), inv);
    return inv;
  }
}
