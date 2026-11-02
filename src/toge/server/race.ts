import { decodeCar, raceCars } from '../shared/cars.ts';
import { ITEM_MAX_USES, clampDrift } from '../shared/drift.ts';
import { payout, raceBonus } from '../shared/garage.ts';
import type { Item } from '../shared/powerups.ts';
import { cleanRiderCode } from '../shared/rider.ts';
import { CAR_RULES, MODE_TRACK, RACE, RACE_MODES, ghostMode, type CarRule, type NetCar, type RaceClientMsg, type RaceMode, type RacePhase, type RaceServerMsg, type Racer, type ResultRow } from '../shared/protocol.ts';
import { TRACK_DEFS, type TrackId } from '../shared/track.ts';
import type { Socket } from '../../server/rooms.ts';

const OPEN = 1;
/** How often a live room re-announces itself to the directory. */
const HEARTBEAT_MS = 30_000;
/** One attack item per racer per this many ms at most. */
const ITEM_GAP_MS = 700;
/** No real descent is quicker than this; a faster "finish" is ignored. */
const MIN_RACE_SECONDS = 40;
/** A turbo or shield use is counted at most this often (a triple turbo's three come quickly). */
const USE_GAP_MS = 250;
/** A car can't blow up more often than this (ms). */
const WRECK_GAP_MS = 1000;

export interface RaceClient {
  id: number;
  ws: Socket;
  name: string;
  car: string;
  /** encodeRider(): the racer's driver (cleaned on the way in, so it's always valid). */
  rider: string;
  /** Signed in (prize money is paid into the account's garage). */
  user: boolean;
}

interface Member {
  client: RaceClient;
  state: NetCar | null;
  /** In the current race (joined before the countdown). */
  racing: boolean;
  /** Has built the track and is waiting on the grid (the countdown waits for everyone, up to a timeout). */
  ready: boolean;
  time: number | null;
  /** Quickest lap on a circuit (client-timed; only shown, never paid on). */
  best: number | null;
  /** The car code this racer drives in the current race (their own unless a time trial's rule changed it). */
  raceCar: string;
  /** Drift points reported this race, capped by the race clock. */
  drift: number;
  /** Items used this race, per kind (attack items as relayed, self items from `used`), for the bonus. */
  uses: Partial<Record<Item, number>>;
}

export const sendTo = (c: RaceClient, msg: RaceServerMsg) => {
  if (c.ws.readyState === OPEN) c.ws.send(JSON.stringify(msg));
};

const finite = (x: unknown, lim: number) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= lim;

/**
 * One race lobby: the roster, the host's track pick, and the race cycle (lobby → countdown → racing →
 * results → lobby). Driving is client-authoritative; the room relays poses, times the race, ranks the
 * finishers and works out the prize money.
 */
export class Race {
  readonly members = new Map<number, Member>();
  hostId = 0;
  track: TrackId = 'koripass';
  mode: RaceMode = 'race';
  /** What a time trial's or hill climb's racers drive (a race always runs everyone's own car). */
  cars: CarRule = 'own';
  /** Physics mode: crash damage (damage.ts, run by each client for its own car). */
  physics = false;
  phase: RacePhase = 'lobby';
  private phaseEnds = 0;
  private goAt = 0;
  private firstFinish = 0;
  private lastBeat = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** When each racer last used an attack item (a cheap guard against spam). */
  private itemAt = new Map<number, number>();
  /** When each racer last reported a turbo or shield. */
  private usedAt = new Map<number, number>();
  /** When each racer's car last blew up. */
  private wreckAt = new Map<number, number>();

  constructor(
    readonly code: string,
    private onChange: (r: Race) => void,
    private onEmpty: (r: Race) => void,
    /** Results are in: pay the signed-in racers. */
    private onResults: (rows: ResultRow[], users: Set<number>) => void,
    private now: () => number = Date.now,
    tick = true,
    /** The dice for the spec car (tests pass their own). */
    private rand: () => number = Math.random,
  ) {
    if (tick) this.timer = setInterval(() => this.tick(), 1000 / RACE.snapshotHz);
  }

  get hostName() {
    return this.members.get(this.hostId)?.client.name ?? '?';
  }

  get full() {
    return this.members.size >= RACE.maxPlayers;
  }

  add(c: RaceClient) {
    if (!decodeCar(c.car)) c.car = 'pebble.0.1.0.0.0.0.1.00000000';
    c.rider = cleanRiderCode(c.rider);
    this.members.set(c.id, { client: c, state: null, racing: false, ready: false, time: null, best: null, raceCar: c.car, drift: 0, uses: {} });
    if (!this.hostId) this.hostId = c.id;
    sendTo(c, { t: 'welcome', id: c.id });
    this.broadcastRoom();
    this.onChange(this);
  }

