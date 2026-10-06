import { NET } from '../../shared/constants.ts';
import type { Render } from './router.ts';
import { $, SERVER_PILL, goOnline, playerName, sheet } from './ui.ts';

export const host: Render = (root, ctx) => {
  root.innerHTML = sheet(
    'Host a game',
    `
    <p class="lead">Open a lobby and you'll get a 4-letter code to share. Friends join with the code or an invite link.</p>
    <ul class="facts">
      <li><b>Up to ${NET.maxPlayersPerLobby}</b> beans per sky</li>
      <li><b>Always live:</b> the match runs from the moment it opens, so people drop in and out freely</li>
      <li><b>Free-for-all:</b> one AWP each, first to have fun wins</li>
    </ul>
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
    if (await goOnline(root, ctx.net)) ctx.net.host(playerName());
    create.disabled = false;
  });
  create.focus();
  return off;
};
