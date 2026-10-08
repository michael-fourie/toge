import { JACKETS } from '../../shared/skin.ts';
import { account } from '../account.ts';
import { stash } from '../inventoryStore.ts';
import { storedSkin } from '../skinStore.ts';
import { coinText } from './lootui.ts';
import { levelBadge } from '../xpcard.ts';
import '../xpcard.css';
import type { Render, ScreenName } from './router.ts';
import { DEFAULT_JACKET, mountSkinPreview } from './skinPreview.ts';
import { $, esc, playerName } from './ui.ts';
import './home.css';

export const title: Render = (root, ctx, screen) => {
  let preview: ReturnType<typeof mountSkinPreview> | null = null;
  let notice = screen.notice;

  /** Bottom-right card: balance plus who you are. Guests get a generic name and the Log in / Create account buttons. */
  const accountCard = () => `
    <aside class="acct-card" aria-label="Account and balance">
      <div class="acct-who">
        <span class="avatar-dot" aria-hidden="true">${esc((account.user ?? 'G')[0].toUpperCase())}</span>
        <span class="acct-name"><small>${account.user ? 'Signed in' : 'Playing as a guest'}</small><b>${esc(playerName())}</b></span>
        ${levelBadge(stash.inv.xp)}
      </div>
      <button class="coin-pill" data-go="casino" title="Coins: earn them by eliminating things, spend them on cases, Plinko and Blackjack" aria-label="Coins">${coinText(stash.inv.coins)}</button>
      ${
        account.user
          ? `<button class="nav-btn" data-signout>Sign out</button>`
          : `<div class="acct-actions"><button class="login-btn" data-go="account">Log in</button><button class="nav-btn" data-go="signup">Create account</button></div>
             <p class="acct-hint">Create an account to pick your own name and keep it.</p>`
      }
    </aside>`;

  /** The name under the character: just a label, never editable. */
  const plate = () => `<b class="plate-name">${esc(playerName())}</b>`;

  const drawHero = () => {
    preview?.dispose();
    const skin = storedSkin();
    const canvas = $<HTMLCanvasElement>(root, '.hero-canvas');
    preview = mountSkinPreview(canvas, false, 0.35);
    preview.show(skin, skin?.jacket === undefined ? DEFAULT_JACKET : JACKETS[skin.jacket], playerName(), stash.gear);
  };

  const draw = () => {
    root.innerHTML = `
    <main class="screen home">
      <header class="topbar">
        <h1 class="logo glitch" tabindex="-1" data-text="GAMBOL">GAMBOL</h1>
        <nav class="top-tabs" aria-label="Sections">
          <button class="tab on" aria-current="page">Play</button>
          <button class="tab" data-go="inventory">Inventory</button>
          <button class="tab" data-go="casino">Casino</button>
          <button class="tab" data-go="help">How to play</button>
        </nav>
        <div class="top-right">
          <button class="gear-btn" data-go="settings" aria-label="Settings" title="Settings">⚙</button>
        </div>
      </header>
      <section class="hero" aria-label="Your character">
        <canvas class="hero-canvas" aria-hidden="true"></canvas>
        <div class="nameplate">${plate()}</div>
      </section>
      <nav class="play-menu" aria-label="Play">
        <button class="play-btn play-host" data-go="host"><b>Host</b></button>
        <button class="play-btn play-join" data-go="join"><b>Join</b></button>
        <button class="play-btn play-practice" data-play="practice"><b>Practice</b></button>
      </nav>
      ${accountCard()}
      <p class="notice" role="status">${notice ? esc(notice) : ''}</p>
    </main>`;
    notice = undefined; // shown once; a redraw (e.g. after signing in) shouldn't bring it back

    const goto = (key: string) => {
      if (key === 'signup') ctx.go({ name: 'account', signup: true });
      else ctx.go({ name: key as ScreenName });
    };
    root.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => goto(b.dataset.go!)));
    root.querySelector('[data-play]')?.addEventListener('click', () => ctx.go({ name: 'practice' })); // pick the bots first
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
    if (pill) pill.innerHTML = coinText(stash.inv.coins);
    const lvl = root.querySelector('.lvl-badge');
    if (lvl) lvl.outerHTML = levelBadge(stash.inv.xp);
  });
  return () => {
    offAcct();
    offStash();
    preview?.dispose();
  };
};
