// Gamepads (standard mapping: Xbox / PlayStation / Switch Pro in a browser). One poller serves two jobs:
// - menus: the D-pad or left stick moves focus to the nearest control in that direction, A presses it,
//   B goes back (it sends Escape, which every screen already treats as Back), LB/RB switch tabs;
// - driving: the race reads the raw sticks and triggers with `readPad()`.

export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, View: 8, Menu: 9, LS: 10, RS: 11, Up: 12, Down: 13, Left: 14, Right: 15 } as const;

export interface Pad {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  lt: number;
  rt: number;
  /** Held this frame. */
  down: boolean[];
  /** Went down since the last `readPad()` call. */
  pressed: boolean[];
}

const DEAD = 0.14;
const dead = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

let prev: boolean[] = [];

/** The first connected gamepad, or null. Edges (`pressed`) are relative to the previous call. */
export function readPad(): Pad | null {
  const gp = [...(navigator.getGamepads?.() ?? [])].find((g) => g && g.connected && g.buttons.length >= 16);
  if (!gp) return null;
  const down = gp.buttons.map((b) => b.pressed || b.value > 0.5);
  const pressed = down.map((d, i) => d && !prev[i]);
  prev = down;
  return {
    lx: dead(gp.axes[0] ?? 0),
    ly: dead(gp.axes[1] ?? 0),
    rx: dead(gp.axes[2] ?? 0),
    ry: dead(gp.axes[3] ?? 0),
    lt: gp.buttons[BTN.LT]?.value ?? 0,
    rt: gp.buttons[BTN.RT]?.value ?? 0,
    down,
    pressed,
  };
}

/** One stick axis of the first pad, without touching the button edges `readPad()` tracks. */
export function padAxis(i: number): number {
  const gp = [...(navigator.getGamepads?.() ?? [])].find((g) => g && g.connected);
  return gp ? dead(gp.axes[i] ?? 0) : 0;
}

/** A short rumble (both motors 0..1), where the browser supports it. */
export function rumble(strong: number, weak: number, ms: number) {
  const gp = [...(navigator.getGamepads?.() ?? [])].find((g) => g && g.connected) as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | undefined;
  void gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
}

// ---------------------------------------------------------------------------------------------
// Spatial navigation (pure, so it's tested)

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The control to move to from `from` in direction `dir`: the nearest one whose centre lies that way,
 * scoring sideways drift as worse than distance so a row or column is followed. -1 if there's none.
 */
export function pickNext(from: Box, cands: Box[], dir: Dir): number {
  const fx = from.x + from.w / 2;
  const fy = from.y + from.h / 2;
  let best = -1;
  let bestScore = Infinity;
  cands.forEach((c, i) => {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const dx = cx - fx;
    const dy = cy - fy;
    let along: number;
    let side: number;
    if (dir === 'left' || dir === 'right') {
      along = dir === 'right' ? dx : -dx;
      // Overlapping rows count as straight across.
      side = Math.max(0, Math.abs(dy) - (from.h + c.h) / 4);
    } else {
      along = dir === 'down' ? dy : -dy;
      side = Math.max(0, Math.abs(dx) - (from.w + c.w) / 4);
    }
    if (along <= 1) return;
    const score = along + side * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

// ---------------------------------------------------------------------------------------------
// Menu navigation

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

let navOn = true;
/** A running game turns menu navigation off (and back on in its pause menu). */
export function setMenuNav(on: boolean) {
  navOn = on;
}

function visible(el: HTMLElement): boolean {
  if (el.closest('[data-nav-skip], [inert]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

/** Controls in the innermost open scope (a modal marks itself `data-nav-scope`), else the whole page. */
function candidates(): HTMLElement[] {
  const scopes = [...document.querySelectorAll<HTMLElement>('[data-nav-scope]')].filter((s) => s.getBoundingClientRect().width > 0);
  const root = scopes.at(-1) ?? document.body;
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

function move(dir: Dir) {
  const els = candidates();
  if (!els.length) return;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || cur === document.body || !els.includes(cur)) {
    (els.find((e) => e.hasAttribute('data-autofocus')) ?? els[0]).focus();
    return;
  }
  // Sliders take left/right themselves.
  if (cur instanceof HTMLInputElement && cur.type === 'range' && (dir === 'left' || dir === 'right')) {
    if (dir === 'left') cur.stepDown();
    else cur.stepUp();
    cur.dispatchEvent(new Event('input', { bubbles: true }));
    cur.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const rect = (e: HTMLElement): Box => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const others = els.filter((e) => e !== cur);
  const i = pickNext(rect(cur), others.map(rect), dir);
  if (i < 0) return;
  others[i].focus();
  others[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  document.dispatchEvent(new CustomEvent('padmove'));
}

function press(button: number) {
  const cur = document.activeElement as HTMLElement | null;
  if (button === BTN.A) {
    if (cur && cur !== document.body) cur.click();
    else move('down');
  } else if (button === BTN.B) dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  else if (button === BTN.LB || button === BTN.RB) dispatchEvent(new CustomEvent('padtab', { detail: button === BTN.LB ? -1 : 1 }));
  else if (button === BTN.Menu) dispatchEvent(new CustomEvent('padstart'));
  else if (button === BTN.X || button === BTN.Y) dispatchEvent(new CustomEvent('padbutton', { detail: button }));
}

/** Starts the menu poller (once). Holding a direction repeats after a short pause, like a keyboard. */
export function startMenuNav() {
  let held: Dir | null = null;
  let nextAt = 0;
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    if (!navOn) return;
    const pad = readPad();
    if (!pad) return;
    let dir: Dir | null = null;
    if (pad.down[BTN.Up] || pad.ly < -0.5) dir = 'up';
    else if (pad.down[BTN.Down] || pad.ly > 0.5) dir = 'down';
    else if (pad.down[BTN.Left] || pad.lx < -0.5) dir = 'left';
    else if (pad.down[BTN.Right] || pad.lx > 0.5) dir = 'right';
    if (dir || pad.pressed.some(Boolean)) document.documentElement.classList.add('pad');
    if (dir && (dir !== held || now >= nextAt)) {
      nextAt = now + (dir === held ? 110 : 380);
      held = dir;
      move(dir);
    } else if (!dir) held = null;
    for (const b of [BTN.A, BTN.B, BTN.X, BTN.Y, BTN.LB, BTN.RB, BTN.Menu]) if (pad.pressed[b]) press(b);
  };
  requestAnimationFrame(loop);
  // The mouse takes over again: drop the big pad focus rings.
  addEventListener('mousemove', () => document.documentElement.classList.remove('pad'), { passive: true });
}
