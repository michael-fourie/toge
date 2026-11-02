import { WEAPON } from '../shared/constants.ts';
import { blastTargets } from '../shared/grenade.ts';
import type { MapData } from '../shared/map.ts';
import type { ClientMsg, DeathCause, RoyaleInfo, V3 } from '../shared/protocol.ts';
import { type Circle, type LootItem, ROYALE, type ZoneState, crateRounds, findLoot, foundRounds, newZone, outside, planZone, rollLoot, stepZone } from '../shared/royale.ts';
import { STARTER, type Slot, gunStats } from '../shared/weapons.ts';
import type { Lobby, Member } from './lobby.ts';

/** What a player carries in Royale. `rounds` counts mag + spare for each slot, so the server knows when a gun is empty. */
interface Kit {
  slots: (Slot | null)[];
  cur: number;
  rounds: number[];
  nades: number;
  shield: number;
}

const freshKit = (): Kit => ({ slots: [{ w: STARTER, up: false }, null], cur: 0, rounds: [foundRounds(STARTER), 0], nades: 0, shield: 0 });

/**
 * Battle Royale (gambol/shared/royale.ts has the rules). Owned by the Lobby, like Survival: it runs the warmup, the zone and
 * its damage, the loot on the ground and what everyone carries, health and shields, and decides the last one standing.
 * Hits are detected by the shooter's client and sanity-checked here; damage comes from the gun we know they hold.
 */
export class Royale {
  phase: RoyaleInfo['phase'] = 'warmup';
  private warmupLeft: number = ROYALE.warmupSolo;
  /** How many were in when the match went live (1 = a solo run: it ends when you go down). */
  private started = 0;
  zone: ZoneState | null = null;
  private plan: Circle[] = [];
  readonly loot = new Map<number, LootItem>();
  private nextLoot = 1;
  private kits = new Map<number, Kit>();
  /** Zone damage owed to each player, paid out every ROYALE.zoneTick. */
  private burn = new Map<number, number>();

  constructor(
    private lobby: Lobby,
    private data: MapData,
    private rand: () => number = Math.random,
  ) {
    this.reroll(); // loot to play with during the warmup too
  }

  get live() {
    return this.phase === 'live';
  }

  info(): RoyaleInfo {
    return { phase: this.phase, left: Math.ceil(this.warmupLeft), n: this.started };
  }

  private kit(m: Member): Kit {
    let k = this.kits.get(m.info.id);
    if (!k) this.kits.set(m.info.id, (k = freshKit()));
    return k;
  }

  /** Someone is joining: mid-match they watch until the next one; in the warmup, company shortens the wait. */
  admit(m: Member) {
    if (this.phase !== 'warmup') {
      m.info.alive = false;
      m.respawnAt = Infinity;
      return;
    }
    if (this.lobby.members.size >= 1) this.warmupLeft = Math.max(Math.min(this.warmupLeft, ROYALE.warmupCrowd), ROYALE.joinGrace);
    this.lobby.broadcast({ t: 'royale', info: this.info() });
  }

  /** After `joined`, and again when their game screen opens: the phase, the loot on the ground, what they carry. */
  welcome(m: Member) {
    const k = this.kit(m);
    this.lobby.sendTo(m, { t: 'royale', info: this.info() });
    this.lobby.sendTo(m, { t: 'loot', items: [...this.loot.values()], reset: true });
    this.lobby.sendTo(m, { t: 'hp', hp: Math.ceil(m.hp), sh: k.shield });
    this.sendMe(m, k.slots.flatMap((s, i) => (s ? [i] : [])));
  }

  left(id: number) {
    this.kits.delete(id);
    this.burn.delete(id);
    this.checkWinner();
  }

  /** A (re)spawn: full health, no shield, back to the pistol. */
  spawned(m: Member) {
    this.kits.set(m.info.id, freshKit());
    m.hp = ROYALE.hp;
    this.lobby.sendTo(m, { t: 'hp', hp: m.hp, sh: 0 });
    this.sendMe(m, [0]);
  }

