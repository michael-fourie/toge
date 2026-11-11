// The climber: first-person parkour movement, pure and deterministic (no three.js, no DOM), stepped at a fixed
// TICK by every browser for its own player and by the tests. Units are metres and seconds, Y up, yaw 0 looks down -Z.
//
// What it does, in the order a tick runs:
//   timers (coyote time, jump buffer) -> wall run / mantle / slide state -> ground or air acceleration -> gravity ->
//   collision (axis by axis, with step-up and ground snapping) -> what the player touches now.
//
// Feel rules (keep them; the tests in tests/beacon.test.ts guard them):
// - Momentum is kept: landing never costs speed, the air has no friction, and only the ground slows you, gently,
//   when you're over your running speed. Slides, slide jumps, wall jumps and downhill slides build speed.
// - Forgiving inputs: a jump pressed just before landing still happens (JUMP_BUFFER), and a jump just after running
//   off an edge or a wall still counts (COYOTE).
// - Ledges come to you: running or jumping into a ledge within reach climbs it (mantle), and a wall you meet
//   side-on while airborne and fast is run along without pressing anything.

/** Every tunable of the movement, in metres and seconds. */
export const MOVE = {
  tick: 1 / 120,
  radius: 0.32,
  height: 1.8,
  crouchHeight: 1.05,
  /** Eye below the top of the body. */
  eyeDrop: 0.12,
  gravity: 24,
  /** Ground speeds: walking (Shift), strafing/backing, sprinting forward, crouched. */
  walk: 3.2,
  run: 6.0,
  sprint: 8.6,
  crouch: 2.6,
  /** Ground acceleration up to `run`, then the slower build to `sprint` (the "getting going" feel). */
  accel: 48,
  sprintAccel: 9,
  /** With no input, how fast the ground stops you. */
  stopDecel: 34,
  /** Over the target speed with input held: a gentle bleed so carried momentum lasts. */
  overDecel: 4.5,
  /** How fast a fast player can swing their direction on the ground (rad/s). */
  turnRate: 7,
  /** Air control: you can steer toward airWish m/s in any direction but never add speed past it. */
  airAccel: 16,
  airWish: 6.2,
  /** How fast held direction turns your carried speed in the air (rad/s). */
  airTurn: 2.4,
  jump: 8.0,
  /** Letting go of jump while still rising cuts the jump to this upward speed (short hops). */
  jumpCut: 3.2,
  coyote: 0.12,
  jumpBuffer: 0.15,
  /** Steps this tall are walked up without jumping. */
  step: 0.5,
  /** Snaps you down onto a floor this close below while walking downhill or off a small step. */
  snap: 0.35,
  // Slide
  slideMin: 5.0,
  slideBoost: 2.6,
  slideBoostCooldown: 0.9,
  slideDecel: 2.6,
  slideTurn: 1.6,
  slideEnd: 3.4,
  /** Downhill pull on a ramp while sliding, as a share of gravity times the slope. */
  slideSlope: 0.95,
  maxSpeed: 15,
  // Wall run
  wallReach: 0.5,
  wallMinSpeed: 4.6,
  wallTime: 1.35,
  wallSpeed: 8.8,
  wallLift: 3.2,
  /** Gravity while wall running grows from wallGravity0 to wallGravity1 over the run. */
  wallGravity0: 0.12,
  wallGravity1: 0.75,
  wallJumpOut: 6.0,
  wallJumpUp: 7.6,
  /** Must be at least this far above a floor to start a wall run. */
  wallClear: 0.7,
  /** …and with no floor within wallLookDrop below the spot wallLook metres ahead (else you're landing, not running). */
  wallLook: 2.8,
  wallLookDrop: 2.2,
  // Wall climb: running straight into a wall in the air, you run up it for a moment, once per jump.
  climbSpeed: 5.6,
  climbTime: 0.3,
  // Mantle: hands reach this far above your feet.
  reach: 2.05,
  mantleMin: 0.4,
  mantleBase: 0.16,
  mantlePerMetre: 0.12,
  /** Share of your speed you keep coming over a ledge (never below mantleExit). */
  mantleKeep: 0.6,
  mantleExit: 3.2,
} as const;

