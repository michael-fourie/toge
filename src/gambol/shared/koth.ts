// King of the Hill: two teams fight over one zone, Overwatch "Control" style. Pure rules, run by the server
// and unit-tested; the client only draws the state it is sent.
//
//   - The hill starts locked for a few seconds, then neutral.
//   - Stand on it with no enemies there and your team's capture bar fills (faster with more of you, up to 3).
//     A full bar makes the hill yours. Retaking an enemy hill works the same way.
//   - Both teams on it: contested. Nothing moves except the owner's clock.
//   - Nobody capturing: a half-filled bar slowly drains (fast if the owners are standing on it).
//   - The owning team's clock runs while they hold it. First to HOLD_TO_WIN seconds wins,
//     but not while the enemy is on the hill or has a capture going: that's overtime.

import type { Vec3 } from '../../shared/math.ts';
import type { Team } from './teams.ts';

export const KOTH = {
  /** Seconds a team must hold the hill (in total) to win. */
  holdToWin: 180,
  /** Seconds one player needs to capture a neutral or enemy hill. */
  captureTime: 9,
  /** Each extra capturer adds this much speed, up to `maxCapturers`. */
  extraCapturer: 0.5,
  maxCapturers: 3,
  /** How fast an abandoned capture drains (fraction of the capture rate); owners standing on it drain it at full speed. */
  drain: 0.35,
  /** The hill opens this long after a match starts. */
  unlockSeconds: 10,
} as const;

/** The hill: a cylinder standing on the plateau. */
export interface Zone {
  x: number;
  y: number;
  z: number;
  /** Radius, metres. */
  r: number;
  /** Height above `y` that still counts (so jumping on it counts, hooking high over it does not). */
  h: number;
}

export function inZone(zone: Zone, p: Vec3): boolean {
  return Math.hypot(p.x - zone.x, p.z - zone.z) <= zone.r && p.y >= zone.y - 0.5 && p.y <= zone.y + zone.h;
}

export interface KothState {
  /** Seconds until the hill opens (0 once it's open). */
  lock: number;
  /** Who holds the hill (null: nobody yet). */
  owner: Team | null;
  /** The team whose capture bar is filling, and how full it is (0..1). */
  cap: Team | null;
  prog: number;
  /** Seconds each team has held the hill. */
  held: [number, number];
  /** Living players on the hill, per team. */
  on: [number, number];
  contested: boolean;
  overtime: boolean;
}

export const newKoth = (): KothState => ({ lock: KOTH.unlockSeconds, owner: null, cap: null, prog: 0, held: [0, 0], on: [0, 0], contested: false, overtime: false });

/** What happened during a step, for announcements. */
export interface KothEvents {
  captured?: Team;
  won?: Team;
}

const rate = (n: number) => (1 + KOTH.extraCapturer * (Math.min(n, KOTH.maxCapturers) - 1)) / KOTH.captureTime;

/** Advances the hill by `dt` seconds with `on` living players per team standing on it. Mutates `s`. */
export function stepKoth(s: KothState, on: [number, number], dt: number): KothEvents {
  const ev: KothEvents = {};
  if (s.held[0] >= KOTH.holdToWin || s.held[1] >= KOTH.holdToWin) return ev; // decided: frozen until a new match
  s.on = [on[0], on[1]];
  s.contested = on[0] > 0 && on[1] > 0;
  if (s.lock > 0) {
    s.lock = Math.max(0, s.lock - dt);
    s.overtime = false;
    return ev;
  }

  // The one team on the hill alone, if any.
  const alone: Team | null = s.contested ? null : on[0] > 0 ? 0 : on[1] > 0 ? 1 : null;
  if (alone !== null && alone !== s.owner) {
    if (s.cap !== null && s.cap !== alone) {
      // Someone else's half-done capture has to be wiped out first.
      s.prog -= rate(on[alone]) * dt;
      if (s.prog <= 0) {
        s.cap = alone;
        s.prog = -s.prog;
      }
    } else {
      s.cap = alone;
      s.prog += rate(on[alone]) * dt;
    }
    if (s.cap === alone && s.prog >= 1) {
      s.owner = alone;
      s.cap = null;
      s.prog = 0;
      ev.captured = alone;
    }
  } else if (!s.contested && s.prog > 0) {
    // Nobody pushing: the bar drains, quickly if the owners are standing on their hill.
    s.prog -= (alone !== null ? 1 : KOTH.drain) * rate(1) * dt;
    if (s.prog <= 0) {
      s.prog = 0;
      s.cap = null;
    }
  }

  // The owners' clock. It can't run out while the enemy is still fighting for the hill.
  s.overtime = false;
  if (s.owner !== null) {
    const o = s.owner;
    const threat = s.on[1 - o] > 0 || (s.cap !== null && s.cap !== o && s.prog > 0);
    s.held[o] += dt;
    if (s.held[o] >= KOTH.holdToWin) {
      if (threat) {
        s.held[o] = KOTH.holdToWin - 0.01;
        s.overtime = true;
      } else {
        s.held[o] = KOTH.holdToWin;
        ev.won = o;
      }
    }
  }
  return ev;
}
