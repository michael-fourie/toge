import { ACTIONS, ACTION_NAME, type Action, DEFAULT_KEYS, keyLabel, loadSettings, saveSettings } from '../settings.ts';
import { IS_TOUCH } from '../touch.ts';
import type { Render } from './router.ts';
import { $, esc, sheet } from './ui.ts';

/** Keys the game itself uses (weapon slots, tuning panel, pause, killcam skip). */
const RESERVED = new Set(['Escape', 'Enter', 'Backquote', 'Digit1', 'Digit2', 'Digit3']);

export const settings: Render = (root) => {
  const s = loadSettings();
  let listening: Action | null = null;

  root.innerHTML = sheet(
    'Settings',
    `
    <fieldset class="settings">
      <legend>${IS_TOUCH ? 'Look' : 'Mouse'} &amp; movement <small>saved, and used online too</small></legend>
      <label class="setting">
        <span>${IS_TOUCH ? 'Look sensitivity' : 'Mouse sensitivity'}</span>
        <input id="sens" type="range" min="0.25" max="3" step="0.05" value="${s.sensitivity}" />
        <output id="sens-out">${s.sensitivity.toFixed(2)}×</output>
      </label>
      <label class="setting toggle">
        <span>Auto-bhop <small>hold jump to hop on every landing</small></span>
        <input id="autohop" type="checkbox" role="switch" ${s.autoHop ? 'checked' : ''} />
      </label>
    </fieldset>
    <fieldset class="settings key-binds">
      <legend>Controls <small>click a key, then press the new one (Esc cancels)</small></legend>
      <div class="binds" id="binds"></div>
      <div class="cta"><button class="pick" id="reset">Reset controls</button></div>
    </fieldset>
    <p class="notice" role="status"></p>`,
  );
  $(root, '.sheet').classList.add('wide', 'settings-sheet');

  const sens = $<HTMLInputElement>(root, '#sens');
  const autoHop = $<HTMLInputElement>(root, '#autohop');
  const notice = $(root, '.notice');
  const save = () => {
    s.sensitivity = Number(sens.value);
    s.autoHop = autoHop.checked;
    $(root, '#sens-out').textContent = `${s.sensitivity.toFixed(2)}×`;
    saveSettings(s);
  };
  sens.addEventListener('input', save);
  autoHop.addEventListener('change', save);

  const drawBinds = () => {
    $(root, '#binds').innerHTML = ACTIONS.map(
      (a) => `<div class="bind"><span>${ACTION_NAME[a]}</span>
        <button class="keycap" data-bind="${a}" aria-pressed="${listening === a}">${listening === a ? 'Press a key…' : esc(keyLabel(s.keys[a]))}</button></div>`,
    ).join('');
  };
  drawBinds();

  $(root, '#binds').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-bind]');
    if (!b) return;
    listening = b.dataset.bind as Action;
    notice.textContent = '';
    drawBinds();
  });
  $(root, '#reset').addEventListener('click', () => {
    s.keys = { ...DEFAULT_KEYS };
    saveSettings(s);
    listening = null;
    notice.textContent = '';
    drawBinds();
  });

  // Capture phase and stopPropagation so Esc cancels the rebind instead of leaving the screen.
  const onKey = (e: KeyboardEvent) => {
    if (!listening) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code !== 'Escape') {
      if (RESERVED.has(e.code)) notice.textContent = `${keyLabel(e.code)} is used by the game; pick another key.`;
      else {
        // Taking a key from another action swaps the two, so nothing is left unbound.
        const other = ACTIONS.find((a) => a !== listening && s.keys[a] === e.code);
        if (other) s.keys[other] = s.keys[listening];
        s.keys[listening] = e.code;
        saveSettings(s);
        notice.textContent = other ? `Swapped with ${ACTION_NAME[other]}.` : '';
      }
    }
    listening = null;
    drawBinds();
  };
  addEventListener('keydown', onKey, true);
  return () => removeEventListener('keydown', onKey, true);
};