export type Mat = 'rock' | 'stone' | 'wood' | 'steel' | 'concrete' | 'plaster' | 'brick' | 'moss';

/** A solid: an axis-aligned box, or a ramp (a box whose top rises along one axis). */
export interface Solid {
  min: [number, number, number];
  max: [number, number, number];
  mat: Mat;
  /** Ramp: the top rises from min.y to max.y along `axis` (0 = x, 2 = z) in direction `dir`. */
  ramp?: { axis: 0 | 2; dir: 1 | -1 };
}

/** The top of a solid under (x, z): its max.y, or the ramp's surface there. */
export function topAt(s: Solid, x: number, z: number): number {
  if (!s.ramp) return s.max[1];
  const a = s.ramp.axis;
  const c = a === 0 ? x : z;
  let t = (c - s.min[a]) / (s.max[a] - s.min[a]);
  t = Math.max(0, Math.min(1, t));
  if (s.ramp.dir < 0) t = 1 - t;
  return s.min[1] + (s.max[1] - s.min[1]) * t;
}

/** The world's solids, bucketed in a coarse XZ grid so a tick only looks at what's nearby. */
export class World {
  private cells = new Map<number, number[]>();
  private mark: Int32Array;
  private stamp = 0;
  static CELL = 8;

  constructor(readonly solids: Solid[]) {
    this.mark = new Int32Array(solids.length);
    solids.forEach((s, i) => {
      for (let cx = Math.floor(s.min[0] / World.CELL); cx <= Math.floor(s.max[0] / World.CELL); cx++)
        for (let cz = Math.floor(s.min[2] / World.CELL); cz <= Math.floor(s.max[2] / World.CELL); cz++) {
          const k = key(cx, cz);
          const list = this.cells.get(k);
          if (list) list.push(i);
          else this.cells.set(k, [i]);
        }
    });
  }

  /** Solids whose box overlaps [x0,x1]×[z0,z1] (each once). */
  near(x0: number, z0: number, x1: number, z1: number, out: Solid[] = []): Solid[] {
    out.length = 0;
    this.stamp++;
    for (let cx = Math.floor(x0 / World.CELL); cx <= Math.floor(x1 / World.CELL); cx++)
      for (let cz = Math.floor(z0 / World.CELL); cz <= Math.floor(z1 / World.CELL); cz++) {
        const list = this.cells.get(key(cx, cz));
        if (!list) continue;
        for (const i of list) {
          if (this.mark[i] === this.stamp) continue;
          this.mark[i] = this.stamp;
          out.push(this.solids[i]);
        }
      }
    return out;
  }
}

const key = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);

export interface Input {
  /** Forward and right, −1..1. */
  fwd: number;
  side: number;
  /** Where you look (radians). */
  yaw: number;
  jump: boolean;
  crouch: boolean;
  /** Shift: walk carefully instead of sprinting. */
  walk: boolean;
}

export const idle = (yaw = 0): Input => ({ fwd: 0, side: 0, yaw, jump: false, crouch: false, walk: false });

/** Things that happened this tick, for sound, camera and animation. */
export type MoveEvent = 'jump' | 'land' | 'walljump' | 'wallrun' | 'mantle' | 'slide' | 'climb';

