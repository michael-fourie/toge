import { type ActionResult, type Garage, type GarageAction, applyAction, award, cleanGarage, newGarage } from '../shared/race/garage.ts';
import type { KV } from './accountStore.ts';

/** Signed-in players' garages (the driving game), kept next to their accounts. The rules are shared/race/garage.ts. */
export class GarageStore {
  constructor(
    private kv: KV,
    private rnd: () => number = Math.random,
    private now: () => number = Date.now,
  ) {}

  private key = (user: string) => `g:${user.toLowerCase()}`;

  async get(user: string): Promise<Garage> {
    const stored = await this.kv.get(this.key(user));
    return stored ? cleanGarage(stored) : newGarage();
  }

  async act(user: string, action: GarageAction): Promise<ActionResult> {
    const result = applyAction(await this.get(user), action, this.rnd, this.now());
    if (result.ok) await this.kv.put(this.key(user), result.g);
    return result;
  }

  async award(user: string, amount: number, won: boolean): Promise<void> {
    await this.kv.put(this.key(user), award(await this.get(user), amount, won));
  }
}
