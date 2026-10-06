import type { Render } from './router.ts';
import { $, sheet } from './ui.ts';

const KEYS: [string, string][] = [
  ['WASD', 'Move. In the air, let go of W, hold A or D and turn the mouse the same way to gain speed.'],
  ['Space / wheel', 'Jump. Hold to bhop; every hop keeps your speed.'],
  ['Shift', 'Slide. Hold it in the air to slide the moment you land.'],
  ['Walls', 'Run along one in the air to wallrun. Space wall-jumps.'],
  ['Blue ramps', 'Surf. Strafe into the slope to ride it.'],
  ['Left / right mouse', 'Shoot / hold to scope. No-scopes spray.'],
  ['R', 'Reload (automatic when empty).'],
  ['Tab', 'Scores.'],
  ['`', 'Live movement tuning panel.'],
];

export const help: Render = (root) => {
  root.innerHTML = sheet(
    'How to play',
    `
    <p class="lead">Momentum is everything. Keep moving, keep hopping, and line up the shot while you fly.</p>
    <dl class="help-keys">${KEYS.map(([k, v]) => `<dt><kbd>${k}</kbd></dt><dd>${v}</dd>`).join('')}</dl>`,
  );
  $(root, 'h2').focus();
};
