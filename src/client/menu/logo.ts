// The title logo: "GAMBOL" in block letters whose cells are flickering matrix-style glyphs, with a bright
// wave sweeping across and rain streaking down through the word. Pure canvas, no assets.

const FONT: Record<string, string[]> = {
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
};
const WORD = 'GAMBOL';
const SX = 3; // grid cells per font pixel, across
const SY = 2; // and down (glyphs are ~0.6 as wide as tall, so this keeps font pixels roughly square)
const PAD = 4; // rain-only rows above and below the word
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:.=*+-<>';
const FRAME_MS = 60; // matrix glyphs change at a stepped pace, not every display frame

/** Which grid cells belong to the letters. */
function letterMask(): { cols: number; rows: number; lit: boolean[][] } {
  const pxCols = WORD.length * 5 + (WORD.length - 1);
  const cols = pxCols * SX;
  const rows = 7 * SY + PAD * 2;
  const lit = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  [...WORD].forEach((ch, li) => {
    FONT[ch].forEach((line, py) =>
      [...line].forEach((c, px) => {
        if (c !== '#') return;
        for (let dy = 0; dy < SY; dy++) for (let dx = 0; dx < SX; dx++) lit[PAD + py * SY + dy][(li * 6 + px) * SX + dx] = true;
      }),
    );
  });
  return { cols, rows, lit };
}

const rand = (n: number) => Math.floor(Math.random() * n);
const glyph = () => GLYPHS[rand(GLYPHS.length)];

/** Draws and animates the logo into `canvas`; returns a cleanup. Holds still if the user prefers reduced motion. */
export function mountLogo(canvas: HTMLCanvasElement): () => void {
  const { cols, rows, lit } = letterMask();
  const chars = Array.from({ length: rows }, () => Array.from({ length: cols }, glyph));
  // One rain drop per column: head row (can be above the grid), speed, trail length.
  const drops = Array.from({ length: cols }, () => ({ y: -rand(rows * 3), speed: 0.25 + Math.random() * 0.5, trail: 4 + rand(6) }));
  const ctx = canvas.getContext('2d')!;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cw = 0;
  let ch = 0;
  let dpr = 1;

  const resize = () => {
    const w = canvas.clientWidth;
    dpr = Math.min(devicePixelRatio || 1, 2);
    cw = w / cols;
    ch = cw / 0.6;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(ch * rows * dpr);
    canvas.style.aspectRatio = `${w} / ${ch * rows}`;
  };

  const draw = (t: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `700 ${ch * 0.95}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const sweep = (t / 1400) % 2.2; // a bright diagonal band crossing the word, then a pause
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const d = drops[c];
        const rain = d.y - r; // rows behind the drop's head (negative: below it, untouched)
        const x = (c + 0.5) * cw;
        const y = (r + 0.5) * ch;
        if (lit[r][c]) {
          // A dark panel behind each lit cell makes the letters solid; bright glyphs on top give the matrix look.
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(14, 48, 36, 0.9)';
          ctx.fillRect(c * cw - 0.5, r * ch - 0.5, cw + 1, ch + 1);
          const band = Math.max(0, 1 - Math.abs((c + r * 2) / (cols + rows * 2) - sweep + 0.1) * 7);
          if (rain >= 0 && rain < 1.2) {
            ctx.shadowColor = '#b8ffc4';
            ctx.shadowBlur = 8;
            ctx.fillStyle = '#ffffff';
          } else {
            // Mid green, flaring toward near-white where the sweep (or a rain trail) passes.
            const trail = rain > 0 && rain < d.trail ? 0.5 * (1 - rain / d.trail) : 0;
            const k = Math.min(1, band + trail);
            ctx.fillStyle = `rgb(${Math.round(70 + 150 * k)}, ${Math.round(200 + 50 * k)}, ${Math.round(110 + 110 * k)})`;
          }
          ctx.fillText(chars[r][c], x, y);
        } else if (rain >= 0 && rain < d.trail) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = `rgba(52, 130, 84, ${(0.4 * (1 - rain / d.trail)).toFixed(2)})`;
          ctx.fillText(chars[r][c], x, y);
        }
      }
    }
    ctx.shadowBlur = 0;
  };

  const step = () => {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (Math.random() < (lit[r][c] ? 0.07 : 0.02)) chars[r][c] = glyph();
    for (const d of drops) {
      d.y += d.speed;
      if (d.y - d.trail > rows) {
        d.y = -rand(rows);
        d.speed = 0.25 + Math.random() * 0.5;
        d.trail = 4 + rand(6);
      }
    }
  };

  resize();
  addEventListener('resize', resize);
  let raf = 0;
  if (still) {
    drops.forEach((d) => (d.y = -100)); // no rain: just the letters
    draw(1100);
  } else {
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < FRAME_MS) return;
      last = t;
      step();
      draw(t);
    };
    raf = requestAnimationFrame(loop);
  }
  return () => {
    cancelAnimationFrame(raf);
    removeEventListener('resize', resize);
  };
}
