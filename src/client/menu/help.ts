import { IS_TOUCH } from '../touch.ts';
import type { Render } from './router.ts';
import { $, sheet } from './ui.ts';

const KEYS: [string, string][] = [
  ['WASD', 'Move. In the air, let go of W, hold A or D and turn the mouse the same way to gain speed.'],
  ['Space / wheel', 'Jump. Hold to bhop; every hop keeps your speed. Tap again in the air for a double jump.'],
  ['Shift', 'Slide. Hold it in the air to slide the moment you land.'],
  ['Walls', 'Run along one in the air to wallrun, or tap Space beside one to kick off it (a new wall each time, and it refreshes your double jump).'],
  ['Q', 'Grenade. Lobs a frag that goes off after about 2 s: kills anyone near it in line of sight and shoves everyone close (you too, so you can grenade-jump). 8 s until the next one.'],
  ['E', 'Grapple. Aim at a surface within 40 m and the rope reels you in; Space lets go and you keep your speed. Hook a player to zip to them, or aim near a glowing ring in the sky. 1.5 s to recharge.'],
  ['F', 'Survival: buy doors, wall guns and the Mystery Box, take a gun from the box, and hold F at a window to nail its boards back up. Pack-a-Punch (Furnace, 5000) upgrades your gun; Juggernog (Storage, 2500) gives 250 health.'],
  ['1 / 2', 'Survival: switch between your two guns.'],
  ['Blue ramps', 'Surf. Strafe into the slope to ride it.'],
  ['Left / right mouse', 'Shoot (hold for automatic guns) / hold to aim or scope. Hip fire sprays.'],
  ['R', 'Reload (automatic when empty).'],
  ['Tab', 'Scores.'],
  ['`', 'Live movement tuning panel.'],
];

/** On a phone: the on-screen controls instead of keys. */
const TOUCH: [string, string][] = [
  ['Left thumb', 'Put it down anywhere on the left and drag: a joystick appears under it. Push past halfway for full speed.'],
  ['Right thumb', 'Swipe anywhere on the right to look around.'],
  ['Fire', 'The big red button (or the one on the left). Keep your thumb on it and drag to aim while you shoot.'],
  ['Jump / slide', 'Hold jump to bhop. Slide is the down arrow; hold it in the air to slide the moment you land.'],
  ['Bhop', 'In the air, hold the stick sideways and swipe the same way to gain speed.'],
  ['Scope', 'Tap to zoom in, tap again to zoom out.'],
  ['Grapple / grenade', 'The hook button reels you toward what you aim at; the grenade sits in its cooldown ring.'],
  ['Reload / swap', 'The small buttons above fire: reload, and switch between your guns and the knife.'],
  ['Use', 'Survival: appears when there is something to buy or a window to repair (hold it).'],
  ['Pause / scores', 'Top-left.'],
];

export const help: Render = (root) => {
  root.innerHTML = sheet(
    'How to play',
    `
    <p class="lead">Momentum is everything. Keep moving, keep hopping, and line up the shot while you fly.</p>
    <dl class="help-keys">${(IS_TOUCH ? TOUCH : KEYS).map(([k, v]) => `<dt><kbd>${k}</kbd></dt><dd>${v}</dd>`).join('')}</dl>`,
  );
  $(root, 'h2').focus();
};
