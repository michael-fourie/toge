// The front of 282 at night, painted on a 2D canvas: brick, the green gable, the porch and balcony with the purple
// flag, the bare tree, power lines, windows lighting up and going dark. The channel's banner tile, and the backdrop
// behind the game's menus. Runs until the canvas leaves the page.

/** The front of 282 at night for the banner: windows as [x, y, w, h] fractions of the facade (0 = left, 0 = top). */
const WINDOWS: [number, number, number, number][] = [
  [0.6, 0.6, 0.22, 0.22],
  [0.6, 0.18, 0.2, 0.22],
  [0.2, 0.18, 0.18, 0.14],
  [0.24, 0.62, 0.12, 0.2],
];

/** The big bare tree out front: branches drawn once, recursively, with a seeded wobble. */
function tree(g: CanvasRenderingContext2D, x: number, y: number, len: number, angle: number, width: number, depth: number, seed: { s: number }) {
  const rnd = () => ((seed.s = (seed.s * 16807) % 2147483647) / 2147483647);
  const x2 = x + Math.sin(angle) * len;
  const y2 = y - Math.cos(angle) * len;
  g.strokeStyle = '#4a3e56';
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x2, y2);
  g.stroke();
  if (depth <= 0) return;
  const n = depth > 4 ? 2 : 3;
  for (let i = 0; i < n; i++) tree(g, x2, y2, len * (0.62 + rnd() * 0.2), angle + (rnd() - 0.5) * 1.3, width * 0.62, depth - 1, seed);
}

