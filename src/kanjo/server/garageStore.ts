import { type ActionResult, type Garage, type GarageAction, applyAction, award, cleanGarage, newGarage, ownedCarCode, ownedRider } from '../shared/garage.ts';
import { cleanRider } from '../shared/rider.ts';
import type { KV } from '../../server/accountStore.ts';

/** Dice for crates and cosmetic cases: [0, 1) from the platform's CSPRNG, so rolls can't be predicted from earlier ones. */
export const secureRandom = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

/** Signed-in players' garages (the driving game), kept next to their accounts. The rules are kanjo/shared/garage.ts. */
export class GarageStore {
  constructor(
    private kv: KV,
    private rnd: () => number = secureRandom,
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

  /** A race car code with anything the account doesn't own taken off, so other racers only see real unlocks. */
  async raceCar(user: string, code: string): Promise<string> {
    return ownedCarCode(code, await this.get(user));
  }

  /** A driver code with any battle pass piece the account hasn't unlocked taken off. */
  async raceRider(user: string, rider: string): Promise<string> {
    return ownedRider(await this.get(user), cleanRider(rider));
  }

  /** A race's prize, its win, and its battle pass XP (which hands over any tiers it reaches). */
  async award(user: string, amount: number, won: boolean, xp = 0): Promise<void> {
    await this.kv.put(this.key(user), award(await this.get(user), amount, won, xp));
  }
}