  /** The match goes live (the lobby respawns everyone right after): new loot, a new zone, no respawns from now on. */
  start() {
    this.phase = 'live';
    this.started = this.lobby.members.size;
    for (const m of this.lobby.members.values()) m.info.alive = false; // so each drop is spread from the ones placed before it
    this.warmupLeft = 0;
    const start = this.data.royale!.zone;
    this.plan = planZone(start, this.data.royale!.loot, this.rand);
    this.zone = newZone(start, this.plan);
    this.burn.clear();
    this.reroll();
    this.lobby.broadcast({ t: 'royale', info: this.info() });
    this.lobby.broadcast({ t: 'loot', items: [...this.loot.values()], reset: true });
  }

  private reroll() {
    this.loot.clear();
    for (const it of rollLoot(this.data.royale!.loot, this.rand, this.nextLoot)) this.loot.set(it.id, it);
    this.nextLoot += this.loot.size + 1;
  }

  /** Spread the drop: the spawn farthest from everyone already placed (with a little luck so it isn't the same each time). */
  spawnPoint(living: readonly V3[]): { p: V3; yaw: number } {
    let best = this.data.spawns[0];
    let bestD = -1;
    for (const s of this.data.spawns) {
      const near = Math.min(1e4, ...living.map((p) => Math.hypot(p[0] - s.pos.x, p[2] - s.pos.z)));
      const d = near * (0.75 + this.rand() * 0.5);
      if (d > bestD) {
        bestD = d;
        best = s;
      }
    }
    return { p: [best.pos.x, best.pos.y, best.pos.z], yaw: best.yaw };
  }

  tick(dt: number) {
    if (this.phase === 'warmup') {
      this.warmupLeft -= dt;
      if (this.warmupLeft <= 0) this.lobby.startMatch();
      return;
    }
    if (!this.live || !this.zone) return;
    stepZone(this.zone, this.plan, dt);
    for (const m of this.lobby.members.values()) {
      if (!this.live || !this.zone) return; // that burn decided the match
      if (!m.info.alive) continue;
      const p = { x: m.state.p[0], y: m.state.p[1], z: m.state.p[2] };
      if (!outside(this.zone, p)) continue;
      const owed = (this.burn.get(m.info.id) ?? 0) + this.zone.dps * dt;
      if (owed >= this.zone.dps * ROYALE.zoneTick - 1e-6 || owed >= m.hp) {
        this.burn.set(m.info.id, 0);
        this.hurt(m, m, owed, 'zone', [0, 1, 0], true);
      } else this.burn.set(m.info.id, owed);
    }
  }

  // ---------------------------------------------------------------------------
  // Guns and damage

  fireCooldown(m: Member): number {
    const k = this.kit(m);
    const s = k.slots[k.cur];
    return s ? gunStats(s.w, s.up).fireCooldown : WEAPON.fireCooldown;
  }

  shotLook(m: Member) {
    const k = this.kit(m);
    const s = k.slots[k.cur];
    return s ? { w: s.w } : undefined;
  }

  /** A gun shot is leaving: false (and nothing happens) if that gun is empty. */
  fire(m: Member): boolean {
    const k = this.kit(m);
    if (!k.slots[k.cur] || k.rounds[k.cur] <= 0) return false;
    k.rounds[k.cur]--;
    return true;
  }

  equip(m: Member, slot: number) {
    const k = this.kit(m);
    if (k.slots[slot]) k.cur = slot;
  }

  /** A grenade leaves a hand: only if they have one. */
  nade(m: Member): boolean {
    const k = this.kit(m);
    if (k.nades <= 0) return false;
    k.nades--;
    this.sendMe(m);
    return true;
  }

