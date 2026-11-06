import { PASSWORD_MIN, checkCredentials } from '../shared/account.ts';

/** Who's signed in on this browser (the session cookie is HttpOnly, so we ask the server). */
let user: string | null = null;
const listeners = new Set<() => void>();

function set(next: string | null) {
  user = next;
  listeners.forEach((l) => l());
}

async function post(path: string, body: object): Promise<{ ok: boolean; user?: string; error?: string }> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await res.json();
  } catch {
    return { ok: false, error: 'Could not reach the game server.' };
  }
}

export const account = {
  /** Display name of the signed-in account, or null for a guest. */
  get user() {
    return user;
  },

  onChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  async refresh() {
    try {
      const r = (await (await fetch('/api/me')).json()) as { user: string | null };
      set(r.user ?? null);
    } catch {
      /* offline: stay a guest */
    }
  },

  /** Creates the account or signs in. Resolves an error message to show, or null on success. */
  async submit(mode: 'login' | 'register', username: string, password: string): Promise<string | null> {
    if (mode === 'register') {
      const bad = checkCredentials(username, password);
      if (bad) return bad;
    } else if (!username || !password) return 'Enter your username and password.';
    const r = await post(`/api/${mode}`, { username, password });
    if (r.ok && r.user) {
      set(r.user);
      return null;
    }
    return r.error ?? 'Something went wrong.';
  },

  /** Changes the signed-in account's password. Resolves an error message to show, or null on success. */
  async changePassword(current: string, next: string): Promise<string | null> {
    if (!current) return 'Enter your current password.';
    if (next.length < PASSWORD_MIN) return `Passwords need at least ${PASSWORD_MIN} characters.`;
    const r = await post('/api/password', { current, password: next });
    return r.ok ? null : (r.error ?? 'Something went wrong.');
  },

  async signOut() {
    await post('/api/logout', {});
    set(null);
  },
};
