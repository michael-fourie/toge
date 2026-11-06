// Race lobby wire types (JSON). A race room is its own Durable Object (toge/server/raceroom.ts); the shooter's
// protocol is untouched.
//
// Flow: everyone sits in the lobby → the host picks a track and starts → `load` (grid slots): every racer builds
// the track and says `ready` (`loading` tells the room who has) → once all are ready, or after RACE.loadTimeoutMs,
// `countdown` (the same 3-2-1 on every screen) → `go` → clients drive (client-authoritative, like the shooter) and send `state` at 20 Hz → each sends `finish`
// with its time (and `drift` / `used` along the way for the bonus) → `results` (places, prize money) → back to the lobby.

import { TRACK_DEFS, type TrackId } from './track.ts';
import type { GhostRun } from './ghost.ts';

/** One signed-in racer's new best in `records` (NewBest in records.ts, keyed by racer id). */
export interface RecordRow {
  id: number;
  time: number;
  prev: number | null;
  rank: number | null;
  beat: { name: string; time: number } | null;
}

export type RacePhase = 'lobby' | 'loading' | 'countdown' | 'racing' | 'results';

/**
 * What the host is running: a `race` (cars bump, items fly), a `trial` (time trial: everyone laps the same
 * road at once, but the other cars are see-through ghosts you drive straight through, and there are no items)
 * or a `climb` (hill climb: one run up a hill-climb road (`climb` on its TrackDef), solid cars you can bump and
 * draft, no items, rockfall on the road; first to the summit wins).
 */
export type RaceMode = 'race' | 'trial' | 'climb';
export const RACE_MODES: Record<RaceMode, { name: string; blurb: string }> = {
  race: { name: 'Race', blurb: 'Bump, block and throw items. First to the line wins.' },
  trial: { name: 'Time trial', blurb: 'Ghost cars, no contact, no items. Fastest clean time wins.' },
  climb: { name: 'Hill climb', blurb: 'One run up the mountain past boulders and broken tarmac. No items. First to the summit wins.' },
};

/** Modes where the other racers are ghosts you drive straight through (no contact, no slipstream): the time trial. */
export const ghostMode = (m: RaceMode) => m === 'trial';

/** Modes with no items (boxes, throws or item money), where the host picks a car rule: everything but a race. */
export const cleanMode = (m: RaceMode) => m !== 'race';

/**
 * Modes whose finishes count as best times, on the all-time boards and for the record ghost: the item-free ones (a
 * time trial, and a hill climb on its own roads). A race's items make its times unbeatable in a trial, and a solo
 * run is always a race, so neither counts.
 */
export const recordMode = (m: RaceMode) => cleanMode(m);

/** The tracks a mode can run: a hill climb only on hill-climb roads, everything else only off them. */
export const modeTracks = (m: RaceMode): TrackId[] => (Object.keys(TRACK_DEFS) as TrackId[]).filter((id) => !!TRACK_DEFS[id].climb === (m === 'climb'));

/** The track a mode starts on when the host switches to it (they can still pick another the mode allows). */
export const MODE_TRACK: Record<RaceMode, TrackId> = { race: 'koripass', trial: 'kodama', climb: 'karasu' };

/**
 * What the racers drive in a time trial (the host picks; a race always uses everyone's own car):
 * `own` their own car, `vanta` everyone in a Vanta V10 with every part at the top level (default tuning, so
 * identical stats; each keeps their own paint), `maxed` their own car with every part at the top level.
 */
export type CarRule = 'own' | 'vanta' | 'maxed';
export const CAR_RULES: Record<CarRule, { name: string; blurb: string }> = {
  own: { name: 'Own cars', blurb: 'Everyone drives their own car as it is.' },
  vanta: { name: 'Maxed Vanta', blurb: 'Everyone drives a Vanta V10 with every part at level 5. Same stats, your paint.' },
  maxed: { name: 'Maxed out', blurb: 'Your own car with every part at level 5.' },
};

/**
 * Physics mode (damage.ts), a switch the host flips in the lobby (a solo race has its own): realistic crash
 * damage. Hard knocks against cars and walls dent the car and hurt how it drives; too much and it blows up and
 * respawns a few metres back. Works in either mode (in a time trial only the walls can hurt you).
 */
