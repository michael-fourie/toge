// SNAP! on screen: the menu, the room, the rounds and the boards. The rules (rounds, judging, scoring) are in
// rules.ts. Online, the host is the referee: it picks the seed, starts each round, collects everyone's result
// and sends the round's scores; every player builds the same rounds from the seed and times themselves.
// Solo runs the same loop with nobody else in it, against your own bests.

import type { Party } from '../party.ts';
import type { GameApi } from '../types.ts';
import {
  ARROWS,
  CATEGORIES,
  COLOURS,
  DUCK_FLASH,
  DUCK_WAIT,
  INTRO,
  KINDS,
  ODD_PAIRS,
  ROUNDS,
  SHOW_CLOCK,
  SIMON_LIT,
  SIMON_STEP,
  SWEET_HALF,
  TITLES,
  cleanResult,
  describe,
  goAt,
  judge,
  judgeMash,
  judgeSimon,
  makeMatch,
  picks,
  pourLevel,
  sweetAt,
  scoreRound,
  standings,
  timeLimit,
  untimed,
  type Kind,
  type Round,
} from './rules.ts';
import './snap.css';

/** The round's board stays up this long before the next round (ms). */
const BOARD_MS = 4200;
/** After everyone has answered, a beat before the board (so the last answer's feedback is seen). */
const SETTLE_MS = 700;
/** The referee gives up on stragglers this long after the round's time limit (ms). */
const STRAGGLE_MS = 2500;
const BEST_KEY = 'snap.best';
/** Pad buttons in pick order (Ⓐ Ⓑ Ⓧ Ⓨ) and keys: ↓ → ← ↑ follow the pad's diamond, 1-4 too. */
const PICK_KEYS: Record<string, number> = { ArrowDown: 0, ArrowRight: 1, ArrowLeft: 2, ArrowUp: 3, Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 };
const GLYPH = ['Ⓐ', 'Ⓑ', 'Ⓧ', 'Ⓨ'];

type Msg =
  | { t: 'match'; seed: number }
  | { t: 'round'; i: number }
  | { t: 'res'; i: number; v: number | null }
  | { t: 'score'; i: number; res: [number, number | null][] }
  | { t: 'end' }
  | { t: 'room' };

/** Checks a message's shape before anything trusts it. */
function readMsg(d: unknown): Msg | null {
  if (!d || typeof d !== 'object') return null;
  const m = d as Record<string, unknown>;
  const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9;
  switch (m.t) {
    case 'match':
      return int(m.seed) ? { t: 'match', seed: m.seed as number } : null;
    case 'round':
      return int(m.i) ? { t: 'round', i: m.i as number } : null;
    case 'res':
      return int(m.i) ? { t: 'res', i: m.i as number, v: cleanResult(m.v) } : null;
    case 'score': {
      if (!int(m.i) || !Array.isArray(m.res) || m.res.length > 16) return null;
      const res: [number, number | null][] = [];
      for (const e of m.res) if (Array.isArray(e) && int(e[0])) res.push([e[0], cleanResult(e[1])]);
      return { t: 'score', i: m.i as number, res };
    }
    case 'end':
    case 'room':
      return { t: m.t as 'end' | 'room' };
  }
  return null;
}

