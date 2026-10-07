import { JACKETS } from '../../shared/skin.ts';
import { account } from '../account.ts';
import { stash } from '../inventoryStore.ts';
import { storedSkin } from '../skinStore.ts';
import { coinText } from './lootui.ts';
import { mountLogo } from './logo.ts';
import type { Render, ScreenName } from './router.ts';
import { DEFAULT_JACKET, mountSkinPreview } from './skinPreview.ts';
import { skinLabel } from './skin.ts';
import { $, esc, saveName, storedName } from './ui.ts';
import './home.css';

/** The main buttons down the left, Fortnite-lobby style. */
const PLAY = [
  { id: 'practice', label: 'Practice', sub: 'Free-fly against scarecrows' },
  { id: 'survival', label: 'Survival', sub: 'Co-op vs zombies' },
  { id: 'battle', label: 'Battle', sub: 'Snipers, first to 30' },
  { id: 'settings', label: 'Settings', sub: 'Mouse and controls' },
] as const;

export const title: Render = (root, ctx, screen) => {
  let stopLogo = () => {};
  let preview: ReturnType<typeof mountSkinPreview> | null = null;
  let notice = screen.notice;

  /** Top-right: a guest sees Log in / Create account; a signed-in player sees their name and Sign out. */
  const accountBox = () =>
    account.user
      ? `<div class="acct signed"><span class="avatar-dot" aria-hidden="true">${esc(account.user[0].toUpperCase())}</span>
           <span class="acct-name"><small>Signed in</small><b>${esc(account.user)}</b></span>
           <button class="nav-btn" data-signout>Sign out</button></div>`
      : `<div class="acct guest"><button class="login-btn" data-go="account">Log in</button>
           <button class="nav-btn" data-go="signup">Create account</button></div>`;

  const plate = () =>
    account.user
      ? `<b class="plate-name">${esc(account.user)}</b>`
      : `<label class="plate-name"><input id="name" maxlength="16" placeholder="your name" autocomplete="nickname" spellcheck="false" value="${esc(storedName())}" aria-label="Your name" /><i aria-hidden="true">✎</i></label>`;

  const drawHero = () => {
    preview?.dispose();
    const skin = storedSkin();
    const canvas = $<HTMLCanvasElement>(root, '.hero-canvas');
    preview = mountSkinPreview(canvas, false, 0.35);
    preview.show(skin, skin?.jacket === undefined ? DEFAULT_JACKET : JACKETS[skin.jacket], account.user ?? storedName().trim(), stash.gear);
  };

  const draw = () => {
    stopLogo();
    root.innerHTML = `
    <main class="screen home">
      <header class="topbar">
        <h1 class="logo" tabindex="-1" aria-label="Gambol"><canvas aria-hidden="true"></canvas></h1>
        <nav class="top-tabs" aria-label="Sections">
          <button class="tab on" aria-current="page">Play</button>
          <button class="tab" data-go="inventory">Inventory</button>
          <button class="tab" data-go="store">Store</button>
          <button class="tab" data-go="help">How to play</button>
        </nav>
        <div class="top-right">
          <button class="coin-pill" data-go="store" title="Acorns: earn them by eliminating things, spend them on cases" aria-label="Acorns">${coinText(stash.inv.coins)}</button>
          ${accountBox()}
        </div>
      </header>
      <section class="hero" aria-label="Your character">
        <canvas class="hero-canvas" aria-hidden="true"></canvas>
        <div class="nameplate">${plate()}<button class="look-btn" data-go="character">Look: ${esc(skinLabel(storedSkin()))} · Customize</button></div>
      </section>
      <nav class="play-menu" aria-label="Play">
        ${PLAY.map((p) => `<button class="play-btn play-${p.id}" data-play="${p.id}"><b>${p.label}</b><small>${p.sub}</small></button>`).join('')}
        <button class="link join-link" data-go="join">Have a code? Join a lobby</button>
      </nav>
      <p class="notice" role="status">${notice ? esc(notice) : ''}</p>
    </main>`;
    notice = undefined; // shown once; a redraw (e.g. after signing in) shouldn't bring it back

    const nameInput = root.querySelector<HTMLInputElement>('#name');
    if (nameInput) {
      nameInput.addEventListener('input', () => saveName(nameInput.value));
      nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && nameInput.blur());
    }
    const goto = (key: string) => {
      if (key === 'signup') ctx.go({ name: 'account', signup: true });
      else if (key === 'character') ctx.go({ name: 'inventory', tab: 'character' });
      else ctx.go({ name: key as ScreenName });
    };
    root.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => goto(b.dataset.go!)));
    root.querySelectorAll<HTMLElement>('[data-play]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.play;
        if (id === 'practice') ctx.play();
        else if (id === 'settings') ctx.go({ name: 'settings' });
        else ctx.go({ name: 'host', mode: id as 'survival' | 'battle' });
      }),
    );
    root.querySelector('[data-signout]')?.addEventListener('click', () => void account.signOut());
    stopLogo = mountLogo($(root, '.logo canvas') as HTMLCanvasElement);
    drawHero();
  };

  draw();
  $(root, '.play-practice').focus();
  // A notice is shown once; don't replay it when navigating back here later.
  if (screen.notice) history.replaceState({ ...screen, notice: undefined }, '');
  const offAcct = account.onChange(draw); // signed in or out
  // Acorns change when kills pay out or cases open; only the pill needs to move.
  const offStash = stash.onChange(() => {
    const pill = root.querySelector('.coin-pill');
    if (pill) pill.textContent = coinText(stash.inv.coins);
  });
  return () => {
    offAcct();
    offStash();
    stopLogo();
    preview?.dispose();
  };
};
