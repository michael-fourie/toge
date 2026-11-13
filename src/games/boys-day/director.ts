// The host's half of a run: the zombies, the stops, the money and the bus's health. Every screen draws what the
// director says; only the host's browser runs one (solo is the same with nobody else). Pure: no three.js, no DOM.
//
// What it trusts: the driver's bus pose (the driver drives; movement is client-side like the rest of the site) and
// players' hit claims and minigame results, checked for shape and range. It's co-op between friends: the checks keep a
// broken client from wrecking the run, not a determined cheat from winning it.

import { TWISTS } from './checkpoints.ts';
import { HAZARD, makeRoute, roadNear, type Route } from './route.ts';
import {
  BUS,
  CLUB,
  GORDIE,
  GUNS,
  HORDE,
  JOBS,
  NADE,
  BJ_MAX,
  BUY,
  MAX_PLAYERS,
  REPAIR,
  ROUNDS,
  RUN,
  SLOT_MAX,
  ZOMBIE,
  burnOf,
  buy,
  chewOf,
  fwdOf,
  fromBus,
  gunsUnlocked,
  maxFuel,
  maxHp,
  newRun,
  onBus,
  rng,
  toBus,
  yeetSpeedOf,
  zSpeed,
  type Bus,
  type RunState,
  type ZKind,
} from './rules.ts';

export type ZState = 'run' | 'climb' | 'fly' | 'dead';
export const Z_STATES: ZState[] = ['run', 'climb', 'fly', 'dead'];

export interface Zombie {
  id: number;
  k: ZKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  hp: number;
  st: ZState;
  /** Seconds in this state. */
  t: number;
  /** Where on the bus it's going for / hanging on (bus-local). */
  side: number;
  along: number;
  /** The paint colour of whoever last hit it (-1: clean). */
  paint: number;
  /** Seconds until it can bite someone on foot again. */
  bite: number;
}

export type FxKind = 'yeet' | 'fore' | 'splat' | 'gordie' | 'grab' | 'hurt' | 'shake' | 'heal' | 'bump' | 'round' | 'bite' | 'crate' | 'can' | 'clear' | 'buy' | 'leg';
export interface Fx {
  k: FxKind;
  x: number;
  y: number;
  z: number;
  /** Paint colour, the pickup or site id, or the amount. */
  n: number;
  /** Which player it's about (a bite, a crate). */
  w?: number;
}

/** Somebody off the bus: where they stand (from their own screen). */
export interface Walker {
  id: number;
  x: number;
  z: number;
}

/** Death rattles: how long a body lies there before it's tidied away (s). */
const BODY_TIME = 4;
/** Climbers get flung off a bus going faster than this (m/s), a few each second. */
const SHAKE = { speed: 15, chance: 0.18 };
/** Never more than this many zombies at once (the snapshot's size and the frame rate). */
export const Z_CAP = 120;
/** Stand this close to the beacon to crank it (m). */
export const BEACON_R = 6;

export class Director {
  run: RunState;
  route: Route;
  zs: Zombie[] = [];
  /** Things for every screen to show (popups, splats); the session sends and clears them. */
  fx: Fx[] = [];
  /** Lines for everyone's banner. */
  said: string[] = [];
  /** Pickups taken on this leg, and the checkpoint's crates. */
  taken = new Set<number>();
  got = new Set<number>();
  private nextId = 1;
  /** Zombies still to send this round. */
  private toSpawn = 0;
  private inRound = false;
  /** Where the bus was last step (fuel burns by the metre), and the potholes it's just hit (no double jolts). */
  private lastXZ: { x: number; z: number } | null = null;
  private jolted = new Map<number, number>();
  private spawnAcc = 0;
  private gordieT = 0;
  private r: () => number;
  private roadHint = 0;
  private shakeT = 0;
  private walkers: readonly Walker[] = [];

  constructor(
    readonly seed: number,
    /** How many are on the bus (a smaller crew faces a smaller horde). */
    readonly crew = 1,
  ) {
    this.run = newRun(seed, crew);
    this.route = makeRoute(seed, 0);
    this.run.need = JOBS[this.route.cp.job].need(crew, 0);
    this.r = rng(seed ^ 0x5eed);
  }

