import { FRIENDS_MAX, type FriendAction, type FriendList, type FriendResult, friendName } from '../shared/friends.ts';
import type { KV } from './accountStore.ts';

/**
 * Friend lists, next to the accounts: `f:<user>` is who a user added, `fi:<user>` who added them (both lower-cased
 * usernames). Adding is one way, like following; the list shows who added you back.
 */
export class FriendStore {
  constructor(private kv: KV) {}

  private async ids(key: string): Promise<string[]> {
    const v = await this.kv.get<unknown>(key);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }

  /** An account's display name (as typed at sign-up), or null if there's no such account. */
  private async display(lower: string): Promise<string | null> {
    const u = await this.kv.get<{ name?: unknown }>(`u:${lower}`);
    return u && typeof u.name === 'string' ? u.name : null;
  }

  private async names(ids: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const id of ids) {
      const n = await this.display(id);
      if (n) out.push(n);
    }
    return out.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  }

  async list(user: string): Promise<FriendList> {
    const me = user.toLowerCase();
    const out = await this.ids(`f:${me}`);
    const inc = new Set(await this.ids(`fi:${me}`));
    return {
      friends: await this.names(out),
      mutual: await this.names(out.filter((id) => inc.has(id))),
      fans: await this.names([...inc].filter((id) => !out.includes(id))),
    };
  }

  /** `user` has added `other` (either name, any case). */
  async has(user: string, other: string): Promise<boolean> {
    return (await this.ids(`f:${user.toLowerCase()}`)).includes(other.toLowerCase());
  }

  async act(user: string, act: FriendAction): Promise<FriendResult> {
    if (!act || typeof act !== 'object' || (act.a !== 'add' && act.a !== 'remove')) return { ok: false, error: 'Bad request.' };
    const name = friendName(act.name);
    if (!name) return { ok: false, error: 'Usernames are 3-16 letters, numbers, _ or -.' };
    const me = user.toLowerCase();
    const them = name.toLowerCase();
    const out = await this.ids(`f:${me}`);
    if (act.a === 'add') {
      if (them === me) return { ok: false, error: "That's you." };
      if (!(await this.display(them))) return { ok: false, error: `No driver called ${name}.` };
      if (!out.includes(them)) {
        if (out.length >= FRIENDS_MAX) return { ok: false, error: `You can have up to ${FRIENDS_MAX} friends.` };
        await this.kv.put(`f:${me}`, [...out, them]);
        const inc = await this.ids(`fi:${them}`);
        if (!inc.includes(me)) await this.kv.put(`fi:${them}`, [...inc, me]);
      }
    } else if (out.includes(them)) {
      await this.kv.put(`f:${me}`, out.filter((id) => id !== them));
      await this.kv.put(`fi:${them}`, (await this.ids(`fi:${them}`)).filter((id) => id !== me));
    }
    return { ok: true, list: await this.list(user) };
  }
}
