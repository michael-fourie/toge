// Player settings, saved per browser. Only things the game actually honours live here.

/** Rebindable actions. Weapon slots (1/2/3), Esc, Tab-free extras like ` stay fixed. */
export const ACTIONS = ['forward', 'back', 'left', 'right', 'jump', 'slide', 'grapple', 'grenade', 'reload', 'use', 'scores'] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_NAME: Record<Action, string> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Strafe left',
  right: 'Strafe right',
  jump: 'Jump / bhop',
  slide: 'Slide',
  grapple: 'Grapple',
  grenade: 'Grenade',
  reload: 'Reload',
  use: 'Use (Survival)',
  scores: 'Scoreboard',
};

export const DEFAULT_KEYS: Record<Action, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  slide: 'ShiftLeft',
  grapple: 'KeyE',
  grenade: 'KeyQ',
  reload: 'KeyR',
  use: 'KeyF',
  scores: 'Tab',
};

interface Settings {
  /** Multiplier on the default mouse sensitivity. */
  sensitivity: number;
  /** Hold Space to bhop (CS sv_autobunnyhopping). Off = time each jump yourself. */
  autoHop: boolean;
  /** KeyboardEvent.code for each action. */
  keys: Record<Action, string>;
}

const KEY = 'atrous.settings';
const DEFAULTS: Settings = { sensitivity: 1, autoHop: true, keys: DEFAULT_KEYS };

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const keys = { ...DEFAULT_KEYS };
    for (const a of ACTIONS) if (typeof raw.keys?.[a] === 'string') keys[a] = raw.keys[a];
    return { ...DEFAULTS, ...raw, keys };
  } catch {
    return { ...DEFAULTS, keys: { ...DEFAULT_KEYS } };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: settings just won't persist */
  }
}

/** A readable name for a KeyboardEvent.code ("KeyW" → "W", "ShiftLeft" → "Left Shift"). */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5) + ' arrow';
  if (code === 'Mouse3') return 'Mouse 4';
  return code.replace(/(Left|Right)$/, ' $1').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^Control/, 'Ctrl');
}
