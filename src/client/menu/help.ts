import type { Render } from './router.ts';
import { $, sheet } from './ui.ts';

const KEYS: [string, string][] = [
  ['WASD', 'Move. In the air, let go of W, hold A or D and turn the mouse the same way to gain speed.'],
  ['Space / wheel', 'Jump. Hold to bhop; every hop keeps your speed. Tap again in the air for a double jump.'],
  ['Shift', 'Slide. Hold it in the air to slide the moment you land.'],
  ['Walls', 'Run along one in the air to wallrun, or tap Space beside one to kick off it (a new wall each time, and it refreshes your double jump).'],
  ['E', 'Grapple. Aim at a surface within 40 m and the rope reels you in; Space lets go and you keep your speed. Hook a player to zip to them, or aim near a glowing ring in the sky. 1.5 s to recharge.'],
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
