// The host's half of a run: the zombies, the stops, the money and the bus's health. Every screen draws what the
// director says; only the host's browser runs one (solo is the same with nobody else). Pure: no three.js, no DOM.
//
// What it trusts: the driver's bus pose (the driver drives; movement is client-side like the rest of the site) and
// players' hit claims and minigame results, checked for shape and range. It's co-op between friends: the checks keep a
// broken client from wrecking the run, not a determined cheat from winning it.

import { roadNear, type Route } from './route.ts';
import {
  BUS,
  CLUB,
  GORDIE,
  HORDE,
  RUN,
  SLOT_MAX,
  ZOMBIE,
  finishStop,
  fwdOf,
  fromBus,
  newRun,
  onBus,
  rng,
  stopDone,
  stopOf,
  toBus,
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
}

export type FxKind = 'yeet' | 'fore' | 'splat' | 'gordie' | 'grab' | 'hurt' | 'shake';
export interface Fx {
  k: FxKind;
  x: number;
  y: number;
  z: number;
  /** Paint colour, the pickup id, or the amount. */
  n: number;
}

/** Death rattles: how long a body lies there before it's tidied away (s). */
const BODY_TIME = 4;
/** Climbers get flung off a bus going faster than this (m/s), a few each second. */
const SHAKE = { speed: 15, chance: 0.18 };
/** Never more than this many zombies at once (the snapshot's size and the frame rate). */
export const Z_CAP = 90;

export class Director {
  run: RunState;
  zs: Zombie[] = [];
  /** Things for every screen to show (popups, splats); the session sends and clears them. */
  fx: Fx[] = [];
  /** Lines for everyone's banner. */
  said: string[] = [];
  taken = new Set<number>();
  private woke = new Set<number>();
  private nextId = 1;
  private spawnAcc = 0;
  private gordieT = 0;
  private r: () => number;
  private roadHint = 0;
  private shakeT = 0;

  constructor(
    readonly route: Route,
    seed = route.seed,
    /** How many are on the bus (a smaller crew faces a smaller horde). */
    readonly crew = 1,
  ) {
    this.run = newRun(seed);
    this.r = rng(seed ^ 0x5eed);
  }

  /** Bus distance along the road (m), from the last step. */
  busS = 0;

  step(dt: number, bus: Bus) {
    const run = this.run;
    if (run.phase === 'won' || run.phase === 'lost') {
      this.moveBodies(dt);
      return;
    }
    run.time += dt;
    this.lastBus = bus;
    const near = roadNear(this.route.road, bus.x, bus.z, this.roadHint);
    this.roadHint = near.i;
    this.busS = near.s;
    this.stops(dt, bus);
    this.spawn(dt, bus);
    this.zombies(dt, bus);
    this.gordie(dt);
    if (run.busHp <= 0) {
      run.busHp = 0;
      run.phase = 'lost';
      this.said.push('THE BUS IS TOAST.');
    }
  }

  private stops(dt: number, bus: Bus) {
    const run = this.run;
    const stop = this.route.stops[run.stage];
    if (!stop) return;
    const d = Math.hypot(bus.x - stop.x, bus.z - stop.z);
    if (run.phase === 'drive' && d < RUN.parkRadius && Math.abs(bus.v) < RUN.parkSpeed) {
      run.phase = 'stop';
      this.said.push(stopOf(run) === 'home' ? 'HOME SWEET HOME' : `Parked at ${stop.kind === 'jail' ? 'the jail' : stop.kind === 'golf' ? 'the driving range' : 'the casino'}!`);
    } else if (run.phase === 'stop' && d > RUN.parkRadius + 10) {
      run.phase = 'drive';
      this.said.push('Left before the job was done!');
    }
    if (run.phase !== 'stop') return;
    if (stopOf(run) === 'jail') {
      if (!run.bailPaid && run.money >= RUN.bail) {
        run.money -= RUN.bail;
        run.bailPaid = true;
        this.said.push(`Paid $${RUN.bail} bail. Now hold them off!`);
      }
      if (run.bailPaid) run.hold = Math.min(RUN.jailHold, run.hold + dt);
    }
    if (stopDone(run)) this.said.push(finishStop(run));
  }

  /** How many should be about right now. */
  target() {
    const s = this.run.stage;
    return Math.min(Z_CAP, Math.round((this.run.phase === 'stop' ? HORDE.stop(s) : HORDE.drive(s)) * HORDE.crewScale(this.crew)));
  }

  private spawn(dt: number, bus: Bus) {
    const alive = this.zs.filter((z) => z.st === 'run' || z.st === 'climb').length;
    // Sleeping crowds wake as the bus comes up the road.
    for (const h of this.route.hordes) {
      if (this.woke.has(h.id) || Math.hypot(h.x - bus.x, h.z - bus.z) > 90) continue;
      this.woke.add(h.id);
      for (let k = 0; k < h.n && this.zs.length < Z_CAP; k++) this.add(h.x + (this.r() - 0.5) * 10, h.z + (this.r() - 0.5) * 10);
    }
    this.spawnAcc = Math.min(5, this.spawnAcc + dt * HORDE.rate);
    let want = this.target() - alive;
    while (want > 0 && this.spawnAcc >= 1 && this.zs.length < Z_CAP) {
      this.spawnAcc -= 1;
      want--;
      // Mostly ahead of the bus, so you drive into them; some from anywhere.
      const ahead = this.r() < 0.7;
      const a = bus.h + (ahead ? (this.r() - 0.5) * 2.4 : this.r() * Math.PI * 2);
      const dist = HORDE.near + this.r() * (HORDE.far - HORDE.near);
      this.add(bus.x - Math.sin(a) * dist, bus.z - Math.cos(a) * dist);
    }
  }

