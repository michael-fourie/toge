import type { PlayerInfo } from '../../shared/protocol.ts';
import { MODES } from './host.ts';
import type { Render } from './router.ts';
import { $, copy, esc, hex, sheet } from './ui.ts';

/**
 * The lobby room: a client-side pre-roll before entering the (always running) match.
 * It keeps ctx.joined fresh from messages the server already sends, then hands it to the Game.
 */
export const lobby: Render = (root, ctx) => {
  const j = ctx.joined;
  if (!j) return ctx.replace({ name: 'title' });
  const invite = `${location.origin}/?join=${j.code}`;

  root.innerHTML = sheet(
    'Lobby',
    `
    <section class="lobby-code-card" aria-label="Lobby code">
      <span class="mode-tag mode-${j.mode}">${MODES[j.mode].name}</span>
      <span class="small-caps">Share this code</span>
      <div class="big-code" aria-label="${[...j.code].join(' ')}">${[...j.code].map((c) => `<span>${esc(c)}</span>`).join('')}</div>
      <div class="row">
        <button data-copy-code>Copy code</button>
        <button data-copy-link>Copy invite link</button>
      </div>
    </section>
    <section class="roster" aria-labelledby="roster-h">
      <h3 id="roster-h">In this sky <span class="count"></span></h3>
      <ul class="players" aria-live="polite"></ul>
    </section>
    <p class="hint">${
      j.mode === 'survival'
        ? 'The horde is already rising. You spawn by the Great Tree the moment you enter.'
        : "The match is already running. You'll spawn the moment you enter."
    }</p>
    <div class="cta"><button class="primary big" id="enter">Enter match</button></div>`,
    'Leave',
  );

  const players = $(root, '.players');
  const draw = () => {
    $(root, '.count').textContent = `${j.players.length}`;
    players.innerHTML = j.players
      .map(
        (p) => `<li>
          <i class="swatch" style="background:${hex(p.color)}"></i>
          <span class="pname">${esc(p.name)}</span>
          ${p.id === j.hostId ? '<em class="badge">host</em>' : ''}
          ${p.id === ctx.net.id ? '<em class="badge you">you</em>' : ''}
          <small>${p.kills} / ${p.deaths}</small>
        </li>`,
      )
      .join('');
  };
  draw();

  const find = (id: number): PlayerInfo | undefined => j.players.find((p) => p.id === id);
  const off = ctx.net.on((m) => {
    switch (m.t) {
      case 'playerJoined':
        if (!find(m.player.id)) j.players.push(m.player);
        break;
      case 'playerLeft':
        j.players = j.players.filter((p) => p.id !== m.id);
        j.hostId = m.hostId;
        break;
      case 'kill': {
        const victim = find(m.victim);
        if (victim) {
          victim.alive = false;
          victim.deaths++;
        }
        const killer = m.killer !== m.victim ? find(m.killer) : undefined;
        if (killer) killer.kills++;
        break;
      }
      case 'respawn': {
        const p = find(m.id);
        if (p) p.alive = true;
        if (m.id === ctx.net.id) j.spawn = { p: m.p, yaw: m.yaw };
        break;
      }
      default:
        return;
    }
    draw();
  });
  ctx.net.onClose = () => ctx.replace({ name: 'title', notice: 'Lost connection to the server.' });

  $(root, '[data-copy-code]').addEventListener('click', () => void copy(j.code, 'Code'));
  $(root, '[data-copy-link]').addEventListener('click', () => void copy(invite, 'Invite link'));
  let entering = false;
  $(root, '#enter').addEventListener('click', () => {
    entering = true;
    ctx.play(j);
  });
  $(root, '#enter').focus();

  return () => {
    off();
    ctx.net.onClose = undefined;
    if (!entering) {
      ctx.net.send({ t: 'leave' });
      ctx.joined = null;
    }
  };
};
