import { decodeCar, encodeCar, newOwnedCar, raceCars, rivalCar } from '../shared/cars.ts';
import { clampDrift } from '../shared/drift.ts';
import { payout, raceBonus } from '../shared/garage.ts';
import { raceXp } from '../shared/pass.ts';
import { cleanRiderCode, decodeRider, defaultRider, encodeRider, rivalRider } from '../shared/rider.ts';
import { CUPS, addRound, isCup, roundsOf, type CupId } from '../shared/cups.ts';
import { CAR_RULES, CPU, MODE_TRACK, RACE, RACE_MODES, cleanMode, isGp, isTeam, modeTracks, type CarRule, type GpState, type NetCar, type RaceClientMsg, type RaceMode, type RacePhase, type RaceServerMsg, type Racer, type ResultRow, type Team } from '../shared/protocol.ts';
import { GhostRecorder, type GhostRun, type GhostTape } from '../shared/ghost.ts';
import { SAMPLE, TRACK_DEFS, getTrack, type TrackId } from '../shared/track.ts';
import { Royale } from '../shared/royale.ts';
import { guarded, type Socket } from '../../server/rooms.ts';

const OPEN = 1;
/** How often a live room re-announces itself to the directory. */
const HEARTBEAT_MS = 30_000;
/** No real descent is quicker than this; a faster "finish" is ignored. */
const MIN_RACE_SECONDS = 40;
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
  /** A CPU racer the host added (driven by the host's client; its `client.ws` is a dead socket). */
  cpu: boolean;
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
  /** This race's run, from the poses they send (ghost.ts): kept as the record ghost if it sets the record. */
  rec: GhostRecorder;
  /** In the lobby's garage, editing their car (shown to the others; cleared when a race starts). */
  pit: boolean;
  /** Red or Blue, for a Team Grand Prix (kept in every mode, so switching to one keeps everyone where they were). */
  team: Team;
}

export const sendTo = (c: RaceClient, msg: RaceServerMsg) => {
  if (c.ws.readyState === OPEN) c.ws.send(JSON.stringify(msg));
};

