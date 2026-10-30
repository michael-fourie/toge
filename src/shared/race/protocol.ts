// Race lobby wire types (JSON). A race room is its own Durable Object (server/raceroom.ts); the shooter's
// protocol is untouched.
//
// Flow: everyone sits in the lobby → the host picks a track and starts → `countdown` (grid slots) → `go` →
// clients drive (client-authoritative, like the shooter) and send `state` at 20 Hz → each sends `finish`
// with its time → `results` (places, prize money) → back to the lobby.

import type { TrackId } from './track.ts';

export type RacePhase = 'lobby' | 'countdown' | 'racing' | 'results';

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
  place: number;
  prize: number;
}

export interface RaceLobbyInfo {
  code: string;
  host: string;
  track: TrackId;
  phase: RacePhase;
  players: number;
  max: number;
}

export type RaceServerMsg =
  | { t: 'welcome'; id: number }
  | { t: 'room'; code: string; hostId: number; track: TrackId; phase: RacePhase; racers: Racer[] }
  | { t: 'countdown'; track: TrackId; ms: number; grid: Record<number, number> }
  | { t: 'go' }
  | { t: 'snap'; cars: NetCar[] }
  | { t: 'finished'; id: number; time: number }
  | { t: 'results'; track: TrackId; rows: ResultRow[] }
  | { t: 'pong'; n: number }
  /** Someone used an item that reaches other racers: an oil slick dropped at `p`, or a shockwave. */
  | { t: 'item'; by: number; kind: 'oil' | 'shock'; p?: [number, number, number] }
  | { t: 'error'; message: string };

export type RaceClientMsg =
  | { t: 'track'; track: TrackId }
  | { t: 'start' }
  | { t: 'car'; car: string }
  | ({ t: 'state' } & Omit<NetCar, 'id'>)
  | { t: 'finish'; time: number }
  | { t: 'ping'; n: number }
  | { t: 'item'; kind: 'oil' | 'shock'; p?: [number, number, number] };

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