export interface Body {
  /** Feet, centre of the footprint. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  h: number;
  ground: boolean;
  /** The floor under you is a ramp (its solid), for slides. */
  floor: Solid | null;
  /** Seconds since you could last jump from the ground (or a wall): coyote time counts it. */
  air: number;
  buffer: number;
  jumpHeld: boolean;
  /** A ground jump still rising, which letting go of jump may cut short. */
  cuttable: boolean;
  crouched: boolean;
  sliding: boolean;
  slideCd: number;
  /** Wall run: the wall's outward normal (axis-aligned), and how long you've run on it. */
  wall: { nx: number; nz: number; t: number; key: string } | null;
  /** The wall you last left and how long ago (for the wall-jump coyote time). */
  lastWall: { nx: number; nz: number; t: number; key: string } | null;
  /** Walls already run since you last touched the ground (no running the same wall twice). */
  used: string[];
  climbed: boolean;
  /** Seconds left running up the wall in front. */
  climbT: number;
  mantle: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t: number; dur: number; keep: number; yaw: number } | null;
  /** Speed you hit the ground with this tick (for the camera dip), 0 otherwise. */
  impact: number;
  events: MoveEvent[];
}

export function newBody(x: number, y: number, z: number): Body {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    h: MOVE.height,
    ground: false,
    floor: null,
    air: 0,
    buffer: 0,
    jumpHeld: false,
    cuttable: false,
    crouched: false,
    sliding: false,
    slideCd: 0,
    wall: null,
    lastWall: null,
    used: [],
    climbed: false,
    climbT: 0,
    mantle: null,
    impact: 0,
    events: [],
  };
}

export const hspeed = (b: Body) => Math.hypot(b.vx, b.vz);
export const eyeHeight = (b: Body) => b.h - MOVE.eyeDrop;

// ---------------------------------------------------------------------------------------------
// Collision

const scratch: Solid[] = [];

/** First solid the body would overlap standing at (x, y, z) with height h (shrunk by `pad` on every side). */
function hit(w: World, x: number, y: number, z: number, h: number, pad = 0): Solid | null {
  const r = MOVE.radius - pad;
  const list = w.near(x - r, z - r, x + r, z + r, scratch);
  for (const s of list) {
    if (x + r <= s.min[0] || x - r >= s.max[0] || z + r <= s.min[2] || z - r >= s.max[2]) continue;
    const top = topAt(s, x, z);
    if (y + h - pad <= s.min[1] || y + pad >= top) continue;
    return s;
  }
  return null;
}

export const blocked = (w: World, x: number, y: number, z: number, h: number) => hit(w, x, y, z, h) !== null;

/** The highest floor top under the footprint at or below y + up (or -Infinity). */
function floorBelow(w: World, x: number, y: number, z: number, up: number): { top: number; s: Solid | null } {
  const r = MOVE.radius;
  const list = w.near(x - r, z - r, x + r, z + r, scratch);
  let best = -Infinity;
  let bs: Solid | null = null;
  for (const s of list) {
    if (x + r <= s.min[0] || x - r >= s.max[0] || z + r <= s.min[2] || z - r >= s.max[2]) continue;
    const top = topAt(s, x, z);
    if (top <= y + up && top > best) {
      best = top;
      bs = s;
    }
  }
  return { top: best, s: bs };
}

/** Moves along one horizontal axis, stepping up small ledges when on the ground. Returns the wall normal hit (0 if none). */
function slideAxis(w: World, b: Body, axis: 0 | 2, d: number): number {
  if (d === 0) return 0;
  const nx = axis === 0 ? b.x + d : b.x;
  const nz = axis === 2 ? b.z + d : b.z;
  const s = hit(w, nx, b.y, nz, b.h);
  if (!s) {
    b.x = nx;
    b.z = nz;
    return 0;
  }
  // Step up: on (or just off) the ground, a low enough top is walked onto.
  if (b.ground || b.air < 0.05) {
    const top = floorBelow(w, nx, b.y, nz, MOVE.step).top;
    if (top > b.y && top - b.y <= MOVE.step && !hit(w, nx, top + 0.001, nz, b.h)) {
      b.x = nx;
      b.z = nz;
      b.y = top + 0.001;
      return 0;
    }
  }
  // Push flush against the face.
  const r = MOVE.radius;
  if (axis === 0) {
    b.x = d > 0 ? Math.min(nx, s.min[0] - r - 1e-4) : Math.max(nx, s.max[0] + r + 1e-4);
    if (blocked(w, b.x, b.y, b.z, b.h)) b.x -= d; // wedged between two: stay put
    b.vx = 0;
  } else {
    b.z = d > 0 ? Math.min(nz, s.min[2] - r - 1e-4) : Math.max(nz, s.max[2] + r + 1e-4);
    if (blocked(w, b.x, b.y, b.z, b.h)) b.z -= d;
    b.vz = 0;
  }
  return d > 0 ? -1 : 1;
}

