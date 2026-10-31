// The heads-up layer over the night: crosshair and the use prompt, your role and chores, the clock and the chore
// bar, toasts, the big cards (cold open, eviction, case closed) and the pause menu. DOM only; anything that came
// from another player goes in with textContent.

export interface Prefs {
  sens: number;
  fov: number;
  bob: boolean;
  volume: number;
}

const PREFS_KEY = 'royal-degeneracy.prefs';
const DEFAULT_PREFS: Prefs = { sens: 1, fov: 85, bob: true, volume: 0.8 };

export function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const clock = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export interface PauseHandlers {
  resume(): void;
  leave(): void;
  prefs(p: Prefs): void;
}

export class Hud {
  readonly root = el('div', 'rd-hud');
  private cross = el('div', 'rd-cross');
  private prompt = el('div', 'rd-prompt');
  private role = el('div', 'rd-role');
  private tasks = el('ul', 'rd-tasks');
  private top = el('div', 'rd-topbar');
  private time = el('b', 'rd-time');
  private bar = el('i', 'rd-bar');
  private caseName = el('span', 'rd-case');
  private hint = el('div', 'rd-hint');
  private toasts = el('div', 'rd-toasts');
  private cardBox = el('div', 'rd-cardbox');
  private pauseBox = el('div', 'rd-pause');
  private kill = el('div', 'rd-kill');

  constructor(parent: HTMLElement) {
    const left = el('div', 'rd-left');
    left.append(this.role, this.tasks);
    const barWrap = el('div', 'rd-barwrap');
    barWrap.append(this.bar);
    const barLabel = el('small', '', 'House inspection');
    this.top.append(this.caseName, this.time, barLabel, barWrap);
    this.root.append(this.cross, this.prompt, left, this.top, this.hint, this.kill, this.toasts, this.cardBox, this.pauseBox);
    parent.append(this.root);
  }

  setPrompt(text: string) {
    this.prompt.textContent = text;
    this.prompt.style.display = text ? '' : 'none';
  }

  setRole(text: string, evil: boolean, ghost: boolean) {
    this.role.textContent = text;
    this.role.classList.toggle('evil', evil);
    this.root.classList.toggle('ghost', ghost);
  }

  setTasks(items: { name: string; done: boolean }[], fake: boolean) {
    this.tasks.replaceChildren();
    if (fake) this.tasks.append(el('li', 'fake', 'Fake chores: look busy'));
    for (const t of items) this.tasks.append(el('li', t.done ? 'done' : '', `${t.done ? '✓' : '○'} ${t.name}`));
  }

  setClock(left: number, label: string, progress: number, caseTitle: string) {
    this.time.textContent = label ? `${label} ${clock(left)}` : clock(left);
    this.bar.style.width = `${Math.round(progress * 100)}%`;
    this.caseName.textContent = caseTitle;
  }

  setHint(text: string) {
    this.hint.textContent = text;
  }

  /** The Degenerate's takeout readiness (empty hides it). */
  setKill(text: string, ready: boolean) {
    this.kill.textContent = text;
    this.kill.classList.toggle('ready', ready);
    this.kill.style.display = text ? '' : 'none';
  }

  showCross(on: boolean) {
    this.cross.style.display = on ? '' : 'none';
  }

  toast(text: string, ms = 2600) {
    const t = el('div', 'rd-toast', text);
    this.toasts.append(t);
    setTimeout(() => t.remove(), ms);
  }

  /** A big centred card; `build` fills it. Null hides it. */
  card(build: ((box: HTMLElement) => void) | null, cls = '') {
    this.cardBox.replaceChildren();
    this.cardBox.className = `rd-cardbox ${cls}`;
    if (!build) return;
    const c = el('div', 'rd-bigcard');
    build(c);
    this.cardBox.append(c);
  }

  pause(open: boolean, prefs: Prefs, h: PauseHandlers) {
    this.pauseBox.replaceChildren();
    this.pauseBox.style.display = open ? '' : 'none';
    if (!open) return;
    const box = el('div', 'rd-pausecard');
    box.dataset.navScope = '';
    box.append(el('h2', '', 'Paused'), el('p', 'rd-dim', 'The night goes on without you. Click Resume to look around again.'));
    const resume = el('button', 'rd-btn hot', 'Resume');
    resume.dataset.autofocus = '';
    resume.addEventListener('click', () => h.resume());
    box.append(resume);
    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) => {
      const row = el('label', 'rd-slider');
      const name = el('span', '', label);
      const val = el('b', '', fmt(get()));
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(get());
      input.addEventListener('input', () => {
        set(Number(input.value));
        val.textContent = fmt(get());
        savePrefs(prefs);
        h.prefs(prefs);
      });
      row.append(name, input, val);
      box.append(row);
    };
    slider('Mouse sensitivity', 0.2, 3, 0.05, () => prefs.sens, (v) => (prefs.sens = v), (v) => v.toFixed(2));
    slider('Field of view', 60, 110, 1, () => prefs.fov, (v) => (prefs.fov = v), (v) => `${v}°`);
    slider('Volume', 0, 1, 0.05, () => prefs.volume, (v) => (prefs.volume = v), (v) => `${Math.round(v * 100)}%`);
    const bob = el('button', 'rd-btn small', `Head bob: ${prefs.bob ? 'on' : 'off'}`);
    bob.addEventListener('click', () => {
      prefs.bob = !prefs.bob;
      bob.textContent = `Head bob: ${prefs.bob ? 'on' : 'off'}`;
      savePrefs(prefs);
      h.prefs(prefs);
    });
    const leave = el('button', 'rd-btn ghost', 'Leave the house');
    leave.addEventListener('click', () => h.leave());
    box.append(bob, leave, el('p', 'rd-keys', KEYS));
    this.pauseBox.append(box);
    resume.focus();
  }

  dispose() {
    this.root.remove();
  }
}

export const KEYS =
  'WASD move · Mouse look · Space jump · C crouch (silent) · E use / report / chores · T torch · V shove · Click take out (Degenerates) · Esc pause';

/** A portrait chip: image + name (for cards and the vote grid). */
export function chip(img: string, name: string, sub = ''): HTMLElement {
  const c = el('div', 'rd-chip');
  const i = document.createElement('img');
  i.src = img;
  i.alt = '';
  c.append(i, el('b', '', name));
  if (sub) c.append(el('small', '', sub));
  return c;
}

