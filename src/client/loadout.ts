import { type GunStats, type Slot, type WeaponId, gunStats } from '../shared/weapons.ts';

/** One gun in our hands: which, punched or not, and what's in the mag and the reserve. */
export interface GunSlot extends Slot {
  mag: number;
  reserve: number;
}

/**
 * The guns we carry and their ammo. The server decides which guns we own (and charges for ammo); the ammo itself is
 * counted here, which keeps firing instant. Battle and practice carry one AWP with endless spare mags.
 */
export class Loadout {
  slots: (GunSlot | null)[] = [null, null];
  cur = 0;

  constructor(
    private endless: boolean,
    first: WeaponId,
  ) {
    this.slots[0] = this.fresh({ w: first, up: false });
  }

  private fresh(s: Slot): GunSlot {
    const st = gunStats(s.w, s.up);
    return { ...s, mag: st.mag, reserve: this.endless ? Infinity : st.reserve };
  }

  get gun(): GunSlot | null {
    return this.slots[this.cur];
  }

  get stats(): GunStats {
    const g = this.gun!;
    return gunStats(g.w, g.up);
  }

  /**
   * Adopt the server's guns. A slot whose gun is unchanged keeps its ammo; a new or upgraded one comes full, and so
   * does every slot in `fill` (ammo bought, a new run). Returns whether the gun in our hands is a different one now.
   */
  sync(server: readonly (Slot | null)[], cur: number, fill: readonly number[] = []): boolean {
    const before = this.gun ? `${this.gun.w}${this.gun.up}` : '';
    server.forEach((s, i) => {
      const mine = this.slots[i];
      if (!s) this.slots[i] = null;
      else if (!mine || mine.w !== s.w || mine.up !== s.up || fill.includes(i)) this.slots[i] = this.fresh(s);
    });
    this.cur = this.slots[cur] ? cur : 0;
    return (this.gun ? `${this.gun.w}${this.gun.up}` : '') !== before;
  }

  /** Switch to a slot we have a gun in. */
  equip(i: number): boolean {
    if (i === this.cur || !this.slots[i]) return false;
    this.cur = i;
    return true;
  }

  /** Take a round out of the mag. */
  fire() {
    this.gun!.mag--;
  }

  /** Is there room in the mag and something to put in it? */
  canReload(): boolean {
    const g = this.gun!;
    return g.mag < this.stats.mag && g.reserve > 0;
  }

  /** Top the mag up from the reserve. */
  finishReload() {
    const g = this.gun!;
    const take = Math.min(this.stats.mag - g.mag, g.reserve);
    g.mag += take;
    g.reserve -= take;
  }

  /** Everything full again (a respawn). */
  refill() {
    this.slots = this.slots.map((s) => (s ? this.fresh(s) : null));
  }
}
