import { PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN } from '../../shared/account.ts';
import { account } from '../account.ts';
import type { Render } from './router.ts';
import './account.css';
import { $, esc, sheet } from './ui.ts';

/** Sign in / create account, or who you're signed in as. Accounts are optional: guests can play, an account just reserves your name. */
export const accountScreen: Render = (root, ctx, screen) => {
  // Redraw when the sign-in state changes (e.g. /api/me lands after we opened, or Sign out).
  const draw = () => (account.user ? signedIn(root, account.user) : signInForm(root, ctx, screen.signup));
  draw();
  return account.onChange(draw);
};

function signedIn(root: HTMLElement, user: string) {
  root.innerHTML = sheet(
    'Account',
    `
    <p class="lead">Signed in as <b>${esc(user)}</b>. Your name, coins and XP are kept on this account.</p>
    <div class="cta"><button class="primary big" data-signout>Sign out</button></div>`,
  );
  const out = $<HTMLButtonElement>(root, '[data-signout]');
  out.addEventListener('click', () => {
    out.disabled = true;
    void account.signOut();
  });
  out.focus();
}

function signInForm(root: HTMLElement, ctx: Parameters<Render>[1], signup?: boolean) {
  let mode: 'login' | 'register' = 'login';
  root.innerHTML = sheet(
    'Account',
    `
    <p class="lead">Sign in to keep your name. Friends can't pass as you.</p>
    <div class="tabs" role="tablist">
      <button role="tab" data-mode="login" class="on">Sign in</button>
      <button role="tab" data-mode="register">Create account</button>
    </div>
    <form class="account-form" novalidate>
      <label>Username<input id="acc-user" maxlength="${USERNAME_MAX}" autocomplete="username" spellcheck="false" autocapitalize="off" /></label>
      <label>Password<input id="acc-pass" type="password" autocomplete="current-password" /></label>
      <p class="hint" data-hint></p>
      <p class="notice" role="alert"></p>
      <div class="cta"><button class="primary big" type="submit">Sign in</button></div>
    </form>`,
  );
  const form = $<HTMLFormElement>(root, 'form');
  const user = $<HTMLInputElement>(root, '#acc-user');
  const pass = $<HTMLInputElement>(root, '#acc-pass');
  const notice = $(root, '.notice');
  const submit = $<HTMLButtonElement>(root, 'button[type=submit]');

  const setMode = (m: 'login' | 'register') => {
    mode = m;
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
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
