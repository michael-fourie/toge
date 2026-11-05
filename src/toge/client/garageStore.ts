// Your garage on this side. Signed in: the server's copy (every action is a POST the server re-runs with
// the shared rules and its own dice). Guest: the same rules run here against localStorage.

import { type ActionResult, type Garage, type GarageAction, applyAction, award, cleanGarage, current, newGarage } from '../shared/garage.ts';
import { encodeCar } from '../shared/cars.ts';
import { type Bests, type NewBest, cleanBests, recordTime } from '../shared/records.ts';
import { account } from '../../client/account.ts';

const KEY = 'atrous.garage';
/** A guest's best times. */
const BESTS_KEY = 'atrous.bests';

function loadLocal(): Garage {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? cleanGarage(JSON.parse(raw)) : newGarage();
  } catch {
    return newGarage();
  }
}

function saveLocal(g: Garage) {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* private mode: the garage lasts this session */
  }
}

function loadBests(): Bests {
  try {
    return cleanBests(JSON.parse(localStorage.getItem(BESTS_KEY) ?? '{}'));
  } catch {
    return {};
  }
}

let g: Garage = loadLocal();
/** Best times: the account's (from the server) or this browser's. */
let bests: Bests = loadBests();
/** The garage shown belongs to the signed-in account (it lives on the server). */
let onServer = false;
const listeners = new Set<() => void>();
const set = (next: Garage) => {
  g = next;
  listeners.forEach((l) => l());
};

export const garage = {
  get g() {
    return g;
  },
  get onServer() {
    return onServer;
  },
  get bests() {
    return bests;
  },

  onChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Loads the account's garage, or falls back to this browser's. */
  async refresh() {
    if (account.user) {
      try {
        const r = (await (await fetch('/api/garage')).json()) as { garage: Garage | null; bests?: unknown };
        if (r.garage) {
          const local = loadLocal();
          onServer = true;
          bests = cleanBests(r.bests);
          set(cleanGarage(r.garage));
          // A guest who made their own driver and then signs in keeps it, unless the account already has one.
          if (!g.look && local.look) void garage.act({ a: 'rider', rider: local.rider, look: local.look });
          return;
        }
      } catch {
        /* offline: show the local one */
      }
    }
    onServer = false;
    bests = loadBests();
    set(loadLocal());
  },

  /** One garage action. A solo finish (`time` on a `solo` action) also comes back with `best` if it set one. */
  async act(action: GarageAction): Promise<ActionResult> {
    const car = encodeCar(current(g));
    if (onServer) {
      try {
        const res = await fetch('/api/garage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) });
        const r = (await res.json()) as ActionResult;
        if (r.best) noteBest(r.best, car);
        if (r.ok) set(cleanGarage(r.g));
        return r;
      } catch {
        return { ok: false, error: 'Could not reach the game server.' };
      }
    }
    const best = action.a === 'solo' && action.place >= 1 ? garage.noteTime(action.track, action.time, car) : undefined;
    const r = applyAction(g, action, Math.random, Date.now());
    if (r.ok) {
      saveLocal(r.g);
      set(r.g);
    }
    return best === undefined ? r : { ...r, best };
  },

  /**
   * A guest's finish (solo or online): kept in this browser if it's a best. The server keeps accounts' own and tells
   * the race (`records`), which comes back here through `noteBest`.
   */
  noteTime(track: unknown, time: unknown, car: string): NewBest | null {
    const r = recordTime(bests, track, time, car, Date.now());
    if (!r) return null;
    bests = r.bests;
    if (!onServer) {
      try {
        localStorage.setItem(BESTS_KEY, JSON.stringify(bests));
      } catch {
        /* private mode */
      }
    }
    return r.best;
  },

  /** The server kept a new best for this account: update the copy shown here. */
  noteBest(b: NewBest, car: string) {
    noteBest(b, car);
  },

  /** Prize money from an online race. The server pays accounts itself; guests are paid here. */
  credit(amount: number, won: boolean) {
    if (onServer) {
      void garage.refresh();
      return;
    }
    const next = award(g, amount, won);
    saveLocal(next);
    set(next);
  },
};

function noteBest(b: NewBest, car: string) {
  if (onServer) bests = recordTime(bests, b.track, b.time, car, Date.now())?.bests ?? bests;
}

account.onChange(() => void garage.refresh());