function moveVertical(w: World, b: Body, d: number) {
  const ny = b.y + d;
  const s = hit(w, b.x, ny, b.z, b.h);
  if (!s) {
    b.y = ny;
    return;
  }
  if (d < 0) {
    const f = floorBelow(w, b.x, b.y + 0.01, b.z, 0);
    b.y = Number.isFinite(f.top) && f.top <= b.y + 0.01 ? Math.max(ny, f.top) : b.y;
    if (b.vy < 0) {
      b.impact = -b.vy;
      b.vy = 0;
    }
    b.ground = true;
    b.floor = f.s;
  } else {
    b.y = Math.min(ny, s.min[1] - b.h - 1e-4);
    if (b.vy > 0) b.vy = 0;
    b.cuttable = false;
  }
}

/** Axis-aligned wall within `reach` in direction (dx, dz), measured at chest height: its key, or null. */
function wallAt(w: World, b: Body, dx: number, dz: number, reach: number): string | null {
  const s = hit(w, b.x + dx * reach, b.y + 0.35, b.z + dz * reach, Math.max(0.4, b.h - 0.6));
  if (!s) return null;
  const face = dx > 0 ? s.min[0] : dx < 0 ? s.max[0] : dz > 0 ? s.min[2] : s.max[2];
  return `${dx},${dz},${face.toFixed(2)}`;
}

// ---------------------------------------------------------------------------------------------
// The tick

