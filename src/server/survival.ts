import { GRENADE, KNIFE, SURVIVAL, WEAPON } from '../shared/constants.ts';
import { type Colliders, buildColliders } from '../shared/colliders.ts';
import { blastTargets } from '../shared/grenade.ts';
import { findUse, killPoints, maxHp, pierced } from '../shared/interact.ts';
import { FOUNDRY } from '../shared/foundry.ts';
import { Nav } from '../shared/nav.ts';
import { type RunRecord, buildRows, shouldRestart, waitingFor } from '../shared/postgame.ts';
import { type BoxState, type ClientMsg, type NetZombie, type V3, type WaveInfo, type WavePhase, ZombieFlag, round3 } from '../shared/protocol.ts';
import { isThrough, makeBrain } from '../shared/siege.ts';
import { STARTER, type Slot, type WeaponId, bodyDamage, boxPool, gunStats, headDamage } from '../shared/weapons.ts';
import { type Zombie, type ZombieTarget, createZombie, stepHorde } from '../shared/zombie.ts';
import type { Lobby, Member } from './lobby.ts';

const SIM_DT = 1 / 60; // zombie physics sub-step
const LAY = FOUNDRY.survival!;
const PICK_FROM = 3; // a new zombie breaks in at one of the few windows nearest a player

interface Wallet {
  points: number;
  jug: boolean;
  /** Two guns, like the originals. */
  slots: (Slot | null)[];
  cur: number;
}

/**
 * Survival rounds for one lobby on the Foundry: an intermission, then a round of zombies that break in through the windows
 * (they tear the boards off; players nail them back) and chase you through whichever rooms you've bought your way into. A round
 * ends when they're all dead (everyone revived and healed, next round) or everyone is down (game over: the post-game board stays
 * up until everyone present pressed Play again, or the timeout, then back to round 1). Dead players stay down until the round ends.
 * Everything with a price is decided here: doors, wall guns, the Mystery Box, the two stations and repairs.
 */
export class Survival {
  private round = 0;
  private phase: WavePhase = 'intermission';
  private timer: number = SURVIVAL.firstRoundDelay;
  private toSpawn = 0;
  private spawnTimer = 0;
  private zombies: Zombie[] = [];
  private nextId = 1;
  private simAcc = 0;
  private clock = 0;
  /** Zombie kills this run, per player; players who leave keep their line. Cleared on restart. */
  private run = new Map<number, RunRecord>();
  private ready = new Set<number>();
  private wallet = new Map<number, Wallet>();
  private hurtAt = new Map<number, number>();
  private repairAt = new Map<number, number>();
  /** Progress on the board each window's front zombie is tearing. */
  private tearing = new Map<number, number>();

  // The building: which doors are open, the planks in each window, the Mystery Box.
  private doors: boolean[] = [];
  private boards: number[] = [];
  private box: BoxState = { spot: 0, phase: 'closed', gun: null, owner: 0, left: 0 };
  private boxUses = 0;
  private dirty = false;
  private nav = new Nav(LAY);
  private cols: Colliders = buildColliders(FOUNDRY);
  private brain = makeBrain(this.nav, LAY, this.boards);

  constructor(private lobby: Lobby) {
    this.resetBuilding();
  }

  info(): WaveInfo {
    return { round: this.round, phase: this.phase, left: this.toSpawn + this.zombies.length, timer: Math.round(this.timer * 10) / 10 };
  }

  snapshot(): NetZombie[] {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return this.zombies.map((z) => ({
      id: z.id,
      p: [r2(z.pos.x), r2(z.pos.y), r2(z.pos.z)],
      yaw: r2(z.yaw),
      f: (z.claw > 0 || z.tear > 0 ? ZombieFlag.Clawing : 0) | (z.crouch > 0 ? ZombieFlag.Crouching : 0),
    }));
  }

  tick(dt: number) {
    this.clock += dt;
    if (this.phase === 'active') this.spawn(dt);
    else {
      this.timer -= dt;
      if (this.phase === 'over') {
        if (shouldRestart(this.present(), this.ready, this.timer)) this.reset();
      } else if (this.timer <= 0) this.startRound();
    }
    this.simulate(dt);
    this.tickBox(dt);
    this.regen(dt);
    if (this.dirty) this.sendWorld();
    if (this.phase !== 'active') return;
    const anyoneUp = [...this.lobby.members.values()].some((m) => m.info.alive);
    if (!anyoneUp && this.lobby.members.size > 0) this.setPhase('over', SURVIVAL.gameOverSeconds);
    else if (this.toSpawn === 0 && this.zombies.length === 0) {
      this.reviveAll();
      this.setPhase('intermission', SURVIVAL.intermission);
    }
  }

