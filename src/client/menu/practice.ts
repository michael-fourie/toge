import { BOT, BOT_LEVELS, type BotLevel } from '../../shared/bot.ts';
import { loadSettings, saveSettings } from '../settings.ts';
import type { Render } from './router.ts';
import { $, sheet } from './ui.ts';

const TIPS: Record<BotLevel, string> = {
  easy: 'Slow to spot you, slower to shoot, and they miss a lot',
  normal: 'They hunt you, strafe and hop, and hit what they aim at',
  hard: 'Quick, accurate, slippery, and they go for the head',
};

/** Practice: pick how good the bots are, then go. The choice is remembered. */
export const practice: Render = (root, ctx) => {
  const saved = loadSettings().bots;
  root.innerHTML = sheet(
    'Practice',
    `
    <fieldset class="host-row">
      <legend class="small-caps">Bots</legend>
      ${BOT_LEVELS.map((l) => `<label class="host-pill" title="${TIPS[l]}"><input type="radio" name="bots" value="${l}" ${l === saved ? 'checked' : ''} /><span>${BOT[l].name}</span></label>`).join('')}
    </fieldset>
    <p class="hint" id="bot-tip"></p>
    <div class="cta"><button class="primary big" id="start">Start</button></div>`,
  );
  const pick = () => $<HTMLInputElement>(root, 'input[name=bots]:checked').value as BotLevel;
  const tip = () => ($(root, '#bot-tip').textContent = `${BOT[pick()].count} sniper bots. ${TIPS[pick()]}.`);
  root.querySelectorAll('input[name=bots]').forEach((i) => i.addEventListener('change', tip));
  tip();
  const start = $<HTMLButtonElement>(root, '#start');
  start.addEventListener('click', () => {
    saveSettings({ ...loadSettings(), bots: pick() });
    ctx.play(undefined, pick());
  });
  start.focus();
};