  /** A new zombie at (x, z). */
  add(x: number, z: number, k?: ZKind) {
    const roll = this.r();
    const stage = this.run.stage;
    const kind: ZKind = k ?? (roll < 0.08 + stage * 0.02 ? 2 : roll < 0.25 + stage * 0.04 ? 1 : 0);
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
    };
    this.zs.push(zb);
    return zb;
  }

  private zombies(dt: number, bus: Bus) {
    const f = fwdOf(bus.h);
    this.shakeT += dt;
    const shake = this.shakeT >= 1 && Math.abs(bus.v) > SHAKE.speed;
    if (this.shakeT >= 1) this.shakeT = 0;
    for (const z of this.zs) {
      z.t += dt;
      if (z.st === 'run') {
        const spec = ZOMBIE[z.k];
        // Head for their spot on the bus's side; from far off, straight for the bus.
        const goal = fromBus(bus, z.side, z.along);
        const dx = goal.x - z.x;
        const dz = goal.z - z.z;
        const d = Math.hypot(dx, dz) || 1;
        z.vx = (dx / d) * spec.speed;
        z.vz = (dz / d) * spec.speed;
        z.x += z.vx * dt;
        z.z += z.vz * dt;
        if (onBus(bus, z.x, z.z, spec.r)) {
          if (Math.abs(bus.v) > HORDE.yeetSpeed) this.yeet(z, bus, z.paint, 'yeet');
          else this.grabOn(z, bus);
        } else if (d < HORDE.climbReach + spec.r) this.grabOn(z, bus);
        if (Math.hypot(z.x - bus.x, z.z - bus.z) > HORDE.despawn) z.st = 'dead';
      } else if (z.st === 'climb') {
        const p = fromBus(bus, z.side, z.along);
        z.x = p.x;
        z.z = p.z;
        z.y = Math.min(1.2, z.y + dt * 1.5);
        this.run.busHp -= ZOMBIE[z.k].damage * dt;
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

  /** Sends a zombie flying (hit by the bus or a golf club). It's dead when it lands. */
  private yeet(z: Zombie, bus: Bus, paint: number, k: 'yeet' | 'fore', power = 1) {
    const f = fwdOf(bus.h);
    const p = toBus(bus, z.x, z.z);
    const speed = Math.max(Math.abs(bus.v), 10) * power;
    const r = { x: Math.cos(bus.h), z: -Math.sin(bus.h) };
    z.st = 'fly';
    z.t = 0;
    z.hp = 0;
    z.paint = paint;
    z.vx = f.x * Math.sign(bus.v || 1) * speed * (k === 'fore' ? 0.3 : 1.1) + r.x * Math.sign(p.side || 1) * speed * 0.5;
    z.vz = f.z * Math.sign(bus.v || 1) * speed * (k === 'fore' ? 0.3 : 1.1) + r.z * Math.sign(p.side || 1) * speed * 0.5;
    z.vy = 7 + speed * 0.35;
    this.run.kills++;
    this.run.yeets++;
    this.fx.push({ k, x: z.x, y: z.y + 1.5, z: z.z, n: Math.round(speed) });
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
      this.run.kills++;
      z.st = z.y > 0.1 ? 'fly' : 'dead';
      if (z.st === 'fly') {
        z.vx = z.vz = 0;
        z.vy = 1;
      }
      z.t = 0;
    }
  }

  /** The last bus pose the session gave `step` (for knock-off directions). */
  lastBus: Bus | null = null;

  /**
   * A golf-club swing from the roof: every zombie in `zids` that really is within reach of the bus's side gets
   * teed off. Only with the club.
   */
  swing(zids: readonly number[], by: number, bus: Bus) {
    if (!this.run.club) return 0;
    let n = 0;
    for (const id of zids.slice(0, 6)) {
      const z = this.zs.find((q) => q.id === id);
      if (!z || (z.st !== 'run' && z.st !== 'climb')) continue;
      if (!onBus(bus, z.x, z.z, CLUB.reach + 1.5)) continue;
      this.yeet(z, bus, by, 'fore', 1.6);
      n++;
    }
    return n;
  }

  /** A minigame result: a green at the range, or what a slot pull paid. Only counts at that stop. */
  mini(kind: 'golf' | 'casino', v: number) {
    const run = this.run;
    if (run.phase !== 'stop' || stopOf(run) !== kind) return;
    if (kind === 'golf') run.greens = Math.min(RUN.golfGreens, run.greens + 1);
    else run.money += Math.max(0, Math.min(SLOT_MAX, Math.round(v)));
  }

  /** A pickup shot (cash or a repair kit). */
  grab(id: number) {
    const p = this.route.pickups[id];
    if (!p || this.taken.has(id)) return;
    this.taken.add(id);
    if (p.kind === 'cash') this.run.money += RUN.cash;
    else this.run.busHp = Math.min(BUS.hp, this.run.busHp + RUN.repair);
    this.fx.push({ k: 'grab', x: p.x, y: 1.2, z: p.z, n: id });
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
