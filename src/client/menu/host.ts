import { NET } from '../../shared/constants.ts';
import type { GameMode } from '../../shared/protocol.ts';
import type { Render } from './router.ts';
import { $, SERVER_PILL, goOnline, playerName, sheet } from './ui.ts';

export const MODES: Record<GameMode, { name: string; blurb: string }> = {
  battle: { name: 'Battle', blurb: 'Free-for-all snipers' },
  survival: { name: 'Survival', blurb: 'Co-op vs zombie rounds' },
};

export const host: Render = (root, ctx) => {
  root.innerHTML = sheet(
    'Host a game',
    `
    <fieldset class="modes">
      <legend class="small-caps">Game type</legend>
      ${(Object.keys(MODES) as GameMode[])
        .map(
          (m, i) => `<label class="mode mode-${m}">
            <input type="radio" name="mode" value="${m}" ${i === 0 ? 'checked' : ''} />
            <b>${MODES[m].name}</b>
            <span>${MODES[m].blurb}</span>
          </label>`,
        )
        .join('')}
    </fieldset>
    <p class="hint">Up to ${NET.maxPlayersPerLobby} players. Share the code to invite friends.</p>
    ${SERVER_PILL}
    <p class="notice" role="alert"></p>
    <div class="cta"><button class="primary big" id="create">Create lobby</button></div>`,
  );

  const notice = $(root, '.notice');
  const create = $<HTMLButtonElement>(root, '#create');
  const off = ctx.net.on((m) => {
    if (m.t === 'joined') {
      ctx.joined = m;
      ctx.go({ name: 'lobby' });
    }
    if (m.t === 'error') notice.textContent = m.message;
  });
  void goOnline(root, ctx.net);
  create.addEventListener('click', async () => {
    create.disabled = true;
    notice.textContent = '';
    const mode = $<HTMLInputElement>(root, 'input[name=mode]:checked').value as GameMode;
    if (await goOnline(root, ctx.net)) ctx.net.host(playerName(), mode);
    create.disabled = false;
  });
  create.focus();
  return off;
};
