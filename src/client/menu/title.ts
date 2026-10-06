import type { Render } from './router.ts';
import { mountLogo } from './logo.ts';
import { $, esc, saveName, storedName } from './ui.ts';

// Small storybook icons for the three buttons.
const ICONS = {
  practice: `<svg viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="34" r="22" fill="#fbf4e2" stroke="#d9584a" stroke-width="4"/>
      <circle cx="32" cy="34" r="12" fill="none" stroke="#d9584a" stroke-width="4"/>
      <circle cx="32" cy="34" r="4" fill="#d9584a"/>
      <path d="M44 8 q10 2 12 12 q-10 0 -12 -12z" fill="#6fa64a"/></svg>`,
  host: `<svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M10 40 Q32 34 54 40 L46 46 Q38 60 32 62 Q26 56 18 46Z" fill="#a98c6c"/>
      <path d="M8 40 Q32 32 56 40 Q48 44 32 42 Q16 44 8 40Z" fill="#7fb24e"/>
      <rect x="30" y="8" width="3" height="32" rx="1.5" fill="#7a5236"/>
      <path d="M33 9 L52 15 L33 22Z" fill="#d9584a"/></svg>`,
  join: `<svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M6 30 L58 10 L44 54 L32 38Z" fill="#fbf4e2" stroke="#4a3726" stroke-width="3" stroke-linejoin="round"/>
      <path d="M32 38 L58 10 L28 34Z" fill="#8cc6ee"/>
      <path d="M6 58 q10 -8 22 -10" stroke="#fffdf3" stroke-width="3" fill="none" stroke-dasharray="4 5" stroke-linecap="round"/></svg>`,
};

const door = (name: 'practice' | 'host' | 'join', title: string) => `
  <button class="door door-${name}" data-go="${name}">
    <span class="door-art">${ICONS[name]}</span>
    <b>${title}</b>
  </button>`;

export const title: Render = (root, ctx, screen) => {
  root.innerHTML = `
    <main class="screen title-screen">
      <h1 class="logo" tabindex="-1" aria-label="Gambol"><canvas aria-hidden="true"></canvas></h1>
      <label class="name-chip">
        <span>Playing as</span>
        <input id="name" maxlength="16" placeholder="your name" autocomplete="nickname" spellcheck="false" value="${esc(storedName())}" />
        <i aria-hidden="true">✎</i>
      </label>
      <nav class="doors" aria-label="Play">
        ${door('practice', 'Practice')}
        ${door('host', 'Host')}
        ${door('join', 'Join')}
      </nav>
      <p class="notice" role="status">${screen.notice ? esc(screen.notice) : ''}</p>
      <footer class="menu-foot"><button class="link" data-go="help">How to play</button></footer>
    </main>`;

  const nameInput = $<HTMLInputElement>(root, '#name');
  nameInput.addEventListener('input', () => saveName(nameInput.value));
  nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && nameInput.blur());
  root.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) =>
    b.addEventListener('click', () => ctx.go({ name: b.dataset.go as 'practice' | 'host' | 'join' | 'help' })),
  );
  // A notice is shown once; don't replay it when navigating back here later.
  if (screen.notice) history.replaceState({ ...screen, notice: undefined }, '');
  $(root, '.door-practice').focus();
  return mountLogo($(root, '.logo canvas') as HTMLCanvasElement);
};
