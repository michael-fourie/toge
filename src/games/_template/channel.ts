// A starting point for a new game. Copy this folder to src/games/<your-game-id>/ (no leading underscore:
// folders starting with _ are not loaded), then change the id and the text. See docs/ADDING_A_GAME.md.

import type { GameChannel } from '../types.ts';

const channel: GameChannel = {
  id: 'my-game', // lowercase letters, digits, dashes; unique; same as the folder name
  title: 'MY GAME',
  tagline: 'One line about it',
  about: 'A short paragraph for the channel page.',
  facts: ['1 player', 'Controller'],
  order: 100,

  banner(canvas) {
    // Draw something that moves. Stop when the canvas leaves the page.
    const g = canvas.getContext('2d');
    if (!g) return;
    const frame = (now: number) => {
      if (!canvas.isConnected) return;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width;
      canvas.height = height;
      g.fillStyle = `hsl(${(now / 20) % 360} 70% 55%)`;
      g.fillRect(0, 0, width, height);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  },

  mount(root, api) {
    root.innerHTML = `
      <div class="my-game" style="position:absolute;inset:0;display:grid;place-content:center;gap:12px;color:#fff;font:600 20px system-ui">
        <p data-hello></p>
        <button data-autofocus>Back to the menu</button>
      </div>`;
    // Player names come from other people: put them in with textContent, never into an HTML string.
    root.querySelector('[data-hello]')!.textContent = `Hello, ${api.name}!`;
    root.querySelector('button')!.addEventListener('click', () => api.exit());
    // Start loops / listeners here...
    return () => {
      // ...and stop every one of them here.
    };
  },
};

export default channel;