  shoot(m: Member, msg: Extract<ClientMsg, { t: 'shoot' }>) {
    const [fx, fy, fz] = msg.from;
    if (Math.hypot(fx - m.state.p[0], fy - m.state.p[1], fz - m.state.p[2]) > 10) return; // not where we last saw them
    const dir = sub(msg.to, msg.from);
    const v = msg.victim === undefined ? undefined : this.lobby.members.get(msg.victim);
    const near = (o: Member) => Math.hypot(msg.to[0] - o.state.p[0], msg.to[1] - (o.state.p[1] + 1), msg.to[2] - o.state.p[2]) <= 6;
    if (msg.knife) {
      if (v && v !== m && v.info.alive && near(v)) this.hurt(v, m, ROYALE.knifeDamage, 'knife', dir);
      return;
    }
    const k = this.kit(m);
    const s = k.slots[k.cur];
    if (!s) return;
    const g = gunStats(s.w, s.up);
    if (v && v !== m && v.info.alive && near(v) && Math.hypot(...dir) <= WEAPON.range + 5) {
      const pellets = Math.max(1, Math.min(g.pellets, Math.round(msg.ph ?? 1)));
      const dmg = g.damage * pellets * (msg.headshot ? g.headMult : 1);
      this.hurt(v, m, dmg, msg.headshot ? 'headshot' : s.w === 'awp' ? 'snipe' : 'shot', dir);
    }
    if (g.splash > 0) {
      for (const o of this.lobby.members.values()) {
        if (o === m || o === v || !o.info.alive) continue;
        const d = Math.hypot(msg.to[0] - o.state.p[0], msg.to[1] - o.state.p[1] - 1, msg.to[2] - o.state.p[2]);
        if (d < g.splash) this.hurt(o, m, g.damage * (1 - (d / g.splash) * 0.5), 'shot', dir);
      }
    }
  }

  /** A grenade went off: everyone in range and in sight (but the thrower) takes the blast. */
  blast(m: Member, center: { x: number; y: number; z: number }) {
    const targets = [...this.lobby.members.values()].filter((v) => v !== m && v.info.alive).map((v) => ({ id: v.info.id, pos: { x: v.state.p[0], y: v.state.p[1], z: v.state.p[2] } }));
    for (const id of blastTargets(center, targets, this.data.boxes)) {
      const v = this.lobby.members.get(id)!;
      this.hurt(v, m, ROYALE.nadeDamage, 'grenade', [v.state.p[0] - center.x, v.state.p[1] + 1.8 - center.y, v.state.p[2] - center.z]);
    }
  }

  /** Shields soak damage first (not the zone's); at 0 hp it's a kill. */
  private hurt(v: Member, by: Member, dmg: number, cause: DeathCause, dir: V3, ignoreShield = false) {
    if (!v.info.alive || this.phase === 'over') return;
    const k = this.kit(v);
    const soak = ignoreShield ? 0 : Math.min(k.shield, dmg);
    k.shield -= soak;
    v.hp = Math.max(0, v.hp - (dmg - soak));
    const from: V3 | undefined = by === v ? undefined : [by.state.p[0], by.state.p[1], by.state.p[2]];
    this.lobby.sendTo(v, { t: 'hp', hp: Math.ceil(v.hp), sh: Math.ceil(k.shield), from });
    if (v.hp <= 0) this.lobby.kill(v, by, cause, dir);
  }

  /** Someone died (the lobby already announced it). Live: they're out, and their guns fall where they stood. */
  died(v: Member) {
    if (!this.live) return;
    const k = this.kit(v);
    const drops: LootItem[] = [];
    k.slots.forEach((s, i) => {
      if (s && k.rounds[i] > 0) drops.push(this.drop(v, { k: 'gun', w: s.w, n: k.rounds[i] }, i * 1.1 - 0.5));
    });
    if (k.nades > 0) drops.push(this.drop(v, { k: 'nade' }, 1.4));
    this.kits.delete(v.info.id);
    if (drops.length) this.lobby.broadcast({ t: 'loot', items: drops });
    this.checkWinner();
  }

