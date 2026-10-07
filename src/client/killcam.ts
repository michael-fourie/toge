// Kill-cam: everyone's recent movement is recorded as a short trail, so when we die we can replay the last
// couple of seconds from the killer's eyes. Pure logic (no three.js / DOM), so it's unit-tested.

export const KILLCAM = {
  window: 2.0, // seconds of game time replayed, ending at the moment we died
  tail: 0.15, // a little past the death so the shot lands on screen
  real: 2.2, // seconds of real time the replay takes (slightly slow-mo); must be under RESPAWN_SECONDS
  recordInterval: 1 / 30, // trail sample spacing
  keep: 4, // seconds of trail kept
  remoteLag: 0.1, // remotes are recorded as rendered, NET.interpDelayMs behind real time: look this far ahead to line up with us and the shots
  killerEye: 1.62,
  killerEyeSliding: 0.95,
};

export interface TrailPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Wallrun lean side (-1, 0, 1). */
  side: number;
  sliding: boolean;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function lerpAngle(a: number, b: number, k: number) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

/** A rolling record of one player's poses over time. */
export class Trail {
  private t: number[] = [];
  private p: TrailPose[] = [];

  get length() {
    return this.t.length;
  }

  /** Records at most one sample per `recordInterval`; drops anything older than `keep` seconds. */
  push(time: number, pose: TrailPose) {
    const n = this.t.length;
    if (n && time - this.t[n - 1] < KILLCAM.recordInterval) return;
    this.t.push(time);
    this.p.push({ ...pose });
    while (this.t.length > 1 && this.t[0] < time - KILLCAM.keep) {
      this.t.shift();
      this.p.shift();
    }
  }

  clear() {
    this.t.length = 0;
    this.p.length = 0;
  }

  /** Pose at `time`, interpolated; clamps to the ends; null if nothing was recorded or `time` is long before the first sample. */
  at(time: number): TrailPose | null {
    const n = this.t.length;
    if (!n || time < this.t[0] - 0.25) return null;
    if (time <= this.t[0]) return { ...this.p[0] };
    if (time >= this.t[n - 1]) return { ...this.p[n - 1] };
    let i = 1;
    while (this.t[i] < time) i++;
    const a = this.p[i - 1];
    const b = this.p[i];
    const k = (time - this.t[i - 1]) / (this.t[i] - this.t[i - 1]);
    return {
      x: lerp(a.x, b.x, k),
      y: lerp(a.y, b.y, k),
      z: lerp(a.z, b.z, k),
      yaw: lerpAngle(a.yaw, b.yaw, k),
      pitch: lerp(a.pitch, b.pitch, k),
      side: b.side,
      sliding: b.sliding,
    };
  }
}

/** Banner text: the death text plus how far away the killer was, when known. */
export function killcamText(text: string, metres: number | null): string {
  return metres === null ? text : `${text} · ${Math.round(metres)} m`;
}

/** Game time shown `elapsed` real seconds into a replay of a death at `deathTime`. */
export function replayTime(elapsed: number, deathTime: number): number {
  const span = KILLCAM.window + KILLCAM.tail;
  return deathTime - KILLCAM.window + Math.min(1, Math.max(0, elapsed / KILLCAM.real)) * span;
}

/** True while the replay is still running. */
export const replaying = (elapsed: number) => elapsed < KILLCAM.real;