  /** Bus distance along the road (m), from the last step. */
  busS = 0;
  /** The last bus pose the session gave `step` (for knock-off directions). */
  lastBus: Bus | null = null;

  private get twist() {
    return TWISTS[this.route.cp.twist];
  }

  /** One tick: `walkers` is everyone off the bus. */
  step(dt: number, bus: Bus, walkers: readonly Walker[] = []) {
    const run = this.run;
    if (run.phase === 'lost') {
      this.moveBodies(dt);
      return;
    }
    run.time += dt;
    this.lastBus = bus;
    this.walkers = walkers;
    const near = roadNear(this.route.road, bus.x, bus.z, this.roadHint);
    this.roadHint = near.i;
    this.busS = near.s;
    if (run.done && near.i >= this.route.gate.i) return this.nextLeg();
    this.checkpoint(dt, bus);
    this.driveOver(bus);
    this.burn(bus);
    this.potholes(bus);
    this.spawn(dt, bus);
    this.zombies(dt, bus);
    this.gordie(dt);
    if (run.busHp <= 0) {
      run.busHp = 0;
      run.phase = 'lost';
      this.said.push('THE BUS IS TOAST.');
    }
  }

  /** Parking at the checkpoint, its job, and clearing it. */
  private checkpoint(dt: number, bus: Bus) {
    const run = this.run;
    const { stop, cp } = this.route;
    const d = Math.hypot(bus.x - stop.x, bus.z - stop.z);
    if (run.phase === 'drive' && !run.done && d < RUN.parkRadius && Math.abs(bus.v) < RUN.parkSpeed) {
      run.phase = 'stop';
      this.said.push(`${cp.name.toUpperCase()}: ${JOBS[cp.job].goal}.`);
    } else if (run.phase === 'stop' && d > RUN.parkRadius + 10) run.phase = 'drive';
    if (run.phase !== 'stop' || run.done) return;
    if (cp.job === 'beacon') {
      const b = this.route.sites.find((s) => s.kind === 'beacon');
      if (b && this.walkers.some((w) => Math.hypot(w.x - b.x, w.z - b.z) < BEACON_R)) run.prog = Math.min(run.need, run.prog + dt);
    }
    if (run.prog >= run.need) this.clear();
  }

  /** The job's done: the prizes, and the gate opens. */
  private clear() {
    const run = this.run;
    const { cp, stop } = this.route;
    run.done = true;
    const scrap = Math.round((RUN.clear + RUN.clearPer * run.stage) * this.twist.pay);
    this.payAll(scrap);
    const before = run.busHp;
    run.busHp = Math.min(maxHp(run), run.busHp + RUN.patch);
    this.fx.push({ k: 'clear', x: stop.x, y: 3, z: stop.z, n: scrap });
    this.fx.push({ k: 'heal', x: stop.x, y: 2, z: stop.z, n: Math.round(run.busHp - before) });
    let line = `CHECKPOINT ${run.stage + 1} CLEARED! +${scrap} scrap each. All aboard: the gate’s open.`;
    if (cp.job === 'golf' && !run.club) {
      run.club = true;
      line = 'GOLF CLUB GET! Swing it at zombies (V / RB): FORE! The gate’s open.';
    } else if (cp.job === 'holdout' && !run.gordie) {
      run.gordie = true;
      line = 'GORDIE IS FREE! He’s on the bus, shooting. The gate’s open.';
    }
    this.said.push(line);
    const gun = GUNS.find((g) => g.unlock === run.stage + 1);
    if (gun) this.said.push(`NEW GUN: ${gun.name.toUpperCase()}! Q / D-pad right to switch.`);
  }

  /** Through the gate: the next leg, a new world. */
  private nextLeg() {
    const run = this.run;
    run.stage++;
    this.route = makeRoute(this.seed, run.stage);
    const cp = this.route.cp;
    run.phase = 'drive';
    run.prog = 0;
    run.done = false;
    run.need = JOBS[cp.job].need(this.crew, run.stage);
    run.calm = Math.max(run.calm, RUN.legCalm);
    this.toSpawn = 0;
    this.inRound = false;
    this.zs = [];
    this.taken = new Set();
    this.got = new Set();
    this.jolted.clear();
    this.lastXZ = null;
    this.roadHint = 0;
    this.fx.push({ k: 'leg', x: 0, y: 0, z: 0, n: run.stage });
    if (this.twist.note) this.said.push(this.twist.note);
  }