  private drop(m: Member, it: Omit<LootItem, 'id' | 'p'>, dx: number): LootItem {
    const [x, y, z] = m.state.p;
    const item: LootItem = { ...it, id: this.nextLoot++, p: [Math.round((x + dx) * 100) / 100, Math.round(y * 100) / 100, Math.round(z * 100) / 100] };
    this.loot.set(item.id, item);
    return item;
  }

  /** Live: the last one standing wins. A solo run ends when you go down (nobody wins that one). */
  private checkWinner() {
    if (!this.live) return;
    const alive = [...this.lobby.members.values()].filter((m) => m.info.alive);
    if (alive.length > (this.started >= 2 ? 1 : 0)) return;
    this.phase = 'over';
    this.zone = null;
    this.lobby.finish({ id: alive[0]?.info.id ?? -1 });
    this.lobby.broadcast({ t: 'royale', info: this.info() });
  }

  // ---------------------------------------------------------------------------
  // Picking things up (F)

  use(m: Member, msg: Extract<ClientMsg, { t: 'use' }>) {
    if (msg.kind !== 'loot' || !m.info.alive || this.phase === 'over') return;
    const it = this.loot.get(msg.id);
    const k = this.kit(m);
    if (!it) return;
    const p = { x: m.state.p[0], y: m.state.p[1], z: m.state.p[2] };
    const u = findLoot(p, [it], { hp: m.hp, shield: k.shield, nades: k.nades, guns: k.slots.map((s) => s?.w ?? null) });
    if (!u?.ready) return;
    this.loot.delete(it.id);
    this.lobby.broadcast({ t: 'looted', id: it.id, by: m.info.id });
    switch (it.k) {
      case 'gun': {
        const n = it.n ?? foundRounds(it.w!);
        const have = k.slots.findIndex((s) => s?.w === it.w);
        if (have >= 0) {
          k.rounds[have] += n;
          this.ammo(m, have === 0 ? [n, 0] : [0, n]);
          return;
        }
        let i = k.slots.findIndex((s) => !s);
        if (i < 0) {
          i = k.cur; // both hands full: swap the one you hold, and it drops at your feet
          const old = k.slots[i]!;
          if (k.rounds[i] > 0) this.lobby.broadcast({ t: 'loot', items: [this.drop(m, { k: 'gun', w: old.w, n: k.rounds[i] }, 0.6)] });
        }
        k.slots[i] = { w: it.w!, up: false };
        k.rounds[i] = n;
        k.cur = i;
        this.sendMe(m, [i]);
        return;
      }
      case 'ammo': {
        const add = k.slots.map((s) => (s ? crateRounds(s.w) : 0));
        add.forEach((n, i) => (k.rounds[i] += n));
        this.ammo(m, add);
        return;
      }
      case 'nade':
        k.nades = Math.min(ROYALE.maxNades, k.nades + ROYALE.nadeBundle);
        this.sendMe(m);
        return;
      case 'heal':
        m.hp = Math.min(ROYALE.hp, m.hp + ROYALE.heal);
        this.lobby.sendTo(m, { t: 'hp', hp: Math.ceil(m.hp), sh: k.shield });
        return;
      case 'shield':
        k.shield = Math.min(ROYALE.maxShield, k.shield + ROYALE.shield);
        this.lobby.sendTo(m, { t: 'hp', hp: Math.ceil(m.hp), sh: k.shield });
        return;
    }
  }

  private ammo(m: Member, add: number[]) {
    this.lobby.sendTo(m, { t: 'ammo', add });
  }

  /** Tell a player what they carry. `fill`: slots whose gun is new (with `rounds` in it). */
  private sendMe(m: Member, fill?: number[]) {
    const k = this.kit(m);
    this.lobby.sendTo(m, { t: 'me', pts: 0, slots: k.slots, cur: k.cur, fill, rounds: fill && k.slots.map((s, i) => (s && fill.includes(i) ? k.rounds[i] : null)), nades: k.nades });
  }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
