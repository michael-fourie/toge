import { loadSettings, saveSettings } from '../settings.ts';
import type { Render } from './router.ts';
import { $, sheet } from './ui.ts';

export const practice: Render = (root, ctx) => {
  const s = loadSettings();
  root.innerHTML = sheet(
    'Practice',
    `
    <p class="lead">Free-fly the islands on your own against strafing scarecrows. Nothing here is online, so take your time.</p>
    <ul class="tips">
      <li><b>Bhop:</b> hold Space, let go of W, and strafe with A/D while turning the mouse the same way.</li>
      <li><b>Surf:</b> the steep blue ramps. Strafe into the slope to ride it.</li>
      <li><b>Slide:</b> hold Shift at speed. Jump out of it to keep your momentum.</li>
      <li><b>Tune:</b> press <kbd>\`</kbd> in game for the live movement panel.</li>
    </ul>
    <fieldset class="settings">
      <legend>Your settings <small>saved, and used online too</small></legend>
      <label class="setting">
        <span>Mouse sensitivity</span>
        <input id="sens" type="range" min="0.25" max="3" step="0.05" value="${s.sensitivity}" />
        <output id="sens-out">${s.sensitivity.toFixed(2)}×</output>
      </label>
      <label class="setting toggle">
        <span>Auto-bhop <small>hold Space to hop on every landing</small></span>
        <input id="autohop" type="checkbox" role="switch" ${s.autoHop ? 'checked' : ''} />
      </label>
    </fieldset>
    <div class="cta"><button class="primary big" id="start">Start practice</button></div>`,
  );

  const sens = $<HTMLInputElement>(root, '#sens');
  const autoHop = $<HTMLInputElement>(root, '#autohop');
  const save = () => {
    s.sensitivity = Number(sens.value);
    s.autoHop = autoHop.checked;
    $(root, '#sens-out').textContent = `${s.sensitivity.toFixed(2)}×`;
    saveSettings(s);
  };
  sens.addEventListener('input', save);
  autoHop.addEventListener('change', save);
  $(root, '#start').addEventListener('click', () => ctx.play());
  $(root, '#start').focus();
};
