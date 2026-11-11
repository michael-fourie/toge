// BEACON (src/games/beacon): the movement's feel rules, the course, and the wire format.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildCourse, heightShare, progress, spawnFor } from '../src/games/beacon/course.ts';
import { type Body, hspeed, idle, type Input, MOVE, newBody, type Solid, step, World } from '../src/games/beacon/move.ts';
import { clock, readMsg } from '../src/games/beacon/net.ts';
import { pilot } from './beacon-pilot.ts';

// ---------------------------------------------------------------------------------------------
// A tiny test world: a long floor along -Z (yaw 0 runs down it), plus whatever a test adds.

const floor = (z0: number, z1: number, y = 0, x0 = -4, x1 = 4): Solid => ({ min: [x0, y - 1, z0], max: [x1, y, z1], mat: 'stone' });
const wall = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Solid => ({ min: [x0, y0, z0], max: [x1, y1, z1], mat: 'stone' });

/** Steps `secs` of input. `each` may return 'jump' to press and hold jump for the next 0.35 s, like a player. */
function sim(w: World, b: Body, inp: Partial<Input>, secs: number, each?: (b: Body, t: number) => 'jump' | void) {
  let held = -1;
  for (let t = 0; t < secs; t += MOVE.tick) {
    step(w, b, { ...idle(0), ...inp, ...(held >= 0 && t - held < 0.35 ? { jump: true } : {}) });
    if (each?.(b, t) === 'jump' && (held < 0 || t - held >= 0.35)) held = t;
  }
}

/** A body at `z`, already at full sprint down -Z (as if it had been running a while). */
function atSprint(w: World, z = 0) {
  const b = newBody(0, 0, z);
  b.vz = -MOVE.sprint;
  sim(w, b, { fwd: 1 }, MOVE.tick);
  return b;
}

const flat = new World([floor(-400, 10, 0, -40, 40)]);

describe('Running', () => {
  test('builds from a run to a sprint going forward, and strafing stays at run speed', () => {
    const b = newBody(0, 0, 0);
    sim(flat, b, { fwd: 1 }, 0.25);
    assert.ok(hspeed(b) > MOVE.run * 0.9 && hspeed(b) < MOVE.sprint, `quick to a run (${hspeed(b).toFixed(2)})`);
    sim(flat, b, { fwd: 1 }, 2);
    assert.ok(Math.abs(hspeed(b) - MOVE.sprint) < 0.05, 'then up to a sprint');
    const s = newBody(0, 0, 0);
    sim(flat, s, { side: 1 }, 2);
    assert.ok(Math.abs(hspeed(s) - MOVE.run) < 0.05);
  });

  test('letting go stops you quickly; Shift walks', () => {
    const b = atSprint(flat);
    sim(flat, b, {}, 0.35);
    assert.ok(hspeed(b) < 0.01);
    const w = newBody(0, 0, 0);
    sim(flat, w, { fwd: 1, walk: true }, 2);
    assert.ok(Math.abs(hspeed(w) - MOVE.walk) < 0.05);
  });
});

describe('Momentum', () => {
  test('landing never costs speed', () => {
    const b = atSprint(flat);
    b.vx = 0;
    b.vz = -12;
    b.vy = -6;
    b.y = 0.5;
    b.ground = false;
    let before = 0;
    let after = 0;
    sim(flat, b, { fwd: 1 }, 0.3, (bb) => {
      if (bb.events.includes('land')) after = hspeed(bb);
      else if (!bb.ground) before = hspeed(bb);
    });
    assert.ok(after > 0 && after >= before - 0.05, `kept ${after.toFixed(2)} of ${before.toFixed(2)}`);
  });

  test('the air has no friction', () => {
    const w = new World([floor(-2, 2)]);
    const b = newBody(0, 30, 0);
    b.vz = -11;
    sim(w, b, {}, 1);
    assert.equal(hspeed(b), 11);
  });

  test('over sprint speed on the ground with input held, speed bleeds gently (carried momentum lasts)', () => {
    const b = atSprint(flat);
    b.vz = -13;
    sim(flat, b, { fwd: 1 }, 0.5);
    assert.ok(hspeed(b) > 10.5, `${hspeed(b).toFixed(2)} after half a second`);
  });

  test('air control steers but never adds speed past airWish', () => {
    const w = new World([floor(-2, 2)]);
    const b = newBody(0, 50, 0);
    sim(w, b, { side: 1 }, 1);
    assert.ok(hspeed(b) <= MOVE.airWish + 1e-9);
    const fast = newBody(0, 50, 0);
    fast.vz = -10;
    sim(w, fast, { fwd: 1, side: 1, yaw: 0 }, 0.5);
    assert.ok(Math.abs(hspeed(fast) - 10) < 1e-6, 'steering keeps the speed');
    assert.ok(fast.vx > 1, 'and turns it');
  });
});