  /** Rounds: a calm, then "ROUND n" sends its zombies (a few at a time); kill them all and the next calm starts. */
  private spawn(dt: number, bus: Bus) {
    const run = this.run;
    let alive = this.zs.filter((z) => z.st === 'run' || z.st === 'climb').length;
    // A siege (hold them off, or crank the beacon) doesn't let up until the job's done.
    const job = this.route.cp.job;
    const siege = run.phase === 'stop' && !run.done && (job === 'holdout' || job === 'beacon');
    if (!this.inRound) {
      if (!siege) {
        run.calm = Math.max(0, run.calm - dt);
        if (run.calm > 0) {
          run.left = alive;
          return;
        }
      }
      run.calm = 0;
      this.inRound = true;
      run.round++;
      this.toSpawn = Math.max(1, Math.round((ROUNDS.size(run.round, this.crew) + run.stage * 2) * this.twist.horde));
      this.said.push(`ROUND ${run.round}`);
      this.fx.push({ k: 'round', x: bus.x, y: 0, z: bus.z, n: run.round });
    }
    this.spawnAcc = Math.min(3, this.spawnAcc + dt * ROUNDS.rate);
    const cap = Math.min(Z_CAP, Math.round(ROUNDS.alive(run.round, this.crew) * this.twist.horde));
    while (this.toSpawn > 0 && this.spawnAcc >= 1 && alive < cap) {
      this.spawnAcc -= 1;
      this.toSpawn--;
      alive++;
      // Mostly ahead of the bus, so you drive into them; some from anywhere (all round, when you're parked).
      const ahead = run.phase === 'drive' && this.r() < 0.7;
      const a = bus.h + (ahead ? (this.r() - 0.5) * 2.4 : this.r() * Math.PI * 2);
      const dist = HORDE.near + this.r() * (HORDE.far - HORDE.near);
      this.add(bus.x - Math.sin(a) * dist, bus.z - Math.cos(a) * dist);
    }
    run.left = alive + this.toSpawn;
    if (this.toSpawn === 0 && alive === 0) {
      this.inRound = false;
      run.calm = siege ? 0 : ROUNDS.calm;
      if (!siege) this.said.push(`ROUND ${run.round} SURVIVED! Catch your breath.`);
    }
  }

  /** The tank empties by the metre driven. */
  private burn(bus: Bus) {
    if (this.lastXZ) {
      const d = Math.hypot(bus.x - this.lastXZ.x, bus.z - this.lastXZ.z);
      // A jump of more than a few metres is a teleport (a join, a new leg), not driving.
      if (d < 5) {
        this.run.fuel = Math.max(0, this.run.fuel - d * burnOf(this.run));
        this.run.dist += d;
      }
    }
    this.lastXZ = { x: bus.x, z: bus.z };
  }

  /** Hitting a pothole at speed hurts the bus (the driver's screen takes the speed off). */
  private potholes(bus: Bus) {
    const t = this.run.time;
    this.route.hazards.forEach((h, i) => {
      if (h.kind !== 'pothole' || Math.abs(h.x - bus.x) > 9 || Math.abs(h.z - bus.z) > 9) return;
      if (!onBus(bus, h.x, h.z, h.r * 0.5) || Math.abs(bus.v) < 4 || t - (this.jolted.get(i) ?? -9) < 2) return;
      this.jolted.set(i, t);
      this.run.busHp -= HAZARD.potholeDamage;
      this.fx.push({ k: 'bump', x: h.x, y: 1, z: h.z, n: HAZARD.potholeDamage });
    });
  }