  remove(c: RaceClient) {
    if (!this.members.delete(c.id)) return;
    if (this.members.size === 0) {
      if (this.timer) clearInterval(this.timer);
      this.onEmpty(this);
      return;
    }
    if (this.hostId === c.id) this.hostId = this.members.keys().next().value!;
    this.broadcastRoom();
    this.onChange(this);
    if (this.phase === 'racing') this.maybeFinish();
    else if (this.phase === 'loading') this.loaded();
  }

  handle(c: RaceClient, msg: RaceClientMsg) {
    const m = this.members.get(c.id);
    if (!m || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'track':
        // Only a track the mode runs: hill-climb roads in a hill climb, the rest otherwise.
        if (c.id === this.hostId && this.phase === 'lobby' && Object.hasOwn(TRACK_DEFS, msg.track) && !!TRACK_DEFS[msg.track].climb === (this.mode === 'climb')) {
          this.track = msg.track;
          this.broadcastRoom();
          this.onChange(this);
        }
        break;
      case 'mode':
        if (c.id === this.hostId && this.phase === 'lobby' && Object.hasOwn(RACE_MODES, msg.mode) && msg.mode !== this.mode) {
          this.mode = msg.mode;
          // A time trial wants a lap to learn: switching to one puts its ring up (the host can still pick another).
          // A hill climb runs on its mountain; leaving one comes back down to the passes.
          if (msg.mode !== 'race' || !!TRACK_DEFS[this.track].climb) this.track = MODE_TRACK[msg.mode];
          this.broadcastRoom();
          this.onChange(this);
        }
        break;
      case 'cars':
        if (c.id === this.hostId && this.phase === 'lobby' && Object.hasOwn(CAR_RULES, msg.cars) && msg.cars !== this.cars) {
          this.cars = msg.cars;
          this.broadcastRoom();
        }
        break;
      case 'physics':
        if (c.id === this.hostId && this.phase === 'lobby' && typeof msg.on === 'boolean' && msg.on !== this.physics) {
          this.physics = msg.on;
          this.broadcastRoom();
          this.onChange(this);
        }
        break;
      case 'wreck': {
        // Relayed so everyone sees the fireball; a car blows up at most once a second.
        if (this.phase !== 'racing' || !this.physics || !m.racing || m.time !== null) return;
        if (!(Array.isArray(msg.p) && msg.p.length === 3 && msg.p.every((x) => finite(x, 1e5)))) return;
        const now = this.now();
        if (now - (this.wreckAt.get(c.id) ?? 0) < WRECK_GAP_MS) return;
        this.wreckAt.set(c.id, now);
        const text = JSON.stringify({ t: 'wreck', id: c.id, p: msg.p } satisfies RaceServerMsg);
        for (const o of this.members.values()) if (o !== m && o.client.ws.readyState === OPEN) o.client.ws.send(text);
        break;
      }
      case 'start':
        if (c.id === this.hostId && this.phase === 'lobby') this.startLoading();
        break;
      case 'ready': {
        if (!m.racing || m.ready) return;
        m.ready = true;
        if (this.phase === 'loading') {
          this.broadcastLoading();
          this.loaded();
        } else if (this.phase === 'countdown') sendTo(c, { t: 'countdown', ms: Math.max(0, this.phaseEnds - this.now()) });
        // Loaded after the timeout: start now (the server's clock has been running, so this costs them the wait).
        else if (this.phase === 'racing') sendTo(c, { t: 'go' });
        break;
      }
      case 'car':
        if ((this.phase === 'lobby' || this.phase === 'results') && decodeCar(msg.car)) {
          c.car = msg.car;
          this.broadcastRoom();
        }
        break;
      case 'rider':
        if (this.phase === 'lobby' || this.phase === 'results') {
          const rider = cleanRiderCode(msg.rider);
          if (rider === c.rider) break;
          c.rider = rider;
          this.broadcastRoom();
        }
        break;
      case 'state': {
        if (!m.racing || m.time !== null || (this.phase !== 'racing' && this.phase !== 'countdown' && this.phase !== 'loading')) return;
        const okVec = (a: unknown, n: number, lim: number) => Array.isArray(a) && a.length === n && a.every((x) => finite(x, lim));
        if (!okVec(msg.p, 3, 1e5) || !okVec(msg.q, 4, 2) || !okVec(msg.v, 3, 200) || !finite(msg.w, 50) || !finite(msg.s, 1e5) || !finite(msg.st, 2) || !finite(msg.ws, 1e3) || !finite(msg.rpm, 2e4) || !finite(msg.f, 1023)) return;
        m.state = { id: c.id, p: msg.p, q: msg.q, v: msg.v, w: msg.w, s: msg.s, st: msg.st, ws: msg.ws, rpm: msg.rpm, f: msg.f | 0 };
        if (this.physics && finite(msg.dm, 0xffff)) m.state.dm = msg.dm! & 0xffff;
        // Relay straight away (no waiting for a tick): every millisecond here is a millisecond of lag.
        const text = JSON.stringify({ t: 'snap', cars: [m.state] } satisfies RaceServerMsg);
        for (const o of this.members.values()) if (o !== m && o.client.ws.readyState === OPEN) o.client.ws.send(text);
        break;
      }
      case 'item': {
        // Relayed to everyone else; each client works out whether it was hit.
        // Ghosts can't touch each other, so a time trial or hill climb has no items at all.
        if (this.phase !== 'racing' || ghostMode(this.mode) || !m.racing || (msg.kind !== 'oil' && msg.kind !== 'shock' && msg.kind !== 'comet')) return;
        if (msg.kind === 'oil' && !(Array.isArray(msg.p) && msg.p.length === 3 && msg.p.every((x) => finite(x, 1e5)))) return;
        if (msg.kind === 'comet' && !(finite(msg.target, 1e6) && finite(msg.s, 1e5))) return;
        const now = this.now();
        if (now - (this.itemAt.get(c.id) ?? 0) < ITEM_GAP_MS) return;
        this.itemAt.set(c.id, now);
        this.countUse(m, msg.kind);
        const text = JSON.stringify({ t: 'item', by: c.id, kind: msg.kind, p: msg.kind === 'oil' ? msg.p : undefined, target: msg.kind === 'comet' ? msg.target : undefined, s: msg.kind === 'comet' ? msg.s : undefined } satisfies RaceServerMsg);
        for (const o of this.members.values()) if (o !== m && o.client.ws.readyState === OPEN) o.client.ws.send(text);
        break;
      }
      case 'used': {
        // Turbos and shields stay on the racer's own screen; they only count toward the item bonus.
        if (this.phase !== 'racing' || ghostMode(this.mode) || !m.racing || m.time !== null) return;
        if (msg.kind !== 'turbo' && msg.kind !== 'triple' && msg.kind !== 'shield') return;
        const now = this.now();
        if (now - (this.usedAt.get(c.id) ?? 0) < USE_GAP_MS) return;
        this.usedAt.set(c.id, now);
        this.countUse(m, msg.kind);
        break;
      }
      case 'drift': {
        // Client-scored, so the most it can be is what the fastest possible drifting would score since GO.
        if (this.phase !== 'racing' || !m.racing || m.time !== null) return;
        m.drift = Math.max(m.drift, clampDrift(msg.pts, (this.now() - this.goAt) / 1000));
        break;
      }
      case 'ping':
        if (finite(msg.n, 1e9)) sendTo(c, { t: 'pong', n: msg.n });
        break;
      case 'finish': {
        if (this.phase !== 'racing' || !m.racing || m.time !== null || !finite(msg.time, 1e4)) return;
        const elapsed = (this.now() - this.goAt) / 1000;
        if (elapsed < MIN_RACE_SECONDS) return;
        // Trust the client's own clock (it started on `go`) within a little latency either way.
        const time = msg.time >= elapsed - 2 && msg.time <= elapsed + 0.5 ? msg.time : elapsed;
        m.time = Math.round(time * 1000) / 1000;
        m.best = finite(msg.best, 1e4) && msg.best! > 0 && msg.best! <= m.time ? Math.round(msg.best! * 1000) / 1000 : null;
        if (!this.firstFinish) this.firstFinish = this.now();
        this.broadcast({ t: 'finished', id: c.id, time: m.time });
        this.maybeFinish();
        break;
      }
    }
  }