describe('Jumping', () => {
  test('a jump peaks at v²/2g', () => {
    const b = newBody(0, 0, 0);
    sim(flat, b, {}, 0.1);
    let top = 0;
    sim(flat, b, { jump: true }, 1, (bb) => void (top = Math.max(top, bb.y)));
    const want = (MOVE.jump * MOVE.jump) / (2 * MOVE.gravity);
    assert.ok(Math.abs(top - want) < 0.08, `peak ${top.toFixed(2)} vs ${want.toFixed(2)}`);
  });

  test('letting go early cuts the jump short', () => {
    const b = newBody(0, 0, 0);
    sim(flat, b, {}, 0.1);
    let top = 0;
    sim(flat, b, { jump: true }, 0.05);
    sim(flat, b, {}, 1, (bb) => void (top = Math.max(top, bb.y)));
    assert.ok(top < 0.7, `short hop ${top.toFixed(2)}`);
  });

  test('coyote time: a jump just after running off an edge still happens; later it does not', () => {
    const w = new World([floor(-5, 10)]);
    for (const [late, jumps] of [
      [MOVE.coyote * 0.6, true],
      [MOVE.coyote * 2, false],
    ] as const) {
      const b = newBody(0, 0, 0);
      b.vz = -6;
      let off = -1;
      let jumped = false;
      sim(w, b, { fwd: 1 }, 2, (bb, t) => {
        if (off < 0 && !bb.ground) off = t;
        if (bb.events.includes('jump')) jumped = true;
      });
      // Replay: same run, pressing jump `late` seconds after leaving the floor.
      const c = newBody(0, 0, 0);
      c.vz = -6;
      jumped = false;
      let t0 = -1;
      sim(w, c, { fwd: 1 }, 0); // no-op, keeps the shape of the loop below readable
      for (let t = 0; t < 2; t += MOVE.tick) {
        if (t0 < 0 && !c.ground && c.air > 0) t0 = t;
        const press = t0 >= 0 && t >= t0 + late && t < t0 + late + 0.05;
        step(w, c, { ...idle(0), fwd: 1, jump: press });
        if (c.events.includes('jump')) jumped = true;
      }
      assert.equal(jumped, jumps, `jump ${late.toFixed(2)} s after the edge`);
    }
  });

  test('jump buffer: a press just before landing jumps on touchdown', () => {
    for (const [early, jumps] of [
      [MOVE.jumpBuffer * 0.6, true],
      [MOVE.jumpBuffer * 2.5, false],
    ] as const) {
      const b = newBody(0, 3, 0);
      // Fall from 3 m: find the landing tick, then press `early` before it.
      const probe = newBody(0, 3, 0);
      let land = 0;
      for (let t = 0; t < 2; t += MOVE.tick) {
        step(flat, probe, idle(0));
        if (probe.events.includes('land')) {
          land = t;
          break;
        }
      }
      let jumped = false;
      for (let t = 0; t < land + 0.2; t += MOVE.tick) {
        const press = t >= land - early && t < land - early + 0.04;
        step(flat, b, { ...idle(0), jump: press });
        if (b.events.includes('jump')) jumped = true;
      }
      assert.equal(jumped, jumps, `pressed ${early.toFixed(2)} s early`);
    }
  });

  test('a sprint jump clears 5 m of gap', () => {
    const w = new World([floor(-10, 10), floor(-30, -15)]);
    const b = atSprint(w, 5);
    let jumped = false;
    sim(w, b, { fwd: 1 }, 3, (bb) => {
      if (!jumped && bb.z < -9.6) {
        jumped = true;
        return 'jump';
      }
    });
    assert.ok(b.y > -0.1 && b.z < -15, `landed at z ${b.z.toFixed(1)}, y ${b.y.toFixed(1)}`);
  });
});