/** The lobby's record ghost toggle (the host's pick). */
export const RECORD_GHOST = {
  name: 'Record ghost',
  off: { name: 'Off', blurb: 'Just the racers in the room.' },
  on: { name: 'Race the record', blurb: "The track record's run rides along as a see-through ghost. Beat it to take the record." },
};

export const PHYSICS = {
  name: 'Physics',
  off: { name: 'Off', blurb: 'Cars bounce off each other and the rails. No damage.' },
  on: { name: 'Crash damage', blurb: 'Hard hits dent your car and cost power and steering. Wreck it and it blows up.' },
};

export interface Racer {
  id: number;
  name: string;
  /** encodeCar(): model, paint, rims... and upgrade levels. */
  car: string;
  /** encodeRider(): the racer's driver, shown with the crew in the lobby. */
  rider: string;
  /** Signed in: prize money goes to the account's garage on the server. */
  user: boolean;
  /** A CPU racer the host added: the host's client drives it (see CPU below). */
  cpu?: boolean;
  /** In the lobby's garage, editing their car (sent only while true). */
  pit?: boolean;
}

/** A car's pose as relayed between clients. */
export interface NetCar {
  id: number;
  p: [number, number, number];
  q: [number, number, number, number];
  v: [number, number, number];
  /** Yaw rate (rad/s, + = turning left), so receivers can predict the car forward. */
  w: number;
  /** Distance along the road (for positions). */
  s: number;
  /** Front wheel angle (rad), wheel spin (rad/s), engine rpm. */
  st: number;
  ws: number;
  rpm: number;
  /** CarFlag bits. */
  f: number;
  /** Physics mode: how bent each side of the car is (damage.ts packZones). */
  dm?: number;
}

/** Bits of NetCar.f. The drift's spark level (0-3) rides in the top two bits. */
export const CarFlag = { Brake: 1, Reverse: 2, Skid: 4, Offroad: 8, Drift: 16, Boost: 32, LevelShift: 6, Shield: 256 } as const;

export interface ResultRow {
  id: number;
  name: string;
  car: string;
  /** Finish time (s), or null for a DNF. */
  time: number | null;
  /** Quickest lap (s) on a circuit, as the racer's client timed it. */
  best?: number | null;
  place: number;
  /** Everything paid: the place prize plus `bonus`. */
  prize: number;
  /** Drift points banked (clamped to the race clock by the server). */
  drift: number;
  /** The part of `prize` earned by drifting and by using items. */
  bonus: { drift: number; items: number };
  /** A CPU racer (never paid). */
  cpu?: boolean;
  /** Battle pass XP the race earned (pass.ts `raceXp`; 0 for CPU racers). */
  xp: number;
}

export interface RaceLobbyInfo {
  code: string;
  host: string;
  track: TrackId;
  mode: RaceMode;
  /** Physics mode (crash damage) is on. */
  physics?: boolean;
  phase: RacePhase;
  players: number;
  max: number;
}

export type RaceServerMsg =
  | { t: 'welcome'; id: number }
  /**
   * `ghost`: the host turned the record ghost on. `record`: whose run it would be on this track (null: none kept, or
   * not fetched yet).
   */
  | { t: 'room'; code: string; hostId: number; track: TrackId; mode: RaceMode; cars: CarRule; physics: boolean; ghost: boolean; record: { name: string; time: number } | null; phase: RacePhase; racers: Racer[] }
  /**
   * The race is on: build the track and say `ready`. Nobody moves until `countdown` then `go`. `rule` and `cars`
   * (each racer's car code for this race) settle what everyone drives; see raceCars().
   */
  | { t: 'load'; track: TrackId; mode: RaceMode; grid: Record<number, number>; timeoutMs: number; rule: CarRule; cars: Record<number, string>; physics: boolean; ghost: GhostRun | null }
  /** Who in the field has loaded so far (ids), sent whenever that changes. */
  | { t: 'loading'; ready: number[]; field: number[] }
  /** Everyone's loaded: `go` comes in `ms`. A racer who loads late hears the time that's left. */
  | { t: 'countdown'; ms: number }
  | { t: 'go' }
  | { t: 'snap'; cars: NetCar[] }
  | { t: 'finished'; id: number; time: number }
  | { t: 'results'; track: TrackId; mode: RaceMode; rows: ResultRow[] }
  /**
   * Shortly after `results`: the signed-in racers whose finish was a new best on this track (`prev`: the old one),
   * with their place on the track's all-time board (`rank` 1: a new track record, beating `beat`).
   */
  | { t: 'records'; rows: RecordRow[] }
  | { t: 'pong'; n: number }
  /** Someone used an item that reaches other racers: an oil slick dropped at `p`, or a shockwave. */
  | { t: 'item'; by: number; kind: 'oil' | 'shock' | 'comet'; p?: [number, number, number]; target?: number; s?: number }
  /** Physics mode: racer `id` wrecked their car at `p` (it blew up; they're respawning). */
  | { t: 'wreck'; id: number; p: [number, number, number] }
  | { t: 'error'; message: string };

