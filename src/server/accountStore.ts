import { checkCredentials, cleanName } from '../shared/account.ts';

/** The slice of Durable Object storage the accounts need (so tests can use a Map). */
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
}

interface User {
  name: string; // as typed at sign-up (usernames are unique case-insensitively)
  salt: string;
  hash: string;
  created: number;
  /** When the password last changed: sessions opened before then are signed out. */
  pwAt?: number;
}

interface Session {
  user: string; // lower-cased username
  expires: number;
}

export type Result = { ok: true; name: string; token: string } | { ok: false; error: string };
export type ResetResult = { ok: true; name: string; password: string } | { ok: false; error: string };

/** workerd caps PBKDF2 at 100k iterations. */
export const PBKDF2_ITERATIONS = 100_000;
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 30_000;

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b as ArrayBuffer)].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));
const randomHex = (bytes: number) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

/** Temporary passwords from an admin reset: easy to read out to a friend (no 0/O, 1/l/I). */
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const TEMP_LENGTH = 12;
const tempPassword = () => [...crypto.getRandomValues(new Uint8Array(TEMP_LENGTH))].map((b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]).join('');

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Compares without bailing out at the first difference. */
function same(a: string, b: string): boolean {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

/**
 * Accounts for a group of friends: a username, a password (PBKDF2-SHA256, per-user salt) and session
 * tokens (random, only their hash is stored). Kept free of Cloudflare imports so it's unit-testable.
 */
export class AccountStore {
  private failures = new Map<string, { count: number; until: number }>();

  constructor(
    private kv: KV,
    private iterations = PBKDF2_ITERATIONS,
    private now: () => number = Date.now,
  ) {}

  private async derive(password: string, salt: string): Promise<string> {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(salt), iterations: this.iterations }, key, 256));
  }

  private async open(user: string): Promise<{ name: string; token: string }> {
    const token = randomHex(32);
    await this.kv.put(`s:${await sha256(token)}`, { user: user.toLowerCase(), expires: this.now() + SESSION_MS } satisfies Session);
    return { name: (await this.kv.get<User>(`u:${user.toLowerCase()}`))!.name, token };
  }

  async register(username: string, password: string): Promise<Result> {
    const bad = checkCredentials(username, password);
    if (bad) return { ok: false, error: bad };
    const salt = randomHex(16);
    const hash = await this.derive(password, salt); // before the existence check: nothing awaits between that check and the write
    const key = `u:${username.toLowerCase()}`;
    if (await this.kv.get(key)) return { ok: false, error: 'That username is taken.' };
    await this.kv.put(key, { name: username, salt, hash, created: this.now() } satisfies User);
    return { ok: true, ...(await this.open(username)) };
  }

  /** Checks a password, with the per-username lockout. The user on success, or the error to show. */
  private async check(username: unknown, password: unknown): Promise<User | string> {
    const lower = String(username).toLowerCase();
    const lock = this.failures.get(lower);
    if (lock && lock.until > this.now()) return 'Too many tries. Wait a few seconds and try again.';
    const user = typeof username === 'string' && typeof password === 'string' ? await this.kv.get<User>(`u:${lower}`) : undefined;
    // Hash even for unknown names so timing doesn't reveal which usernames exist.
    const hash = await this.derive(String(password).slice(0, 72), user?.salt ?? '00'.repeat(16));
    if (!user || !same(hash, user.hash)) {
      const count = (lock?.count ?? 0) + 1;
      if (this.failures.size > 10_000) for (const [k, f] of this.failures) if (f.until <= this.now()) this.failures.delete(k); // random names can't grow it forever
      this.failures.set(lower, { count, until: count >= MAX_FAILS ? this.now() + LOCK_MS : 0 });
      return 'Wrong username or password.';
    }
    this.failures.delete(lower);
    return user;
  }

  /** Stores a new password and signs out every session opened before now. */
  private async setPassword(user: User, password: string): Promise<void> {
    const salt = randomHex(16);
    await this.kv.put(`u:${user.name.toLowerCase()}`, { ...user, salt, hash: await this.derive(password, salt), pwAt: this.now() } satisfies User);
  }

  async login(username: string, password: string): Promise<Result> {
    const user = await this.check(username, password);
    if (typeof user === 'string') return { ok: false, error: user };
    return { ok: true, ...(await this.open(user.name)) };
  }

  /** The signed-in user (lower-cased) for a session token, or null. */
  private async session(token: string | undefined): Promise<string | null> {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    const key = `s:${await sha256(token)}`;
    const s = await this.kv.get<Session>(key);
    if (!s) return null;
    const user = await this.kv.get<User>(`u:${s.user}`);
    // Expired, the account is gone, or opened before the password last changed.
    if (s.expires < this.now() || !user || s.expires - SESSION_MS < (user.pwAt ?? 0)) {
      await this.kv.delete(key);
      return null;
    }
    return s.user;
  }

  /** The signed-in display name for a session token, or null. */
  async me(token: string | undefined): Promise<string | null> {
    const lower = await this.session(token);
    return lower && ((await this.kv.get<User>(`u:${lower}`))?.name ?? null);
  }

  /**
   * Signed in, with the current password: sets a new one. Every other session is signed out; the result is a fresh
   * session for this browser.
   */
  async changePassword(token: string | undefined, current: unknown, next: unknown): Promise<Result> {
    const lower = await this.session(token);
    if (!lower) return { ok: false, error: 'Sign in first.' };
    const user = await this.check(lower, current);
    if (typeof user === 'string') return { ok: false, error: user === 'Wrong username or password.' ? 'Your current password is wrong.' : user };
    const bad = checkCredentials(user.name, String(next ?? ''));
    if (bad) return { ok: false, error: bad };
    await this.setPassword(user, String(next));
    return { ok: true, ...(await this.open(user.name)) };
  }

  /**
   * Admin only (the Worker checks the admin key): gives an account a random temporary password and signs it out
   * everywhere. For a friend who forgot theirs; they change it once they're in.
   */
  async resetPassword(username: unknown): Promise<ResetResult> {
    const user = typeof username === 'string' ? await this.kv.get<User>(`u:${username.toLowerCase()}`) : undefined;
    if (!user) return { ok: false, error: 'No account with that username.' };
    const password = tempPassword();
    await this.setPassword(user, password);
    this.failures.delete(user.name.toLowerCase());
    return { ok: true, name: user.name, password };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token && /^[0-9a-f]{64}$/.test(token)) await this.kv.delete(`s:${await sha256(token)}`);
  }

  /**
   * The name to play under. Signed in: your username. Guest: whatever you typed, unless it belongs to an
   * account, in which case it's marked "(guest)" so nobody can pass as a friend.
   */
  async identify(token: string | undefined, guestName: string): Promise<{ name: string; user: boolean }> {
    const user = await this.me(token);
    if (user) return { name: user, user: true };
    const typed = cleanName(guestName) || 'guest';
    if (await this.kv.get(`u:${typed.toLowerCase()}`)) return { name: `${typed.slice(0, 8)} (guest)`, user: false };
    return { name: typed, user: false };
  }
}