  /** Everyone in the room is in this race: send them off to build the track, and wait for each to be `ready`. */
  private startLoading() {
    this.phase = 'loading';
    this.phaseEnds = this.now() + RACE.loadTimeoutMs;
    this.firstFinish = 0;
    const grid: Record<number, number> = {};
    let slot = 0;
    for (const m of this.members.values()) {
      m.racing = true;
      m.ready = false;
      m.time = null;
      m.best = null;
      m.state = null;
      m.drift = 0;
      m.uses = {};
      grid[m.client.id] = slot++;
    }
    // Settle every racer's car for this race here, once, so a spec car's draw is the same for everyone.
    const rule: CarRule = ghostMode(this.mode) ? this.cars : 'own';
    const cars = raceCars(rule, [...this.members.values()].map((m) => ({ id: m.client.id, car: m.client.car })), this.rand());
    for (const m of this.members.values()) m.raceCar = cars[m.client.id];
    this.broadcast({ t: 'load', track: this.track, mode: this.mode, grid, timeoutMs: RACE.loadTimeoutMs, rule, cars, physics: this.physics });
    this.broadcastRoom();
    this.onChange(this);
  }

  /** While loading: once every racer still here is ready, count down. (The tick counts down anyway at the timeout.) */
  private loaded() {
    const field = [...this.members.values()].filter((m) => m.racing);
    if (!field.length) {
      // The whole field left before the start: back to the lobby for whoever's here now.
      this.phase = 'lobby';
      this.broadcastRoom();
      this.onChange(this);
    } else if (field.every((m) => m.ready)) this.startCountdown();
  }

