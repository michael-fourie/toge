import type { LobbyInfo, ServerMsg } from '../shared/protocol.ts';
import { Game } from './game.ts';
import { Net } from './net.ts';
import { sfx } from './sfx.ts';

const app = document.getElementById('app')!;
const net = new Net();

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function storedName(): string {
  try {
    return localStorage.getItem('atrous.name') ?? '';
  } catch {
    return '';
  }
}

/** Painted sky backdrop shared by the menu and the loading screen: drifting clouds and a floating island. */
const SKY_BACKDROP = `
  <div class="sky">
    <div class="sun"></div>
    <div class="cloud c1"></div><div class="cloud c2"></div><div class="cloud c3"></div><div class="cloud c4"></div>
    <svg class="isle" viewBox="0 0 320 300" aria-hidden="true">
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

function showMenu(notice?: string) {
  app.innerHTML = `
    <div class="menu">
      ${SKY_BACKDROP}
      <div class="menu-card">
        <h1 class="logo">Atrous<span>a sky-island bhop &amp; snipe</span></h1>
        <label class="field">
          <span>Your name</span>
          <input id="name" maxlength="16" placeholder="sniper_mcgee" value="${esc(storedName())}" />
        </label>
        <div class="row">
          <button id="practice" class="primary">Practice</button>
          <button id="host">Host lobby</button>
        </div>
        <div class="row join">
          <input id="code" maxlength="4" placeholder="CODE" autocomplete="off" />
          <button id="join">Join</button>
        </div>
        <div class="lobbies">
          <div class="lobbies-head"><span>Open lobbies</span><button id="refresh" class="link">refresh</button></div>
          <ul id="lobby-list"><li class="empty">Hit refresh to look for games</li></ul>
        </div>
        <p class="notice" id="notice">${notice ? esc(notice) : ''}</p>
      </div>
    </div>`;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const nameInput = $<HTMLInputElement>('name');
  const codeInput = $<HTMLInputElement>('code');
  const setNotice = (t: string) => ($('notice').textContent = t);
  const name = () => {
    const n = nameInput.value.trim() || `bean${Math.floor(Math.random() * 1000)}`;
    try {
      localStorage.setItem('atrous.name', n);
    } catch {
      /* private mode */
    }
    return n;
  };

  // While the menu is up, route server messages here.
  const off = net.on((m: ServerMsg) => {
    if (m.t === 'lobbies') renderLobbies(m.lobbies);
    if (m.t === 'error') setNotice(m.message);
    if (m.t === 'joined') {
      off();
      void startGame(name(), m);
    }
  });

  const online = async (then: () => void) => {
    sfx.unlock();
    setNotice('Connecting…');
    try {
      await net.connect(name());
      setNotice('');
      then();
    } catch (e) {
      setNotice(`${(e as Error).message}. Is the server running? (npm run dev)`);
    }
  };

  const renderLobbies = (lobbies: LobbyInfo[]) => {
    const list = $('lobby-list');
    list.innerHTML = lobbies.length
      ? lobbies
          .map((l) => `<li><b>${esc(l.code)}</b><span>${esc(l.host)}'s game</span><em>${l.players}/${l.max}</em><button data-code="${esc(l.code)}">Join</button></li>`)
          .join('')
      : '<li class="empty">No open lobbies. Host one!</li>';
    list.querySelectorAll<HTMLButtonElement>('button[data-code]').forEach((b) =>
      b.addEventListener('click', () => online(() => net.send({ t: 'join', code: b.dataset.code! }))),
    );
  };

  $('practice').addEventListener('click', () => {
    off();
    sfx.unlock();
    void startGame(name());
  });
  $('host').addEventListener('click', () => online(() => net.send({ t: 'host' })));
  $('join').addEventListener('click', () => {
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 4) return setNotice('Lobby codes are 4 letters.');
    online(() => net.send({ t: 'join', code }));
  });
  codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && $('join').click());
  $('refresh').addEventListener('click', () => online(() => net.send({ t: 'list' })));
}

const LOADING_LINES = ['Catching the wind…', 'Waking the island spirits…', 'Polishing the brass scopes…', 'Fluffing the clouds…', 'Shooing the dust bunnies…'];

/** Resolves after the next paint; falls back to a timeout when the tab is hidden (rAF paused). */
const nextPaint = () =>
  new Promise<void>((res) => {
    requestAnimationFrame(() => res());
    setTimeout(res, 80);
  });

function showLoading(): () => void {
  const el = document.createElement('div');
  el.className = 'loading';
  el.innerHTML = `${SKY_BACKDROP}<div class="loading-card"><div class="leaf"></div><p>${LOADING_LINES[Math.floor(Math.random() * LOADING_LINES.length)]}</p></div>`;
  document.body.appendChild(el);
  const shownAt = performance.now();
  // Hold briefly so it never flashes, then fade away.
  return () => {
    setTimeout(() => {
      el.classList.add('done');
      setTimeout(() => el.remove(), 700);
    }, Math.max(0, 900 - (performance.now() - shownAt)));
  };
}

async function startGame(name: string, joined?: Extract<ServerMsg, { t: 'joined' }>) {
  const hide = showLoading();
  // Offline we can let the loading screen paint before building the world. Online, build
  // immediately so no lobby messages arrive before the game is listening.
  if (!joined) await nextPaint();
  app.innerHTML = '';
  new Game({
    container: app,
    name,
    net: joined ? net : undefined,
    joined,
    onExit: (reason) => showMenu(reason),
  });
  // The first rendered frames compile shaders; keep the veil up through them.
  await nextPaint();
  await nextPaint();
  hide();
}

// Deep link: /?join=ABCD
const deepLink = new URLSearchParams(location.search).get('join');
showMenu();
if (deepLink) (document.getElementById('code') as HTMLInputElement).value = deepLink.toUpperCase();
