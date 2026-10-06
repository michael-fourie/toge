/**
 * The menu's living backdrop: a few floating islands bobbing in the sky, and faded shadow-players
 * bhopping around on them, leaping between islands and now and then sniping each other (tracer,
 * a flung body that fades away, a respawn somewhere else). Plain 2D canvas, one rAF loop that
 * stops itself when the canvas leaves the page. Reduced motion gets a single still frame.
 */

// Island art in a 320x300 box (same shapes as the old SVG). The grass top is the curve
// y = 118 - 64·t(1-t) for x = 36 + 248·t, which is what players stand on.
const ROCK = new Path2D('M40 120 Q160 92 280 120 L250 150 Q215 250 165 292 Q140 230 92 190 Q60 160 40 120Z');
const ROCK_SHADE = new Path2D('M92 190 Q140 232 165 292 Q170 230 150 180Z');
const GRASS = new Path2D('M36 118 Q160 86 284 118 Q280 132 250 136 Q160 120 70 138 Q40 134 36 118Z');
const surfaceY = (t: number) => 118 - 64 * t * (1 - t);

interface Island {
  x: number; // centre, fraction of the viewport width
  y: number; // grass line, fraction of the viewport height
  w: number; // width, fraction of min(vw, vh) * 1.6
  haze: number; // 0 near, 1 far
  tree: boolean;
  ruins: boolean;
  phase: number;
}

// Arranged around the edges so the menu card in the middle never hides the action.
const ISLANDS: Island[] = [
  { x: 0.13, y: 0.72, w: 0.3, haze: 0, tree: true, ruins: true, phase: 0 },
  { x: 0.87, y: 0.6, w: 0.24, haze: 0.1, tree: false, ruins: true, phase: 1.7 },
  { x: 0.2, y: 0.3, w: 0.15, haze: 0.45, tree: true, ruins: false, phase: 3.1 },
  { x: 0.8, y: 0.24, w: 0.13, haze: 0.55, tree: true, ruins: false, phase: 4.4 },
  { x: 0.62, y: 0.88, w: 0.2, haze: 0.2, tree: false, ruins: false, phase: 2.3 },
  { x: 0.38, y: 0.86, w: 0.12, haze: 0.35, tree: true, ruins: false, phase: 5.2 },
];

interface Spot {
  island: number;
  t: number; // 0..1 across the grass, kept away from the edges
}

interface Bean {
  at: Spot;
  arc: { from: Spot; to: Spot; start: number; dur: number; height: number } | null;
  nextMove: number;
  nextShot: number;
  facing: 1 | -1;
  alpha: number;
  dead: { x: number; y: number; vx: number; vy: number; spin: number; angle: number; since: number } | null;
  respawnAt: number;
}

interface Tracer {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  born: number;
}

const SHADOW = '42, 63, 92'; // deep sky-blue ink, drawn faint
const BEAN = 1.15; // silhouette size relative to its island's scale
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pickSpot = (island = Math.floor(Math.random() * ISLANDS.length)): Spot => ({ island, t: rand(0.22, 0.78) });