/** Advances the body one TICK. `b.events` lists what happened (cleared at the start of each tick). */
export function step(w: World, b: Body, inp: Input, dt: number = MOVE.tick) {
  b.events.length = 0;
  b.impact = 0;
  const jumpPress = inp.jump && !b.jumpHeld;
  b.jumpHeld = inp.jump;
  if (jumpPress) b.buffer = MOVE.jumpBuffer;
  else b.buffer = Math.max(0, b.buffer - dt);
  b.slideCd = Math.max(0, b.slideCd - dt);
  if (b.lastWall) b.lastWall.t += dt;

  if (b.mantle) return mantleTick(w, b, dt);

  const fx = -Math.sin(inp.yaw);
  const fz = -Math.cos(inp.yaw);
  const rx = Math.cos(inp.yaw);
  const rz = -Math.sin(inp.yaw);
  let wx = fx * inp.fwd + rx * inp.side;
  let wz = fz * inp.fwd + rz * inp.side;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) {
    wx /= wl;
    wz /= wl;
  }
  const wish = Math.min(1, wl);

  // Crouch / stand.
  const wantCrouch = inp.crouch;
  if (wantCrouch && !b.crouched) {
    b.crouched = true;
    b.h = MOVE.crouchHeight;
    if (b.ground && hspeed(b) >= MOVE.slideMin) startSlide(b);
  } else if (!wantCrouch && b.crouched && !blocked(w, b.x, b.y, b.z, MOVE.height)) {
    b.crouched = false;
    b.sliding = false;
    b.h = MOVE.height;
  }

  // ----- Jumps (ground, coyote, wall)
  if (b.buffer > 0) {
    if (b.wall || (b.lastWall && b.lastWall.t < MOVE.coyote && !b.ground)) {
      wallJump(b);
    } else if (b.ground || b.air < MOVE.coyote) {
      if (!blocked(w, b.x, b.y, b.z, MOVE.height) || b.crouched) {
        b.vy = MOVE.jump;
        b.ground = false;
        b.air = MOVE.coyote;
        b.buffer = 0;
        b.cuttable = true;
        b.events.push('jump');
        if (b.sliding) {
          // Slide jump: keep every bit of speed, stand up if there's room.
          b.sliding = false;
          if (!blocked(w, b.x, b.y, b.z, MOVE.height)) {
            b.crouched = false;
            b.h = MOVE.height;
          }
        }
      }
    }
  }
  if (b.cuttable && !inp.jump && b.vy > MOVE.jumpCut) {
    b.vy = MOVE.jumpCut;
    b.cuttable = false;
  }
  if (b.vy <= 0) b.cuttable = false;

  // ----- Horizontal acceleration
  if (b.wall) wallRunTick(w, b, inp, dt);
  else if (b.ground) groundAccel(b, inp, wx, wz, wish, dt);
  else airAccel(b, wx, wz, wish, dt);

  const sp = hspeed(b);
  if (sp > MOVE.maxSpeed) {
    b.vx *= MOVE.maxSpeed / sp;
    b.vz *= MOVE.maxSpeed / sp;
  }

  // ----- Running up a wall: hold the climb speed while you push into it.
  if (b.climbT > 0) {
    b.climbT -= dt;
    if (b.ground || inp.fwd < 0.3 || !blocked(w, b.x + fx * MOVE.wallReach, b.y + 0.4, b.z + fz * MOVE.wallReach, Math.max(0.3, b.h - 0.5))) b.climbT = 0;
    else if (b.vy < MOVE.climbSpeed) b.vy = MOVE.climbSpeed;
  }

  // ----- Gravity
  if (!b.ground) {
    let g = MOVE.gravity;
    if (b.wall) {
      const k = Math.min(1, b.wall.t / MOVE.wallTime);
      g *= MOVE.wallGravity0 + (MOVE.wallGravity1 - MOVE.wallGravity0) * k * k;
    }
    b.vy -= g * dt;
  } else if (b.vy < 0) b.vy = 0;

  // ----- Move
  const wasGround = b.ground;
  b.ground = false;
  const nx = slideAxis(w, b, 0, b.vx * dt);
  const nz = slideAxis(w, b, 2, b.vz * dt);
  moveVertical(w, b, b.vy * dt);
  // Stay on the floor walking down a ramp or off a small step (not after a jump).
  if (!b.ground && wasGround && b.vy <= 0) {
    const f = floorBelow(w, b.x, b.y, b.z, 0);
    if (b.y - f.top <= MOVE.snap && !blocked(w, b.x, f.top + 0.001, b.z, b.h)) {
      b.y = f.top + 0.0005;
      b.ground = true;
      b.floor = f.s;
    }
  }
  if (b.ground) {
    if (!wasGround) {
      b.events.push('land');
      if (b.impact === 0) b.impact = 0.01;
      // Carried momentum at a run into a crouch on landing: slide straight on.
      if (b.crouched && hspeed(b) >= MOVE.slideMin) startSlide(b);
    }
    b.air = 0;
    b.climbed = false;
    b.climbT = 0;
    b.used.length = 0;
    b.lastWall = null;
    if (b.wall) b.wall = null;
  } else {
    b.air += dt;
    b.floor = null;
  }

  if (!b.ground && !b.wall) {
    if (tryMantle(w, b, inp, fx, fz, wish)) return;
    tryWall(w, b, inp, fx, fz, nx, nz);
  }
}

function startSlide(b: Body) {
  if (b.sliding) return;
  b.sliding = true;
  b.events.push('slide');
  if (b.slideCd <= 0) {
    const sp = hspeed(b);
    const k = Math.min(MOVE.maxSpeed, sp + MOVE.slideBoost) / sp;
    b.vx *= k;
    b.vz *= k;
    b.slideCd = MOVE.slideBoostCooldown;
  }
}

