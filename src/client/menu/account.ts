import { PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN } from '../../shared/account.ts';
import { account } from '../account.ts';
import type { Render } from './router.ts';
import './account.css';
import { $, esc } from './ui.ts';
import { ICON, LOGO } from '../../kanjo/client/brand.ts';

/** The account card in KANJO's look (DESIGN.md): the logo, a back pill, the heading, then `body`. */
const card = (body: string) => `
  <div class="tg tg-account">
    <main class="tg-acct" data-nav-scope>
      <header class="tg-acct-head">
        <button class="tg-home" data-back aria-label="Back">${ICON.back}</button>
        ${LOGO}
      </header>
      <h2 class="tg-acct-title" tabindex="-1">Account</h2>
      ${body}
    </main>
  </div>`;

/** Sign in / create account, or who you're signed in as. Accounts are optional: guests can play, an account just reserves your name. */
export const accountScreen: Render = (root, ctx, screen) => {
  // Redraw when the sign-in state changes (e.g. /api/me lands after we opened, or Sign out).
  const draw = () => (account.user ? signedIn(root, account.user) : signInForm(root, ctx, screen.signup));
  draw();
  return account.onChange(draw);
};

function signedIn(root: HTMLElement, user: string) {
  root.innerHTML = card(
    `
    <p class="tg-acct-lead">Signed in as <b>${esc(user)}</b>. Your garage, race money, best times and friends are kept on this account.</p>
    <div class="tg-acct-cta"><button class="tg-go alt small" data-signout>Sign out</button></div>
    <details class="account-change">
      <summary>Change password</summary>
      <form class="account-form" novalidate>
        <input type="text" autocomplete="username" value="${esc(user)}" hidden />
        <label>Current password<input id="acc-cur" type="password" autocomplete="current-password" /></label>
        <label>New password<input id="acc-new" type="password" autocomplete="new-password" /></label>
        <p class="tg-acct-hint">At least ${PASSWORD_MIN} characters. You stay signed in here and get signed out everywhere else.</p>
        <p class="tg-acct-notice notice" role="alert"></p>
        <div class="tg-acct-cta"><button class="tg-go small" type="submit">Change password</button></div>
      </form>
    </details>`,
  );
  const out = $<HTMLButtonElement>(root, '[data-signout]');
  out.addEventListener('click', () => {
    out.disabled = true;
    void account.signOut();
  });
  const form = $<HTMLFormElement>(root, '.account-change form');
  const cur = $<HTMLInputElement>(root, '#acc-cur');
  const next = $<HTMLInputElement>(root, '#acc-new');
  const notice = $(root, '.account-change .notice');
  const submit = $<HTMLButtonElement>(form, 'button[type=submit]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    notice.textContent = '';
    notice.classList.remove('ok');
    const err = await account.changePassword(cur.value, next.value);
    submit.disabled = false;
    if (err) return void (notice.textContent = err);
    cur.value = next.value = '';
    notice.classList.add('ok');
    notice.textContent = 'Password changed.';
  });
  out.focus();
}

function signInForm(root: HTMLElement, ctx: Parameters<Render>[1], signup?: boolean) {
  let mode: 'login' | 'register' = 'login';
  root.innerHTML = card(
    `
    <p class="tg-acct-lead">Sign in to keep your garage and race money on the server, set times on the leaderboards and add friends. Nobody else can race under your name.</p>
    <div class="tg-acct-tabs" role="tablist">
      <button class="tg-pill" role="tab" data-mode="login" aria-pressed="true">Sign in</button>
      <button class="tg-pill" role="tab" data-mode="register" aria-pressed="false">Create account</button>
    </div>
    <form class="account-form" novalidate>
      <label>Username<input id="acc-user" maxlength="${USERNAME_MAX}" autocomplete="username" spellcheck="false" autocapitalize="off" /></label>
      <label>Password<input id="acc-pass" type="password" autocomplete="current-password" /></label>
      <p class="tg-acct-hint" data-hint></p>
      <p class="tg-acct-notice notice" role="alert"></p>
      <div class="tg-acct-cta"><button class="tg-go" type="submit">Sign in</button></div>
    </form>`,
  );
  const form = $<HTMLFormElement>(root, 'form');
  const user = $<HTMLInputElement>(root, '#acc-user');
  const pass = $<HTMLInputElement>(root, '#acc-pass');
  const notice = $(root, '.notice');
  const submit = $<HTMLButtonElement>(root, 'button[type=submit]');

  const setMode = (m: 'login' | 'register') => {
    mode = m;
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    submit.textContent = m === 'login' ? 'Sign in' : 'Create account';
    pass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    $(root, '[data-hint]').textContent = m === 'register' ? `${USERNAME_MIN}-${USERNAME_MAX} letters, numbers, _ or -. Password at least ${PASSWORD_MIN} characters.` : '';
    notice.textContent = '';
  };
  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode as 'login' | 'register')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    notice.textContent = '';
    const err = await account.submit(mode, user.value.trim(), pass.value);
    submit.disabled = false;
    if (err) notice.textContent = err;
    else ctx.back();
  });
  if (signup) setMode('register');
  user.focus();
}
