// The wire: what climbers tell each other through the party relay, and `readMsg`, which checks every incoming
// message's shape (anything from another browser is untrusted).
//
// - `st`  (15 Hz) where I am and what I'm doing, so everyone can draw me.
// - `go`  host -> everyone (or one late joiner): a climb starts; `n` numbers it so stale messages are ignored.
// - `hi`  a late joiner asks the host for the current climb.
// - `cp`  I reached checkpoint i (for the "Ana lit Signal Hut" feed).
// - `fin` I lit the beacon, in `ms`.

/** What a climber is doing, for posing their figure. */
export const ANIM = { idle: 0, run: 1, air: 2, wall: 3, slide: 4, mantle: 5, crouch: 6 } as const;
export type Anim = (typeof ANIM)[keyof typeof ANIM];

export type Msg =
  | { t: 'st'; n: number; p: [number, number, number]; yaw: number; a: Anim; s: number; w: number; cp: number }
  | { t: 'go'; n: number }
  | { t: 'hi' }
  | { t: 'cp'; n: number; i: number }
  | { t: 'fin'; n: number; ms: number };

/** Positions go out rounded to centimetres (smaller messages). */
export const r2 = (v: number) => Math.round(v * 100) / 100;

const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v: unknown, lo: number, hi: number): v is number => num(v, lo, hi) && Number.isInteger(v);

/** The message if `d` is a well-formed one, else null. */
export function readMsg(d: unknown): Msg | null {
  if (!d || typeof d !== 'object') return null;
  const m = d as Record<string, unknown>;
  switch (m.t) {
    case 'st': {
      const p = m.p;
      if (!Array.isArray(p) || p.length !== 3 || !p.every((v) => num(v, -5000, 5000))) return null;
      if (!int(m.n, 0, 1e9) || !num(m.yaw, -10, 10) || !int(m.a, 0, 6) || !num(m.s, 0, 60) || !num(m.w, -1, 1) || !int(m.cp, -1, 99)) return null;
      return { t: 'st', n: m.n, p: [p[0], p[1], p[2]], yaw: m.yaw, a: m.a as Anim, s: m.s, w: m.w, cp: m.cp };
    }
    case 'go':
      return int(m.n, 0, 1e9) ? { t: 'go', n: m.n } : null;
    case 'hi':
      return { t: 'hi' };
    case 'cp':
      return int(m.n, 0, 1e9) && int(m.i, 0, 99) ? { t: 'cp', n: m.n, i: m.i } : null;
    case 'fin':
      return int(m.n, 0, 1e9) && int(m.ms, 0, 864e5) ? { t: 'fin', n: m.n, ms: m.ms } : null;
    default:
      return null;
  }
}

/** Formats a climb time: 3:07.42. */
export function clock(ms: number) {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(2).padStart(5, '0')}`;
}