function groundAccel(b: Body, inp: Input, wx: number, wz: number, wish: number, dt: number) {
  const sp = hspeed(b);
  if (b.sliding) {
    // Sliding: slow bleed, weak steering, pulled down slopes.
    let ns = Math.max(0, sp - MOVE.slideDecel * dt);
    const f = b.floor;
    if (f?.ramp) {
      const a = f.ramp.axis;
      const len = f.max[a] - f.min[a];
      const slope = (f.max[1] - f.min[1]) / len;
      const down = -f.ramp.dir; // downhill along the axis
      const pull = (MOVE.gravity * MOVE.slideSlope * slope) / Math.sqrt(1 + slope * slope);
      if (a === 0) b.vx += down * pull * dt;
      else b.vz += down * pull * dt;
      ns = Math.max(0, hspeed(b) - MOVE.slideDecel * dt);
    }
    steer(b, wx, wz, wish, MOVE.slideTurn, dt, ns);
    if (ns < MOVE.slideEnd) b.sliding = false;
    return;
  }
  let target: number = inp.walk ? MOVE.walk : b.crouched ? MOVE.crouch : MOVE.run;
  // Sprint is running forward: build from run to sprint speed while you keep going that way.
  const forwardish = inp.fwd > 0.5 && Math.abs(inp.side) < 0.8;
  if (!inp.walk && !b.crouched && forwardish) target = MOVE.sprint;
  target *= wish;
  if (wish === 0) {
    const ns = Math.max(0, sp - MOVE.stopDecel * dt);
    if (sp > 0) {
      b.vx *= ns / sp;
      b.vz *= ns / sp;
    }
    return;
  }
  if (sp > target) {
    // Carried momentum: bleed gently, steer toward input.
    const ns = Math.max(target, sp - (inp.walk || b.crouched ? MOVE.stopDecel : MOVE.overDecel) * dt);
    steer(b, wx, wz, wish, MOVE.turnRate, dt, ns);
    return;
  }
  // Accelerate toward wish * target: fast up to run speed, slower beyond (the sprint build).
  const tx = wx * target;
  const tz = wz * target;
  let dx = tx - b.vx;
  let dz = tz - b.vz;
  const dl = Math.hypot(dx, dz);
  const a = (sp < MOVE.run ? MOVE.accel : MOVE.sprintAccel) * dt;
  // Turning hard is always quick: only the speed build beyond a run is slow.
  const along = (b.vx * wx + b.vz * wz) / Math.max(1e-6, sp);
  const lim = sp >= MOVE.run && along > 0.9 ? Math.max(a, MOVE.accel * dt * 0.25) : MOVE.accel * dt;
  if (dl > lim) {
    dx *= lim / dl;
    dz *= lim / dl;
  }
  b.vx += dx;
  b.vz += dz;
}

/** Turns the horizontal velocity toward the wish direction at `rate`, at speed `ns`. */
function steer(b: Body, wx: number, wz: number, wish: number, rate: number, dt: number, ns: number) {
  let ang = Math.atan2(b.vx, b.vz);
  if (wish > 0) {
    const want = Math.atan2(wx, wz);
    let d = want - ang;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    // Pulling back against the motion brakes instead of spinning round.
    if (Math.abs(d) > 2.3) ns = Math.max(0, ns - MOVE.stopDecel * 0.5 * dt);
    else ang += Math.max(-rate * dt, Math.min(rate * dt, d));
  }
  b.vx = Math.sin(ang) * ns;
  b.vz = Math.cos(ang) * ns;
}

function airAccel(b: Body, wx: number, wz: number, wish: number, dt: number) {
  if (wish === 0) return;
  // Steer: turn the speed you carry toward where you're pushing (never adds or removes speed).
  const sp = hspeed(b);
  if (sp > 0.5) {
    const d = Math.atan2(Math.sin(Math.atan2(wx, wz) - Math.atan2(b.vx, b.vz)), Math.cos(Math.atan2(wx, wz) - Math.atan2(b.vx, b.vz)));
    if (Math.abs(d) < 1.7) steer(b, wx, wz, wish, MOVE.airTurn * wish, dt, sp);
  }
  const cur = b.vx * wx + b.vz * wz;
  const add = Math.max(0, Math.min(MOVE.airWish * wish - cur, MOVE.airAccel * dt));
  b.vx += wx * add;
  b.vz += wz * add;
}

