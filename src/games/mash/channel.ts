// MASH: the example plug-in game. A button-mashing race to 50, solo against the clock or online in a party
// room. Small on purpose: it shows the whole GameApi (menus with real buttons, controller input,
// multiplayer, cleanup). Copy src/games/_template to start your own.

import type { GameChannel } from '../types.ts';
import { mount } from './game.ts';

const channel: GameChannel = {
  id: 'mash',
  title: 'MASH',
  tagline: 'Hammer the button. Win.',
  about: 'A race to 50 presses. Solo against your best time, or host a room and mash against your friends. (It is also the example for making your own game: see docs/ADDING_A_GAME.md.)',
  facts: ['1–12 players online', 'Ⓐ / Space / click'],
  order: 50,
  banner(canvas) {
    const g = canvas.getContext('2d');
    if (!g) return;
    const draw = (now: number) => {
      if (!canvas.isConnected) return;
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width;
      canvas.height = r.height;
      const W = canvas.width;
      const H = canvas.height;
      const grad = g.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, '#ff3d7f');
      grad.addColorStop(1, '#ffb84d');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      const press = Math.abs(Math.sin(now / 90)) > 0.6;
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath();
      g.ellipse(W / 2, H * 0.55 + H * 0.06, H * 0.26, H * 0.1, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#e8203a';
      g.beginPath();
      g.ellipse(W / 2, H * 0.5 + (press ? H * 0.05 : 0), H * 0.26, H * 0.12, 0, 0, Math.PI * 2);
      g.fill();
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  },
  mount,
};

export default channel;