describe('Slides', () => {
  test('crouching at speed slides with a boost that bleeds away, and a slide jump keeps the speed', () => {
    const b = atSprint(flat);
    sim(flat, b, { fwd: 1, crouch: true }, MOVE.tick);
    assert.ok(b.sliding);
    assert.ok(hspeed(b) > MOVE.sprint + MOVE.slideBoost - 0.2, 'boost');
    sim(flat, b, { fwd: 1, crouch: true }, 0.3);
    const mid = hspeed(b);
    assert.ok(mid < MOVE.sprint + MOVE.slideBoost && mid > MOVE.sprint, 'bleeding');
    sim(flat, b, { fwd: 1, crouch: true, jump: true }, MOVE.tick);
    assert.ok(b.events.includes('jump') && !b.sliding);
    assert.ok(hspeed(b) >= mid - 0.1, 'slide jump keeps the speed');
  });

  test('no boost spam: a second slide right away gets no boost', () => {
    const b = atSprint(flat);
    sim(flat, b, { fwd: 1, crouch: true }, 0.1);
    sim(flat, b, { fwd: 1 }, 0.05);
    const v = hspeed(b);
    sim(flat, b, { fwd: 1, crouch: true }, MOVE.tick);
    assert.ok(hspeed(b) <= v + 0.01);
  });

  test('sliding down a ramp gains speed', () => {
    // A ramp dropping 4 m over 16 m toward -Z (its top at +Z).
    const ramp: Solid = { min: [-3, -4, -16], max: [3, 0, 0], mat: 'concrete', ramp: { axis: 2, dir: 1 } };
    const w = new World([floor(0, 10), ramp, floor(-60, -16, -4)]);
    // The same slide on the flat, for comparison: speed at the bottom of the ramp vs the same moment there.
    const b = atSprint(w, 2);
    const f = atSprint(flat, 2);
    let bottom = 0;
    let t0 = -1;
    sim(w, b, { fwd: 1, crouch: true }, 2, (bb, t) => {
      if (t0 < 0 && bb.z < -16) {
        t0 = t;
        bottom = hspeed(bb);
      }
    });
    sim(flat, f, { fwd: 1, crouch: true }, t0);
    assert.ok(t0 > 0 && bottom > hspeed(f) + 1.5, `bottom ${bottom.toFixed(2)} vs flat ${hspeed(f).toFixed(2)}`);
  });

  test('a low gap only lets you through crouched', () => {
    const w = new World([floor(-30, 10), wall(-4, 4, 1.2, 4, -12, -10)]);
    const stand = atSprint(w, 8);
    sim(w, stand, { fwd: 1 }, 2);
    assert.ok(stand.z > -10, 'stopped by the slab standing up');
    const slide = atSprint(w, 8);
    sim(w, slide, { fwd: 1, crouch: true }, 3);
    assert.ok(slide.z < -12.5, `slid under (z ${slide.z.toFixed(1)})`);
  });
});

describe('Walls', () => {
  // A wall along the -Z run, on the left (its face at x = -1), over a 12 m gap.
  const gapWorld = () => new World([floor(-2, 10), wall(-1.6, -1, -4, 5, -14, -1), floor(-40, -14)]);

  test('jumping alongside a wall at speed runs along it, then a wall jump pushes off and up', () => {
    const w = gapWorld();
    const b = atSprint(w, 2);
    b.x = -0.6;
    let ran = false;
    let maxT = 0;
    sim(w, b, { fwd: 1, jump: false }, 0.9, (bb) => {
      if (!ran && bb.z < -1.8 && bb.ground) return 'jump';
      if (bb.wall) {
        ran = true;
        maxT = Math.max(maxT, bb.wall.t);
      }
    });
    assert.ok(ran, 'wall run started');
    assert.ok(b.wall, 'still on it');
    const vx = b.vx;
    sim(w, b, { fwd: 1, jump: true }, MOVE.tick);
    assert.ok(b.events.includes('walljump'));
    assert.ok(b.vx > vx + MOVE.wallJumpOut * 0.9, 'pushed off the wall');
    assert.ok(b.vy > MOVE.wallJumpUp * 0.9);
    void maxT;
  });

  test('a wall run carries you across the gap without losing height early', () => {
    const w = gapWorld();
    const b = atSprint(w, 2);
    b.x = -0.6;
    let lowest = 9;
    let landed = false;
    sim(w, b, { fwd: 1 }, 3, (bb) => {
      if (bb.z < -1.8 && bb.z > -2.4 && bb.ground) return 'jump';
      if (bb.wall) lowest = Math.min(lowest, bb.y);
      if (bb.ground && bb.z < -14) landed = true;
    });
    assert.ok(landed, `crossed the 12 m gap (ended at z ${b.z.toFixed(1)}, y ${b.y.toFixed(1)})`);
    assert.ok(lowest > -0.5);
  });

  test('a plain hop next to a wall, onto a stone just ahead, is not a wall run', () => {
    const w = new World([floor(-2, 10), wall(-1.6, -1, -4, 5, -14, 10), floor(-10, -4.4)]);
    const b = atSprint(w, 2);
    b.x = -0.6;
    let ran = false;
    sim(w, b, { fwd: 1 }, 0.8, (bb) => {
      if (bb.z < -1.6 && bb.z > -2.2 && bb.ground) return 'jump';
      if (bb.wall) ran = true;
    });
    assert.ok(!ran);
  });

  test('running into a wall head-on in the air runs up it once per jump', () => {
    const w = new World([floor(-10, 10), wall(-4, 4, 0, 8, -14, -10)]);
    const b = atSprint(w, 5);
    let top = 0;
    let climbs = 0;
    sim(w, b, { fwd: 1 }, 2, (bb) => {
      if (bb.z < -8.4 && bb.ground && climbs === 0) return 'jump';
      if (bb.events.includes('climb')) climbs++;
      top = Math.max(top, bb.y);
    });
    const plain = (MOVE.jump * MOVE.jump) / (2 * MOVE.gravity);
    assert.equal(climbs, 1);
    assert.ok(top > plain + 0.6, `ran up to ${top.toFixed(2)} (a plain jump: ${plain.toFixed(2)})`);
  });
});