// ---------------------------------------------------------------------------------------------
// Walls

const AXES: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function tryWall(w: World, b: Body, inp: Input, fx: number, fz: number, nx: number, nz: number) {
  const sp = hspeed(b);
  for (const [dx, dz] of AXES) {
    const k = wallAt(w, b, dx, dz, MOVE.wallReach);
    if (!k) continue;
    const vin = (b.vx * dx + b.vz * dz) / Math.max(sp, 1e-6);
    const face = fx * dx + fz * dz;
    // Head on (looking at it, pushing into it): kick up it once per jump.
    const into = (dx !== 0 && nx === -dx) || (dz !== 0 && nz === -dz) || vin > 0.6;
    if (face > 0.7 && into && inp.fwd > 0.3 && !b.climbed && b.vy > -3) {
      b.climbed = true;
      b.climbT = MOVE.climbTime;
      b.events.push('climb');
      return;
    }
    // Side on, fast, and moving along it: run on it.
    if (Math.abs(vin) < 0.72 && sp >= MOVE.wallMinSpeed && inp.fwd > 0 && !b.used.includes(k) && !inp.crouch) {
      if (floorBelow(w, b.x, b.y, b.z, 0).top > b.y - MOVE.wallClear) continue;
      // About to land anyway (a floor just ahead and not far below): a plain jump, not a wall run.
      const ax = b.x + (b.vx / sp) * MOVE.wallLook;
      const az = b.z + (b.vz / sp) * MOVE.wallLook;
      if (floorBelow(w, ax, b.y, az, 1.2).top > b.y - MOVE.wallLookDrop) continue;
      b.wall = { nx: -dx, nz: -dz, t: 0, key: k };
      b.used.push(k);
      b.vy = Math.max(Math.min(b.vy, 5), MOVE.wallLift);
      // Lose the part of the velocity into the wall, keep the rest.
      const vn = b.vx * dx + b.vz * dz;
      b.vx -= vn * dx;
      b.vz -= vn * dz;
      // Snap snug to the wall so the run doesn't drift off it.
      const gap = MOVE.wallReach - 0.02;
      for (let g = 0; g < gap; g += 0.05) {
        if (blocked(w, b.x + dx * 0.05, b.y, b.z + dz * 0.05, b.h)) break;
        b.x += dx * 0.05;
        b.z += dz * 0.05;
      }
      b.events.push('wallrun');
      return;
    }
  }
}

function wallRunTick(w: World, b: Body, inp: Input, dt: number) {
  const wl = b.wall!;
  wl.t += dt;
  const dx = -wl.nx;
  const dz = -wl.nz;
  // Along the wall: keep the speed, ease up toward wallSpeed.
  const vn = b.vx * dx + b.vz * dz;
  b.vx -= vn * dx;
  b.vz -= vn * dz;
  const sp = hspeed(b);
  if (sp > 0.01 && sp < MOVE.wallSpeed) {
    const ns = Math.min(MOVE.wallSpeed, sp + 5 * dt);
    b.vx *= ns / sp;
    b.vz *= ns / sp;
  }
  const still = wallAt(w, b, dx, dz, MOVE.wallReach);
  if (wl.t > MOVE.wallTime || !still || sp < MOVE.wallMinSpeed * 0.7 || inp.crouch || b.vy < -6) endWall(b);
}

function endWall(b: Body) {
  if (!b.wall) return;
  b.lastWall = { ...b.wall, t: 0 };
  b.wall = null;
}

