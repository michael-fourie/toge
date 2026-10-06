// Player settings, saved per browser. Only things the game actually honours live here.

interface Settings {
  /** Multiplier on the default mouse sensitivity. */
  sensitivity: number;
  /** Hold Space to bhop (CS sv_autobunnyhopping). Off = time each jump yourself. */
  autoHop: boolean;
}

const KEY = 'atrous.settings';
const DEFAULTS: Settings = { sensitivity: 1, autoHop: true };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: settings just won't persist */
  }
}