describe('Mantles', () => {
  const ledge = (h: number) => new World([floor(-10, 10), { min: [-4, 0, -60], max: [4, h, -10], mat: 'stone' }]);

  for (const h of [1.2, 2.4, 3.2]) {
    test(`jumping at a ${h} m ledge climbs onto it`, () => {
      const w = ledge(h);
      const b = atSprint(w, 5);
      let mantled = false;
      sim(w, b, { fwd: 1 }, 3, (bb) => {
        if (bb.events.includes('mantle')) mantled = true;
        if (bb.z < -9 && bb.ground && bb.y < 0.1) return 'jump';
      });
      assert.ok(mantled);
      assert.ok(Math.abs(b.y - h) < 0.05 && b.z < -10, `on top (y ${b.y.toFixed(2)}, z ${b.z.toFixed(1)})`);
    });
  }

  test('a 4 m wall needs the wall run-up; 6 m is out of reach', () => {
    for (const [h, ok] of [
      [4.0, true],
      [6, false],
    ] as const) {
      const w = ledge(h);
      const b = atSprint(w, 5);
      sim(w, b, { fwd: 1 }, 3, (bb) => {
        if (bb.z < -8.6 && bb.ground && bb.y < 0.1) return 'jump';
      });
      assert.equal(Math.abs(b.y - h) < 0.05, ok, `${h} m: ended at y ${b.y.toFixed(2)}`);
    }
  });

  test('no mantle into a gap too low to stand or crouch in', () => {
    const w = new World([floor(-10, 10), { min: [-4, 0, -16], max: [4, 1.5, -10], mat: 'stone' }, wall(-4, 4, 2.2, 5, -16, -10)]);
    const b = atSprint(w, 5);
    let mantled = false;
    sim(w, b, { fwd: 1 }, 3, (bb) => {
      if (bb.events.includes('mantle')) mantled = true;
      if (bb.z < -9 && bb.ground && bb.y < 0.1) return 'jump';
    });
    assert.ok(!mantled && b.z > -10, `ended at y ${b.y.toFixed(2)}, z ${b.z.toFixed(2)}`);
  });
});

describe('Collision', () => {
  test('small steps are walked up; a ceiling stops a jump', () => {
    const w = new World([floor(-30, 10), { min: [-4, 0, -30], max: [4, 0.4, -6], mat: 'stone' }]);
    const b = atSprint(w, 5);
    sim(w, b, { fwd: 1 }, 2);
    assert.ok(Math.abs(b.y - 0.4) < 0.01 && b.ground);
    const c = new World([floor(-5, 5), wall(-4, 4, 2.2, 3, -5, 5)]);
    const j = newBody(0, 0, 0);
    let top = 0;
    sim(c, j, { jump: true }, 1, (bb) => void (top = Math.max(top, bb.y + bb.h)));
    assert.ok(top <= 2.2 + 1e-3);
  });
});

// ---------------------------------------------------------------------------------------------
// The course