  /** A new zombie at (x, z). */
  add(x: number, z: number, k?: ZKind) {
    const roll = this.r();
    const stage = this.run.stage;
    const twist = this.route.cp.twist;
    const chonk = Math.min(0.3, 0.08 + stage * 0.012) + (twist === 'chonk' ? 0.4 : 0);
    const sprint = twist === 'sprint' ? 1 : Math.min(0.5, 0.17 + stage * 0.025);
    const kind: ZKind = k ?? (twist !== 'sprint' && roll < chonk ? 2 : roll < chonk + sprint ? 1 : 0);
    const zb: Zombie = {
      id: this.nextId++,
      k: kind,
      x,
      y: 0,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      hp: ZOMBIE[kind].hp,
      st: 'run',
      t: 0,
      side: (this.r() < 0.5 ? -1 : 1) * (BUS.width / 2 + ZOMBIE[kind].r),
      along: (this.r() - 0.5) * (BUS.length - 2),
      paint: -1,
      bite: 0,
    };
    this.zs.push(zb);
    return zb;
  }

  private zombies(dt: number, bus: Bus) {
    const f = fwdOf(bus.h);
    this.shakeT += dt;
    const shake = this.shakeT >= 1 && Math.abs(bus.v) > SHAKE.speed;
    if (this.shakeT >= 1) this.shakeT = 0;
    const fast = zSpeed(this.run.stage);
    const yeetAt = yeetSpeedOf(this.run);
    const chew = chewOf(this.run);
    for (const z of this.zs) {
      z.t += dt;
      z.bite -= dt;
      if (z.st === 'run') {
        const spec = ZOMBIE[z.k];
        // Whoever's nearest on foot, if they're closer than the bus; otherwise their spot on the bus's side.
        const goal = fromBus(bus, z.side, z.along);
        let dx = goal.x - z.x;
        let dz = goal.z - z.z;
        let d = Math.hypot(dx, dz) || 1;
        let prey: Walker | null = null;
        for (const w of this.walkers) {
          const wd = Math.hypot(w.x - z.x, w.z - z.z);
          if (wd < HORDE.chase && wd < d) {
            prey = w;
            d = wd || 0.01;
            dx = w.x - z.x;
            dz = w.z - z.z;
          }
        }
        if (prey && d < spec.r + HORDE.biteReach) {
          z.vx = z.vz = 0;
          if (z.bite <= 0) {
            z.bite = HORDE.bite;
            this.fx.push({ k: 'bite', x: prey.x, y: 1.4, z: prey.z, n: spec.bite, w: prey.id });
          }
          continue;
        }
        z.vx = (dx / d) * spec.speed * fast;
        z.vz = (dz / d) * spec.speed * fast;
        z.x += z.vx * dt;
        z.z += z.vz * dt;
        if (onBus(bus, z.x, z.z, spec.r)) {
          if (Math.abs(bus.v) > yeetAt) this.yeet(z, this.busFling(z, bus), Math.max(Math.abs(bus.v), 10), z.paint, 'yeet');
          else if (!prey) this.grabOn(z, bus);
          else this.pushOut(z, bus);
        } else if (!prey && d < HORDE.climbReach + spec.r) this.grabOn(z, bus);
        if (Math.hypot(z.x - bus.x, z.z - bus.z) > HORDE.despawn) z.st = 'dead';
      } else if (z.st === 'climb') {
        const p = fromBus(bus, z.side, z.along);
        z.x = p.x;
        z.z = p.z;
        z.y = Math.min(1.2, z.y + dt * 1.5);
        this.run.busHp -= ZOMBIE[z.k].damage * chew * dt;
        if (shake && this.r() < SHAKE.chance) {
          // Flung off at speed: they tumble away behind.
          z.st = 'fly';
          z.t = 0;
          z.vx = -f.x * 4 + Math.sign(z.side) * Math.cos(bus.h) * 6;
          z.vz = -f.z * 4 - Math.sign(z.side) * Math.sin(bus.h) * 6;
          z.vy = 4;
          this.fx.push({ k: 'shake', x: z.x, y: z.y + 1, z: z.z, n: 0 });
        }
      } else if (z.st === 'fly') this.fly(z, dt);
    }
    this.zs = this.zs.filter((z) => !(z.st === 'dead' && z.t > BODY_TIME));
  }

