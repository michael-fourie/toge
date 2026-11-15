// The words on KANJO's loading screen (loading.ts): the run label and the tips. No DOM, so tests can import it.

import { TRACK_DEFS, type TrackId } from '../shared/track.ts';
import { TRACK_LENGTH_KM } from '../shared/garage.ts';
import type { RaceMode } from '../shared/protocol.ts';
import { CUPS, roundsOf, type CupId } from '../shared/cups.ts';

/** One-line tips in the house voice (DESIGN.md §1): short, second person, no exclamation marks. */
export const LOADING_TIPS = [
  'Sit in a rival’s slipstream, then pull out to slingshot past.',
  'Hold the wheel into a drift to tighten it round a hairpin.',
  'Brake in a straight line, then turn in. The pass rewards patience.',
  'Tuning is in Performance. A softer setup soaks up a bumpy road.',
  'Set a best time and your friends can see it on their Friends tab.',
  'Late on the brakes wins a corner. Early on the throttle wins the run.',
  'Rainbow pads sit wide on a few corner exits. Run out over one to fire off it.',
];

/** What kind of run this is, for the line beside the logo. */
export interface LoadingRun {
  track: TrackId;
  /** Solo: how many AI rivals. */
  rivals?: number;
  physics?: boolean;
  /** Online: the lobby's mode and how many racers are on the grid. */
  online?: { mode: RaceMode; racers: number; laps?: number };
  /** A Grand Prix round (0-3) of a cup, solo or online. */
  gp?: { cup: CupId; round: number };
}

/** "1 lap", "42 laps". */
export const lapsLabel = (n: number) => `${n} ${n === 1 ? 'lap' : 'laps'}`;

/** A race's distance (km): the track's own, or a circuit raced `laps` times (an Endurance race). */
export function raceKm(track: TrackId, laps?: number): number {
  const own = TRACK_DEFS[track].laps;
  if (!own || !laps) return TRACK_LENGTH_KM[track];
  return Math.round((TRACK_LENGTH_KM[track] / own) * laps * 10) / 10;
}

export function runLabel(r: LoadingRun): string {
  const parts: string[] = [];
  if (r.gp) parts.push(`${r.online?.mode === 'team' ? 'Team Grand Prix · ' : ''}${CUPS[r.gp.cup].name} · Round ${r.gp.round + 1} of ${roundsOf(r.gp.cup)}`);
  if (r.online) {
    if (r.online.mode === 'endurance') parts.push(`Endurance · ${lapsLabel(r.online.laps ?? 1)}`);
    else if (!r.gp) parts.push(r.online.mode === 'trial' ? 'Online time trial' : r.online.mode === 'climb' ? 'Online hill climb' : 'Online race');
    if (r.online.racers > 1) parts.push(`${r.online.racers} racers`);
  } else {
    const n = r.rivals ?? 0;
    parts.push(n > 0 ? `Solo · ${n} ${n === 1 ? 'rival' : 'rivals'}` : 'Solo run');
  }
  if (r.physics) parts.push('Physics');
  return parts.join(' · ');
}