  // ---------------------------------------------------------------------------
  // The building

  private resetBuilding() {
    this.doors = LAY.doors.map(() => false);
    this.boards = LAY.barricades.map(() => SURVIVAL.boards);
    this.tearing.clear();
    this.brain = makeBrain(this.nav, LAY, this.boards);
    this.box = { spot: Math.floor(Math.random() * LAY.boxSpots.length), phase: 'closed', gun: null, owner: 0, left: 0 };
    this.boxUses = 0;
    this.nav.setDoors(this.doors);
    this.rebuildColliders();
    this.dirty = true;
  }

  private rebuildColliders() {
    this.cols = buildColliders(FOUNDRY, this.doors, this.boards);
  }

  private sendWorld(to?: Member) {
    const msg = { t: 'world', doors: this.doors, boards: this.boards, box: this.box } as const;
    if (to) this.lobby.sendTo(to, msg);
    else {
      this.dirty = false;
      this.lobby.broadcast(msg);
    }
  }

  private tickBox(dt: number) {
    const b = this.box;
    if (b.phase === 'closed') return;
    b.left -= dt;
    if (b.left > 0) return;
    if (b.phase === 'rolling') {
      if (b.gun) {
        b.phase = 'ready';
        b.left = SURVIVAL.boxHold;
      } else {
        // The sad plush: you get your points back and the box is off to somewhere else.
        const owner = this.lobby.members.get(b.owner);
        if (owner) {
          this.purse(owner).points += SURVIVAL.boxPrice;
          this.sendMe(owner);
        }
        b.phase = 'leaving';
        b.left = SURVIVAL.boxLeave;
      }
    } else if (b.phase === 'ready') {
      b.phase = 'closed';
    } else {
      const others = LAY.boxSpots.map((_, i) => i).filter((i) => i !== b.spot);
      b.spot = others[Math.floor(Math.random() * others.length)];
      b.phase = 'closed';
    }
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------
  // Players: points, guns, buying

  private purse(m: Member) {
    let w = this.wallet.get(m.info.id);
    if (!w) this.wallet.set(m.info.id, (w = { points: 0, jug: false, slots: [{ w: STARTER, up: false }, null], cur: 0 }));
    return w;
  }

  forget(id: number) {
    this.wallet.delete(id);
    this.hurtAt.delete(id);
    this.repairAt.delete(id);
  }

  /** Seconds between shots for the gun in this player's hands (the lobby's rate limit). */
  fireCooldown(m: Member): number {
    const w = this.purse(m);
    const s = w.slots[w.cur];
    return s ? gunStats(s.w, s.up).fireCooldown : 0.5;
  }

  /** What others see of a shot: which gun, and whether it is punched. */
  shotLook(m: Member): { w: WeaponId; up?: boolean } | undefined {
    const w = this.purse(m);
    const s = w.slots[w.cur];
    return s ? { w: s.w, up: s.up || undefined } : undefined;
  }

  /** Tell a player their points and guns. `fill` lists slots that start with a full mag and spare ammo. */
  private sendMe(m: Member, fill?: number[]) {
    const w = this.purse(m);
    this.lobby.sendTo(m, { t: 'me', pts: w.points, jug: w.jug || undefined, slots: w.slots, cur: w.cur, fill });
  }

  equip(m: Member, slot: number) {
    const w = this.purse(m);
    if (w.slots[slot]) w.cur = slot;
  }

  /** Put a gun in a player's hands: refill it if they have it, else fill an empty slot, else swap the one they're holding. */
  private give(m: Member, gun: WeaponId): number[] {
    const w = this.purse(m);
    let i = w.slots.findIndex((s) => s?.w === gun);
    if (i < 0) {
      i = w.slots.findIndex((s) => !s);
      if (i < 0) i = w.cur;
      w.slots[i] = { w: gun, up: false };
    }
    w.cur = i;
    return [i];
  }

  /** F: the player pressed use. We find what's in reach ourselves and only act if it's what they asked for. */
  use(m: Member, msg: Extract<ClientMsg, { t: 'use' }>) {
    if (!m.info.alive) return;
    const w = this.purse(m);
    const [x, y, z] = m.state.p;
    const u = findUse({ x, y, z }, { lay: LAY, doorsOpen: this.doors, boards: this.boards, box: this.box, points: w.points, slots: w.slots, cur: w.cur, jug: w.jug, self: m.info.id });
    if (!u || u.kind !== msg.kind || u.id !== msg.id || u.status !== 'ready') return;

    let fill: number[] | undefined;
    switch (u.kind) {
      case 'door':
        w.points -= u.price;
        this.doors[u.id] = true;
        this.nav.setDoors(this.doors);
        this.rebuildColliders();
        this.dirty = true;
        break;
      case 'wall': {
        const buy = LAY.wallBuys[u.id];
        w.points -= u.price;
        const own = w.slots.find((s) => s?.w === buy.weapon);
        fill = own ? [w.slots.indexOf(own)] : this.give(m, buy.weapon);
        break;
      }
      case 'box':
        w.points -= u.price;
        this.rollBox(m);
        break;
      case 'take':
        fill = this.give(m, this.box.gun!);
        this.box.phase = 'closed';
        this.dirty = true;
        break;
      case 'punch': {
        w.points -= u.price;
        w.slots[w.cur]!.up = true;
        fill = [w.cur];
        break;
      }
      case 'jug':
        w.points -= u.price;
        w.jug = true;
        m.hp = maxHp(true);
        this.lobby.sendTo(m, { t: 'hp', hp: m.hp });
        break;
      case 'board':
        this.repair(m, u.id, w);
        break;
    }
    this.sendMe(m, fill);
  }

  /** Nail one board back up (hold F: one per repairTime), unless a zombie is standing right there. */
  private repair(m: Member, id: number, w: Wallet) {
    if (this.clock - (this.repairAt.get(m.info.id) ?? -9) < SURVIVAL.repairTime * 0.8) return;
    const b = LAY.barricades[id];
    if (this.zombies.some((z) => z.gate === id && Math.hypot(z.pos.x - b.outside.x, z.pos.z - b.outside.z) < 1.6)) return;
    this.repairAt.set(m.info.id, this.clock);
    if (this.boards[id] === 0) {
      this.boards[id] = 1;
      this.rebuildColliders();
    } else this.boards[id]++;
    w.points += SURVIVAL.repairPoints;
    this.dirty = true;
  }

  /** The box spins its guns for a few seconds, then shows one to whoever paid (or the plush, after a few uses). */
  private rollBox(m: Member) {
    const w = this.purse(m);
    const owned = w.slots.filter((s): s is Slot => !!s).map((s) => s.w);
    const pool = boxPool(owned);
    this.boxUses++;
    const plush = this.boxUses > SURVIVAL.plushAfter && Math.random() < SURVIVAL.plushChance;
    this.box = { spot: this.box.spot, phase: 'rolling', gun: plush ? null : pool[Math.floor(Math.random() * pool.length)], owner: m.info.id, left: SURVIVAL.boxRoll };
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------
  // Shooting

  /** A player's shot (hit detection is the shooter's; we sanity-check it). Damage comes from the gun we know they hold. */
  shoot(m: Member, msg: Extract<ClientMsg, { t: 'shoot' }>) {
    if (msg.knife) return this.stab(m, msg);
    const w = this.purse(m);
    const slot = w.slots[w.cur];
    if (!slot) return;
    const g = gunStats(slot.w, slot.up);
    const [fx, fy, fz] = msg.from;
    const [px, py, pz] = m.state.p;
    if (Math.hypot(fx - px, fy - py, fz - pz) > 10) return; // not where we last saw them
    const dir = unit(sub(msg.to, msg.from));
    let scored = false;
    const hitIds = new Set<number>();
    for (const h of (msg.hits ?? []).slice(0, g.pellets)) {
      const z = this.zombies.find((x) => x.id === h.z);
      if (!z || Math.hypot(fx - z.pos.x, fy - z.pos.y - 1, fz - z.pos.z) > WEAPON.range) continue;
      hitIds.add(z.id);
      scored = this.hurt(m, z, !!h.h, h.h ? headDamage(g) : bodyDamage(g), dir, scored);
    }
    if (g.pierces && slot.up && hitIds.size) {
      const first = this.zombies.find((x) => x.id === [...hitIds][0]);
      const [tx, ty, tz] = msg.to;
      for (const id of pierced({ x: fx, y: fy, z: fz }, { x: tx, y: ty, z: tz }, this.zombies, first?.id ?? -1)) {
        const o = this.zombies.find((x) => x.id === id);
        if (o) scored = this.hurt(m, o, false, bodyDamage(g), dir, scored);
      }
    }
    if (g.splash > 0 && Math.hypot(msg.to[0] - fx, msg.to[1] - fy, msg.to[2] - fz) <= WEAPON.range) {
      for (const z of [...this.zombies]) {
        if (hitIds.has(z.id)) continue;
        const d = Math.hypot(msg.to[0] - z.pos.x, msg.to[1] - z.pos.y - 1, msg.to[2] - z.pos.z);
        if (d < g.splash) scored = this.hurt(m, z, false, g.damage * (1 - (d / g.splash) * 0.5), dir, scored);
      }
    }
  }

  /** A knife stab: the first zombie it names, if it is within arm's reach (plus a little for lag). */
  private stab(m: Member, msg: Extract<ClientMsg, { t: 'shoot' }>) {
    const z = this.zombies.find((x) => x.id === msg.hits?.[0]?.z);
    if (!z || !m.info.alive || Math.hypot(m.state.p[0] - z.pos.x, m.state.p[1] - z.pos.y, m.state.p[2] - z.pos.z) > KNIFE.range + 2) return;
    this.hurt(m, z, false, KNIFE.zombieDamage, unit(sub(msg.to, msg.from)), false);
  }

  /** A grenade went off: every zombie in range and in sight takes the blast damage (kills pay points as usual). */
  blast(m: Member, center: { x: number; y: number; z: number }) {
    const hit = blastTargets(center, this.zombies.map((z) => ({ id: z.id, pos: z.pos })), this.cols.shot);
    for (const id of hit) {
      const z = this.zombies.find((x) => x.id === id);
      if (z) this.hurt(m, z, false, GRENADE.zombieDamage, unit([z.pos.x - center.x, z.pos.y + 1 - center.y, z.pos.z - center.z]), true);
    }
  }

  /** Damages a zombie; pays 10 for a hit (once per shot) and kill points when it dies. Returns whether this shot has paid its hit points. */
  private hurt(m: Member, z: Zombie, headshot: boolean, damage: number, dir: V3, scored: boolean): boolean {
    z.hp -= damage;
    const w = this.purse(m);
    if (z.hp > 0) {
      if (!scored) w.points += SURVIVAL.hitPoints;
      this.sendMe(m);
      return true;
    }
    this.zombies.splice(this.zombies.indexOf(z), 1);
    m.info.kills++;
    this.record(m).kills++;
    w.points += killPoints(headshot);
    this.sendMe(m);
    this.lobby.broadcast({ t: 'zombieDied', id: z.id, killer: m.info.id, headshot, dir });
    this.broadcastWave();
    return scored;
  }

  // ---------------------------------------------------------------------------
  // Run bookkeeping

  /** Post-game: this player wants another run. */
  again(m: Member) {
    if (this.phase !== 'over') return;
    this.ready.add(m.info.id);
    this.broadcastPostgame();
  }

  /** A player left the lobby (Home, or disconnected): stop waiting for them. */
  left(id: number) {
    this.ready.delete(id);
    if (this.phase === 'over') this.broadcastPostgame();
  }

  /** A player who joins mid-round starts healthy, and sees the building as it is now. */
  heal(m: Member) {
    this.record(m);
    if (this.phase === 'over') this.broadcastPostgame();
    m.hp = maxHp(this.purse(m).jug);
    this.lobby.sendTo(m, { t: 'hp', hp: m.hp });
    this.sendMe(m, [0, 1]);
    this.sendWorld(m);
  }

  private startRound() {
    this.round++;
    this.toSpawn = SURVIVAL.zombiesBase + SURVIVAL.zombiesPerRound * this.round;
    this.spawnTimer = 0;
    this.setPhase('active', 0);
  }

  private record(m: Member): RunRecord {
    let r = this.run.get(m.info.id);
    if (!r) this.run.set(m.info.id, (r = { name: m.info.name, color: m.info.color, kills: 0 }));
    return r;
  }

  private present() {
    return new Set(this.lobby.members.keys());
  }

  private broadcastPostgame() {
    const present = this.present();
    this.lobby.broadcast({
      t: 'postgame',
      rounds: Math.max(0, this.round - 1),
      rows: buildRows(this.run, present, this.ready),
      waiting: waitingFor(present, this.ready),
    });
  }

  private reset() {
    this.round = 0;
    this.ready.clear();
    for (const id of [...this.run.keys()]) {
      if (this.lobby.members.has(id)) this.run.get(id)!.kills = 0;
      else this.run.delete(id);
    }
    this.zombies = [];
    this.toSpawn = 0;
    this.wallet.clear();
    this.resetBuilding();
    this.reviveAll();
    this.setPhase('intermission', SURVIVAL.firstRoundDelay);
  }

  private reviveAll() {
    for (const m of this.lobby.members.values()) {
      if (!m.info.alive) this.lobby.respawn(m);
      this.heal(m);
    }
  }

  private setPhase(phase: WavePhase, timer: number) {
    this.phase = phase;
    this.timer = timer;
    this.broadcastWave();
    if (phase === 'over') {
      for (const m of this.lobby.members.values()) this.record(m);
      this.broadcastPostgame();
    }
  }

  private broadcastWave() {
    this.lobby.broadcast({ t: 'wave', wave: this.info() });
  }

  // ---------------------------------------------------------------------------
  // The horde

  private spawn(dt: number) {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0 || this.toSpawn === 0 || this.zombies.length >= SURVIVAL.maxAlive) return;
    this.spawnTimer = SURVIVAL.spawnInterval;
    this.toSpawn--;
    const b = this.pickWindow();
    const at = b.spawns[Math.floor(Math.random() * b.spawns.length)];
    this.zombies.push(createZombie(this.nextId++, at, this.round, b.id));
  }

  /** A window in a room the players can reach, chosen from the few closest to someone (so the action keeps coming to you). */
  private pickWindow() {
    const players = this.targets();
    const live = LAY.barricades.filter((b) => this.nav.isOpen(b.room));
    const ranked = live
      .map((b) => ({ b, d: players.length ? Math.min(...players.map((p) => this.nav.cost(b.inside, p.pos))) : 0 }))
      .sort((p, q) => p.d - q.d)
      .slice(0, PICK_FROM);
    return ranked[Math.floor(Math.random() * ranked.length)].b;
  }

  private targets(): ZombieTarget[] {
    const out: ZombieTarget[] = [];
    for (const m of this.lobby.members.values()) {
      if (m.info.alive) out.push({ id: m.info.id, pos: { x: m.state.p[0], y: m.state.p[1], z: m.state.p[2] } });
    }
    return out;
  }

  private simulate(dt: number) {
    if (!this.zombies.length) return;
    const targets = this.targets();
    this.simAcc += dt;
    while (this.simAcc >= SIM_DT) {
      this.simAcc -= SIM_DT;
      for (const { zombie, target } of stepHorde(this.zombies, targets, SIM_DT, this.cols.zombie, this.brain)) this.claw(zombie, target);
      this.siege(SIM_DT);
    }
  }

  /** The zombie at the front of each window's queue rips a board off every tearTime; one that is through the wall goes after players. */
  private siege(dt: number) {
    const front = new Map<number, Zombie>();
    for (const z of this.zombies) {
      if (z.gate < 0) continue;
      const b = LAY.barricades[z.gate];
      if (this.boards[b.id] === 0) {
        z.tear = 0;
        if (isThrough(z, LAY)) z.gate = -1;
        continue;
      }
      const d = Math.hypot(z.pos.x - b.outside.x, z.pos.z - b.outside.z);
      if (d > 0.75) continue;
      const f = front.get(b.id);
      if (!f || d < Math.hypot(f.pos.x - b.outside.x, f.pos.z - b.outside.z)) front.set(b.id, z);
      z.tear = 0;
    }
    for (const [id, z] of front) {
      z.tear = (this.tearing.get(id) ?? 0) + dt;
      if (z.tear < SURVIVAL.tearTime) {
        this.tearing.set(id, z.tear);
        continue;
      }
      this.tearing.set(id, 0);
      z.tear = 0.001;
      if (--this.boards[id] === 0) this.rebuildColliders();
      this.dirty = true;
    }
  }

  private claw(z: Zombie, targetId: number) {
    const m = this.lobby.members.get(targetId);
    if (!m || !m.info.alive) return;
    m.hp = Math.max(0, m.hp - z.damage);
    this.hurtAt.set(m.info.id, this.clock);
    const from: V3 = [round3(z.pos.x), round3(z.pos.y), round3(z.pos.z)];
    this.lobby.sendTo(m, { t: 'hp', hp: m.hp, from });
    if (m.hp === 0) this.lobby.kill(m, m, 'zombie', sub(m.state.p, from));
  }

  /** Health creeps back a few seconds after the last claw. */
  private regen(dt: number) {
    if (this.phase !== 'active') return;
    for (const m of this.lobby.members.values()) {
      const max = maxHp(this.purse(m).jug);
      if (!m.info.alive || m.hp >= max || this.clock - (this.hurtAt.get(m.info.id) ?? -99) < SURVIVAL.regenDelay) continue;
      m.hp = Math.min(max, m.hp + SURVIVAL.regenRate * dt);
      this.lobby.sendTo(m, { t: 'hp', hp: Math.round(m.hp) });
    }
  }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (v: V3): V3 => {
  const l = Math.hypot(...v) || 1;
  return [round3(v[0] / l), round3(v[1] / l), round3(v[2] / l)];
};