  /** A zombie chasing someone round the parked bus goes round it, not through it. */
  private pushOut(z: Zombie, bus: Bus) {
    const p = toBus(bus, z.x, z.z);
    const w = fromBus(bus, Math.sign(p.side || 1) * (BUS.width / 2 + ZOMBIE[z.k].r), p.along);
    z.x = w.x;
    z.z = w.z;
  }

  private grabOn(z: Zombie, bus: Bus) {
    const p = toBus(bus, z.x, z.z);
    z.st = 'climb';
    z.t = 0;
    z.side = Math.sign(p.side || 1) * (BUS.width / 2 + 0.2);
    z.along = Math.max(-BUS.length / 2 + 0.6, Math.min(BUS.length / 2 - 0.6, p.along));
  }

  private fly(z: Zombie, dt: number) {
    z.vy -= 18 * dt;
    z.x += z.vx * dt;
    z.y += z.vy * dt;
    z.z += z.vz * dt;
    if (z.y <= 0 && z.t > 0.2) {
      z.y = 0;
      if (z.hp <= 0) {
        z.st = 'dead';
        z.t = 0;
      } else {
        z.st = 'run';
        z.t = 0;
      }
    }
  }

  private moveBodies(dt: number) {
    if (dt <= 0) return;
    for (const z of this.zs) {
      z.t += dt;
      if (z.st === 'fly') this.fly(z, dt);
    }
  }

  /** Which way the bus flings a zombie it hits: on ahead, and out to its side. */
  private busFling(z: Zombie, bus: Bus) {
    const f = fwdOf(bus.h);
    const p = toBus(bus, z.x, z.z);
    const r = { x: Math.cos(bus.h), z: -Math.sin(bus.h) };
    const go = Math.sign(bus.v || 1) * 1.1;
    const out = Math.sign(p.side || 1) * 0.5;
    return { x: f.x * go + r.x * out, z: f.z * go + r.z * out };
  }

  /** Scrap for crew member `who` (their place in the crew), or off them; never below nothing. */
  pay(who: number, n: number) {
    if (who >= 0 && who < Math.min(this.crew, MAX_PLAYERS)) this.run.cash[who] = Math.max(0, Math.round(this.run.cash[who] + n));
  }

  /** The same for everyone aboard: what the crew finds, everybody pockets. */
  payAll(n: number) {
    for (let i = 0; i < Math.min(this.crew, MAX_PLAYERS); i++) this.pay(i, n);
  }

  /** One more for the count (and for a hold-out's job). */
  private killed() {
    const run = this.run;
    run.kills++;
    if (run.phase === 'stop' && !run.done && this.route.cp.job === 'holdout') run.prog = Math.min(run.need, run.prog + 1);
  }

  /** Sends a zombie flying (hit by the bus or a golf club) along `dir`. It's dead when it lands. */
  private yeet(z: Zombie, dir: { x: number; z: number }, speed: number, paint: number, k: 'yeet' | 'fore') {
    z.st = 'fly';
    z.t = 0;
    z.hp = 0;
    z.paint = paint;
    z.vx = dir.x * speed;
    z.vz = dir.z * speed;
    z.vy = 7 + speed * 0.35;
    this.killed();
    this.run.yeets++;
    this.fx.push({ k, x: z.x, y: z.y + 1.5, z: z.z, n: Math.round(speed) });
  }

  /** What a hit from gun `g` does (-1: a grenade), if the crew has that gun. */
  damageOf(g: number) {
    if (g === -1) return NADE.damage;
    const gun = GUNS[g];
    return gun && g < gunsUnlocked(this.run.stage + (this.run.done ? 1 : 0)) ? gun.damage : 1;
  }

