import { NET } from '../../shared/constants.ts';
import { KILL_LIMIT, TEAMS } from '../../shared/teams.ts';
import type { GameMode } from '../../shared/protocol.ts';
import type { Render } from './router.ts';
import { $, SERVER_PILL, goOnline, playerName, sheet } from './ui.ts';

export const MODES: Record<GameMode, { name: string; blurb: string }> = {
  battle: { name: 'Battle', blurb: 'Snipers, first to 30 kills' },
  survival: { name: 'Survival', blurb: 'Co-op vs zombies in a night factory' },
};

export const host: Render = (root, ctx, screen) => {
  root.innerHTML = sheet(
    'Host a game',
    `
    <fieldset class="modes">
      <legend class="small-caps">Game type</legend>
      ${(Object.keys(MODES) as GameMode[])
        .map(
          (m) => `<label class="mode mode-${m}">
            <input type="radio" name="mode" value="${m}" ${m === (screen.mode ?? 'battle') ? 'checked' : ''} />
            <b>${MODES[m].name}</b>
            <span>${MODES[m].blurb}</span>
          </label>`,
        )
        .join('')}
    </fieldset>
    <fieldset class="modes formats" id="formats">
      <legend class="small-caps">Battle format</legend>
      <label class="mode mode-ffa">
        <input type="radio" name="format" value="ffa" checked />
        <b>Free for all</b>
        <span>Every sniper for themselves</span>
      </label>
      <label class="mode mode-teams">
        <input type="radio" name="format" value="teams" />
        <b>Teams</b>
        <span>${TEAMS[0].name} vs ${TEAMS[1].name}. Pick a side in the lobby, or shuffle</span>
      </label>
    </fieldset>
    <p class="hint">First to ${KILL_LIMIT} kills wins the match. Up to ${NET.maxPlayersPerLobby} players. Share the code to invite friends.</p>
    ${SERVER_PILL}
    <p class="notice" role="alert"></p>
    <div class="cta"><button class="primary big" id="create">Create lobby</button></div>`,
  );

  const formats = $(root, '#formats');
  const syncFormats = () => (formats.hidden = $<HTMLInputElement>(root, 'input[name=mode]:checked').value !== 'battle');
  root.querySelectorAll('input[name=mode]').forEach((i) => i.addEventListener('change', syncFormats));
  syncFormats();
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
    const teams = mode === 'battle' && $<HTMLInputElement>(root, 'input[name=format]:checked').value === 'teams';
    if (await goOnline(root, ctx.net)) ctx.net.host(playerName(), mode, teams);
    create.disabled = false;
  });
  create.focus();
  return off;
};
