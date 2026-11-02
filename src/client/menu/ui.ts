// Shared bits for the menu screens: the painted backdrop, the page shell, names, toasts. (Gambol's server pill is gambol/client/menu/online.ts.)

import { account } from '../account.ts';

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

/** The menu's backdrop: a sunny meadow, so the character on the home screen stands in a field. (Loading into a match keeps the sky.) */
export const FIELD_BACKDROP = `
  <div class="sky field" aria-hidden="true">
    <div class="sun"></div>
    <svg class="far-mountains" viewBox="0 0 1600 300" preserveAspectRatio="none">
      <defs>
        <linearGradient id="mtA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b4fd1"/><stop offset="1" stop-color="#8fb4ff"/></linearGradient>
        <linearGradient id="mtB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f7fe0"/><stop offset="1" stop-color="#8ad6f2"/></linearGradient>
        <linearGradient id="mtC" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#18a98f"/><stop offset="1" stop-color="#a6e6c4"/></linearGradient>
      </defs>
      <path d="M0 300 V170 L110 60 L170 110 L260 20 L360 130 L450 80 L560 170 L640 110 L760 40 L880 150 L980 90 L1100 10 L1230 140 L1330 70 L1450 130 L1600 60 V300Z" fill="url(#mtA)"/>
      <path d="M260 20 L222 62 L246 56 L262 74 L280 54 L300 62Z M1100 10 L1064 52 L1086 46 L1104 66 L1124 44 L1142 54Z M760 40 L728 76 L748 72 L762 88 L780 70 L796 78Z" fill="#fff"/>
      <path d="M0 300 V210 L90 140 L190 200 L300 110 L420 210 L540 150 L680 220 L800 130 L930 215 L1060 150 L1180 225 L1310 140 L1440 210 L1600 150 V300Z" fill="url(#mtB)"/>
      <path d="M300 110 L274 140 L292 136 L304 152 L320 134 L334 140Z M800 130 L774 160 L792 156 L804 172 L820 154 L836 160Z M1310 140 L1286 168 L1302 164 L1314 178 L1330 162 L1344 168Z" fill="#fff" opacity=".95"/>
      <path d="M0 300 V250 L140 200 L260 245 L400 190 L540 250 L700 205 L860 255 L1020 195 L1180 250 L1340 200 L1480 245 L1600 210 V300Z" fill="url(#mtC)"/>
    </svg>
    <div class="cloud c2"></div><div class="cloud c1"></div><div class="cloud c4"></div><div class="cloud c6"></div><div class="cloud c7"></div>
    <svg class="bird b1" viewBox="0 0 40 20"><path d="M2 10 Q10 0 20 10 Q30 0 38 10" fill="none" stroke="#3d3550" stroke-width="2.4" stroke-linecap="round"/></svg>
    <svg class="bird b2" viewBox="0 0 40 20"><path d="M2 10 Q10 0 20 10 Q30 0 38 10" fill="none" stroke="#3d3550" stroke-width="2.4" stroke-linecap="round"/></svg>
    <svg class="bird b3" viewBox="0 0 40 20"><path d="M2 10 Q10 0 20 10 Q30 0 38 10" fill="none" stroke="#3d3550" stroke-width="2.4" stroke-linecap="round"/></svg>
    <svg class="hills" viewBox="0 0 1600 400" preserveAspectRatio="none">
      <path d="M0 200 Q200 90 420 170 T860 150 T1240 160 T1600 120 V400 H0Z" fill="#9fc98a"/>
      <path d="M0 260 Q260 170 520 240 T1020 220 T1600 230 V400 H0Z" fill="#86b872"/>
      <g fill="#6b9a58"><path d="M120 235 l22 -42 l22 42z"/><path d="M1300 215 l18 -34 l18 34z"/><path d="M1380 222 l14 -26 l14 26z"/></g>
    </svg>
    <div class="meadow"></div>
    <i class="fly f1"></i><i class="fly f2"></i><i class="fly f3"></i><i class="fly f4"></i><i class="fly f5"></i><i class="fly f6"></i>
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