  /** A paintball hit (claimed by a player): `by` is their paint colour. */
  hit(zid: number, by: number, dmg = 1) {
    const z = this.zs.find((q) => q.id === zid);
    if (!z || z.st === 'dead' || z.st === 'fly') return;
    z.hp -= dmg;
    z.paint = by;
    this.fx.push({ k: 'splat', x: z.x, y: z.y + 1.2, z: z.z, n: by });
    if (z.hp > 0 && z.st === 'climb') {
      // A hit knocks a climber off; it'll come back.
      z.st = 'fly';
      z.t = 0;
      const out = { x: z.x - (this.lastBus?.x ?? z.x), z: z.z - (this.lastBus?.z ?? z.z) };
      const l = Math.hypot(out.x, out.z) || 1;
      z.vx = (out.x / l) * 5;
      z.vz = (out.z / l) * 5;
      z.vy = 3;
      return;
    }
    if (z.hp <= 0) {
      this.killed();
      this.pay(by, z.k === 2 ? RUN.chonk : RUN.kill);
      z.st = z.y > 0.1 || dmg > 3 ? 'fly' : 'dead';
      if (z.st === 'fly') {
        // A big hit (a grenade, the Long Tom) pops them into the air.
        z.vx = z.vz = 0;
        z.vy = dmg > 3 ? 6 : 1;
      }
      z.t = 0;
    }
  }

  /**
   * A golf-club swing: every zombie in `zids` that really is within reach of the bus's side (or of `from`, a swing
   * on foot) gets teed off, away from the swinger. Only with the club.
   */
  swing(zids: readonly number[], by: number, bus: Bus, from?: { x: number; z: number }) {
    if (!this.run.club) return 0;
    let n = 0;
    for (const id of zids.slice(0, 6)) {
      const z = this.zs.find((q) => q.id === id);
      if (!z || (z.st !== 'run' && z.st !== 'climb')) continue;
      if (from ? Math.hypot(z.x - from.x, z.z - from.z) > CLUB.reach + 1.5 : !onBus(bus, z.x, z.z, CLUB.reach + 1.5)) continue;
      const o = from ?? bus;
      const l = Math.hypot(z.x - o.x, z.z - o.z) || 1;
      this.yeet(z, { x: (z.x - o.x) / l, z: (z.z - o.z) / l }, 16, by, 'fore');
      n++;
    }
    return n;
  }

  /** A minigame result at the checkpoint: a zombie teed off, or what a slot pull paid. Only counts for that job. */
  mini(kind: 'golf' | 'slots', v: number, who: number) {
    const run = this.run;
    if (run.phase !== 'stop' || run.done || this.route.cp.job !== kind) return;
    if (kind === 'golf') {
      run.prog = Math.min(run.need, run.prog + 1);
      run.busHp = Math.min(maxHp(run), run.busHp + RUN.teeHeal);
    } else {
      const won = Math.max(0, Math.min(SLOT_MAX, Math.round(v)));
      this.pay(who, won);
      run.prog = Math.min(run.need, run.prog + won);
    }
  }

  /** A hand of blackjack at the card table: what `who` won or lost (held to the top bet, doubled). */
  blackjack(delta: number, who: number) {
    this.pay(who, Math.max(-BJ_MAX, Math.min(BJ_MAX, Math.round(delta))));
  }

  /**
   * Something `who` (their place in the crew) did on foot: a crate grabbed (`id`), a jerry can brought back, or
   * getting knocked out.
   */
  did(k: 'crate' | 'can' | 'ko', id: number, who: number) {
    const run = this.run;
    const job = this.route.cp.job;
    if (k === 'ko') {
      const lost = Math.floor((run.cash[who] ?? 0) * RUN.koLoss);
      this.pay(who, -lost);
      this.said.push(lost ? `Someone got chomped and dropped ${lost} scrap!` : 'Someone got chomped!');
      return;
    }
    if (run.phase !== 'stop' || run.done) return;
    if (k === 'crate') {
      const s = this.route.sites[id];
      if (job !== 'scavenge' || !s || s.kind !== 'crate' || this.got.has(id)) return;
      this.got.add(id);
      run.prog = Math.min(run.need, run.prog + 1);
      const scrap = Math.round(RUN.crate * this.twist.pay);
      this.payAll(scrap);
      this.fx.push({ k: 'crate', x: s.x, y: 1.2, z: s.z, n: scrap, w: who });
    } else if (job === 'fuel') {
      run.prog = Math.min(run.need, run.prog + 1);
      run.fuel = Math.min(maxFuel(run), run.fuel + RUN.jerry);
      const b = this.lastBus;
      if (b) this.fx.push({ k: 'can', x: b.x, y: 2.5, z: b.z, n: RUN.jerry, w: who });
    }
  }

