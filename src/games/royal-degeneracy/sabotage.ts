// Sabotages, pure: the Degenerates' one-at-a-time house disasters (power cut, toilet flood, WiFi down, fire alarm,
// locked doors), what each one blocks, how each is fixed, and the crisis that wins the night if nobody fixes it.
// Fix timings are held on the fixer's screen (Dev's Engineer quirk halves them); the referee checks who and where.

import { tagFor } from './cast.ts';
import { log } from './clues.ts';
import { DOORS } from './house.ts';
import type { Night } from './rules.ts';

export type SabKind = 'power' | 'flood' | 'wifi' | 'alarm' | 'lock';

export const SABOTAGES: Record<SabKind, { name: string; text: string; fix: string[] }> = {
  power: { name: 'Power cut', text: 'Every light in the house goes out. Phone torches only.', fix: ['fix-fuse'] },
  flood: { name: 'Toilet flood', text: 'The toilet overflows: 45 s, or the Degenerates win. Plunge it and shut the stopcock at once.', fix: ['fix-plunge', 'fix-stopcock'] },
  wifi: { name: 'WiFi down', text: 'No photos to the group chat, no router logs, no Ring cam.', fix: ['fix-router'] },
  alarm: { name: 'Fire alarm', text: 'A piercing noise: no footsteps to hear, no meetings to call.', fix: ['fix-alarm'] },
  lock: { name: 'Lock doors', text: 'Every bedroom door on one floor slams and locks for 12 s.', fix: [] },
};
export const SAB_KINDS = Object.keys(SABOTAGES) as SabKind[];

export const SAB = {
  /** Shared cooldown between sabotages (s of roam). */
  cooldown: 35,
  /** None in the first minute of a night. */
  first: 60,
  crisis: 45,
  locked: 12,
  /** After the router reboots, WiFi takes this long to come back. */
  reboot: 10,
  /** Seconds of holding E to fix (Dev halves it). */
  hold: { 'fix-fuse': 3, 'fix-stopcock': 3, 'fix-plunge': 3, 'fix-alarm': 3, 'fix-router': 5 } as Record<string, number>,
  /** The flood's two halves must be done within this long of each other. */
  together: 4,
};

interface Sabotage {
  kind: SabKind;
  /** When it started (roam). */
  at: number;
  /** The crisis deadline, the locks' end, the WiFi's return after a reboot (roam); Infinity if it waits for a fix. */
  until: number;
  /** Lock doors: which floor. */
  floor: number;
  /** The flood: which halves are done, and when (roam). */
  done: Record<string, number>;
}

/** The referee's sabotage state (part of the Night). */
export interface Sabotages {
  now: Sabotage | null;
  readyAt: number;
}

export const newSabotages = (): Sabotages => ({ now: null, readyAt: SAB.first });

/** Why `who` can't sabotage now (null: they can). Ghost Degenerates still can. */
export function sabotageProblem(n: Night, who: number): string | null {
  const p = n.players.find((x) => x.id === who);
  if (!p || p.role !== 'degenerate' || p.gone || p.evicted) return 'not a Degenerate';
  if (n.phase !== 'night') return 'not now';
  if (n.sab.now) return 'one at a time';
  if (n.roam < n.sab.readyAt) return 'cooling down';
  return null;
}

/** Starts a sabotage. `floor` is where the saboteur is (Lock doors locks that floor). */
export function startSabotage(n: Night, who: number, kind: SabKind, floor: number): boolean {
  if (sabotageProblem(n, who)) return false;
  const until = kind === 'flood' ? n.roam + SAB.crisis : kind === 'lock' ? n.roam + SAB.locked : Infinity;
  n.sab.now = { kind, at: n.roam, until, floor, done: {} };
  const p = n.players.find((x) => x.id === who)!;
  log(n, `${tagFor(p.char, p.name)} sabotaged the house: ${SABOTAGES[kind].name.toLowerCase()}.`);
  return true;
}

/** Bedroom doors on the locked floor (none when no lock is on). */
export function lockedDoors(n: Night): string[] {
  const s = n.sab.now;
  if (!s || s.kind !== 'lock') return [];
  return DOORS.filter((d) => d.floor === s.floor && !['front', 'back', 'balcony', 'frontbalcony'].includes(d.id) && !d.id.startsWith('bath')).map((d) => d.id);
}

const done = (n: Night) => {
  n.sab.now = null;
  n.sab.readyAt = n.roam + SAB.cooldown;
};

/**
 * Someone finished holding E at a fix spot. Returns what happened: 'fixed', 'half' (the flood needs its other
 * half), 'rebooting' (WiFi's coming back), or null (nothing to fix there).
 */
export function fixSabotage(n: Night, who: number, spot: string): 'fixed' | 'half' | 'rebooting' | null {
  const s = n.sab.now;
  const p = n.players.find((x) => x.id === who);
  if (!s || !p || p.gone || !p.alive || p.evicted || n.phase !== 'night' || !SABOTAGES[s.kind].fix.includes(spot)) return null;
  const name = tagFor(p.char, p.name);
  if (s.kind === 'wifi') {
    if (s.until !== Infinity) return null;
    s.until = n.roam + SAB.reboot;
    log(n, `${name} rebooted the router.`);
    return 'rebooting';
  }
  if (s.kind === 'flood') {
    s.done[spot] = n.roam;
    // Selby decides it's dire and does both halves alone.
    const both = SABOTAGES.flood.fix.every((f) => s.done[f] !== undefined && n.roam - s.done[f] <= SAB.together);
    if (!both && p.char !== 'selby') return 'half';
    log(n, p.char === 'selby' && !both ? `${name} decided it was dire and stopped the flood alone.` : `${name} and someone else stopped the flood.`);
    done(n);
    return 'fixed';
  }
  log(n, `${name} fixed the ${SABOTAGES[s.kind].name.toLowerCase()}.`);
  done(n);
  return 'fixed';
}

/** Time passes: the locks and the rebooted WiFi end; an unfixed flood wins it. Returns true if anything changed. */
export function stepSabotage(n: Night): 'over' | 'changed' | null {
  const s = n.sab.now;
  if (!s || n.roam < s.until) return null;
  if (s.kind === 'flood') return 'over';
  done(n);
  return 'changed';
}

export const wifiDown = (n: Night) => n.sab.now?.kind === 'wifi';
export const alarmOn = (n: Night) => n.sab.now?.kind === 'alarm';
