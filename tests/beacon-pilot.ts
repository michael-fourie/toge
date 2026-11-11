// An autopilot that climbs BEACON's course leg by leg with the real movement (tests only).

import { type Course, inBox, progress } from '../src/games/beacon/course.ts';
import { type Input, MOVE, newBody, step } from '../src/games/beacon/move.ts';

const DIRS: [number, number][] = [
  [1, 0],
  [0, -1],
  [-1, 0],
  [0, 1],
];

export interface PilotResult {
  finished: boolean;
  time: number;
  /** The leg it was on when it stopped. */
  leg: number;
  why: string;
  checkpoints: number;
  /** Fastest horizontal speed reached. */
  top: number;
}

export function pilot(c: Course, limit = 1500, trace?: (leg: number, b: ReturnType<typeof newBody>, inp: Input) => void): PilotResult {
  const b = newBody(...c.start.spawn);
  let cp = -1;
  let li = 0;
  let t = 0;
  let legT = 0;
  let top = 0;
  let pressed = false;
  const inp: Input = { fwd: 1, side: 0, yaw: c.start.yaw, jump: false, crouch: false, walk: false };
  const res = (finished: boolean, why: string): PilotResult => ({ finished, time: t, leg: li, why, checkpoints: cp + 1, top });
  while (t < limit) {
    const leg = c.legs[li];
    const [dx, dz] = DIRS[leg.d];
    const fAt = (b.x - leg.at[0]) * dx + (b.z - leg.at[2]) * dz;
    // Pure pursuit of a point 3 m ahead on the line at -> to.
    const lx = leg.to[0] - leg.at[0];
    const lz = leg.to[2] - leg.at[2];
    const ll = Math.hypot(lx, lz) || 1;
    const ux = lx / ll;
    const uz = lz / ll;
    const proj = (b.x - leg.at[0]) * ux + (b.z - leg.at[2]) * uz;
    const ax = leg.at[0] + ux * (proj + 3);
    const az = leg.at[2] + uz * (proj + 3);
    inp.yaw = Math.atan2(-(ax - b.x), -(az - b.z));
    inp.crouch = leg.act === 'slide' && fAt >= 0;
    // Turning sharply onto a new heading (e.g. inward to a ledge): stop first, like a person would.
    const sp = Math.hypot(b.vx, b.vz);
    const misaligned = (leg.act === 'mantle' || leg.act === 'climb') && b.ground && sp > 2 && (b.vx * dx + b.vz * dz) / sp < 0.8;
    inp.fwd = misaligned ? 0 : 1;
    let jump = false;
    if (leg.act === 'jump' || leg.act === 'mantle' || leg.act === 'climb' || leg.act === 'wallrun') {
      if ((b.ground || b.air < 0.1) && !b.mantle && fAt >= -0.25 && !pressed && !misaligned) {
        // A fresh press (let go first if it's still held from the last jump).
        jump = !b.jumpHeld;
        pressed = jump;
      } else if (pressed && !b.ground) jump = true; // hold for full height
      if (leg.act === 'wallrun' && leg.lane > 0 && b.wall && b.wall.nx * dz - b.wall.nz * dx < 0) jump = !b.jumpHeld;
    }
    inp.jump = jump;
    step(c.world, b, inp);
    trace?.(li, b, inp);
    t += MOVE.tick;
    legT += MOVE.tick;
    top = Math.max(top, Math.hypot(b.vx, b.vz));
    const pr = progress(c, b, cp);
    cp = pr.cp;
    if (pr.finished) return res(true, 'finished');
    if (pr.drowned) return res(false, `fell in the sea on leg ${li} (${leg.act})`);
    if (b.y < Math.min(leg.at[1], leg.to[1]) - 5) return res(false, `fell on leg ${li} (${leg.act}) at ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`);
    if (legT > 12) return res(false, `stuck on leg ${li} (${leg.act}) at ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)} going to ${leg.to.map((v) => v.toFixed(1))}`);
    // Done with this leg (and any it has overtaken)?
    for (;;) {
      const lg = c.legs[li];
      const [ex, ez] = DIRS[lg.d];
      const f = (b.x - lg.to[0]) * ex + (b.z - lg.to[2]) * ez;
      const next = c.legs[li + 1];
      const chain = lg.act === 'wallrun' && next?.act === 'wallrun';
      const done = lg.act === 'run' ? f >= -0.3 && b.y > lg.to[1] - 0.6 : chain ? f >= 0 : b.ground && f >= -0.3 && b.y > lg.to[1] - 0.7;
      if (!done) break;
      li++;
      legT = 0;
      pressed = false;
      if (li >= c.legs.length) return res(inBox(b, c.finish), 'ran out of legs');
    }
  }
  return res(false, 'out of time');
}