  /** Scrap `who` spends at the bus's store (see BUY). The 'buy' effect tells their screen (grenades, bandages). */
  buy(k: number, who: number) {
    const before = this.run.busHp;
    if (!buy(this.run, k, who)) return false;
    const b = this.lastBus;
    this.fx.push({ k: 'buy', x: b?.x ?? 0, y: 3, z: b?.z ?? 0, n: k, w: who });
    if (k === BUY.repair) this.fx.push({ k: 'heal', x: b?.x ?? 0, y: 2, z: b?.z ?? 0, n: Math.min(REPAIR.hp, Math.round(this.run.busHp - before)) });
    return true;
  }

  /** A pickup, shot or driven over: scrap, gas or a repair kit. */
  grab(id: number) {
    const p = this.route.pickups[id];
    if (!p || this.taken.has(id)) return;
    this.taken.add(id);
    this.fx.push({ k: 'grab', x: p.x, y: 1.2, z: p.z, n: id });
    if (p.kind === 'scrap') {
      this.payAll(RUN.scrap);
      return;
    }
    if (p.kind === 'gas') {
      this.run.fuel = Math.min(maxFuel(this.run), this.run.fuel + RUN.gas);
      return;
    }
    // Say what it actually fixed (a full bus gets nothing, and the popup says so).
    const before = this.run.busHp;
    this.run.busHp = Math.min(maxHp(this.run), before + RUN.repair);
    this.fx.push({ k: 'heal', x: p.x, y: 2, z: p.z, n: Math.round(this.run.busHp - before) });
  }

  /** The bus picks up whatever it drives over (the driver can't shoot). */
  private driveOver(bus: Bus) {
    for (const p of this.route.pickups) {
      if (this.taken.has(p.id) || Math.abs(p.x - bus.x) > 9 || Math.abs(p.z - bus.z) > 9) continue;
      if (onBus(bus, p.x, p.z, PICKUP_REACH)) this.grab(p.id);
    }
  }

  private gordie(dt: number) {
    if (!this.run.gordie) return;
    this.gordieT += dt;
    if (this.gordieT < GORDIE.every) return;
    this.gordieT = 0;
    const bus = this.lastBus;
    if (!bus) return;
    let best: Zombie | null = null;
    let bd: number = GORDIE.range;
    for (const z of this.zs) {
      if (z.st !== 'run' && z.st !== 'climb') continue;
      const d = Math.hypot(z.x - bus.x, z.z - bus.z);
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    if (!best) return;
    this.fx.push({ k: 'gordie', x: best.x, y: best.y + 1.2, z: best.z, n: 0 });
    if (this.r() < GORDIE.hit) this.hit(best.id, GORDIE_PAINT, 2);
  }
}

/** Driving over a pickup collects it within this much of the bus's sides (m). */
export const PICKUP_REACH = 0.8;

/** Gordie's paint colour (an index past the players'). */
export const GORDIE_PAINT = 8;

/** The zombies as a flat list for the wire: [id, kind, x·10, y·10, z·10, state, paint] per zombie. */
export function packZombies(zs: readonly Zombie[]): number[] {
  const out: number[] = [];
  for (const z of zs) out.push(z.id, z.k, Math.round(z.x * 10), Math.round(z.y * 10), Math.round(z.z * 10), Z_STATES.indexOf(z.st), z.paint);
  return out;
}

export interface ZView {
  id: number;
  k: ZKind;
  x: number;
  y: number;
  z: number;
  st: ZState;
  paint: number;
}

export function unpackZombies(a: readonly number[]): ZView[] {
  const out: ZView[] = [];
  for (let i = 0; i + 6 < a.length; i += 7) {
    const k = a[i + 1];
    const st = Z_STATES[a[i + 5]];
    if ((k !== 0 && k !== 1 && k !== 2) || !st) continue;
    out.push({ id: a[i], k: k as ZKind, x: a[i + 2] / 10, y: a[i + 3] / 10, z: a[i + 4] / 10, st, paint: a[i + 6] });
  }
  return out;
}
