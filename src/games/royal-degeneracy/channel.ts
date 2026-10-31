// ROYAL DEGENERACY: a first-person social-deduction party game in 282, our old university house. Housemates do
// chores and vote; the Degenerates take people out and lie about it. Design in DESIGN.md, screens in game.ts.

import type { GameChannel } from '../types.ts';
import { mount } from './game.ts';

/** The house at night for the banner: [x, y, w, h] windows as fractions of the facade. */
const WINDOWS: [number, number, number, number][] = [
  [0.12, 0.62, 0.13, 0.16],
  [0.62, 0.6, 0.16, 0.2],
  [0.13, 0.36, 0.13, 0.15],
  [0.62, 0.34, 0.16, 0.18],
  [0.42, 0.12, 0.12, 0.12],
];

const channel: GameChannel = {
  id: 'royal-degeneracy',
  title: 'ROYAL DEGENERACY',
  tagline: 'One of you did this.',
  about:
    'A first-person whodunit in 282, the old house, at real scale. Walk the actual hallways at night, do the chores, ring the pot for a house meeting and vote someone out into the rain. One or two of you are the Degenerates: take people out with a drumstick, act natural, and survive the Last Meeting.',
  facts: ['4–12 players online', 'First person', 'Controller', 'Voice chat recommended'],
  order: 40,

  banner(canvas) {
    const g = canvas.getContext('2d');
    if (!g) return;
    const lit = WINDOWS.map(() => Math.random() > 0.4);
    let next = 0;
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
      // The house: brick body, green gable, white porch.
      const hw = Math.min(w * 0.34, h * 0.6);
      const x0 = w * 0.24 - hw / 2;
      const top = h * 0.38;
      const bot = h * 0.92;
      g.fillStyle = '#7a3428';
      g.fillRect(x0, top, hw, bot - top);
      g.fillStyle = '#2f5a3e';
      g.beginPath();
      g.moveTo(x0 - hw * 0.06, top);
      g.lineTo(x0 + hw / 2, top - hw * 0.42);
      g.lineTo(x0 + hw * 1.06, top);
      g.fill();
      // Windows flick on and off as people move around inside.
      if (now > next) {
        next = now + 500 + Math.random() * 900;
        const i = Math.floor(Math.random() * lit.length);
        lit[i] = !lit[i];
      }
      WINDOWS.forEach(([fx, fy, fw, fh], i) => {
        const wy = fy < 0.2 ? top - hw * 0.28 : top + (bot - top) * (fy - 0.3) * 1.4;
        g.fillStyle = lit[i] ? (i === 0 ? '#ff4d8d' : '#ffcf7a') : '#1d1a2a';
        g.fillRect(x0 + hw * fx, wy, hw * fw, hw * fh);
      });
      // A silhouette passes the big front window.
      const sx = x0 + hw * (0.62 + ((now / 2600) % 1) * 0.16);
      if (lit[1]) {
        g.fillStyle = 'rgba(20,10,20,0.85)';
        const wy = top + (bot - top) * 0.42;
        g.beginPath();
        g.arc(sx, wy + hw * 0.05, hw * 0.022, 0, Math.PI * 2);
        g.fill();
        g.fillRect(sx - hw * 0.025, wy + hw * 0.075, hw * 0.05, hw * 0.12);
      }
      g.fillStyle = '#efe9dc';
      g.fillRect(x0 - hw * 0.02, top + (bot - top) * 0.6, hw * 0.46, h * 0.02);
      g.fillRect(x0, top + (bot - top) * 0.6, hw * 0.03, bot - top - (bot - top) * 0.6);
      g.fillRect(x0 + hw * 0.4, top + (bot - top) * 0.6, hw * 0.03, bot - top - (bot - top) * 0.6);
      // The title.
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
  },

  mount,
};

export default channel;