export type RaceClientMsg =
  | { t: 'track'; track: TrackId }
  | { t: 'mode'; mode: RaceMode }
  | { t: 'cars'; cars: CarRule }
  /** The host turns Physics mode (crash damage) on or off. */
  | { t: 'physics'; on: boolean }
  /** Host: race the track record's ghost too. */
  | { t: 'ghost'; on: boolean }
  | { t: 'start' }
  /** The track is built and on screen: this racer can take the countdown. */
  | { t: 'ready' }
  | { t: 'car'; car: string }
  /** Your driver changed (lobby only, like `car`). */
  | { t: 'rider'; rider: string }
  /** You opened (or closed) the garage in the lobby, so the others see you're editing your car. Lobby only. */
  | { t: 'pit'; on: boolean }
  | ({ t: 'state' } & Omit<NetCar, 'id'>)
  | { t: 'finish'; time: number; best?: number }
  /** Your drift total so far (sent as each combo banks, and just before `finish`). The server caps it by the clock. */
  | { t: 'drift'; pts: number }
  /** You used an item that only affects you (a turbo or a shield); counted for the item bonus, not relayed. */
  | { t: 'used'; kind: 'turbo' | 'triple' | 'shield' }
  | { t: 'ping'; n: number }
  /** Physics mode: your car blew up at `p`. */
  | { t: 'wreck'; p: [number, number, number] }
  /** `target` and `s` (where it was fired from) for a comet. */
  | { t: 'item'; kind: 'oil' | 'shock' | 'comet'; p?: [number, number, number]; target?: number; s?: number; cpu?: number }
  /** The host adds a CPU racer to the lobby, or takes one (`id`) off the grid. */
  | { t: 'cpu'; op: 'add' }
  | { t: 'cpu'; op: 'remove'; id: number }
  /** The host's CPU racers' poses, all in one message (relayed as one `snap`). */
  | { t: 'cpus'; cars: NetCar[] }
  /** The host says one of its CPU racers crossed the line. */
  | { t: 'cpufinish'; id: number; time: number }
  /** The host says one of its CPU racers blew up. */
  | { t: 'cpuwreck'; id: number; p: [number, number, number] };

/**
 * CPU racers in an online lobby. The host adds them; the room keeps them as racers with negative ids (so they never
 * clash with a socket's), and the host's client drives them with the same AI as a solo race (driver.ts), sending
 * their poses in one `cpus` message, their items with `cpu`, and their finishes and wrecks. They leave with the host
 * if the host goes mid-race, give up their seat to a person who joins a full lobby, and are never paid. A race
 * with CPUs in it pays like a solo race against them, but never less than the people alone would earn.
 */
export const CPU = {
  /** CPU racers' names, the same as a solo race's rivals. */
  names: ['Haruki', 'Mika', 'Bunta', 'Rin', 'Kenji', 'Sora', 'Aiko', 'Daichi'],
};

export const RACE = {
  maxPlayers: 8,
  /** How long the room waits for every racer to load before it counts down without the stragglers. */
  loadTimeoutMs: 20_000,
  /** The 3-2-1 once everyone's loaded. */
  countdownMs: 3000,
  /** The room's clock tick (phases, timeouts). Car poses are relayed as they arrive, not on this tick. */
  snapshotHz: 20,
  /** After the first finisher, the rest have this long before they're a DNF. */
  dnfSeconds: 40,
  resultsSeconds: 12,
  /** A race can't last longer than this (everyone still out is a DNF). */
  maxSeconds: 600,
};
