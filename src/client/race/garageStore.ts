// Your garage on this side. Signed in: the server's copy (every action is a POST the server re-runs with
// the shared rules and its own dice). Guest: the same rules run here against localStorage.

import { type ActionResult, type Garage, type GarageAction, applyAction, award, cleanGarage, newGarage } from '../../shared/race/garage.ts';
import { account } from '../account.ts';

const KEY = 'atrous.garage';

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

let g: Garage = loadLocal();
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

  onChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Loads the account's garage, or falls back to this browser's. */
  async refresh() {
    if (account.user) {
      try {
        const r = (await (await fetch('/api/garage')).json()) as { garage: Garage | null };
        if (r.garage) {
          onServer = true;
          set(cleanGarage(r.garage));
          return;
        }
      } catch {
        /* offline: show the local one */
      }
    }
    onServer = false;
    set(loadLocal());
  },

  async act(action: GarageAction): Promise<ActionResult> {
    if (onServer) {
      try {
        const res = await fetch('/api/garage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) });
        const r = (await res.json()) as ActionResult;
        if (r.ok) set(cleanGarage(r.g));
        return r;
      } catch {
        return { ok: false, error: 'Could not reach the game server.' };
      }
    }
    const r = applyAction(g, action, Math.random, Date.now());
    if (r.ok) {
      saveLocal(r.g);
      set(r.g);
    }
    return r;
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

account.onChange(() => void garage.refresh());
