// The channel tile and the menu's art: a cartoon bus barrelling down a road at sunset, the boys on the roof
// painting zombies, who go flying. 2D canvas; stops when the canvas leaves the page.

const PAINT = ['#ff3d7f', '#2fd3ff', '#ffd23f', '#7cff5b'];

export function paintBanner(canvas: HTMLCanvasElement) {
  const g = canvas.getContext('2d');
  if (!g) return;
  const start = performance.now();
  const zombies = Array.from({ length: 7 }, (_, i) => ({ x: 0.15 + i * 0.13, fly: -1, vy: 0, y: 0, spin: 0, c: '' }));
  const splats: { x: number; y: number; r: number; c: string }[] = [];
  let last = start;
  const draw = (now: number) => {
    if (!canvas.isConnected) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - start) / 1000;
    const W = canvas.width;
    const H = canvas.height;
    // Sunset sky and a big sun.
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#3b5fa8');
    sky.addColorStop(0.5, '#c97bb0');
    sky.addColorStop(0.8, '#ffb36b');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffe08a';
    g.beginPath();
    g.arc(W * 0.78, H * 0.48, H * 0.2, 0, 7);
    g.fill();
    // Hills and the road.
    const horizon = H * 0.66;
    g.fillStyle = '#5f8f4a';
    g.beginPath();
    g.moveTo(0, horizon);
    for (let x = 0; x <= W; x += 20) g.lineTo(x, horizon - 18 - Math.sin(x * 0.01 + 1) * 14);
    g.lineTo(W, H);
    g.lineTo(0, H);
    g.fill();
    g.fillStyle = '#4a4a55';
    g.fillRect(0, horizon + H * 0.06, W, H * 0.18);
    g.fillStyle = '#ffcc33';
    const dash = (t * 400) % 80;
    for (let x = -dash; x < W; x += 80) g.fillRect(x, horizon + H * 0.145, 40, 4);
    // Splats on the road scroll by.
    for (const s of splats) s.x -= dt * 400;
    while (splats.length && splats[0].x < -40) splats.shift();
    for (const s of splats) {
      g.fillStyle = s.c;
      g.beginPath();
      g.ellipse(s.x, s.y, s.r * 1.4, s.r * 0.45, 0, 0, 7);
      g.fill();
    }
    const busX = W * 0.3 + Math.sin(t * 0.7) * W * 0.03;
    const roadY = horizon + H * 0.2;
    // Zombies shamble in from the right; the bus sends them flying.
    for (const z of zombies) {
      if (z.fly < 0) {
        z.x -= dt * 0.38;
        if (z.x * W < busX + W * 0.2 && z.x * W > busX) {
          z.fly = 0;
          z.vy = -H * 1.6;
          z.c = PAINT[Math.floor(Math.random() * PAINT.length)];
          splats.push({ x: z.x * W, y: roadY - 4, r: 10 + Math.random() * 10, c: z.c });
        }
      } else {
        z.fly += dt;
        z.x += dt * 0.5;
        z.vy += H * 3.2 * dt;
        z.y += z.vy * dt;
        z.spin += dt * 12;
        if (z.y > 0 && z.fly > 0.3) Object.assign(z, { x: 1.1 + Math.random() * 0.4, fly: -1, y: 0, spin: 0, c: '' });
      }
      zombie(g, z.x * W, roadY + z.y, H * 0.0028, z.spin, z.c, t + z.x * 9);
    }
    bus(g, busX, roadY, H * 0.0028, t);
    // The title.
    g.font = `900 ${H * 0.2}px system-ui, sans-serif`;
    g.textAlign = 'left';
    g.lineWidth = H * 0.025;
    g.strokeStyle = '#1b1530';
    g.strokeText('BOYS DAY', W * 0.05, H * 0.27);
    g.fillStyle = '#ffd23f';
    g.fillText('BOYS DAY', W * 0.05, H * 0.27);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

/** A side-on cartoon bus, wheels on the line at y, facing right; `s` is pixels per unit. */
function bus(g: CanvasRenderingContext2D, x: number, y: number, s: number, t: number) {
  const bob = Math.sin(t * 12) * 1.5;
  g.save();
  g.translate(x, y + bob);
  g.scale(s * 100, s * 100);
  g.fillStyle = '#f2a516';
  g.strokeStyle = '#1b1530';
  g.lineWidth = 0.025;
  round(g, 0, -0.75, 1.7, 0.62, 0.08);
  g.fill();
  g.stroke();
  g.fillStyle = '#7fc8e8';
  for (let k = 0; k < 5; k++) g.fillRect(0.1 + k * 0.28, -0.68, 0.2, 0.2);
  g.fillRect(1.5, -0.68, 0.16, 0.3);
  g.fillStyle = '#f4efe6';
  g.fillRect(0, -0.44, 1.7, 0.04);
  for (const wx of [0.35, 1.35]) {
    g.fillStyle = '#1b1b1f';
    g.beginPath();
    g.arc(wx, -0.12, 0.13, 0, 7);
    g.fill();
  }
  // The boys on the roof, firing.
  for (let k = 0; k < 4; k++) {
    const bx = 0.25 + k * 0.38;
    g.fillStyle = PAINT[k];
    round(g, bx - 0.06, -1.0, 0.12, 0.25, 0.06);
    g.fill();
    g.fillStyle = '#ffd7b0';
    g.beginPath();
    g.arc(bx, -1.04, 0.07, 0, 7);
    g.fill();
    if (Math.sin(t * 9 + k * 2) > 0.3) {
      g.fillStyle = PAINT[k];
      g.beginPath();
      g.arc(bx + 0.25 + ((t * 3 + k) % 1) * 0.6, -0.95, 0.025, 0, 7);
      g.fill();
    }
  }
  g.restore();
}

function zombie(g: CanvasRenderingContext2D, x: number, y: number, s: number, spin: number, paint: string, t: number) {
  g.save();
  g.translate(x, y);
  g.scale(s * 100, s * 100);
  g.translate(0, -0.3);
  g.rotate(spin);
  g.fillStyle = paint || '#6d5f8a';
  round(g, -0.08, -0.2, 0.16, 0.28, 0.06);
  g.fill();
  g.fillStyle = '#8fbf70';
  g.beginPath();
  g.arc(0, -0.27, 0.09, 0, 7);
  g.fill();
  g.fillRect(-0.24, -0.15 + Math.sin(t * 6) * 0.02, 0.18, 0.04);
  g.strokeStyle = '#111';
  g.lineWidth = 0.018;
  for (const ex of [-0.05, 0.01]) {
    g.beginPath();
    g.moveTo(ex - 0.015, -0.3);
    g.lineTo(ex + 0.015, -0.27);
    g.moveTo(ex + 0.015, -0.3);
    g.lineTo(ex - 0.015, -0.27);
    g.stroke();
  }
  g.fillStyle = '#3b3b48';
  g.fillRect(-0.06, 0.08, 0.05, 0.14 + Math.sin(t * 6) * 0.02);
  g.fillRect(0.01, 0.08, 0.05, 0.14 - Math.sin(t * 6) * 0.02);
  g.restore();
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