export function startSkirmish(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const g: CanvasRenderingContext2D = ctx; // narrowed once so the closures below see it as non-null
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0;
  let H = 0;
  let unit = 0;

  const resize = () => {
    const dpr = Math.min(devicePixelRatio, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    unit = Math.min(W, H) * 1.6;
  };

  /** Island transform for this moment: top-left origin, scale, and its bob. */
  const frame = (i: Island, time: number) => {
    const s = (i.w * unit) / 320;
    const bob = still ? 0 : Math.sin(time * 0.9 + i.phase) * 7;
    return { s, ox: i.x * W - 160 * s, oy: i.y * H - 102 * s + bob };
  };
  const spotPos = (sp: Spot, time: number) => {
    const i = ISLANDS[sp.island];
    const f = frame(i, time);
    return { x: f.ox + (36 + 248 * sp.t) * f.s, y: f.oy + surfaceY(sp.t) * f.s, scale: f.s };
  };

  const now = () => performance.now() / 1000;
  const beans: Bean[] = Array.from({ length: 7 }, (_, k) => ({
    at: pickSpot(k % ISLANDS.length),
    arc: null,
    nextMove: now() + rand(0, 1.5),
    nextShot: now() + rand(2, 6),
    facing: Math.random() < 0.5 ? 1 : -1,
    alpha: 1,
    dead: null,
    respawnAt: 0,
  }));
  const tracers: Tracer[] = [];

  const beanPos = (b: Bean, time: number) => {
    if (!b.arc) return spotPos(b.at, time);
    const u = Math.min(1, (time - b.arc.start) / b.arc.dur);
    const p0 = spotPos(b.arc.from, time);
    const p1 = spotPos(b.arc.to, time);
    return { x: p0.x + (p1.x - p0.x) * u, y: p0.y + (p1.y - p0.y) * u - 4 * b.arc.height * u * (1 - u), scale: p0.scale + (p1.scale - p0.scale) * u };
  };

  function think(b: Bean, time: number) {
    if (b.dead) {
      if (time >= b.respawnAt) {
        b.dead = null;
        b.at = pickSpot();
        b.alpha = 0;
        b.nextMove = time + rand(0.5, 1.2);
      }
      return;
    }
    if (b.arc && time >= b.arc.start + b.arc.dur) {
      b.at = b.arc.to;
      b.arc = null;
    }
    if (b.arc || time < b.nextMove) return;

    // Shoot someone on another island now and then.
    const targets = beans.filter((o) => o !== b && !o.dead && !o.arc && o.at.island !== b.at.island && o.alpha > 0.9);
    if (time >= b.nextShot && targets.length) {
      const o = targets[Math.floor(Math.random() * targets.length)];
      const a = beanPos(b, time);
      const t = beanPos(o, time);
      b.facing = t.x > a.x ? 1 : -1;
      tracers.push({ x0: a.x + b.facing * 14 * a.scale * BEAN, y0: a.y - 18 * a.scale * BEAN, x1: t.x, y1: t.y - 14 * t.scale * BEAN, born: time });
      const dir = Math.sign(t.x - a.x) || 1;
      o.dead = { x: t.x, y: t.y, vx: dir * rand(180, 320), vy: -rand(260, 420), spin: dir * rand(6, 12), angle: 0, since: time };
      o.respawnAt = time + rand(2.5, 4.5);
      b.nextShot = time + rand(3, 7);
      b.nextMove = time + 0.5;
      return;
    }

    // Otherwise keep moving: mostly little bhops, sometimes a leap to another island.
    const leap = Math.random() < 0.22;
    const to = leap ? pickSpot() : { island: b.at.island, t: Math.min(0.8, Math.max(0.2, b.at.t + rand(-0.3, 0.3))) };
    const from = b.at;
    const p0 = spotPos(from, time);
    const p1 = spotPos(to, time);
    b.facing = p1.x >= p0.x ? 1 : -1;
    const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    b.arc = { from, to, start: time, dur: leap ? 0.7 + dist / 900 : rand(0.32, 0.45), height: leap ? 60 + dist * 0.25 : rand(16, 30) };
    b.nextMove = time + b.arc.dur + (Math.random() < 0.7 ? rand(0, 0.08) : rand(0.4, 1.4)); // chain hops like a bhop
  }

  /** A goofy bean silhouette with a rifle: feet at (0, 0), ~30 px tall before scaling. */
  function drawBean(x: number, y: number, k: number, facing: number, angle: number, alpha: number) {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.scale(facing * k, k);
    g.globalAlpha = alpha;
    g.fillStyle = g.strokeStyle = `rgba(${SHADOW}, 0.32)`;
    g.beginPath();
    g.ellipse(0, -11, 6.5, 11, 0, 0, Math.PI * 2); // body
    g.fill();
    g.beginPath();
    g.arc(0, -25, 5, 0, Math.PI * 2); // head
    g.fill();
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-2, -16);
    g.lineTo(15, -19); // rifle
    g.stroke();
    g.restore();
  }

  function drawIsland(i: Island, time: number) {
    const f = frame(i, time);
    g.save();
    g.translate(f.ox, f.oy);
    g.scale(f.s, f.s);
    g.globalAlpha = 1 - i.haze * 0.55;
    g.fillStyle = '#a98c6c';
    g.fill(ROCK);
    g.fillStyle = 'rgba(138, 111, 85, 0.7)';
    g.fill(ROCK_SHADE);
    g.fillStyle = '#7fb24e';
    g.fill(GRASS);
    if (i.tree) {
      g.fillStyle = '#7a5236';
      g.fillRect(196, 40, 9, 70);
      for (const [cx, cy, r, c] of [
        [200, 44, 30, '#4f8a3c'],
        [178, 62, 22, '#6aa548'],
        [224, 60, 24, '#3f7434'],
        [204, 26, 18, '#6aa548'],
      ] as const) {
        g.fillStyle = c;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (i.ruins) {
      g.fillStyle = '#efdcbc';
      g.fillRect(92, 70, 10, 40);
      g.fillRect(120, 88, 10, 22);
      g.fillStyle = '#e3c79c';
      g.fillRect(88, 66, 18, 6);
    }
    // Haze: wash far islands toward the sky colour.
    if (i.haze > 0) {
      g.globalAlpha = i.haze * 0.5;
      g.fillStyle = '#cfe6f6';
      g.fill(ROCK);
      g.fill(GRASS);
    }
    g.restore();
  }

  let last = now();
  function draw() {
    if (!canvas.isConnected) return; // menu was replaced (e.g. a match started): stop
    const time = now();
    const dt = Math.min(0.05, time - last);
    last = time;
    if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize();
    g.clearRect(0, 0, W, H);

    // Far islands first.
    [...ISLANDS].sort((a, b) => b.haze - a.haze).forEach((i) => drawIsland(i, time));

    for (const b of beans) {
      if (!still) think(b, time);
      if (b.dead) {
        const d = b.dead;
        d.vy += 900 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.angle += d.spin * dt;
        const fade = Math.max(0, 1 - (time - d.since) / 1.3);
        drawBean(d.x, d.y, beanPos(b, time).scale * BEAN, b.facing, d.angle, fade);
        continue;
      }
      b.alpha = Math.min(1, b.alpha + dt * 1.5);
      const p = beanPos(b, time);
      drawBean(p.x, p.y, p.scale * BEAN, b.facing, 0, b.alpha);
    }

    // Tracers: a warm streak and a little muzzle flash that fade fast.
    for (let k = tracers.length - 1; k >= 0; k--) {
      const t = tracers[k];
      const age = time - t.born;
      if (age > 0.45) {
        tracers.splice(k, 1);
        continue;
      }
      const a = 1 - age / 0.45;
      g.strokeStyle = `rgba(255, 236, 190, ${0.55 * a})`;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(t.x0, t.y0);
      g.lineTo(t.x1, t.y1);
      g.stroke();
      g.fillStyle = `rgba(255, 241, 196, ${0.8 * a})`;
      g.beginPath();
      g.arc(t.x0, t.y0, 5 * a + 2, 0, Math.PI * 2);
      g.fill();
    }

    if (!still) requestAnimationFrame(draw);
  }
  resize();
  requestAnimationFrame(draw);
}
