// Race lobby wire types (JSON). A race room is its own Durable Object (server/raceroom.ts); the shooter's
// protocol is untouched.
//
// Flow: everyone sits in the lobby → the host picks a track and starts → `countdown` (grid slots) → `go` →
// clients drive (client-authoritative, like the shooter) and send `state` at 20 Hz → each sends `finish`
// with its time → `results` (places, prize money) → back to the lobby.

import type { TrackId } from './track.ts';

export type RacePhase = 'lobby' | 'countdown' | 'racing' | 'results';

/**
 * What the host is running: a `race` (cars bump, items fly) or a `trial` (time trial: everyone laps the same
 * road at once, but the other cars are see-through ghosts you drive straight through, and there are no items).
 */
export type RaceMode = 'race' | 'trial';
export const RACE_MODES: Record<RaceMode, { name: string; blurb: string }> = {
  race: { name: 'Race', blurb: 'Bump, block and throw items. First to the line wins.' },
  trial: { name: 'Time trial', blurb: 'Ghost cars, no contact, no items. Fastest clean time wins.' },
};

/**
 * What the racers drive in a time trial (the host picks; a race always uses everyone's own car):
 * `own` their own car, `spec` one racer's car drawn at random for everyone (same model, upgrades and default
 * tuning, so identical stats; each keeps their own paint), `maxed` their own car with every part at the top level.
 */
export type CarRule = 'own' | 'spec' | 'maxed';
export const CAR_RULES: Record<CarRule, { name: string; blurb: string }> = {
  own: { name: 'Own cars', blurb: 'Everyone drives their own car as it is.' },
  spec: { name: 'Spec car', blurb: "One racer's car, drawn at random, for everyone. Same stats, your paint." },
  maxed: { name: 'Maxed out', blurb: 'Your own car with every part at level 5.' },
};

export interface Racer {
  id: number;
  name: string;
  /** encodeCar(): model, paint, rims... and upgrade levels. */
  car: string;
  /** Signed in: prize money goes to the account's garage on the server. */
  user: boolean;
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
  prize: number;
}

export interface RaceLobbyInfo {
  code: string;
  host: string;
  track: TrackId;
  mode: RaceMode;
  phase: RacePhase;
  players: number;
  max: number;
}

export type RaceServerMsg =
  | { t: 'welcome'; id: number }
  | { t: 'room'; code: string; hostId: number; track: TrackId; mode: RaceMode; cars: CarRule; phase: RacePhase; racers: Racer[] }
  /** `rule` and `cars` (each racer's car code for this race) settle what everyone drives; see raceCars(). */
  | { t: 'countdown'; track: TrackId; mode: RaceMode; ms: number; grid: Record<number, number>; rule: CarRule; cars: Record<number, string> }
  | { t: 'go' }
  | { t: 'snap'; cars: NetCar[] }
  | { t: 'finished'; id: number; time: number }
  | { t: 'results'; track: TrackId; mode: RaceMode; rows: ResultRow[] }
  | { t: 'pong'; n: number }
  /** Someone used an item that reaches other racers: an oil slick dropped at `p`, or a shockwave. */
  | { t: 'item'; by: number; kind: 'oil' | 'shock' | 'comet'; p?: [number, number, number]; target?: number; s?: number }
  | { t: 'error'; message: string };

export type RaceClientMsg =
  | { t: 'track'; track: TrackId }
  | { t: 'mode'; mode: RaceMode }
  | { t: 'cars'; cars: CarRule }
  | { t: 'start' }
  | { t: 'car'; car: string }
  | ({ t: 'state' } & Omit<NetCar, 'id'>)
  | { t: 'finish'; time: number; best?: number }
  | { t: 'ping'; n: number }
  /** `target` and `s` (where it was fired from) for a comet. */
  | { t: 'item'; kind: 'oil' | 'shock' | 'comet'; p?: [number, number, number]; target?: number; s?: number };

export const RACE = {
  maxPlayers: 8,
  countdownMs: 4000,
  /** The room's clock tick (phases, timeouts). Car poses are relayed as they arrive, not on this tick. */
  snapshotHz: 20,
  /** After the first finisher, the rest have this long before they're a DNF. */
  dnfSeconds: 40,
  resultsSeconds: 12,
  /** A race can't last longer than this (everyone still out is a DNF). */
  maxSeconds: 600,
};
