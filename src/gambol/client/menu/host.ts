import { NET } from '../../shared/constants.ts';
import { KILL_LIMIT, TEAMS } from '../../shared/teams.ts';
import { KOTH } from '../../shared/koth.ts';
import { BATTLE_MAPS, BATTLE_MAP_IDS, randomBattleMap } from '../../shared/maps.ts';
import type { BattleMap, GameMode } from '../../shared/protocol.ts';
import type { Render } from '../../../client/menu/router.ts';
import { $, playerName, sheet } from '../../../client/menu/ui.ts';
import { SERVER_PILL, goOnline } from './online.ts';

export const MODES: Record<GameMode, { name: string; blurb: string; icon: string }> = {
  battle: { name: 'Battle', blurb: `Snipers, first to ${KILL_LIMIT} kills`, icon: '🎯' },
  survival: { name: 'Survival', blurb: 'Co-op vs zombies', icon: '🧟' },
};

/** One row of pill buttons (radio inputs underneath); `tip` is the hover text that replaces the old blurbs. */
const chips = (id: string, label: string, name: string, opts: { value: string; text: string; tip: string; on?: boolean }[]) => `
  <fieldset class="host-row" id="${id}">
    <legend class="small-caps">${label}</legend>
    ${opts.map((o) => `<label class="host-pill" title="${o.tip}"><input type="radio" name="${name}" value="${o.value}" ${o.on ? 'checked' : ''} /><span>${o.text}</span></label>`).join('')}
  </fieldset>`;

export const host: Render = (root, ctx, screen) => {
  const mode0 = screen.mode ?? 'battle';
  root.innerHTML = sheet(
    'Host a game',
    `
    ${chips('modes', 'Mode', 'mode', (Object.keys(MODES) as GameMode[]).map((m) => ({ value: m, text: `${MODES[m].icon} ${MODES[m].name}`, tip: MODES[m].blurb, on: m === mode0 })))}
    ${chips('formats', 'Format', 'format', [
      { value: 'ffa', text: 'Free for all', tip: 'Every sniper for themselves', on: true },
      { value: 'teams', text: 'Teams', tip: `${TEAMS[0].name} vs ${TEAMS[1].name}` },
      { value: 'koth', text: '👑 Hill', tip: `King of the Hill on Crown: hold the hill ${KOTH.holdToWin / 60} min to win` },
      { value: 'br', text: '🪂 Royale', tip: 'Battle Royale on Wildmere, a huge island: start with a pistol, find guns, outrun the zone, be the last one standing' },
    ])}
    ${chips('maps', 'Map', 'map', [
      ...BATTLE_MAP_IDS.map((id) => ({ value: id, text: BATTLE_MAPS[id].name, tip: BATTLE_MAPS[id].blurb })),
      { value: 'random', text: '🎲 Random', tip: 'A surprise arena', on: true },
    ])}
    <p class="hint" id="host-goal"></p>
    ${SERVER_PILL}
    <p class="notice" role="alert"></p>
    <div class="cta"><button class="primary big" id="create">Create lobby</button></div>`,
  );

  const formats = $(root, '#formats');
  const maps = $(root, '#maps');
  const syncFormats = () => {
    const battle = $<HTMLInputElement>(root, 'input[name=mode]:checked').value === 'battle';
    const format = $<HTMLInputElement>(root, 'input[name=format]:checked').value;
    const koth = battle && format === 'koth';
    const br = battle && format === 'br';
    formats.hidden = !battle;
    maps.hidden = !battle || koth || br; // the hill and the Royale have their own maps
    $(root, '#host-goal').textContent = `${!battle ? 'The Foundry · co-op' : koth ? 'Crown · hold the hill to win' : br ? 'Wildmere · start with a pistol, last one standing wins' : `First to ${KILL_LIMIT} kills`} · up to ${NET.maxPlayersPerLobby} players`;
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
    const br = mode === 'battle' && format === 'br';
    const teams = koth || (mode === 'battle' && format === 'teams');
    const pick = $<HTMLInputElement>(root, 'input[name=map]:checked').value;
    const map = pick === 'random' ? randomBattleMap() : (pick as BattleMap); // chosen here so every player gets the same arena
    if (await goOnline(root, ctx.net)) ctx.net.host(playerName(), mode, teams, map, koth, br);
    create.disabled = false;
  });
  create.focus();
  return off;
};