/** Paints and animates the house on `canvas`, with the title and tagline (the banner) or without (a backdrop). */
export function paintHouse(canvas: HTMLCanvasElement, caption = true) {
  const g = canvas.getContext('2d');
  if (!g) return;
  const lit = WINDOWS.map(() => Math.random() > 0.4);
  let next = 0;
  let treeLayer: HTMLCanvasElement | null = null;
  const frame = (now: number) => {
    if (!canvas.isConnected) return;
    const { width: w, height: h } = canvas.getBoundingClientRect();
    if (canvas.width !== Math.round(w) || canvas.height !== Math.round(h)) {
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
    }
    // Night sky, a purple glow from the living room, the street.
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#120d26');
    sky.addColorStop(1, '#3a1d3f');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < 24; i++) g.fillRect((i * 97) % w, (i * 53) % (h * 0.4), 1.5, 1.5);
    // The house: red brick, a stone foundation, the green shingled gable with its triple window.
    const hw = Math.min(w * 0.34, h * 0.56);
    const x0 = w * 0.25 - hw / 2;
    const top = h * 0.42;
    const bot = h * 0.9;
    const fh = bot - top;
    g.fillStyle = '#7a3428';
    g.fillRect(x0, top, hw, fh);
    g.fillStyle = '#6a6460';
    g.fillRect(x0, bot - fh * 0.08, hw, fh * 0.08);
    g.fillStyle = '#f2efe6';
    g.beginPath();
    g.moveTo(x0 - hw * 0.08, top + 2);
    g.lineTo(x0 + hw / 2, top - hw * 0.5);
    g.lineTo(x0 + hw * 1.08, top + 2);
    g.fill();
    g.fillStyle = '#4a7a4e';
    g.beginPath();
    g.moveTo(x0 - hw * 0.02, top);
    g.lineTo(x0 + hw / 2, top - hw * 0.44);
    g.lineTo(x0 + hw * 1.02, top);
    g.fill();
    // Windows flick on and off as people move around inside; the attic one too.
    if (now > next) {
      next = now + 500 + Math.random() * 900;
      const i = Math.floor(Math.random() * lit.length);
      lit[i] = !lit[i];
    }
    WINDOWS.forEach(([fx, fy, fw, fhh], i) => {
      g.fillStyle = '#f2efe6';
      g.fillRect(x0 + hw * fx - 2, top + fh * fy - 2, hw * fw + 4, fh * fhh + 4);
      g.fillStyle = lit[i] ? (i === 0 ? '#ff3d5a' : '#ffcf7a') : '#1d1a2a';
      g.fillRect(x0 + hw * fx, top + fh * fy, hw * fw, fh * fhh);
    });
    g.fillStyle = lit[1] ? '#ffcf7a' : '#1d1a2a';
    for (const k of [-1, 0, 1]) g.fillRect(x0 + hw / 2 + k * hw * 0.07 - hw * 0.03, top - hw * (k ? 0.17 : 0.22), hw * 0.06, hw * (k ? 0.1 : 0.15));
    // A silhouette passes the big front window (the living room's red light).
    if (lit[0]) {
      const sx = x0 + hw * (0.62 + ((now / 2600) % 1) * 0.18);
      const wy = top + fh * 0.62;
      g.fillStyle = 'rgba(20,10,20,0.85)';
      g.beginPath();
      g.arc(sx, wy + fh * 0.06, fh * 0.03, 0, Math.PI * 2);
      g.fill();
      g.fillRect(sx - fh * 0.03, wy + fh * 0.09, fh * 0.06, fh * 0.13);
    }
    // The white porch and balcony, the purple flag on the railing.
    const pw = hw * 0.48;
    g.fillStyle = '#f2efe6';
    g.fillRect(x0 - hw * 0.02, top + fh * 0.42, pw, fh * 0.035);
    g.fillRect(x0, top + fh * 0.42, hw * 0.04, fh * 0.5);
    g.fillRect(x0 + pw - hw * 0.06, top + fh * 0.42, hw * 0.04, fh * 0.5);
    for (let i = 0; i < 9; i++) g.fillRect(x0 + i * (pw / 9), top + fh * 0.28, 2, fh * 0.14);
    g.fillRect(x0 - hw * 0.02, top + fh * 0.27, pw, fh * 0.02);
    g.fillStyle = '#6a4aaa';
    g.fillRect(x0 + pw * 0.3, top + fh * 0.3, pw * 0.36, fh * 0.1);
    // The huge bare tree out front, and the power lines.
    if (!treeLayer || treeLayer.width !== canvas.width || treeLayer.height !== canvas.height) {
      treeLayer = document.createElement('canvas');
      treeLayer.width = canvas.width;
      treeLayer.height = canvas.height;
      tree(treeLayer.getContext('2d')!, x0 + hw * 1.12, h, h * 0.36, 0.05, Math.max(3, h * 0.05), 6, { s: 7 });
    }
    g.drawImage(treeLayer, 0, 0);
    g.strokeStyle = 'rgba(10,8,14,0.9)';
    g.lineWidth = 1.5;
    for (const k of [0.3, 0.36]) {
      g.beginPath();
      g.moveTo(0, h * k);
      g.quadraticCurveTo(w * 0.5, h * (k + 0.05), w, h * (k - 0.02));
      g.stroke();
    }
    // The title (the banner tile only: the menus have their own).
    if (!caption) {
      requestAnimationFrame(frame);
      return;
    }
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.font = `900 ${Math.round(h * 0.13)}px system-ui, sans-serif`;
    g.lineWidth = Math.max(3, h * 0.02);
    g.strokeStyle = '#120d26';
    for (const [t, y] of [
      ['ROYAL', h * 0.4],
      ['DEGENERACY', h * 0.58],
    ] as const) {
      g.strokeText(t, w * 0.96, y);
      g.fillStyle = t === 'ROYAL' ? '#ffcf7a' : '#ff4d8d';
      g.fillText(t, w * 0.96, y);
    }
    g.font = `700 ${Math.round(h * 0.08)}px system-ui, sans-serif`;
    g.fillStyle = '#d9c8f0';
    g.fillText('282 · one of you did this', w * 0.96, h * 0.74);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
