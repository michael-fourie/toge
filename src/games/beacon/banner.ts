// The channel art: a sea stack against a golden-hour sky, the lighthouse on top sweeping its beam, a climber
// partway up. Animated 2D canvas; stops when the canvas leaves the page.

export function paintBanner(canvas: HTMLCanvasElement) {
  const g = canvas.getContext('2d');
  if (!g) return;
  // A fixed jagged outline for the stack (seeded, so it doesn't shimmer).
  const ridge: number[] = [];
  let s = 7;
  for (let i = 0; i <= 40; i++) {
    s = (s * 16807) % 2147483647;
    ridge.push((s / 2147483647 - 0.5) * 0.05);
  }
  const frame = (now: number) => {
    if (!canvas.isConnected) return;
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(1, Math.round(r.width * dpr));
    const H = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const t = now / 1000;
    const sea = H * 0.72;
    // Sky.
    const sky = g.createLinearGradient(0, 0, 0, sea);
    sky.addColorStop(0, '#2c3e5c');
    sky.addColorStop(0.55, '#c7856a');
    sky.addColorStop(0.85, '#f2b77a');
    sky.addColorStop(1, '#ffd9a0');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, sea);
    // Sun, low on the horizon.
    const sx = W * 0.22;
    const sun = g.createRadialGradient(sx, sea - H * 0.04, 0, sx, sea - H * 0.04, H * 0.5);
    sun.addColorStop(0, 'rgba(255,240,200,1)');
    sun.addColorStop(0.06, 'rgba(255,220,160,0.9)');
    sun.addColorStop(0.3, 'rgba(255,190,120,0.25)');
    sun.addColorStop(1, 'rgba(255,190,120,0)');
    g.fillStyle = sun;
    g.fillRect(0, 0, W, sea);
    // Far islands.
    g.fillStyle = 'rgba(70,70,90,0.55)';
    g.beginPath();
    g.moveTo(W * 0.45, sea);
    g.quadraticCurveTo(W * 0.5, sea - H * 0.06, W * 0.58, sea);
    g.moveTo(W * 0.02, sea);
    g.quadraticCurveTo(W * 0.08, sea - H * 0.04, W * 0.15, sea);
    g.fill();
    // Sea.
    const water = g.createLinearGradient(0, sea, 0, H);
    water.addColorStop(0, '#6b6a6e');
    water.addColorStop(0.2, '#1d3a44');
    water.addColorStop(1, '#0a1b22');
    g.fillStyle = water;
    g.fillRect(0, sea, W, H - sea);
    g.fillStyle = 'rgba(255,215,160,0.5)';
    for (let i = 0; i < 18; i++) {
      const y = sea + (i / 18) ** 1.6 * (H - sea);
      const w = (W * 0.08 * (1 - i / 22)) * (0.6 + 0.4 * Math.sin(t * 1.3 + i * 1.7));
      g.fillRect(sx - w / 2 + Math.sin(t + i) * 4 * dpr, y, w, 1.2 * dpr);
    }
    // The stack.
    const cx = W * 0.68;
    const base = W * 0.2;
    const top = H * 0.26;
    g.fillStyle = '#1c1a1d';
    g.beginPath();
    g.moveTo(cx - base, sea + 2);
    for (let i = 0; i <= 20; i++) {
      const k = i / 20;
      g.lineTo(cx - base + (base - W * 0.045) * k ** 0.7 + ridge[i] * W, sea - (sea - top) * k);
    }
    for (let i = 20; i >= 0; i--) {
      const k = i / 20;
      g.lineTo(cx + base - (base - W * 0.045) * k ** 0.7 + ridge[i + 20 > 40 ? 40 : i + 20] * W, sea - (sea - top) * k);
    }
    g.closePath();
    g.fill();
    // Rim light on the sun side.
    g.strokeStyle = 'rgba(255,190,120,0.35)';
    g.lineWidth = 2 * dpr;
    g.stroke();
    // A few path pieces jutting out.
    g.fillStyle = '#2a2622';
    for (let i = 0; i < 7; i++) {
      const k = (i + 0.5) / 7;
      const y = sea - (sea - top) * k;
      const half = base - (base - W * 0.045) * k ** 0.7;
      const side = i % 2 ? 1 : -1;
      g.fillRect(cx + side * half - (side > 0 ? 0 : W * 0.03), y, W * 0.03, 3 * dpr);
    }
    // The lighthouse.
    const lw = W * 0.03;
    const lh = H * 0.16;
    g.fillStyle = '#d8d2c4';
    g.fillRect(cx - lw / 2, top - lh, lw, lh);
    g.fillStyle = '#9c2a1e';
    g.fillRect(cx - lw / 2, top - lh * 0.55, lw, lh * 0.12);
    g.fillStyle = '#222';
    g.fillRect(cx - lw * 0.7, top - lh - 3 * dpr, lw * 1.4, 3 * dpr);
    g.fillStyle = '#ffe9b0';
    g.fillRect(cx - lw * 0.35, top - lh - H * 0.035, lw * 0.7, H * 0.032);
    g.fillStyle = '#1b1b1b';
    g.beginPath();
    g.moveTo(cx - lw * 0.5, top - lh - H * 0.035);
    g.lineTo(cx, top - lh - H * 0.06);
    g.lineTo(cx + lw * 0.5, top - lh - H * 0.035);
    g.fill();
    // The beam, sweeping.
    const a = Math.sin(t * 0.9);
    const ly = top - lh - H * 0.02;
    const beam = g.createLinearGradient(cx, ly, cx + a * W * 0.6, ly);
    beam.addColorStop(0, 'rgba(255,240,200,0.55)');
    beam.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = beam;
    g.beginPath();
    g.moveTo(cx, ly);
    g.lineTo(cx + a * W * 0.6, ly - H * 0.08 * Math.abs(a));
    g.lineTo(cx + a * W * 0.6, ly + H * 0.08 * Math.abs(a));
    g.fill();
    // A climber on a ledge, mid-leap.
    const hop = Math.abs(Math.sin(t * 1.6));
    const px = cx - W * 0.1 + (t * 12 * dpr) % (W * 0.05);
    const py = sea - (sea - top) * 0.55 - hop * H * 0.03;
    g.fillStyle = '#d9472b';
    g.fillRect(px, py - 7 * dpr, 3 * dpr, 6 * dpr);
    g.fillStyle = '#111';
    g.fillRect(px, py - 1 * dpr, 3 * dpr, 4 * dpr);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
