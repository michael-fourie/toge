import { NET } from '../../shared/constants.ts';
import { KILL_LIMIT, TEAMS } from '../../shared/teams.ts';
import { KOTH } from '../../shared/koth.ts';
import { BATTLE_MAPS, BATTLE_MAP_IDS, randomBattleMap } from '../../shared/maps.ts';
import type { BattleMap, GameMode } from '../../shared/protocol.ts';
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
      <label class="mode mode-koth">
        <input type="radio" name="format" value="koth" />
        <b>👑 King of the Hill</b>
        <span>Teams fight over the hill on Crown. Hold it for ${KOTH.holdToWin / 60} minutes in total to win</span>
      </label>
    </fieldset>
    <fieldset class="modes formats" id="maps">
      <legend class="small-caps">Battle map</legend>
      ${BATTLE_MAP_IDS.map(
        (id) => `<label class="mode">
          <input type="radio" name="map" value="${id}" />
          <b>${BATTLE_MAPS[id].name}</b>
          <span>${BATTLE_MAPS[id].blurb}</span>
        </label>`,
      ).join('')}
      <label class="mode">
        <input type="radio" name="map" value="random" checked />
        <b>🎲 Random</b>
        <span>A surprise arena each time you host</span>
      </label>
    </fieldset>
    <p class="hint" id="koth-note" hidden>King of the Hill always plays on <b>Crown</b>, a map built around its hill. Stand on the hill with no enemies there to capture it; your team's clock runs while you hold it. You can't win while the enemy is still fighting for it: that's overtime.</p>
    <p class="hint"><span id="kill-goal">First to ${KILL_LIMIT} kills wins the match. </span>Up to ${NET.maxPlayersPerLobby} players. Share the code to invite friends.</p>
    ${SERVER_PILL}
    <p class="notice" role="alert"></p>
    <div class="cta"><button class="primary big" id="create">Create lobby</button></div>`,
  );

  const formats = $(root, '#formats');
  const maps = $(root, '#maps');
  const syncFormats = () => {
    const battle = $<HTMLInputElement>(root, 'input[name=mode]:checked').value === 'battle';
    const koth = battle && $<HTMLInputElement>(root, 'input[name=format]:checked').value === 'koth';
    formats.hidden = !battle;
    maps.hidden = !battle || koth; // the hill has its own map
    $(root, '#koth-note').hidden = !koth;
    $(root, '#kill-goal').hidden = koth;
  };
  root.querySelectorAll('input[name=mode], input[name=format]').forEach((i) => i.addEventListener('change', syncFormats));
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
    const format = $<HTMLInputElement>(root, 'input[name=format]:checked').value;
    const koth = mode === 'battle' && format === 'koth';
    const teams = koth || (mode === 'battle' && format === 'teams');
    const pick = $<HTMLInputElement>(root, 'input[name=map]:checked').value;
    const map = pick === 'random' ? randomBattleMap() : (pick as BattleMap); // chosen here so every player gets the same arena
    if (await goOnline(root, ctx.net)) ctx.net.host(playerName(), mode, teams, map, koth);
    create.disabled = false;
  });
  create.focus();
  return off;
};
