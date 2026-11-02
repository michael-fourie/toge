import type * as THREE from 'three';
import type { Use } from '../shared/interact.ts';
import type { MapData } from '../shared/map.ts';
import type { Vec3 } from '../../shared/math.ts';
import type { RoyaleInfo } from '../shared/protocol.ts';
import { type LootItem, type ZoneState, findLoot } from '../shared/royale.ts';
import type { WeaponId } from '../shared/weapons.ts';
import { LootFx, ZoneFx } from './royalefx.ts';
import { type HudState, RoyaleHud } from './royalehud.ts';

/**
 * Battle Royale on the client: mirrors what the server says (the phase, the zone, the loot on the ground, our shield
 * and grenades) and owns the drawings of it. The rules live in gambol/shared/royale.ts; Game wires this in.
 */
export class RoyaleView {
  info: RoyaleInfo;
  private infoAt: number;
  zone: ZoneState | null = null;
  readonly loot = new Map<number, LootItem>();
  shield = 0;
  nades = 0;
  /** Out of the match: whose eyes we're watching from (a remote player's id). */
  spectating: number | null = null;
  private readonly zoneFx: ZoneFx;
  private readonly lootFx: LootFx;
  private readonly hud: RoyaleHud;

  constructor(scene: THREE.Scene, hudRoot: HTMLElement, data: MapData, info: RoyaleInfo, now: number) {
    this.info = info;
    this.infoAt = now;
    this.zoneFx = new ZoneFx(scene);
    this.lootFx = new LootFx(scene);
    this.hud = new RoyaleHud(hudRoot, data);
    hudRoot.classList.add('br');
  }

  get live() {
    return this.info.phase === 'live';
  }

  onInfo(info: RoyaleInfo, now: number) {
    this.info = info;
    this.infoAt = now;
  }

  onLoot(items: LootItem[], reset = false) {
    if (reset) {
      this.loot.clear();
      this.lootFx.clear();
    }
    for (const it of items) {
      this.loot.set(it.id, it);
      this.lootFx.add(it);
    }
  }

  onLooted(id: number) {
    this.loot.delete(id);
    this.lootFx.remove(id);
  }

  /** What F would pick up here, as a prompt (not-ready things show greyed out with why). */
  findUse(p: Vec3, hp: number, guns: readonly (WeaponId | null)[]): Use | null {
    const u = findLoot(p, this.loot.values(), { hp, shield: this.shield, nades: this.nades, guns });
    return u && { kind: 'loot', id: u.item.id, status: u.ready ? 'ready' : 'owned', price: 0, text: u.text };
  }

  update(time: number, viewer: THREE.Vector3, s: Omit<HudState, 'info' | 'since' | 'zone' | 'shield'>) {
    this.zoneFx.update(this.zone, time);
    this.lootFx.update(time, viewer);
    this.hud.update({ ...s, info: this.info, since: time - this.infoAt, zone: this.zone, shield: this.shield });
  }

  dispose() {
    this.hud.dispose();
  }
}
