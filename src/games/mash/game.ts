import type { Party } from '../party.ts';
import type { GameApi } from '../types.ts';
import './mash.css';

const GOAL = 50;
const BEST_KEY = 'mash.best';

/** Messages between players. Anything JSON works; a `type` field keeps it readable. */
type Msg = { type: 'go' } | { type: 'n'; n: number } | { type: 'won'; time: number };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function mount(root: HTMLElement, api: GameApi): () => void {
  let party: Party | null = null;
  let offs: (() => void)[] = [];
  /** Presses per player id (you are api's party id, or 0 solo). */
  let counts = new Map<number, number>();
  let phase: 'menu' | 'room' | 'count' | 'mash' | 'done' = 'menu';
  let startedAt = 0;
  let note = '';
  let raf = 0;

  const me = () => party?.id ?? 0;
  const best = () => Number(localStorage.getItem(BEST_KEY) ?? 0);

  const draw = () => {
    if (phase === 'menu') {
      root.innerHTML = `
        <div class="mash">
          <h1>MASH</h1>
          <p>Press Ⓐ / Space / click as fast as you can. First to ${GOAL} wins.</p>
          <div class="mash-row">
            <button data-solo data-autofocus>Solo${best() ? ` (best ${best().toFixed(2)} s)` : ''}</button>
            <button data-host>Host a room</button>
            <input data-code maxlength="4" placeholder="CODE" aria-label="Room code" />
            <button data-join>Join</button>
          </div>
          <ul data-list></ul>
          <p class="mash-note">${esc(note)}</p>
          <button class="mash-back" data-exit>◀ Menu</button>
        </div>`;
      root.querySelector('[data-solo]')!.addEventListener('click', () => start(false));
      root.querySelector('[data-host]')!.addEventListener('click', () => void connect(null));
      root.querySelector('[data-join]')!.addEventListener('click', () => void connect(root.querySelector<HTMLInputElement>('[data-code]')!.value));
      root.querySelector('[data-exit]')!.addEventListener('click', () => api.exit());
      void api.party.list().then((rooms) => {
        const ul = root.querySelector('[data-list]');
        if (!ul) return;
        ul.innerHTML = rooms.map((r) => `<li><button data-room="${esc(r.code)}">Join ${esc(r.host)}'s room (${r.players})</button></li>`).join('');
        ul.querySelectorAll<HTMLElement>('[data-room]').forEach((b) => b.addEventListener('click', () => void connect(b.dataset.room!)));
      }, () => {});
    } else if (phase === 'room') {
      const p = party!;
      root.innerHTML = `
        <div class="mash">
          <h1>Room ${esc(p.code)}</h1>
          <ul class="mash-who">${p.members.map((m) => `<li>${esc(m.name)}${m.id === p.hostId ? ' ★' : ''}</li>`).join('')}</ul>
          ${p.isHost ? '<button data-go data-autofocus>Start</button>' : '<p>Waiting for the host…</p>'}
          <p class="mash-note">${esc(note)}</p>
          <button class="mash-back" data-leave>Leave room</button>
        </div>`;
      root.querySelector('[data-go]')?.addEventListener('click', () => {
        party!.send({ type: 'go' } satisfies Msg);
        start(true);
      });
      root.querySelector('[data-leave]')!.addEventListener('click', leaveRoom);
    } else {
      const rows = (party ? party.members : [{ id: 0, name: api.name }])
        .map((m) => {
          const n = counts.get(m.id) ?? 0;
          return `<div class="mash-bar ${m.id === me() ? 'me' : ''}"><span>${esc(m.name)}</span><i style="width:${(100 * n) / GOAL}%"></i><b>${n}</b></div>`;
        })
        .join('');
      const t = phase === 'count' ? Math.ceil((startedAt - performance.now()) / 1000) : (performance.now() - startedAt) / 1000;
      root.innerHTML = `
        <div class="mash">
          <h1>${phase === 'count' ? t : phase === 'done' ? esc(note) : t.toFixed(2)}</h1>
          ${rows}
          <button class="mash-hit" data-hit aria-label="Mash">MASH!</button>
        </div>`;
      root.querySelector('[data-hit]')!.addEventListener('pointerdown', hit);
    }
  };

  const connect = async (code: string | null) => {
    note = code ? `Joining ${code.toUpperCase()}…` : 'Opening a room…';
    draw();
    try {
      party = code ? await api.party.join(code) : await api.party.host();
    } catch (e) {
      note = (e as Error).message;
      return draw();
    }
    phase = 'room';
    note = '';
    offs.push(
      party.onMembers(() => phase === 'room' && draw()),
      party.onMessage((from, data) => {
        const m = data as Msg;
        if (m.type === 'go') start(true);
        else if (m.type === 'n') counts.set(from, m.n);
        else if (m.type === 'won' && phase === 'mash') finish(`${party!.members.find((x) => x.id === from)?.name ?? '?'} wins!`);
      }),
      party.onClose((why) => {
        party = null;
        phase = 'menu';
        note = why;
        draw();
      }),
    );
    draw();
  };

  const leaveRoom = () => {
    offs.forEach((f) => f());
    offs = [];
    party?.leave();
    party = null;
    phase = 'menu';
    draw();
  };

  const start = (online: boolean) => {
    counts = new Map();
    phase = 'count';
    startedAt = performance.now() + 3000;
    api.setMenuNav(false); // Ⓐ is the mash button now, not "press the focused button"
    if (online) party?.setOpen(false);
    tick();
  };

  const hit = () => {
    if (phase !== 'mash') return;
    const n = (counts.get(me()) ?? 0) + 1;
    counts.set(me(), n);
    party?.send({ type: 'n', n } satisfies Msg);
    api.rumble(0.2, 0.1, 40);
    if (n >= GOAL) {
      const time = (performance.now() - startedAt) / 1000;
      party?.send({ type: 'won', time } satisfies Msg);
      if (!party && (!best() || time < best())) localStorage.setItem(BEST_KEY, String(time));
      finish(party ? 'You win!' : `${time.toFixed(2)} s`);
    }
  };

  const finish = (text: string) => {
    phase = 'done';
    note = text;
    draw();
    setTimeout(() => {
      api.setMenuNav(true);
      if (party?.isHost) party.setOpen(true);
      phase = party ? 'room' : 'menu';
      note = text;
      draw();
    }, 2500);
  };

  const tick = () => {
    cancelAnimationFrame(raf);
    if (phase === 'count' && performance.now() >= startedAt) phase = 'mash';
    if (phase === 'count' || phase === 'mash') {
      draw();
      raf = requestAnimationFrame(tick);
    }
  };

  // Ⓐ on a controller, Space or Enter on the keyboard.
  const key = (e: KeyboardEvent) => {
    if ((e.code === 'Space' || e.code === 'Enter') && (phase === 'mash' || phase === 'count')) {
      e.preventDefault();
      if (!e.repeat) hit();
    }
  };
  let padRaf = 0;
  const padLoop = () => {
    padRaf = requestAnimationFrame(padLoop);
    if (phase === 'mash' && api.readPad()?.pressed[0]) hit();
  };
  addEventListener('keydown', key);
  padLoop();
  draw();

  return () => {
    cancelAnimationFrame(raf);
    cancelAnimationFrame(padRaf);
    removeEventListener('keydown', key);
    offs.forEach((f) => f());
    party?.leave();
  };
}