function wallJump(b: Body) {
  const wl = b.wall ?? b.lastWall!;
  b.vx += wl.nx * MOVE.wallJumpOut;
  b.vz += wl.nz * MOVE.wallJumpOut;
  b.vy = MOVE.wallJumpUp;
  b.buffer = 0;
  b.wall = null;
  b.lastWall = null;
  b.climbed = false;
  b.events.push('walljump');
}

// ---------------------------------------------------------------------------------------------
// Mantle

/** Climbs a ledge in front of you if one is within reach, clear to stand on, and you're heading into it. */
function tryMantle(w: World, b: Body, inp: Input, fx: number, fz: number, wish: number): boolean {
  if (inp.fwd < 0.3 || wish < 0.3 || b.vy > 6.5) return false;
  const vfwd = b.vx * fx + b.vz * fz;
  if (vfwd < -1) return false;
  // Something in front at chest height?
  const probe = MOVE.radius + 0.28;
  if (!blocked(w, b.x + fx * 0.3, b.y + 0.5, b.z + fz * 0.3, Math.max(0.3, b.h - 0.7))) return false;
  const px = b.x + fx * probe;
  const pz = b.z + fz * probe;
  // The top of whatever's in front, within reach.
  const f = floorBelow(w, px, b.y + MOVE.reach, pz, 0);
  const rise = f.top - b.y;
  if (!Number.isFinite(f.top) || rise < MOVE.mantleMin || rise > MOVE.reach) return false;
  // Room to come up in place, and to stand (or crouch) on top.
  const tx = b.x + fx * (MOVE.radius * 2 + 0.25);
  const tz = b.z + fz * (MOVE.radius * 2 + 0.25);
  if (blocked(w, b.x, f.top + 0.01, b.z, MOVE.crouchHeight)) return false;
  let h: number = MOVE.height;
  if (blocked(w, tx, f.top + 0.01, tz, h)) {
    h = MOVE.crouchHeight;
    if (blocked(w, tx, f.top + 0.01, tz, h)) return false;
  }
  // The landing spot must actually be on that top (not off its far side).
  if (floorBelow(w, tx, f.top + 0.02, tz, 0).top < f.top - 0.05) return false;
  b.mantle = {
    x0: b.x,
    y0: b.y,
    z0: b.z,
    x1: tx,
    y1: f.top + 0.002,
    z1: tz,
    t: 0,
    dur: MOVE.mantleBase + MOVE.mantlePerMetre * rise,
    keep: Math.max(MOVE.mantleExit, hspeed(b) * MOVE.mantleKeep, vfwd * MOVE.mantleKeep),
    yaw: Math.atan2(-fx, -fz),
  };
  b.h = h;
  b.crouched = h < MOVE.height;
  b.wall = null;
  b.vx = b.vy = b.vz = 0;
  b.events.push('mantle');
  return true;
}

function mantleTick(w: World, b: Body, dt: number) {
  const m = b.mantle!;
  m.t += dt;
  const k = Math.min(1, m.t / m.dur);
  // Up first (the pull), then over (the push).
  const up = Math.min(1, k / 0.6);
  const over = Math.max(0, (k - 0.45) / 0.55);
  const e = (t: number) => t * t * (3 - 2 * t);
  b.y = m.y0 + (m.y1 - m.y0) * e(up);
  b.x = m.x0 + (m.x1 - m.x0) * e(over);
  b.z = m.z0 + (m.z1 - m.z0) * e(over);
  if (k >= 1) {
    b.mantle = null;
    b.x = m.x1;
    b.y = m.y1;
    b.z = m.z1;
    b.vx = -Math.sin(m.yaw) * m.keep;
    b.vz = -Math.cos(m.yaw) * m.keep;
    b.vy = 0;
    b.ground = true;
    b.air = 0;
    b.climbed = false;
    b.used.length = 0;
    if (b.crouched && !blocked(w, b.x, b.y, b.z, MOVE.height)) {
      b.crouched = false;
      b.h = MOVE.height;
    }
  }
}