/** A CPU racer's socket: nothing is ever sent to it. */
const NO_SOCKET: Socket = { readyState: 3, send() {} };

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
  /** The track record's ghost races too (the host's toggle; never in a Grand Prix, whose track changes every round). */
  ghost = false;
  /**
   * A solo time trial (2026-11-10, Andrew: time trials "accessible when playing Solo ... so you are able to put times
   * on the Leaderboard"): a private room of one, always a time trial, that nobody else can join and the lobby list
   * hides. It's a room so the server still times the run (solo races keep no time). Set before the first `add`.
   */
  solo = false;
  /** A Grand Prix lobby's cup (the host's pick). */
  cup: CupId = 'torii';
  /** The Grand Prix under way: its round and cup table (null between cups). */
  gp: GpState | null = null;
  /** The last round's results are in. */
  private gpFinal = false;
  /** The record ghost for `ghostOf` (null: that track has none), fetched when the host wants it. */
  private ghostRun: GhostRun | null = null;
  private ghostOf: TrackId | null = null;
  /** Where record ghosts come from (the Accounts DO; tests pass their own). */
  ghostSource: ((track: TrackId) => Promise<GhostRun | null>) | null = null;
  phase: RacePhase = 'lobby';
  private phaseEnds = 0;
  private goAt = 0;
  private firstFinish = 0;
  private lastBeat = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** When each racer's car last blew up. */
  private wreckAt = new Map<number, number>();
  /** The next CPU racer's id (they count down from -1, so they never clash with a socket's). */
  private nextCpu = -1;
  /** A battle royale under way: who's out (royale.ts), stepped every tick from the racers' poses. */
  private royale: Royale | null = null;

  constructor(
    readonly code: string,
    private onChange: (r: Race) => void,
    private onEmpty: (r: Race) => void,
    /** Results are in: pay the signed-in racers. `tapes`: each finisher's run, for the record ghost. `mode`: which kind of race it was (only `recordMode` ones keep best times). */
    private onResults: (rows: ResultRow[], users: Set<number>, track: TrackId, tapes: Map<number, GhostTape>, mode: RaceMode) => void,
    private now: () => number = Date.now,
    tick = true,
  ) {
    if (tick) this.timer = setInterval(() => guarded(() => this.tick(), `race ${code}`), 1000 / RACE.snapshotHz);
  }

  get hostName() {
    return this.members.get(this.hostId)?.client.name ?? '?';
  }

  /** No seat for another person (CPU racers give theirs up: see add()). */
  get full() {
    return this.humans >= (this.solo ? 1 : RACE.maxPlayers);
  }

  /** Makes this a solo time trial (see `solo`). */
  makeSolo() {
    this.solo = true;
    this.mode = 'trial';
    this.track = MODE_TRACK.trial;
  }

  /** The people in the room (not CPU racers). */
  get humans() {
    let n = 0;
    for (const m of this.members.values()) if (!m.cpu) n++;
    return n;
  }

  private get cpus() {
    return [...this.members.values()].filter((m) => m.cpu);
  }

  /** The host adds a CPU racer: a car near theirs, a driver of its own, a solo rival's name. */
  private addCpu() {
    if (this.members.size >= RACE.maxPlayers) return;
    const host = this.members.get(this.hostId)?.client;
    if (!host) return;
    const taken = new Set(this.cpus.map((m) => m.client.name));
    const i = Math.max(0, CPU.names.findIndex((n) => !taken.has(n)));
    const id = this.nextCpu--;
    const car = encodeCar(rivalCar(decodeCar(host.car) ?? newOwnedCar('pebble'), i));
    // A driver of its own (one the host isn't using), like a solo race's rivals.
    const rider = encodeRider(rivalRider(decodeRider(host.rider) ?? defaultRider(), i));
    const client: RaceClient = { id, ws: NO_SOCKET, name: CPU.names[i], car, rider, user: false };
    this.members.set(id, { client, cpu: true, state: null, racing: false, ready: false, time: null, best: null, raceCar: car, drift: 0, rec: new GhostRecorder(), pit: false, team: this.smallerTeam() });
  }

  /** The team with fewer racers on it (Red when they're even): where a newcomer goes. */
  private smallerTeam(): Team {
    let red = 0;
    let blue = 0;
    for (const m of this.members.values()) m.team === 0 ? red++ : blue++;
    return blue < red ? 1 : 0;
  }

  /** Splits everyone evenly between the teams, alternating in the order they joined (the host on Red). */
  private balanceTeams() {
    let i = 0;
    for (const m of this.members.values()) m.team = (i++ % 2) as Team;
  }

  /** Too many on the grid (someone joined, or it's time to start): the newest CPU racers make room. */
  private trimCpus() {
    const cpus = this.cpus;
    while (this.members.size > RACE.maxPlayers && cpus.length) this.members.delete(cpus.pop()!.client.id);
  }

  /** CPU racers whose host just left mid-race go with them (nobody else is driving them). */
  private dropCpus() {
    for (const m of this.cpus) this.members.delete(m.client.id);
  }

  add(c: RaceClient) {
    if (!decodeCar(c.car)) c.car = 'pebble.0.1.0.0.0.0.1.00000000';
    c.rider = cleanRiderCode(c.rider);
    this.members.set(c.id, { client: c, cpu: false, state: null, racing: false, ready: false, time: null, best: null, raceCar: c.car, drift: 0, rec: new GhostRecorder(), pit: false, team: this.smallerTeam() });
    if (!this.hostId) this.hostId = c.id;
    // A full grid with CPU racers on it: one gives up its seat (in a race, they make room at the next start).
    if (this.phase === 'lobby' || this.phase === 'results') this.trimCpus();
    sendTo(c, { t: 'welcome', id: c.id });
    this.broadcastRoom();
    this.onChange(this);
  }

  remove(c: RaceClient) {
    const gone = this.members.get(c.id);
    if (!gone || gone.cpu || !this.members.delete(c.id)) return;
    if (this.humans === 0) {
      this.members.clear();
      if (this.timer) clearInterval(this.timer);
      this.onEmpty(this);
      return;
    }
    if (this.hostId === c.id) {
      this.hostId = [...this.members.values()].find((m) => !m.cpu)!.client.id;
      // The host's client was driving the CPU racers: in a race they stop with it, so they leave too.
      if (this.phase !== 'lobby' && this.phase !== 'results') this.dropCpus();
    }
    this.broadcastRoom();
    this.onChange(this);
    if (this.phase === 'racing') this.maybeFinish();
    else if (this.phase === 'loading') this.loaded();
  }

  handle(c: RaceClient, msg: RaceClientMsg) {
    const m = this.members.get(c.id);
    if (!m || m.cpu || !msg || typeof msg !== 'object') return;
    const host = c.id === this.hostId;
    // A solo time trial stays one: no CPU racers, no other mode, no cup.
    if (this.solo && (msg.t === 'cpu' || msg.t === 'mode' || msg.t === 'cup')) return;
    switch (msg.t) {
      case 'cpu':
        // Free roam has no CPU racers (there's nothing to race).
        if (!host || this.phase !== 'lobby' || this.mode === 'roam') return;
        if (msg.op === 'add') this.addCpu();
        else if (msg.op === 'remove' && this.members.get(msg.id)?.cpu) this.members.delete(msg.id);
        else return;
        this.broadcastRoom();
        this.onChange(this);
        break;
      case 'cpus': {
        if (!host || !Array.isArray(msg.cars) || msg.cars.length > RACE.maxPlayers) return;
        if (this.phase !== 'racing' && this.phase !== 'countdown' && this.phase !== 'loading') return;
        const cars: NetCar[] = [];
        for (const s of msg.cars) {
          const bot = s && typeof s === 'object' ? this.members.get(s.id) : undefined;
          if (!bot?.cpu || !bot.racing || bot.time !== null || this.isOut(bot)) continue;
          const st = this.pose(bot, s);
          if (st) cars.push(st);
        }
        if (cars.length) this.relay({ t: 'snap', cars }, c.id);
        break;
      }
      case 'cpufinish': {
        const bot = host ? this.members.get(msg.id) : undefined;
        if (bot?.cpu) this.crossLine(bot, msg.time, undefined);
        break;
      }
      case 'cpuwreck': {
        const bot = host ? this.members.get(msg.id) : undefined;
        if (bot?.cpu) this.wrecked(bot, msg.p, c.id);
        break;
      }
      case 'track':
        // Only a track the mode runs: hill-climb roads in a hill climb, the open world in free roam, the rest otherwise.
        // A Grand Prix runs its cup's.
        if (c.id === this.hostId && this.phase === 'lobby' && !isGp(this.mode) && Object.hasOwn(TRACK_DEFS, msg.track) && modeTracks(this.mode).includes(msg.track)) {
          this.track = msg.track;
          this.broadcastRoom();
          this.onChange(this);
          this.fetchGhost();
        }
        break;
      case 'mode':
        if (c.id === this.hostId && this.phase === 'lobby' && Object.hasOwn(RACE_MODES, msg.mode) && msg.mode !== this.mode) {
          this.mode = msg.mode;
          this.gp = null;
          // A time trial wants a lap to learn: switching to one puts its ring up (the host can still pick another).
          // A hill climb runs on its mountain; leaving one comes back down to the passes. A Grand Prix shows its cup's first round.
          // Free roam drives the open world, and leaving it comes back to the passes.
          if (isGp(msg.mode)) this.track = CUPS[this.cup].tracks[0];
          else if (msg.mode !== 'race' || !modeTracks('race').includes(this.track)) this.track = MODE_TRACK[msg.mode];
          if (msg.mode === 'roam') for (const bot of this.cpus) this.members.delete(bot.client.id);
          // A Team Grand Prix starts with the grid split evenly; racers can swap before the cup starts.
          if (msg.mode === 'team') this.balanceTeams();
          this.broadcastRoom();
          this.onChange(this);
          this.fetchGhost();
        }
        break;
      case 'cup':
        if (c.id === this.hostId && this.phase === 'lobby' && isGp(this.mode) && isCup(msg.cup) && msg.cup !== this.cup) {
          this.cup = msg.cup;
          this.track = CUPS[msg.cup].tracks[0];
          this.gp = null;
          this.broadcastRoom();
          this.onChange(this);
        }
        break;
      case 'team': {
        // A Team Grand Prix lobby, between cups: join a team yourself, or (the host) move one of your CPU racers.
        if (this.mode !== 'team' || this.phase !== 'lobby' || this.gp || !isTeam(msg.team)) return;
        const who = msg.id === undefined ? m : host && this.members.get(msg.id)?.cpu ? this.members.get(msg.id)! : null;
        if (!who || who.team === msg.team) return;
        who.team = msg.team;
        this.broadcastRoom();
        break;
      }
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
      case 'ghost':
        if (c.id === this.hostId && this.phase === 'lobby' && typeof msg.on === 'boolean' && msg.on !== this.ghost) {
          this.ghost = msg.on;
          this.broadcastRoom();
          this.fetchGhost();
        }
        break;
      case 'wreck':
        this.wrecked(m, msg.p, c.id);
        break;
      case 'start':
        // From the lobby, straight from the results (Race again: the same track and settings, no wait), or mid-race
        // from the host's pause menu (Restart: the race is dropped unpaid and everyone goes back to the start). A Grand
        // Prix goes on to its next round from the lobby or the results (or the cup again after the last); a restart
        // reruns the same round.
        if (c.id === this.hostId && this.phase !== 'loading') {
          if (isGp(this.mode) && (this.phase === 'lobby' || this.phase === 'results')) this.nextRound();
          this.startLoading();
        }
        break;
      case 'end':
        if (c.id === this.hostId && this.mode === 'roam' && this.phase !== 'lobby' && this.phase !== 'results') this.endRoam();
        break;
      case 'joinin':
        if (this.mode === 'roam' && (this.phase === 'racing' || this.phase === 'countdown') && !m.racing) this.driveIn(m);
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
      case 'pit':
        if ((this.phase === 'lobby' || this.phase === 'results' || !m.racing) && typeof msg.on === 'boolean' && msg.on !== m.pit) {
          m.pit = msg.on;
          this.broadcastRoom();
        }
        break;
      case 'state': {
        if (!m.racing || m.time !== null || this.isOut(m) || (this.phase !== 'racing' && this.phase !== 'countdown' && this.phase !== 'loading')) return;
        const st = this.pose(m, { ...msg, id: c.id });
        // Relay straight away (no waiting for a tick): every millisecond here is a millisecond of lag.
        if (st) this.relay({ t: 'snap', cars: [st] }, c.id);
        break;
      }
      case 'drift': {
        // Client-scored, so the most it can be is what the fastest possible drifting would score since GO.
        if (this.phase !== 'racing' || !m.racing || m.time !== null || this.isOut(m)) return;
        m.drift = Math.max(m.drift, clampDrift(msg.pts, (this.now() - this.goAt) / 1000));
        break;
      }
      case 'ping':
        if (finite(msg.n, 1e9)) sendTo(c, { t: 'pong', n: msg.n });
        break;
      case 'finish':
        this.crossLine(m, msg.time, msg.best);
        break;
    }
  }

  /** A checked pose for racer `m` (null if anything's off), kept as their latest. */
  private pose(m: Member, msg: Omit<NetCar, 'id'> & { id: number }): NetCar | null {
    const okVec = (a: unknown, n: number, lim: number) => Array.isArray(a) && a.length === n && a.every((x) => finite(x, lim));
    if (!okVec(msg.p, 3, 1e5) || !okVec(msg.q, 4, 2) || !okVec(msg.v, 3, 200) || !finite(msg.w, 50) || !finite(msg.s, 1e5) || !finite(msg.st, 2) || !finite(msg.ws, 1e3) || !finite(msg.rpm, 2e4) || !finite(msg.f, 1023)) return null;
    m.state = { id: m.client.id, p: msg.p, q: msg.q, v: msg.v, w: msg.w, s: msg.s, st: msg.st, ws: msg.ws, rpm: msg.rpm, f: msg.f | 0 };
    if (this.physics && finite(msg.dm, 0xffff)) m.state.dm = msg.dm! & 0xffff;
    if (this.phase === 'racing') m.rec.add((this.now() - this.goAt) / 1000, msg.p, msg.q);
    return m.state;
  }


  /** Racer `m`'s car blew up at `p`: relayed so everyone sees the fireball (at most once a second per car). */
  private wrecked(m: Member, p: unknown, from: number) {
    if (this.phase !== 'racing' || !this.physics || !m.racing || m.time !== null || this.isOut(m)) return;
    if (!(Array.isArray(p) && p.length === 3 && p.every((x) => finite(x, 1e5)))) return;
    const id = m.client.id;
    const now = this.now();
    if (now - (this.wreckAt.get(id) ?? 0) < WRECK_GAP_MS) return;
    this.wreckAt.set(id, now);
    this.relay({ t: 'wreck', id, p: p as [number, number, number] }, from);
  }

  /** Racer `m` crossed the line at `time` by their client's clock. */
  private crossLine(m: Member, time: unknown, best: unknown) {
    if (this.phase !== 'racing' || !m.racing || m.time !== null || this.isOut(m) || !finite(time, 1e4)) return;
    const elapsed = (this.now() - this.goAt) / 1000;
    if (elapsed < MIN_RACE_SECONDS) return;
    // Trust the client's own clock (it started on `go`) within a little latency either way.
    const t = (time as number) >= elapsed - 2 && (time as number) <= elapsed + 0.5 ? (time as number) : elapsed;
    m.time = Math.round(t * 1000) / 1000;
    m.best = finite(best, 1e4) && (best as number) > 0 && (best as number) <= m.time ? Math.round((best as number) * 1000) / 1000 : null;
    if (!this.firstFinish) this.firstFinish = this.now();
    this.broadcast({ t: 'finished', id: m.client.id, time: m.time });
    this.maybeFinish();
  }

  /** To every socket but `from`'s (the sender already has it on screen). */
  private relay(msg: RaceServerMsg, from: number) {
    const text = JSON.stringify(msg);
    for (const o of this.members.values()) if (o.client.id !== from && o.client.ws.readyState === OPEN) o.client.ws.send(text);
  }

  /** Everyone in the room is in this race: send them off to build the track, and wait for each to be `ready`. */
  private startLoading() {
    this.trimCpus();
    this.phase = 'loading';
    this.phaseEnds = this.now() + RACE.loadTimeoutMs;
    this.firstFinish = 0;
    this.royale = null;
    const grid: Record<number, number> = {};
    let slot = 0;
    for (const m of this.members.values()) {
      m.racing = true;
      // CPU racers are ready when their host is (the host's client builds them with the track).
      m.ready = m.cpu;
      m.time = null;
      m.best = null;
      m.state = null;
      m.drift = 0;
      m.rec = new GhostRecorder();
      m.pit = false;
      grid[m.client.id] = slot++;
    }
    // Settle every racer's car for this race here, once, so every client draws the same cars.
    const rule: CarRule = cleanMode(this.mode) ? this.cars : 'own';
    const cars = raceCars(rule, [...this.members.values()].map((m) => ({ id: m.client.id, car: m.client.car })));
    for (const m of this.members.values()) m.raceCar = cars[m.client.id];
    const ghost = this.ghost && !isGp(this.mode) && this.mode !== 'roam' && this.mode !== 'royale' && this.ghostOf === this.track ? this.ghostRun : null;
    this.broadcast({ t: 'load', track: this.track, mode: this.mode, grid, timeoutMs: RACE.loadTimeoutMs, rule, cars, physics: this.physics, ghost, ...(this.gp ? { gp: this.gp } : {}) });
    this.broadcastRoom();
    this.onChange(this);
  }

  /** While loading: once every racer still here is ready, count down. (The tick counts down anyway at the timeout.) */
  private loaded() {
    const field = [...this.members.values()].filter((m) => m.racing);
    if (!field.some((m) => !m.cpu)) {
      // The whole field left before the start: back to the lobby for whoever's here now (any cup is off).
      this.phase = 'lobby';
      this.gp = null;
      this.broadcastRoom();
      this.onChange(this);
    } else if (field.every((m) => m.ready)) this.startCountdown();
  }

  private startCountdown() {
    // Free roam has nothing to count down to: everyone's away at the next tick.
    const ms = this.mode === 'roam' ? 0 : RACE.countdownMs;
    this.phase = 'countdown';
    this.phaseEnds = this.now() + ms;
    // Stragglers still loading hear this too (their client holds it until it's built) and say `ready` when they are.
    this.broadcast({ t: 'countdown', ms });
    this.broadcastRoom();
  }

  private broadcastLoading() {
    const field = [...this.members.values()].filter((m) => m.racing);
    this.broadcast({ t: 'loading', ready: field.filter((m) => m.ready).map((m) => m.client.id), field: field.map((m) => m.client.id) });
  }

  /** Everyone still racing has finished (or left), or the DNF clock ran out: rank and pay. */
  private maybeFinish() {
    // Free roam never finishes by itself: it runs until the host ends it (or everyone's gone).
    if (this.mode === 'roam') return;
    if (this.royale) return this.maybeRoyaleOver(this.royale);
    // The race is over when every person is home: CPU racers still out are a DNF, like a solo race's stragglers.
    const out = [...this.members.values()].filter((m) => m.racing && !m.cpu && m.time === null);
    const now = this.now();
    const dnfDue = this.firstFinish && now - this.firstFinish > RACE.dnfSeconds * 1000;
    const tooLong = now - this.goAt > RACE.maxSeconds * 1000;
    if (out.length && !dnfDue && !tooLong) return;
    const field = [...this.members.values()].filter((m) => m.racing);
    const done = field.filter((m) => m.time !== null).sort((a, b) => a.time! - b.time!);
    // A Grand Prix: CPU racers still out when the people are home are placed by how far they got (like a solo race's
    // AI), so they score on the cup table; anyone else still out is a DNF.
    const still = field.filter((m) => m.time === null);
    const placed = isGp(this.mode) ? still.filter((m) => m.cpu).sort((a, b) => (b.state?.s ?? 0) - (a.state?.s ?? 0)) : [];
    const dnf = [...placed, ...still.filter((m) => !placed.includes(m))];
    // CPU racers pay like a solo race's rivals (a solo share for beating them), but never less than the people
    // in the race would earn among themselves; the CPUs themselves are never paid.
    const people = field.filter((m) => !m.cpu).length;
    const cpus = field.length - people;
    const peopleDone = done.filter((m) => !m.cpu);
    const rows: ResultRow[] = [...done, ...dnf].map((m, i) => {
      const place = m.time === null && !placed.includes(m) ? 0 : i + 1;
      if (m.cpu) return { id: m.client.id, name: m.client.name, car: m.raceCar, time: m.time, best: m.best, place, prize: 0, drift: 0, bonus: { drift: 0 }, cpu: true, xp: 0 };
      const bonus = raceBonus(m.drift, this.track, false);
      const among = m.time === null ? 0 : peopleDone.indexOf(m) + 1;
      const base = cpus ? Math.max(payout(among, people, this.track, false), payout(place, field.length, this.track, true)) : payout(place, field.length, this.track, false);
      const prize = base + bonus.drift;
      return { id: m.client.id, name: m.client.name, car: m.raceCar, time: m.time, best: m.best, place, prize, drift: m.drift, bonus, xp: raceXp(place, field.length, m.drift, false) };
    });
    this.phase = 'results';
    this.phaseEnds = now + RACE.resultsSeconds * 1000;
    for (const m of field) m.racing = false;
    // A Grand Prix round: points onto the cup table, then the next round loads by itself (or the host goes sooner).
    let gp: Extract<RaceServerMsg, { t: 'results' }>['gp'];
    if (isGp(this.mode) && this.gp) {
      // A Team Grand Prix: each racer's points also count for their team (cups.ts teamTable).
      const team = (id: number) => (this.mode === 'team' ? this.members.get(id)?.team : undefined);
      this.gp.table = addRound(this.gp.table, this.gp.round, rows.map((r) => ({ key: String(r.id), name: r.name, place: r.place, cpu: r.cpu, team: team(r.id) })));
      this.gpFinal = this.gp.round >= roundsOf(this.gp.cup) - 1;
      const wait = (this.gpFinal ? RACE.cupResultsSeconds : RACE.gpResultsSeconds) * 1000;
      this.phaseEnds = now + wait;
      gp = { ...this.gp, final: this.gpFinal, next: this.gpFinal ? 0 : wait };
    }
    this.broadcast({ t: 'results', track: this.track, mode: this.mode, rows, ...(gp ? { gp } : {}) });
    const tapes = new Map<number, GhostTape>(done.map((m) => [m.client.id, { car: m.raceCar, rider: m.client.rider, d: m.rec.d }]));
    this.onResults(rows, new Set(field.filter((m) => m.client.user).map((m) => m.client.id)), this.track, tapes, this.mode);
    this.onChange(this);
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
      if (this.mode === 'royale') {
        const t = getTrack(this.track);
        this.royale = new Royale(t.startS, t.lap * SAMPLE);
      }
      this.broadcast({ t: 'go' });
      this.broadcastRoom();
    } else if (this.phase === 'racing') {
      if (this.royale) this.stepRoyale(this.royale);
      this.maybeFinish();
    }
    else if (this.phase === 'results' && now >= this.phaseEnds) {
      // A Grand Prix rolls on to its next round with whoever's in the room.
      if (isGp(this.mode) && this.gp && !this.gpFinal) {
        this.nextRound();
        this.startLoading();
        return;
      }
      this.gp = null;
      this.phase = 'lobby';
      this.broadcastRoom();
      this.onChange(this);
      // The race may have set a new record: race that one next.
      this.fetchGhost();
    }
  }

  /** A battle royale: knocked out (their car is gone; they watch the rest). */
  private isOut(m: Member) {
    return !!this.royale?.out.has(m.client.id);
  }

  /**
   * A battle royale's tick: everyone still in, by how far their last pose says they've raced (racers who left are no
   * longer in it), through the elimination rules. Each car knocked out is told to the room.
   */
  private stepRoyale(r: Royale) {
    const progress = new Map<number, number>();
    for (const m of this.members.values()) if (m.racing && m.time === null && !r.out.has(m.client.id)) progress.set(m.client.id, m.state?.s ?? 0);
    const elapsed = (this.now() - this.goAt) / 1000;
    for (const k of r.step(progress, elapsed)) this.broadcast({ t: 'out', id: k.id, lap: k.lap, place: k.place, left: k.place - 1 });
    const win = r.winner !== null ? this.members.get(r.winner) : undefined;
    if (win && win.time === null) win.time = Math.round(elapsed * 1000) / 1000;
  }

  /**
   * A battle royale is over when one car is left (or one went the whole distance, or the race ran too long, or nobody's
   * left in it). Places: the winner, anyone still in by distance, then the knocked out in the order they'd finish.
   */
  private maybeRoyaleOver(r: Royale) {
    const field = [...this.members.values()].filter((m) => m.racing);
    const alive = field.filter((m) => !r.out.has(m.client.id));
    const tooLong = this.now() - this.goAt > RACE.maxSeconds * 1000;
    // (A lone racer has no one to outlast: they just drive the distance.)
    if (alive.length > 1 && !tooLong && !alive.some((m) => m.time !== null)) return;
    if (alive.length === 1 && r.out.size === 0 && alive[0].time === null && !tooLong) return;
    const standing = alive.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || (b.state?.s ?? 0) - (a.state?.s ?? 0));
    const gone = field.filter((m) => r.out.has(m.client.id)).sort((a, b) => r.out.get(a.client.id)!.place - r.out.get(b.client.id)!.place);
    const order = [...standing, ...gone];
    const people = field.filter((m) => !m.cpu);
    const cpus = field.length - people.length;
    const rows: ResultRow[] = order.map((m, i) => {
      const place = i + 1;
      const out = r.out.get(m.client.id)?.lap;
      const base = { id: m.client.id, name: m.client.name, car: m.raceCar, time: m.time, best: null, place, ...(out ? { out } : {}) };
      if (m.cpu) return { ...base, prize: 0, drift: 0, bonus: { drift: 0 }, cpu: true, xp: 0 };
      // Paid like a race (CPU racers like a solo race's rivals, never less than the people alone would earn).
      const bonus = raceBonus(m.drift, this.track, false);
      const among = order.filter((o) => !o.cpu).indexOf(m) + 1;
      const prize = (cpus ? Math.max(payout(among, people.length, this.track, false), payout(place, field.length, this.track, true)) : payout(place, field.length, this.track, false)) + bonus.drift;
      return { ...base, prize, drift: m.drift, bonus, xp: raceXp(place, field.length, m.drift, false) };
    });
    this.royale = null;
    this.phase = 'results';
    this.phaseEnds = this.now() + RACE.resultsSeconds * 1000;
    for (const m of field) m.racing = false;
    this.broadcast({ t: 'results', track: this.track, mode: this.mode, rows });
    this.onResults(rows, new Set(field.filter((m) => m.client.user).map((m) => m.client.id)), this.track, new Map(), this.mode);
    this.onChange(this);
  }

  /** Free roam: someone who joined while it's on (or came back from the lobby) drives in from the meet's next slot. */
  private driveIn(m: Member) {
    const field = [...this.members.values()].filter((o) => o.racing);
    const grid: Record<number, number> = {};
    const cars: Record<number, string> = {};
    field.forEach((o, k) => {
      grid[o.client.id] = k;
      cars[o.client.id] = o.raceCar;
    });
    m.racing = true;
    m.ready = false;
    m.time = null;
    m.state = null;
    m.pit = false;
    m.raceCar = m.client.car;
    grid[m.client.id] = field.length;
    cars[m.client.id] = m.raceCar;
    sendTo(m.client, { t: 'load', track: this.track, mode: this.mode, grid, timeoutMs: RACE.loadTimeoutMs, rule: 'own', cars, physics: this.physics, ghost: null });
    // The others add their car from the roster.
    this.broadcastRoom();
  }

  /** The host ends free roam: everyone back to the lobby. */
  private endRoam() {
    for (const m of this.members.values()) m.racing = false;
    this.phase = 'lobby';
    this.broadcastRoom();
    this.onChange(this);
  }

  /** Grand Prix: the next round of the cup under way, or a fresh cup from round 1 (from the lobby, or after the last round). */
  private nextRound() {
    if (this.gp && !this.gpFinal && this.gp.cup === this.cup) this.gp.round++;
    else this.gp = { cup: this.cup, round: 0, table: [] };
    this.gpFinal = false;
    this.track = CUPS[this.cup].tracks[this.gp.round];
  }

  /** The roster as everyone sees it. */
  room(): Extract<RaceServerMsg, { t: 'room' }> {
    const racers: Racer[] = [...this.members.values()].map((m) => ({ id: m.client.id, name: m.client.name, car: m.client.car, rider: m.client.rider, user: m.client.user, ...(m.cpu ? { cpu: true } : {}), ...(m.pit ? { pit: true } : {}), ...(m.racing && this.mode === 'roam' ? { roaming: true } : {}), ...(this.mode === 'team' ? { team: m.team } : {}) }));
    const record = this.ghostOf === this.track && this.ghostRun ? { name: this.ghostRun.name, time: this.ghostRun.time } : null;
    return { t: 'room', code: this.code, hostId: this.hostId, track: this.track, mode: this.mode, cars: this.cars, physics: this.physics, ghost: this.ghost, record, phase: this.phase, racers, cup: this.cup, gp: isGp(this.mode) ? this.gp : null, ...(this.solo ? { solo: true as const } : {}) };
  }

  /** The host wants the record ghost: fetch the current track's (the lobby shows whose it is, or that there's none). */
  private fetchGhost() {
    if (!this.ghost || !this.ghostSource) return;
    const track = this.track;
    this.ghostSource(track).then(
      (run) => {
        if (this.track !== track) return;
        this.ghostRun = run;
        this.ghostOf = track;
        this.broadcastRoom();
      },
      () => {},
    );
  }

  /** Tells the room something the platform worked out after the fact (new best times). */
  announce(msg: RaceServerMsg) {
    this.broadcast(msg);
  }

  private broadcastRoom() {
    this.broadcast(this.room());
  }

  private broadcast(msg: RaceServerMsg) {
    const text = JSON.stringify(msg);
    for (const m of this.members.values()) if (m.client.ws.readyState === OPEN) m.client.ws.send(text);
  }
}
