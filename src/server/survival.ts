import { SURVIVAL } from '../shared/constants.ts';
import { MAP } from '../shared/map.ts';
import { type ClientMsg, type NetZombie, type V3, type WaveInfo, type WavePhase, ZombieFlag, round3 } from '../shared/protocol.ts';
import { type Zombie, type ZombieTarget, createZombie, stepHorde } from '../shared/zombie.ts';
import type { Lobby, Member } from './lobby.ts';

const SIM_DT = 1 / 60; // zombie physics sub-step
const SAFE_SPAWN = 12; // zombies prefer to climb up at least this far from everyone

/**
 * Survival rounds for one lobby: an intermission, then a round of zombies that ends when they're all
 * dead (next round, everyone revived and healed) or everyone is down (game over, back to round 1).
 * Dead players stay down until the round ends. Zombies are simulated here and sent in snapshots.
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

  constructor(private lobby: Lobby) {}

  info(): WaveInfo {
    return { round: this.round, phase: this.phase, left: this.toSpawn + this.zombies.length, timer: Math.round(this.timer * 10) / 10 };
  }

  snapshot(): NetZombie[] {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return this.zombies.map((z) => ({
      id: z.id,
      p: [r2(z.pos.x), r2(z.pos.y), r2(z.pos.z)],
      yaw: r2(z.yaw),
      f: (z.claw > 0 ? ZombieFlag.Clawing : 0) | (z.crouch > 0 ? ZombieFlag.Crouching : 0),
    }));
  }

  tick(dt: number) {
    if (this.phase === 'active') this.spawn(dt);
    else {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.phase === 'over') this.reset();
        else this.startRound();
      }
    }
    this.simulate(dt);
    if (this.phase !== 'active') return;
    const anyoneUp = [...this.lobby.members.values()].some((m) => m.info.alive);
    if (!anyoneUp && this.lobby.members.size > 0) this.setPhase('over', SURVIVAL.gameOverSeconds);
    else if (this.toSpawn === 0 && this.zombies.length === 0) {
      this.reviveAll();
      this.setPhase('intermission', SURVIVAL.intermission);
    }
  }

  /** A player's shot at a zombie (hit detection is the shooter's; we sanity-check it). */
  shoot(m: Member, msg: Extract<ClientMsg, { t: 'shoot' }>) {
    const z = this.zombies.find((x) => x.id === msg.zombie);
    if (!z) return;
    if (Math.hypot(msg.to[0] - z.pos.x, msg.to[1] - (z.pos.y + 1), msg.to[2] - z.pos.z) > 8) return;
    z.hp -= msg.headshot ? SURVIVAL.headDamage : SURVIVAL.bodyDamage;
    if (z.hp > 0) return;
    this.zombies.splice(this.zombies.indexOf(z), 1);
    m.info.kills++;
    this.lobby.broadcast({ t: 'zombieDied', id: z.id, killer: m.info.id, headshot: !!msg.headshot, dir: unit(sub(msg.to, msg.from)) });
    this.broadcastWave();
  }

  /** A player who joins mid-round starts healthy. */
  heal(m: Member) {
    m.hp = SURVIVAL.playerHp;
    this.lobby.sendTo(m, { t: 'hp', hp: m.hp });
  }

  private startRound() {
    this.round++;
    this.toSpawn = SURVIVAL.zombiesBase + SURVIVAL.zombiesPerRound * this.round;
    this.spawnTimer = 0;
    this.setPhase('active', 0);
  }

  private reset() {
    this.round = 0;
    this.zombies = [];
    this.toSpawn = 0;
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
  }

  private broadcastWave() {
    this.lobby.broadcast({ t: 'wave', wave: this.info() });
  }

  private spawn(dt: number) {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0 || this.toSpawn === 0 || this.zombies.length >= SURVIVAL.maxAlive) return;
    this.spawnTimer = SURVIVAL.spawnInterval;
    this.toSpawn--;
    this.zombies.push(createZombie(this.nextId++, this.spawnPoint(), this.round));
  }

  private spawnPoint() {
    const players = this.targets();
    const far = MAP.zombieSpawns.filter((s) => players.every((p) => Math.hypot(p.pos.x - s.x, p.pos.z - s.z) >= SAFE_SPAWN));
    const pool = far.length ? far : MAP.zombieSpawns;
    return pool[Math.floor(Math.random() * pool.length)];
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
      for (const { zombie, target } of stepHorde(this.zombies, targets, SIM_DT, MAP.boxes)) this.claw(zombie, target);
    }
    // Fell off the world: climb back up out of the clouds somewhere else.
    for (const z of this.zombies) {
      if (z.pos.y >= MAP.killY) continue;
      const p = this.spawnPoint();
      z.pos = { ...p };
      z.vel = { x: 0, y: 0, z: 0 };
    }
  }

  private claw(z: Zombie, targetId: number) {
    const m = this.lobby.members.get(targetId);
    if (!m || !m.info.alive) return;
    m.hp = Math.max(0, m.hp - z.damage);
    const from: V3 = [round3(z.pos.x), round3(z.pos.y), round3(z.pos.z)];
    this.lobby.sendTo(m, { t: 'hp', hp: m.hp, from });
    if (m.hp === 0) this.lobby.kill(m, m, 'zombie', sub(m.state.p, from));
  }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (v: V3): V3 => {
  const l = Math.hypot(...v) || 1;
  return [round3(v[0] / l), round3(v[1] / l), round3(v[2] / l)];
};
