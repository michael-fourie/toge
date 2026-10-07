// Shared bits for the menu screens: the painted backdrop, the page shell, names, toasts, the server pill.

import type { LobbyInfo } from '../../shared/protocol.ts';
import { account } from '../account.ts';
import type { Net } from '../net.ts';
import { sfx } from '../sfx.ts';

export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** Painted sky shared by the menu and the loading screen: sun, drifting clouds, and the island skirmish canvas. */
export const SKY_BACKDROP = `
  <div class="sky" aria-hidden="true">
    <div class="sun"></div>
    <div class="cloud c1"></div><div class="cloud c2"></div><div class="cloud c3"></div><div class="cloud c4"></div>
    <canvas class="skirmish"></canvas>
    <div class="cloud c5"></div>
  </div>`;

/** A paper sheet with a back button and heading; the body is screen-specific. */
export function sheet(title: string, body: string, backLabel = 'Back') {
  return `
    <main class="screen sheet">
      <header class="sheet-head">
        <button class="back" data-back>← ${esc(backLabel)}</button>
        <h2 tabindex="-1">${esc(title)}</h2>
      </header>
      ${body}
    </main>`;
}

export const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

// --- Player name -----------------------------------------------------------------

const NAME_KEY = 'atrous.name';

export function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 16));
  } catch {
    /* private mode */
  }
}

/** The name to play under; invents (and remembers) a bean name if none is set. */
export function playerName(): string {
  if (account.user) return account.user; // signed in: the server uses your username regardless
  const n = storedName().trim();
  if (n) return n;
  const bean = `bean${Math.floor(Math.random() * 1000)}`;
  saveName(bean);
  return bean;
}

// --- Feedback ----------------------------------------------------------------------

export function toast(text: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

export async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied!`);
  } catch {
    toast(`Couldn't copy. It's ${text}`);
  }
}

/** Replays a CSS animation class (e.g. a shake on a wrong code). */
export function replay(el: HTMLElement, cls: string) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// --- Server connection pill ----------------------------------------------------------

export const SERVER_PILL = `<p class="pill" data-pill role="status" aria-live="polite"></p>`;

/**
 * Checks the server and reflects the state in the screen's pill: connecting → online, or offline with Retry.
 * Resolves the open lobbies, or null when the server can't be reached.
 */
export async function goOnline(root: HTMLElement, net: Net): Promise<LobbyInfo[] | null> {
  const pill = $(root, '[data-pill]');
  const set = (state: string, html: string) => {
    if (!pill) return;
    pill.dataset.state = state;
    pill.innerHTML = html;
  };
  sfx.unlock();
  set('connecting', '<i class="mini-leaf"></i> Reaching the sky server…');
  try {
    const lobbies = await net.lobbies();
    set('online', '<i class="dot"></i> Server online');
    return lobbies;
  } catch {
    const hint = import.meta.env.DEV ? ' Is <code>npm run dev</code> running?' : '';
    set('offline', `Can't reach the sky server.${hint} <button class="link" data-retry>Retry</button>`);
    $(root, '[data-retry]')?.addEventListener('click', () => void goOnline(root, net));
    return null;
  }
}
