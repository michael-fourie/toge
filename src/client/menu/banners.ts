// Animated banners for the game chooser's channels (2D canvas, no assets). Each runs until its canvas
// leaves the page.

import { startSkirmish } from './skirmish.ts';

/** Gambol: the sky-island skirmish the shooter's loading screen uses. */
export function gambolBanner(canvas: HTMLCanvasElement) {
  startSkirmish(canvas);
}

/**
 * Tōge: dusk over a mountain pass. Layered ridges, a switchback road down the face, and cars' tail lights
 * snaking down it with light trails.
 */
export function tougeBanner(canvas: HTMLCanvasElement) {
  const g = canvas.getContext('2d');
  if (!g) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0;
  let H = 0;
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio);
    W = Math.max(1, Math.round(r.width * dpr));
    H = Math.max(1, Math.round(r.height * dpr));
    canvas.width = W;
    canvas.height = H;
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // The road: a switchback in normalised coordinates, sampled into a polyline.
  const road: [number, number][] = [];
  const legs = 5;
  for (let i = 0; i <= 400; i++) {
    const u = i / 400;
    const leg = u * legs;
    const k = Math.floor(Math.min(legs - 1e-6, leg));
    const f = leg - k;
    const ease = f * f * (3 - 2 * f);
    const x = k % 2 === 0 ? 0.18 + 0.64 * ease : 0.82 - 0.64 * ease;
    const y = 0.36 + u * 0.56 + Math.sin(f * Math.PI) * 0.025;
    road.push([x, y]);
  }
  const at = (u: number) => road[Math.max(0, Math.min(road.length - 1, Math.round(u * (road.length - 1))))];
  const cars = [0, 0.12, 0.27, 0.41].map((u, i) => ({ u, speed: 0.045 + i * 0.004, hue: i }));
  const stars = Array.from({ length: 60 }, () => [Math.random(), Math.random() * 0.4, Math.random()]);

  const ridge = (seed: number, base: number, amp: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += W / 60) {
      const t = x / W;
      const y = base + Math.sin(t * 7 + seed) * amp * 0.5 + Math.sin(t * 17 + seed * 2) * amp * 0.25 + Math.abs(Math.sin(t * 3.3 + seed)) * -amp;
      g.lineTo(x, y * H);
    }
    g.lineTo(W, H);
    g.fill();
  };

  let last = performance.now();
  const draw = (now: number) => {
    if (!canvas.isConnected) {
      ro.disconnect();
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1b2a55');
    sky.addColorStop(0.45, '#7a4f8f');
    sky.addColorStop(0.7, '#f08a5d');
    sky.addColorStop(1, '#ffd29a');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    for (const [x, y, s] of stars) g.fillRect(x * W, y * H, 1 + s * 1.5, 1 + s * 1.5);
    // Sun low behind the ridges.
    const sun = g.createRadialGradient(W * 0.7, H * 0.42, 0, W * 0.7, H * 0.42, H * 0.5);
    sun.addColorStop(0, 'rgba(255,230,170,0.95)');
    sun.addColorStop(0.15, 'rgba(255,190,120,0.6)');
    sun.addColorStop(1, 'rgba(255,160,100,0)');
    g.fillStyle = sun;
    g.fillRect(0, 0, W, H);
    ridge(1, 0.45, 0.22, '#6b4a7d');
    ridge(4, 0.55, 0.16, '#4b3664');
    ridge(2.2, 0.66, 0.08, '#2c2340');
    // The road, lit faintly.
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(30,24,44,1)';
    g.lineWidth = H * 0.03;
    g.beginPath();
    road.forEach(([x, y], i) => (i ? g.lineTo(x * W, y * H) : g.moveTo(x * W, y * H)));
    g.stroke();
    g.strokeStyle = 'rgba(255,220,160,0.25)';
    g.lineWidth = Math.max(1, H * 0.004);
    g.setLineDash([H * 0.012, H * 0.016]);
    g.stroke();
    g.setLineDash([]);
    // Cars: a glowing trail behind each, tail lights red, the leader's headlights sweeping ahead.
    for (const c of cars) {
      if (!still) c.u = (c.u + c.speed * dt) % 1;
      for (let k = 18; k >= 0; k--) {
        const [x, y] = at(c.u - k * 0.004);
        g.fillStyle = `rgba(255,${60 + c.hue * 20},60,${(1 - k / 18) * 0.5})`;
        g.beginPath();
        g.arc(x * W, y * H, H * 0.008 * (1 - k / 22), 0, Math.PI * 2);
        g.fill();
      }
      const [x, y] = at(c.u);
      const [nx, ny] = at(c.u + 0.01);
      const beam = g.createRadialGradient(nx * W, ny * H, 0, nx * W, ny * H, H * 0.05);
      beam.addColorStop(0, 'rgba(255,250,220,0.55)');
      beam.addColorStop(1, 'rgba(255,250,220,0)');
      g.fillStyle = beam;
      g.fillRect(nx * W - H * 0.05, ny * H - H * 0.05, H * 0.1, H * 0.1);
      g.fillStyle = '#ff3b3b';
      g.beginPath();
      g.arc(x * W, y * H, H * 0.009, 0, Math.PI * 2);
      g.fill();
    }
    if (!still) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
