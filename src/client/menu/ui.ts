// Shared bits for the menu screens: the painted backdrop, the page shell, names, toasts, the server pill.

import type { Net } from '../net.ts';
import { sfx } from '../sfx.ts';

export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** Painted sky shared by the menu and the loading screen: drifting clouds and a floating island. */
export const SKY_BACKDROP = `
  <div class="sky" aria-hidden="true">
    <div class="sun"></div>
    <div class="cloud c1"></div><div class="cloud c2"></div><div class="cloud c3"></div><div class="cloud c4"></div>
    <svg class="isle" viewBox="0 0 320 300">
      <path d="M40 120 Q160 92 280 120 L250 150 Q215 250 165 292 Q140 230 92 190 Q60 160 40 120Z" fill="#a98c6c"/>
      <path d="M92 190 Q140 232 165 292 Q170 230 150 180Z" fill="#8a6f55" opacity=".7"/>
      <path d="M36 118 Q160 86 284 118 Q280 132 250 136 Q160 120 70 138 Q40 134 36 118Z" fill="#7fb24e"/>
      <rect x="196" y="40" width="9" height="74" rx="3" fill="#7a5236"/>
      <circle cx="200" cy="44" r="30" fill="#4f8a3c"/><circle cx="178" cy="62" r="22" fill="#6aa548"/>
      <circle cx="224" cy="60" r="24" fill="#3f7434"/><circle cx="204" cy="26" r="18" fill="#6aa548"/>
      <rect x="92" y="78" width="10" height="44" fill="#efdcbc"/><rect x="88" y="74" width="18" height="6" fill="#e3c79c"/>
      <rect x="120" y="92" width="10" height="28" fill="#efdcbc"/>
      <path d="M246 134 q4 40 -2 90" stroke="#e9f6ff" stroke-width="5" fill="none" opacity=".8" stroke-linecap="round"/>
    </svg>
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
  const n = storedName().trim();
  if (n) return n;
  const bean = `bean${Math.floor(Math.random() * 1000)}`;
  saveName(bean);
  return bean;
}

// --- Feedback ----------------------------------------------------------------------

function toast(text: string) {
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
 * Connects (if needed) and reflects the state in the screen's pill: connecting → online, or offline with Retry.
 * Resolves true when connected.
 */
export async function goOnline(root: HTMLElement, net: Net): Promise<boolean> {
  const pill = $(root, '[data-pill]');
  const set = (state: string, html: string) => {
    if (!pill) return;
    pill.dataset.state = state;
    pill.innerHTML = html;
  };
  sfx.unlock();
  set('connecting', '<i class="mini-leaf"></i> Reaching the sky server…');
  try {
    await net.connect(playerName());
    set('online', '<i class="dot"></i> Server online');
    return true;
  } catch {
    const hint = import.meta.env.DEV ? ' Is <code>npm run dev</code> running?' : '';
    set('offline', `Can't reach the sky server.${hint} <button class="link" data-retry>Retry</button>`);
    $(root, '[data-retry]')?.addEventListener('click', () => void goOnline(root, net));
    return false;
  }
}