describe('Skerry Light', () => {
  const c = buildCourse();

  test('is built the same every time', () => {
    const d = buildCourse();
    assert.deepEqual(d.solids, c.solids);
    assert.deepEqual(d.legs, c.legs);
  });

  test('is a long climb: 150 m+ up, checkpoints in order and climbing', () => {
    assert.ok(c.top - c.start.spawn[1] > 150, `${c.top.toFixed(0)} m`);
    assert.ok(c.checkpoints.length >= 10);
    for (let i = 1; i < c.checkpoints.length; i++) assert.ok(c.checkpoints[i].spawn[1] > c.checkpoints[i - 1].spawn[1] - 1, c.checkpoints[i].name);
    assert.ok(c.finish.min[1] > c.checkpoints[c.checkpoints.length - 1].spawn[1]);
  });

  test('every checkpoint spawn stands on something, clear of every solid', () => {
    for (const cp of [...c.checkpoints, c.start]) {
      const b = newBody(...cp.spawn);
      sim(c.world, b, {}, 0.5);
      assert.ok(b.ground && Math.abs(b.y - cp.spawn[1]) < 0.05, `${'name' in cp ? cp.name : 'start'}: ${b.y.toFixed(2)}`);
    }
  });

  test('the rock never reaches into the route', () => {
    for (const r of c.rock)
      for (const s of c.solids) {
        if (c.rock.includes(s) || s.max[1] <= r.min[1] || s.min[1] >= r.max[1]) continue;
        const overlap = s.max[0] > r.min[0] + 0.01 && s.min[0] < r.max[0] - 0.01 && s.max[2] > r.min[2] + 0.01 && s.min[2] < r.max[2] - 0.01;
        // Pieces may rest on the plateau or cling to the lighthouse (on its faces), never inside the rock.
        if (overlap) assert.ok(s.min[1] >= r.max[1] - 1.01 || r.mat === 'plaster', `piece at ${s.min.map((v) => v.toFixed(1))} inside rock`);
      }
  });

  test('an autopilot climbs it end to end with the real movement, through every checkpoint', () => {
    const r = pilot(c);
    assert.ok(r.finished, r.why);
    assert.equal(r.checkpoints, c.checkpoints.length);
    // A perfect run is a few minutes; people will take a good deal longer.
    assert.ok(r.time > 120 && r.time < 400, `${r.time.toFixed(0)} s`);
    assert.ok(r.top > MOVE.sprint + 2, 'slides and ramps build speed past a sprint');
  });

  test('progress: checkpoints only count forward; the sea sends you back; the gallery finishes', () => {
    const cp = c.checkpoints[3];
    const at = { x: cp.spawn[0], y: cp.spawn[1] + 0.5, z: cp.spawn[2] };
    assert.equal(progress(c, at, -1).cp, 3);
    assert.equal(progress(c, at, 5).cp, 5, 'never backwards');
    assert.ok(progress(c, { x: 0, y: c.sea - 1, z: 80 }, 2).drowned);
    const [lx, ly, lz] = c.lantern;
    assert.ok(progress(c, { x: lx + 3.5, y: ly + 0.1, z: lz }, 12).finished);
    assert.deepEqual(spawnFor(c, -1), c.start);
    assert.equal(heightShare(c, c.top), 1);
    assert.equal(heightShare(c, c.start.spawn[1]), 0);
  });
});

// ---------------------------------------------------------------------------------------------
// The wire

describe('Messages', () => {
  test('well-formed messages pass', () => {
    assert.deepEqual(readMsg({ t: 'st', n: 2, p: [1.5, 20, -3], yaw: 1, a: 3, s: 8.2, w: -1, cp: 4 }), { t: 'st', n: 2, p: [1.5, 20, -3], yaw: 1, a: 3, s: 8.2, w: -1, cp: 4 });
    assert.deepEqual(readMsg({ t: 'go', n: 1 }), { t: 'go', n: 1 });
    assert.deepEqual(readMsg({ t: 'hi' }), { t: 'hi' });
    assert.deepEqual(readMsg({ t: 'fin', n: 1, ms: 183000 }), { t: 'fin', n: 1, ms: 183000 });
  });

  test('anything else is dropped', () => {
    for (const bad of [
      null,
      'st',
      { t: 'st', n: 1, p: [1, 2], yaw: 0, a: 1, s: 1, w: 0, cp: 0 },
      { t: 'st', n: 1, p: [1, 2, NaN], yaw: 0, a: 1, s: 1, w: 0, cp: 0 },
      { t: 'st', n: 1, p: [1, 2, 3], yaw: 0, a: 9, s: 1, w: 0, cp: 0 },
      { t: 'st', n: 1, p: [1, 2, 1e9], yaw: 0, a: 1, s: 1, w: 0, cp: 0 },
      { t: 'cp', n: 1, i: -2 },
      { t: 'fin', n: 1, ms: -5 },
      { t: 'fin', n: 1, ms: 1.5 },
      { t: 'go', n: '1' },
      { t: 'boom' },
    ])
      assert.equal(readMsg(bad), null, JSON.stringify(bad));
  });

  test('clock formats minutes, seconds and hundredths', () => {
    assert.equal(clock(0), '0:00.00');
    assert.equal(clock(183456), '3:03.46');
    assert.equal(clock(61005), '1:01.01');
  });
});
