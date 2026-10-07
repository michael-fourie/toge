import { JACKETS } from '../../shared/skin.ts';
import { account } from '../account.ts';
import { stash } from '../inventoryStore.ts';
import { storedSkin } from '../skinStore.ts';
import { coinText } from './lootui.ts';
import type { Render, ScreenName } from './router.ts';
import { DEFAULT_JACKET, mountSkinPreview } from './skinPreview.ts';
import { skinLabel } from './skin.ts';
import { $, esc, saveName, storedName } from './ui.ts';
import './home.css';

export const title: Render = (root, ctx, screen) => {
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
    root.innerHTML = `
    <main class="screen home">
      <header class="topbar">
        <h1 class="logo glitch" tabindex="-1" data-text="GAMBOL">GAMBOL</h1>
        <nav class="top-tabs" aria-label="Sections">
          <button class="tab on" aria-current="page">Play</button>
          <button class="tab" data-go="inventory">Inventory</button>
          <button class="tab" data-go="store">Store</button>
          <button class="tab" data-go="help">How to play</button>
        </nav>
        <div class="top-right">
          <button class="coin-pill" data-go="store" title="Coins: earn them by eliminating things, spend them on cases" aria-label="Coins">${coinText(stash.inv.coins)}</button>
          ${accountBox()}
          <button class="gear-btn" data-go="settings" aria-label="Settings" title="Settings">⚙</button>
        </div>
      </header>
      <section class="hero" aria-label="Your character">
        <canvas class="hero-canvas" aria-hidden="true"></canvas>
        <div class="nameplate">${plate()}<button class="look-btn" data-go="character">Look: ${esc(skinLabel(storedSkin()))} · Customize</button></div>
      </section>
      <nav class="play-menu" aria-label="Play">
        <button class="play-btn play-host" data-go="host"><b>Host</b></button>
        <button class="play-btn play-join" data-go="join"><b>Join</b></button>
        <button class="play-btn play-practice" data-play="practice"><b>Practice</b></button>
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
    root.querySelector('[data-play]')?.addEventListener('click', () => ctx.play()); // Practice
    root.querySelector('[data-signout]')?.addEventListener('click', () => void account.signOut());
    drawHero();
  };

  draw();
  $(root, '.play-host').focus();
  // A notice is shown once; don't replay it when navigating back here later.
  if (screen.notice) history.replaceState({ ...screen, notice: undefined }, '');
  const offAcct = account.onChange(draw); // signed in or out
  // Coins change when kills pay out or cases open; only the pill needs to move.
  const offStash = stash.onChange(() => {
    const pill = root.querySelector('.coin-pill');
    if (pill) pill.textContent = coinText(stash.inv.coins);
  });
  return () => {
    offAcct();
    offStash();
    preview?.dispose();
  };
};
