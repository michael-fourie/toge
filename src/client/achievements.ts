// Kill streaks and mini achievements ("feats"). Pure logic, no DOM, so it's unit-tested.
// Feats from one kill stack: a 360 no-scope headshot is three feats and one big combo.

/** How the shooter took the shot, captured when they pulled the trigger. */
export interface ShotContext {
  headshot: boolean;
  scoped: boolean;
  /** Radians turned in the moments before the shot (see SpinMeter). */
  spin: number;
  /** Seconds since last on the ground (0 while grounded). */
  airTime: number;
  wallrunning: boolean;
  sliding: boolean;
  speed: number;
  distance: number;
}

export interface Feat {
  label: string;
  /** 1 = nice, 2 = sweet, 3 = legendary: drives colour and how fancy the jingle is. */
  tier: 1 | 2 | 3;
}

export const FEAT = {
  spinWindow: 1.5, // seconds a 360 has to happen in
  spinTurn: Math.PI * 2 * 0.95, // a little forgiving
  airTime: 1, // longer than a bhop hop (~0.75 s): pads, puffballs, big drops
  speed: 15, // m/s
  longShot: 60, // metres
  pointBlank: 2.5,
  multiWindow: 4, // seconds between kills to keep a multi-kill going
};

/** Style feats in reading order, so they compound into a title like "360 NO-SCOPE HEADSHOT". */
export function featsFor(s: ShotContext): Feat[] {
  const out: Feat[] = [];
  if (s.spin >= FEAT.spinTurn) out.push({ label: '360', tier: 3 });
  if (!s.scoped) out.push({ label: 'NO-SCOPE', tier: 2 });
  if (s.wallrunning) out.push({ label: 'WALLRUN', tier: 2 });
  else if (s.airTime >= FEAT.airTime) out.push({ label: 'AIRBORNE', tier: 2 });
  if (s.sliding) out.push({ label: 'SLIDING', tier: 1 });
  if (s.speed >= FEAT.speed) out.push({ label: 'MACH', tier: 2 });
  if (s.distance >= FEAT.longShot) out.push({ label: 'LONG SHOT', tier: 2 });
  else if (s.distance <= FEAT.pointBlank) out.push({ label: 'POINT BLANK', tier: 1 });
  if (s.headshot) out.push({ label: 'HEADSHOT', tier: 1 });
  return out;
}

const MULTI = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'QUAD KILL'];
const STREAKS: [number, string][] = [
  [3, 'KILLING SPREE'],
  [5, 'RAMPAGE'],
  [10, 'UNSTOPPABLE'],
  [15, 'GODLIKE'],
  [25, 'LEGENDARY'],
];

/** Kills since your last death, and kills in quick succession. */
export class Streak {
  count = 0;
  private multi = 0;
  private lastKill = -Infinity;

  /** Records a kill at time `t`; returns the multi-kill and streak-milestone feats it earned. */
  kill(t: number): Feat[] {
    this.multi = t - this.lastKill <= FEAT.multiWindow ? this.multi + 1 : 1;
    this.lastKill = t;
    this.count++;
    const out: Feat[] = [];
    if (this.multi >= 2) out.push({ label: MULTI[this.multi] ?? 'ULTRA KILL', tier: this.multi >= 3 ? 3 : 2 });
    const milestone = STREAKS.find(([n]) => n === this.count);
    if (milestone) out.push({ label: milestone[1], tier: 3 });
    else if (this.count > 25 && this.count % 10 === 0) out.push({ label: `${this.count} STREAK`, tier: 3 });
    return out;
  }

  reset() {
    this.count = 0;
    this.multi = 0;
    this.lastKill = -Infinity;
  }
}

/** Remembers recent yaw so a shot can ask "did they just spin all the way round?". Yaw must be unwrapped. */
export class SpinMeter {
  private samples: { t: number; yaw: number }[] = [];

  push(t: number, yaw: number) {
    this.samples.push({ t, yaw });
    while (this.samples.length > 1 && this.samples[0].t < t - FEAT.spinWindow) this.samples.shift();
  }

  /** Largest net turn between any recent sample and now. */
  spin(yaw: number): number {
    let best = 0;
    for (const s of this.samples) best = Math.max(best, Math.abs(yaw - s.yaw));
    return best;
  }
}
