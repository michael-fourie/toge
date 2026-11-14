// Shared bits for the menu screens: the page shell, names, toasts.

import { account } from '../account.ts';

export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

export const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

// --- Player name -----------------------------------------------------------------

const NAME_KEY = 'atrous.name';

function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 16));
  } catch {
    /* private mode */
  }
}

/** The name to play under: your username, or a generic Guest#### (kept in this browser) until you make an account. */
export function playerName(): string {
  if (account.user) return account.user; // signed in: the server uses your username regardless
  const n = storedName().trim();
  if (n) return n;
  const guest = `Guest${1000 + Math.floor(Math.random() * 9000)}`;
  saveName(guest);
  return guest;
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