  private startCountdown() {
    this.phase = 'countdown';
    this.phaseEnds = this.now() + RACE.countdownMs;
    // Stragglers still loading hear this too (their client holds it until it's built) and say `ready` when they are.
    this.broadcast({ t: 'countdown', ms: RACE.countdownMs });
    this.broadcastRoom();
  }

  private broadcastLoading() {
    const field = [...this.members.values()].filter((m) => m.racing);
    this.broadcast({ t: 'loading', ready: field.filter((m) => m.ready).map((m) => m.client.id), field: field.map((m) => m.client.id) });
  }

  /** Everyone still racing has finished (or left), or the DNF clock ran out: rank and pay. */
  private maybeFinish() {
    const out = [...this.members.values()].filter((m) => m.racing && m.time === null);
    const now = this.now();
    const dnfDue = this.firstFinish && now - this.firstFinish > RACE.dnfSeconds * 1000;
    const tooLong = now - this.goAt > RACE.maxSeconds * 1000;
    if (out.length && !dnfDue && !tooLong) return;
    const field = [...this.members.values()].filter((m) => m.racing);
    const done = field.filter((m) => m.time !== null).sort((a, b) => a.time! - b.time!);
    const dnf = field.filter((m) => m.time === null);
    const rows: ResultRow[] = [...done, ...dnf].map((m, i) => {
      const place = m.time === null ? 0 : i + 1;
      const bonus = raceBonus(m.drift, m.uses, this.track, false);
      const prize = payout(place, field.length, this.track, false) + bonus.drift + bonus.items;
      return { id: m.client.id, name: m.client.name, car: m.raceCar, time: m.time, best: m.best, place, prize, drift: m.drift, bonus };
    });
    this.phase = 'results';
    this.phaseEnds = now + RACE.resultsSeconds * 1000;
    for (const m of field) m.racing = false;
    this.broadcast({ t: 'results', track: this.track, mode: this.mode, rows });
    this.onResults(rows, new Set(field.filter((m) => m.client.user).map((m) => m.client.id)));
    this.onChange(this);
  }

  private countUse(m: Member, kind: Item) {
    if (m.time !== null) return;
    const total = Object.values(m.uses).reduce((a, n) => a + n, 0);
    if (total < ITEM_MAX_USES) m.uses[kind] = (m.uses[kind] ?? 0) + 1;
  }

  tick() {
    const now = this.now();
    if (now - this.lastBeat > HEARTBEAT_MS) {
      this.lastBeat = now;
      this.onChange(this);
    }
    if (this.phase === 'loading' && now >= this.phaseEnds) this.startCountdown();
    else if (this.phase === 'countdown' && now >= this.phaseEnds) {
      this.phase = 'racing';
      this.goAt = now;
      this.broadcast({ t: 'go' });
      this.broadcastRoom();
    } else if (this.phase === 'racing') this.maybeFinish();
    else if (this.phase === 'results' && now >= this.phaseEnds) {
      this.phase = 'lobby';
      this.broadcastRoom();
      this.onChange(this);
    }
  }

  private room(): RaceServerMsg {
    const racers: Racer[] = [...this.members.values()].map((m) => ({ id: m.client.id, name: m.client.name, car: m.client.car, rider: m.client.rider, user: m.client.user }));
    return { t: 'room', code: this.code, hostId: this.hostId, track: this.track, mode: this.mode, cars: this.cars, physics: this.physics, phase: this.phase, racers };
  }

  private broadcastRoom() {
    this.broadcast(this.room());
  }

  private broadcast(msg: RaceServerMsg) {
    const text = JSON.stringify(msg);
    for (const m of this.members.values()) if (m.client.ws.readyState === OPEN) m.client.ws.send(text);
  }
}
