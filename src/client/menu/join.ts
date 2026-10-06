import type { LobbyInfo } from '../../shared/protocol.ts';
import { MODES } from './host.ts';
import type { Render } from './router.ts';
import { $, SERVER_PILL, esc, goOnline, replay, sheet } from './ui.ts';

const REFRESH_MS = 3000;

export const join: Render = (root, ctx, screen) => {
  root.innerHTML = sheet(
    'Join a game',
    `
    <form class="code-form" novalidate>
      <label class="code-label" for="c0">Lobby code</label>
      <div class="code-boxes">
        ${[0, 1, 2, 3].map((i) => `<input id="c${i}" maxlength="4" autocomplete="off" spellcheck="false" aria-label="Letter ${i + 1}" />`).join('')}
      </div>
      <button class="primary big" type="submit">Join</button>
    </form>
    <p class="notice" role="alert"></p>
    <section class="lobbies" aria-labelledby="open-h">
      <div class="lobbies-head">
        <h3 id="open-h">Open skies</h3>
        <button class="link" data-refresh>Refresh</button>
      </div>
      ${SERVER_PILL}
      <ul class="lobby-list" aria-live="polite"></ul>
    </section>`,
  );

  const boxes = [...root.querySelectorAll<HTMLInputElement>('.code-boxes input')];
  const form = $<HTMLFormElement>(root, '.code-form');
  const notice = $(root, '.notice');
  const list = $(root, '.lobby-list');

  // --- Four letter boxes: auto-advance, backspace back, paste or type over to fill several.
  /** Types letters in from box `from`. Typing the last letter submits; a prefill (deep link) just focuses Join. */
  const fill = (from: number, text: string, submit = true) => {
    const letters = text.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4 - from);
    letters.split('').forEach((ch, k) => (boxes[from + k].value = ch));
    const full = boxes.every((b) => b.value);
    if (full && submit && letters.length) form.requestSubmit();
    else if (full) $(form, 'button').focus();
    else boxes[Math.min(3, from + letters.length)].focus();
  };
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => {
      const v = b.value;
      b.value = '';
      fill(i, v);
    });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !b.value && i > 0) {
        boxes[i - 1].value = '';
        boxes[i - 1].focus();
        e.preventDefault();
      }
      if (e.key === 'ArrowLeft' && i > 0) boxes[i - 1].focus();
      if (e.key === 'ArrowRight' && i < 3) boxes[i + 1].focus();
    });
    b.addEventListener('paste', (e) => {
      e.preventDefault();
      fill(i, e.clipboardData?.getData('text') ?? '');
    });
    b.addEventListener('focus', () => b.select());
  });
  const joinCode = async (code: string) => {
    notice.textContent = '';
    if (await goOnline(root, ctx.net)) ctx.net.send({ t: 'join', code });
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = boxes.map((b) => b.value).join('');
    if (code.length < 4) {
      notice.textContent = 'Lobby codes are 4 letters.';
      replay($(root, '.code-boxes'), 'shake');
      return;
    }
    void joinCode(code);
  });
  if (screen.code) fill(0, screen.code, false);
  else boxes[0].focus();

  // --- Open lobbies, refreshed while this screen is up.
  const render = (lobbies: LobbyInfo[]) => {
    list.innerHTML = lobbies.length
      ? lobbies
          .map((l) => {
            const full = l.players >= l.max;
            return `<li>
              <b class="lobby-code">${esc(l.code)}</b>
              <span class="lobby-host">${esc(l.host)}'s sky <small class="mode-tag mode-${l.mode}">${MODES[l.mode].name}</small></span>
              <em>${l.players}/${l.max}</em>
              <button data-code="${esc(l.code)}" ${full ? 'disabled' : ''}>${full ? 'Full' : 'Join'}</button>
            </li>`;
          })
          .join('')
      : '<li class="empty">No open skies yet. Host one!</li>';
    list.querySelectorAll<HTMLButtonElement>('button[data-code]').forEach((b) => b.addEventListener('click', () => void joinCode(b.dataset.code!)));
  };
  const refresh = async () => {
    if (await goOnline(root, ctx.net)) ctx.net.send({ t: 'list' });
  };
  const off = ctx.net.on((m) => {
    if (m.t === 'lobbies') render(m.lobbies);
    if (m.t === 'joined') {
      ctx.joined = m;
      ctx.go({ name: 'lobby' });
    }
    if (m.t === 'error') {
      notice.textContent = m.message;
      replay($(root, '.code-boxes'), 'shake');
    }
  });
  $(root, '[data-refresh]').addEventListener('click', () => void refresh());
  void refresh();
  const timer = setInterval(() => ctx.net.connected && ctx.net.send({ t: 'list' }), REFRESH_MS);

  return () => {
    off();
    clearInterval(timer);
  };
};
