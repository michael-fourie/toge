// SNAP!: a reaction party game. Quickdraw, a blind stopwatch, ink-not-word, duck counting, odd one out, quick maths,
// which way, pour and Simon, for up to 12
// friends online (or solo against your bests). Rules in rules.ts, screens in game.ts.

import type { GameChannel } from '../types.ts';
import { mount } from './game.ts';

const channel: GameChannel = {
  id: 'snap',
  title: 'SNAP!',
  tagline: 'Fastest finger wins',
  about:
    'A quick-reaction party game. Each round is a surprise: press on SNAP! (not on SNACK!), stop a hidden clock on the second, pick the ink not the word, count the ducks before they vanish, spot the odd one out, do quick maths, press the way the arrow points (or the opposite), stop a pour on the line, or repeat a Simon sequence. Points for the quickest; reactions are timed on your own screen, so lag never decides a round.',
  facts: ['1–12 players online', 'Solo practice', 'Controller', 'Touch'],
  order: 30,

  banner(canvas) {
    const g = canvas.getContext('2d');
    if (!g) return;
    const words = ['SNAP!', 'SNACK!', 'SNAP!', 'SNAIL!'];
    const frame = (now: number) => {
      if (!canvas.isConnected) return;
      const { width: w, height: h } = canvas.getBoundingClientRect();
      if (canvas.width !== Math.round(w) || canvas.height !== Math.round(h)) {
        canvas.width = Math.round(w);
        canvas.height = Math.round(h);
      }
      const beat = (now / 900) % words.length;
      const word = words[Math.floor(beat)];
      const k = beat % 1; // 0..1 within the beat
      const real = word === 'SNAP!';
      // A burst of rays on SNAP!, a calm sky on the decoys.
      g.fillStyle = real ? '#ff3d7f' : '#2a2350';
      g.fillRect(0, 0, w, h);
      if (real) {
        g.save();
        g.translate(w / 2, h / 2);
        g.rotate(now / 3000);
        g.fillStyle = '#ff7aa8';
        for (let i = 0; i < 12; i++) {
          g.rotate(Math.PI / 6);
          g.beginPath();
          g.moveTo(0, 0);
          g.lineTo(w, -w * 0.12);
          g.lineTo(w, w * 0.12);
          g.fill();
        }
        g.restore();
      }
      // The word pops in and settles.
      const pop = 1 + Math.max(0, 0.35 - k) * 1.2;
      g.save();
      g.translate(w / 2, h / 2);
      g.scale(pop, pop);
      g.font = `900 ${Math.round(h * 0.34)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = Math.max(4, h * 0.03);
      g.strokeStyle = '#1a1033';
      g.strokeText(word, 0, 0);
      g.fillStyle = real ? '#fff36b' : '#8f86c9';
      g.fillText(word, 0, 0);
      g.restore();
      // A duck bobbing along the bottom, because ducks.
      const dx = ((now / 25) % (w + 80)) - 40;
      g.font = `${Math.round(h * 0.16)}px system-ui, sans-serif`;
      g.fillText('🦆', dx, h * 0.86 + Math.sin(now / 180) * 3);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  },

  mount,
};

export default channel;