function loadBests(): Partial<Record<Kind, number>> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export function mount(root: HTMLElement, api: GameApi): () => void {
  root.classList.add('snap-root');
  let party: Party | null = null;
  let offs: (() => void)[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers.clear();
  };

  let screen: 'menu' | 'room' | 'play' | 'board' | 'final' = 'menu';
  let note = '';
  // The match
  let rounds: Round[] = [];
  let index = -1;
  const totals = new Map<number, number>();
  const names = new Map<number, string>();
  /** Results of the current round (the referee's tally; everyone's copy once scored). */
  let results = new Map<number, number | null>();
  let lastPoints = new Map<number, number>();
  let refTimer: ReturnType<typeof setTimeout> | null = null;
  // The round being played, on this screen
  let stageStart = 0; // performance.now() when the title card ends
  let shown = -1; // when the go moment reached the screen (ms after stageStart)
  let answered = false;
  let mine: number | null = null;
  let feedback = '';
  let raf = 0;
  /** In solo, the result that just beat a personal best. */
  let newBest = false;
  /** Simon and Mash!: the presses so far this round. */
  let presses: { at: number; pick: number }[] = [];

  const me = () => party?.id ?? 0;
  const referee = () => !party || party.isHost;
  const roster = () => (party ? party.members.map((m) => m.id) : [0]);
  const send = (m: Msg, to?: number) => party?.send(m, to);

  // -------------------------------------------------------------------------------------------
  // Screens

  const render = () => {
    cancelAnimationFrame(raf);
    api.setMenuNav(screen !== 'play');
    if (screen === 'menu') renderMenu();
    else if (screen === 'room') renderRoom();
    else if (screen === 'play') renderStage();
    else if (screen === 'board') renderBoard();
    else renderFinal();
  };

  const renderMenu = () => {
    root.innerHTML = `
      <div class="snap snap-menu">
        <h1 class="snap-logo">SNAP<span>!</span></h1>
        <p class="snap-lede">Quick-reaction party rounds. Fastest finger wins.</p>
        <div class="snap-col">
          <button class="snap-btn hot" data-host data-autofocus>Host a room</button>
          <div class="snap-join">
            <input data-code maxlength="4" placeholder="CODE" aria-label="Room code" autocomplete="off" spellcheck="false" />
            <button class="snap-btn" data-join>Join</button>
          </div>
          <button class="snap-btn" data-solo>Practise solo</button>
        </div>
        <ul class="snap-rooms" data-list></ul>
        <p class="snap-note" data-note></p>
        <button class="snap-btn ghost" data-exit>◀ Menu</button>
      </div>`;
    root.querySelector('[data-note]')!.textContent = note;
    root.querySelector('[data-host]')!.addEventListener('click', () => void connect(null));
    const code = root.querySelector<HTMLInputElement>('[data-code]')!;
    code.addEventListener('keydown', (e) => e.key === 'Enter' && code.value.trim() && void connect(code.value));
    root.querySelector('[data-join]')!.addEventListener('click', () => code.value.trim() && void connect(code.value));
    root.querySelector('[data-solo]')!.addEventListener('click', startMatch);
    root.querySelector('[data-exit]')!.addEventListener('click', () => api.exit());
    void api.party.list().then(
      (rooms) => {
        const ul = root.querySelector('[data-list]');
        if (!ul || screen !== 'menu') return;
        for (const r of rooms) {
          const li = document.createElement('li');
          const b = document.createElement('button');
          b.className = 'snap-btn small';
          b.textContent = `Join ${r.host}'s room · ${r.players}/${r.max}`;
          b.addEventListener('click', () => void connect(r.code));
          li.append(b);
          ul.append(li);
        }
      },
      () => {},
    );
  };

  const renderRoom = () => {
    const p = party!;
    root.innerHTML = `
      <div class="snap snap-room">
        <p class="snap-kicker">Room code</p>
        <h1 class="snap-code" data-code></h1>
        <p class="snap-lede">Friends join from the SNAP! channel with this code (up to 12).</p>
        <ul class="snap-who" data-who></ul>
        ${p.isHost ? `<button class="snap-btn hot" data-go data-autofocus>Start · ${ROUNDS} rounds</button>` : '<p class="snap-wait">Waiting for the host to start…</p>'}
        <p class="snap-note" data-note></p>
        <button class="snap-btn ghost" data-leave>Leave room</button>
      </div>`;
    root.querySelector('[data-code]')!.textContent = p.code;
    root.querySelector('[data-note]')!.textContent = note;
    const who = root.querySelector('[data-who]')!;
    for (const m of p.members) {
      const li = document.createElement('li');
      li.textContent = m.name + (m.id === p.hostId ? ' ★' : '') + (m.id === p.id ? ' (you)' : '');
      if (m.id === p.id) li.className = 'me';
      who.append(li);
    }
    root.querySelector('[data-go]')?.addEventListener('click', startMatch);
    root.querySelector('[data-leave]')!.addEventListener('click', () => leaveRoom(''));
  };

  /** The play screen for round `index`: built once, then `frame` animates it. */
  const renderStage = () => {
    const round = rounds[index];
    const info = TITLES[round.kind];
    root.innerHTML = `
      <div class="snap snap-play" data-kind="${round.kind}">
        <header class="snap-hud"><span>Round ${index + 1}/${rounds.length}</span><span>${info.title}</span><span data-score></span></header>
        <div class="snap-stage" data-stage>
          <div class="snap-ducks" data-ducks></div>
          <div class="snap-bar" data-bar hidden><div class="snap-zone" data-zone></div><div class="snap-marker" data-marker></div></div>
          <div class="snap-glass" data-glass hidden><div class="snap-fill" data-fill></div><div class="snap-line" data-line></div></div>
          <div class="snap-big" data-big></div>
          <div class="snap-sub" data-sub></div>
        </div>
        <div class="snap-picks" data-picks hidden>
          ${COLOURS.map((c, i) => `<button class="snap-pick p${i}" data-pick="${i}" tabindex="-1" style="--c:${c.hex}"><b></b><i>${GLYPH[i]}</i></button>`).join('')}
        </div>
      </div>`;
    root.querySelector('[data-score]')!.textContent = party ? `${totals.get(me()) ?? 0} pts` : '';
    root.querySelector('[data-stage]')!.addEventListener('pointerdown', (e) => {
      if (!picks(round)) press(-1, (e as PointerEvent).timeStamp);
    });
    root.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) =>
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        press(Number(b.dataset.pick), e.timeStamp);
      }),
    );
    if (round.kind === 'ducks') {
      const box = root.querySelector('[data-ducks]')!;
      for (const d of round.ducks) {
        const el = document.createElement('span');
        el.textContent = '🦆';
        el.style.left = `${d.x * 100}%`;
        el.style.top = `${d.y * 100}%`;
        if (d.flip) el.classList.add('flip');
        box.append(el);
      }
    }
    if (round.kind === 'most') {
      const box = root.querySelector('[data-ducks]')!;
      for (const d of round.dots) {
        const el = document.createElement('span');
        el.className = 'dot';
        el.style.left = `${d.x * 100}%`;
        el.style.top = `${d.y * 100}%`;
        el.style.background = COLOURS[d.c].hex;
        box.append(el);
      }
    }
    if (round.kind === 'sweet') {
      root.querySelector<HTMLElement>('[data-bar]')!.hidden = false;
      const zone = root.querySelector<HTMLElement>('[data-zone]')!;
      zone.style.left = `${(round.zone - SWEET_HALF) * 100}%`;
      zone.style.width = `${SWEET_HALF * 200}%`;
    }
    if (round.kind === 'pour') {
      root.querySelector<HTMLElement>('[data-glass]')!.hidden = false;
      root.querySelector<HTMLElement>('[data-line]')!.style.bottom = `${round.line * 100}%`;
    }
    // The picks' faces, for the rounds where they aren't just colours.
    const faces = pickFaces(round);
    if (faces) root.querySelectorAll('[data-pick] b').forEach((b, i) => (b.textContent = faces[i]));
    raf = requestAnimationFrame(frame);
  };

  /** What's written on each pick button (null: the round fills them in later, or they're plain colours). */
  const pickFaces = (round: Round): string[] | null => {
    if (round.kind === 'ink' || round.kind === 'most') return COLOURS.map((c) => c.name);
    if (round.kind === 'big' || round.kind === 'which') return round.options.map(String);
    if (round.kind === 'ducks' || round.kind === 'maths') return round.options.map(String);
    if (round.kind === 'odd') return [0, 1, 2, 3].map((i) => ODD_PAIRS[round.pair][i === round.odd ? 1 : 0]);
    if (round.kind === 'arrow') return [...ARROWS];
    return null;
  };

  const renderBoard = () => {
    const round = rounds[index];
    const rows = [...results].sort((a, b) => (a[1] ?? 1e9) - (b[1] ?? 1e9));
    root.innerHTML = `
      <div class="snap snap-board">
        <p class="snap-kicker">Round ${index + 1}/${rounds.length} · ${TITLES[round.kind].title}</p>
        <h2 data-head></h2>
        <ol class="snap-rows" data-rows></ol>
        <p class="snap-note">${index + 1 < rounds.length ? 'Next round coming up…' : 'Final scores coming up…'}</p>
      </div>`;
    const top = rows[0];
    root.querySelector('[data-head]')!.textContent = !party ? (newBest ? 'NEW BEST!' : describe(round, mine)) : top && top[1] !== null ? `${names.get(top[0]) ?? '?'} takes it!` : 'Nobody got that one!';
    const ol = root.querySelector('[data-rows]')!;
    for (const [id, v] of rows) {
      const li = document.createElement('li');
      if (id === me()) li.className = 'me';
      const n = document.createElement('span');
      n.textContent = names.get(id) ?? '?';
      const r = document.createElement('span');
      r.textContent = describe(round, v);
      const p = document.createElement('b');
      p.textContent = party ? `+${lastPoints.get(id) ?? 0} · ${totals.get(id) ?? 0}` : best(round.kind) !== undefined ? `best ${describe(round, best(round.kind)!)}` : '';
      li.append(n, r, p);
      ol.append(li);
    }
  };

  const renderFinal = () => {
    const list = standings(totals, names);
    root.innerHTML = `
      <div class="snap snap-final">
        <p class="snap-kicker">${party ? 'Final scores' : 'Practice done'}</p>
        <h1 class="snap-logo small" data-head></h1>
        <ol class="snap-rows" data-rows></ol>
        <div class="snap-row">
          ${referee() ? '<button class="snap-btn hot" data-again data-autofocus>Play again</button>' : '<p class="snap-wait">Waiting for the host…</p>'}
          ${party?.isHost ? '<button class="snap-btn" data-room>Back to the room</button>' : ''}
          <button class="snap-btn ghost" data-leave>${party ? 'Leave room' : '◀ Back'}</button>
        </div>
      </div>`;
    const top = list[0];
    root.querySelector('[data-head]')!.textContent = !party ? 'Nice reflexes!' : list.length > 1 && list[1].points === top.points ? "It's a tie!" : `${top?.name ?? '?'} wins!`;
    const ol = root.querySelector('[data-rows]')!;
    if (party)
      list.forEach((e, i) => {
        const li = document.createElement('li');
        if (e.id === me()) li.className = 'me';
        const n = document.createElement('span');
        n.textContent = `${['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} ${e.name}`;
        const p = document.createElement('b');
        p.textContent = `${e.points} pts`;
        li.append(n, p);
        ol.append(li);
      });
    else
      for (const k of KINDS) {
        const li = document.createElement('li');
        const n = document.createElement('span');
        n.textContent = TITLES[k].title;
        const p = document.createElement('b');
        const b = best(k);
        p.textContent = b === undefined ? '—' : `best ${describe(rounds.find((r) => r.kind === k) ?? rounds[0], b)}`;
        li.append(n, p);
        ol.append(li);
      }
    root.querySelector('[data-again]')?.addEventListener('click', startMatch);
    root.querySelector('[data-room]')?.addEventListener('click', () => {
      send({ t: 'room' });
      toRoom('');
    });
    root.querySelector('[data-leave]')!.addEventListener('click', () => (party ? leaveRoom('') : toMenu('')));
  };

  // -------------------------------------------------------------------------------------------
  // The round on screen

  const set = (sel: string, text: string) => {
    const el = root.querySelector<HTMLElement>(sel);
    if (el && el.textContent !== text) el.textContent = text;
  };

  const frame = (now: number) => {
    if (screen !== 'play') return;
    raf = requestAnimationFrame(frame);
    const round = rounds[index];
    const t = now - stageStart;
    const stage = root.querySelector<HTMLElement>('[data-stage]')!;
    const big = root.querySelector<HTMLElement>('[data-big]')!;
    const pickBox = root.querySelector<HTMLElement>('[data-picks]')!;
    let mode = 'wait';
    if (!answered && t > timeLimit(round)) answer(null, round.kind === 'pour' ? 'Overflowed!' : 'Missed!');
    if (t < 0) {
      mode = 'intro';
      set('[data-big]', TITLES[round.kind].title);
      set('[data-sub]', TITLES[round.kind].how);
    } else if (answered) {
      mode = mine === null ? 'miss' : 'hit';
      set('[data-big]', feedback);
      set('[data-sub]', party ? 'Waiting for the others…' : '');
    } else if (round.kind === 'draw') {
      if (t >= round.delay) {
        mode = 'go';
        set('[data-big]', 'SNAP!');
        set('[data-sub]', '');
      } else {
        const decoy = round.decoys.find((d) => t >= d.at && t < d.at + 450);
        mode = decoy ? 'decoy' : 'wait';
        set('[data-big]', decoy ? decoy.word : '…');
        set('[data-sub]', decoy ? '' : 'wait for it');
      }
    } else if (round.kind === 'clock') {
      set('[data-big]', t < SHOW_CLOCK ? (t / 1000).toFixed(2) : '?.??');
      set('[data-sub]', `Stop at ${(round.target / 1000).toFixed(2)} s`);
      mode = t < SHOW_CLOCK ? 'clock' : 'blind';
    } else if (round.kind === 'ink') {
      if (t >= round.delay) {
        mode = 'ink';
        set('[data-big]', COLOURS[round.word].name);
        big.style.color = COLOURS[round.ink].hex;
        set('[data-sub]', 'Press the INK colour');
      } else {
        set('[data-big]', '…');
        set('[data-sub]', 'get ready');
      }
    } else if (round.kind === 'ducks') {
      if (t < DUCK_WAIT) set('[data-big]', 'Ready…');
      else if (t < DUCK_WAIT + DUCK_FLASH) {
        mode = 'ducks';
        set('[data-big]', '');
      } else {
        mode = 'count';
        set('[data-big]', 'How many?');
      }
      set('[data-sub]', '');
    } else if (round.kind === 'odd' || round.kind === 'maths' || round.kind === 'arrow') {
      if (t >= round.delay) {
        mode = round.kind === 'arrow' && round.flip ? 'flip' : 'go-pick';
        set('[data-big]', round.kind === 'odd' ? 'Which one?' : round.kind === 'maths' ? `${round.a} ${round.op} ${round.b}` : ARROWS[round.dir]);
        set('[data-sub]', round.kind === 'arrow' ? (round.flip ? 'OPPOSITE!' : 'that way!') : '');
      } else {
        set('[data-big]', '…');
        set('[data-sub]', 'get ready');
      }
    } else if (round.kind === 'pour') {
      mode = 'pour';
      const level = Math.min(1, pourLevel(round, t));
      root.querySelector<HTMLElement>('[data-fill]')!.style.height = `${level * 100}%`;
      set('[data-big]', '');
      set('[data-sub]', 'Stop at the line!');
    } else if (round.kind === 'simon') {
      const step = Math.floor(t / SIMON_STEP);
      const lit = t < goAt(round) && step < round.seq.length && t % SIMON_STEP < SIMON_LIT ? round.seq[step] : -1;
      root.querySelectorAll<HTMLElement>('[data-pick]').forEach((b, i) => b.classList.toggle('lit', i === lit));
      mode = t < goAt(round) ? 'watch' : 'go-pick';
      set('[data-big]', t < goAt(round) ? 'Watch…' : `${presses.length}/${round.seq.length}`);
      set('[data-sub]', t < goAt(round) ? '' : 'Your turn!');
    } else if (round.kind === 'mash') {
      mode = 'go';
      set('[data-big]', `${presses.length}/${round.need}`);
      set('[data-sub]', 'MASH!');
    } else if (round.kind === 'most') {
      if (t < DUCK_WAIT) set('[data-big]', 'Ready…');
      else if (t < DUCK_WAIT + DUCK_FLASH) {
        mode = 'ducks';
        set('[data-big]', '');
      } else {
        mode = 'count';
        set('[data-big]', 'Most?');
      }
      set('[data-sub]', '');
    } else if (round.kind === 'big' || round.kind === 'which') {
      if (t >= round.delay) {
        mode = 'go-pick';
        set('[data-big]', round.kind === 'big' ? 'Biggest?' : `Which is ${CATEGORIES[round.cat].name}?`);
        set('[data-sub]', '');
      } else {
        set('[data-big]', '…');
        set('[data-sub]', 'get ready');
      }
    } else if (round.kind === 'sweet') {
      mode = 'sweet';
      root.querySelector<HTMLElement>('[data-marker]')!.style.left = `${sweetAt(round, t) * 100}%`;
      set('[data-big]', '');
      set('[data-sub]', 'Stop it in the green!');
    }
    if (mode !== 'ink') big.style.color = '';
    stage.dataset.mode = mode;
    // The go moment reached the screen on this frame: reactions are timed from here.
    if (shown < 0 && t >= goAt(round) && t >= 0 && !untimed(round)) shown = t;
    // Simon shows its buttons while the colours flash (pressing them only counts after).
    const open = picks(round) && !answered && t >= (round.kind === 'simon' ? 0 : goAt(round));
    if (pickBox.hidden === open) pickBox.hidden = !open;
  };

  /** A press (pick -1) or a pick (0-3), at `at` (performance.now() time base). */
  const press = (pick: number, at: number) => {
    if (screen !== 'play' || answered) return;
    const round = rounds[index];
    const t = at - stageStart;
    if (t < 0) return; // the title card
    if (picks(round)) {
      if (pick < 0 || t < goAt(round)) return; // picks aren't open yet: no penalty
    }
    if (round.kind === 'simon') {
      presses.push({ at: t, pick });
      const v = judgeSimon(round, presses, shown < 0 ? goAt(round) : shown);
      if (v !== 'more') answer(v, v !== null ? describe(round, v) : 'Wrong colour!');
      return;
    }
    if (round.kind === 'mash') {
      presses.push({ at: t, pick });
      const v = judgeMash(round, presses.map((p) => p.at));
      if (v !== 'more') answer(v, v !== null ? describe(round, v) : 'Too slow!');
      return;
    }
    const v = judge(round, t, pick, shown < 0 ? goAt(round) : shown);
    answer(v, v !== null ? describe(round, v) : round.kind === 'draw' ? 'Too soon!' : round.kind === 'pour' ? 'Spilled!' : round.kind === 'sweet' ? 'Outside the zone!' : 'Wrong!');
  };

  const answer = (v: number | null, text: string) => {
    answered = true;
    mine = v;
    feedback = text;
    if (v !== null) api.rumble(0.25, 0.15, 60);
    if (!party) {
      // Solo: keep your bests.
      const k = rounds[index].kind;
      const b = best(k);
      newBest = v !== null && (b === undefined || v < b);
      if (newBest) {
        const all = loadBests();
        all[k] = v!;
        try {
          localStorage.setItem(BEST_KEY, JSON.stringify(all));
        } catch {
          /* private mode: no bests, still fine */
        }
      }
    }
    if (referee()) gotResult(me(), index, v);
    else send({ t: 'res', i: index, v });
  };

  const best = (k: Kind) => loadBests()[k];

  // -------------------------------------------------------------------------------------------
  // The match (the referee drives it; everyone follows)

  const begin = (seed: number) => {
    clearTimers();
    rounds = makeMatch(seed);
    index = -1;
    totals.clear();
    names.clear();
    const who = party ? party.members : [{ id: 0, name: api.name }];
    for (const m of who) {
      names.set(m.id, m.name);
      totals.set(m.id, 0);
    }
  };

  const startMatch = () => {
    const seed = Math.floor(Math.random() * 1e9);
    if (party) {
      party.setOpen(false);
      send({ t: 'match', seed });
    }
    begin(seed);
    refRound(0);
  };

  /** Referee: start round i for everyone, and give up on stragglers after its time limit. */
  const refRound = (i: number) => {
    results = new Map();
    send({ t: 'round', i });
    playRound(i);
    if (refTimer) clearTimeout(refTimer);
    refTimer = later(INTRO + timeLimit(rounds[i]) + STRAGGLE_MS, () => closeRound(i));
  };

  const playRound = (i: number) => {
    if (i < 0 || i >= rounds.length) return;
    clearTimers();
    index = i;
    answered = false;
    mine = null;
    shown = -1;
    feedback = '';
    newBest = false;
    presses = [];
    stageStart = performance.now() + INTRO;
    screen = 'play';
    render();
  };

  /** Referee: a result came in (ours, or a player's). Close the round once everyone here has answered. */
  const gotResult = (id: number, i: number, v: number | null) => {
    if (i !== index || screen !== 'play' || results.has(id)) return;
    if (party && !party.members.some((m) => m.id === id)) return;
    results.set(id, v);
    checkAllIn();
  };

  const checkAllIn = () => {
    if (referee() && screen === 'play' && roster().every((id) => results.has(id))) later(SETTLE_MS, () => closeRound(index));
  };

  const closeRound = (i: number) => {
    if (i !== index || screen !== 'play') return;
    if (refTimer) clearTimeout(refTimer);
    refTimer = null;
    for (const id of roster()) if (!results.has(id)) results.set(id, null);
    send({ t: 'score', i, res: [...results] });
    showScore(i, results);
    later(BOARD_MS, () => {
      if (i + 1 < rounds.length) refRound(i + 1);
      else {
        send({ t: 'end' });
        finish();
      }
    });
  };

  const showScore = (i: number, res: Map<number, number | null>) => {
    if (i !== index) return;
    clearTimers();
    results = res;
    lastPoints = scoreRound(res);
    for (const [id, p] of lastPoints) totals.set(id, (totals.get(id) ?? 0) + p);
    // Our own result is what we measured, whatever arrived.
    if (!res.has(me())) res.set(me(), mine);
    screen = 'board';
    render();
  };

  const finish = () => {
    clearTimers();
    if (party?.isHost) party.setOpen(true);
    screen = 'final';
    render();
  };

  // -------------------------------------------------------------------------------------------
  // Rooms

  const connect = async (code: string | null) => {
    note = code ? `Joining ${code.trim().toUpperCase()}…` : 'Opening a room…';
    render();
    let p: Party;
    try {
      p = code ? await api.party.join(code.trim()) : await api.party.host();
    } catch (e) {
      note = (e as Error).message || 'Could not connect';
      return render();
    }
    if (screen !== 'menu') return p.leave(); // left while connecting
    party = p;
    let host = p.hostId;
    offs.push(
      p.onMembers(() => {
        // The referee left mid-match: nobody else knows the tally, so start over in the room.
        if (p.hostId !== host && (screen === 'play' || screen === 'board')) {
          host = p.hostId;
          return toRoom('The host left, so that match is over.');
        }
        host = p.hostId;
        if (screen === 'room' || screen === 'final') render();
        else if (screen === 'play') checkAllIn(); // someone left: don't wait for them
      }),
      p.onMessage((from, data) => {
        const m = readMsg(data);
        if (!m) return;
        if (m.t === 'res') return p.isHost && gotResult(from, m.i, m.v);
        if (from !== p.hostId) return; // only the referee runs the match
        if (m.t === 'match') begin(m.seed);
        else if (m.t === 'round' && rounds.length) playRound(m.i);
        else if (m.t === 'score' && rounds.length) showScore(m.i, new Map(m.res));
        else if (m.t === 'end' && rounds.length) finish();
        else if (m.t === 'room') toRoom('');
      }),
      p.onClose((why) => leaveRoom(why || 'Disconnected')),
    );
    toRoom('');
  };

  const toRoom = (why: string) => {
    clearTimers();
    rounds = [];
    note = why;
    screen = party ? 'room' : 'menu';
    render();
  };

  const toMenu = (why: string) => {
    clearTimers();
    rounds = [];
    note = why;
    screen = 'menu';
    render();
  };

  const leaveRoom = (why: string) => {
    offs.forEach((f) => f());
    offs = [];
    party?.leave();
    party = null;
    toMenu(why);
  };

  // -------------------------------------------------------------------------------------------
  // Input: keyboard, controller (polled while playing), pointer (on the stage and the pick buttons)

  const onKey = (e: KeyboardEvent) => {
    if (screen !== 'play' || e.repeat) return;
    const round = rounds[index];
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      press(-1, e.timeStamp);
    } else if (e.code in PICK_KEYS) {
      e.preventDefault();
      press(picks(round) ? PICK_KEYS[e.code] : -1, e.timeStamp);
    }
  };
  let padRaf = 0;
  const padLoop = () => {
    padRaf = requestAnimationFrame(padLoop);
    if (screen !== 'play') return; // the menus' own pad navigation reads the pad then
    const pad = api.readPad();
    if (!pad) return;
    const now = performance.now();
    const round = rounds[index];
    if (pad.pressed[8] || pad.pressed[9]) return party ? leaveRoom('') : toMenu(''); // View / Menu: quit the match
    for (let b = 0; b < 4; b++) if (pad.pressed[b]) return press(picks(round) ? b : -1, now);
    if (pad.pressed[6] || pad.pressed[7]) press(-1, now);
  };
  addEventListener('keydown', onKey);
  padLoop();
  render();

  return () => {
    cancelAnimationFrame(raf);
    cancelAnimationFrame(padRaf);
    clearTimers();
    removeEventListener('keydown', onKey);
    offs.forEach((f) => f());
    party?.leave();
    root.classList.remove('snap-root');
  };
}
