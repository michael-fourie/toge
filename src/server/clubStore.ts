import { CLUBS_MAX, CLUB_MEMBERS_MAX, type ClubAction, type ClubResult, type ClubView, clubName } from '../shared/clubs.ts';
import { friendName } from '../shared/friends.ts';
import type { KV } from './accountStore.ts';
import type { FriendStore } from './friendStore.ts';

interface Club {
  name: string;
  /** Lower-cased usernames. */
  owner: string;
  members: string[];
}

/**
 * Clubs, next to the accounts: `cl:<lower name>` is the club, `cm:<user>` the lower-cased names of the clubs a user is
 * in. Club names are unique site-wide. An owner can only add accounts from their own friends list.
 */
export class ClubStore {
  constructor(
    private kv: KV,
    private friends: FriendStore,
  ) {}

  private async clubOf(id: string): Promise<Club | null> {
    const c = await this.kv.get<Club>(`cl:${id}`);
    return c && typeof c.name === 'string' && Array.isArray(c.members) ? c : null;
  }

  private async mine(user: string): Promise<string[]> {
    const v = await this.kv.get<unknown>(`cm:${user}`);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }

  private async join(user: string, id: string) {
    const m = await this.mine(user);
    if (!m.includes(id)) await this.kv.put(`cm:${user}`, [...m, id]);
  }

  private async leave(user: string, id: string) {
    await this.kv.put(`cm:${user}`, (await this.mine(user)).filter((x) => x !== id));
  }

  private async display(lower: string): Promise<string> {
    const u = await this.kv.get<{ name?: unknown }>(`u:${lower}`);
    return u && typeof u.name === 'string' ? u.name : lower;
  }

  /** The clubs `user` is in, A-Z. */
  async list(user: string): Promise<ClubView[]> {
    const me = user.toLowerCase();
    const out: ClubView[] = [];
    for (const id of await this.mine(me)) {
      const c = await this.clubOf(id);
      if (!c) continue;
      const rest = await Promise.all(c.members.filter((m) => m !== c.owner).map((m) => this.display(m)));
      rest.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
      const owner = await this.display(c.owner);
      out.push({ name: c.name, owner, members: [owner, ...rest], mine: c.owner === me });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }

  async act(user: string, act: ClubAction): Promise<ClubResult> {
    if (!act || typeof act !== 'object') return { ok: false, error: 'Bad request.' };
    const me = user.toLowerCase();
    const done = async (): Promise<ClubResult> => ({ ok: true, clubs: await this.list(user) });
    if (act.a === 'create') {
      const name = clubName(act.club);
      if (!name) return { ok: false, error: 'Club names are 3-20 letters, numbers, spaces, _ or -.' };
      const id = name.toLowerCase();
      if (await this.clubOf(id)) return { ok: false, error: `${name} is taken.` };
      if ((await this.mine(me)).length >= CLUBS_MAX) return { ok: false, error: `You can be in up to ${CLUBS_MAX} clubs.` };
      await this.kv.put(`cl:${id}`, { name, owner: me, members: [me] } satisfies Club);
      await this.join(me, id);
      return done();
    }
    if (act.a !== 'add' && act.a !== 'remove' && act.a !== 'disband') return { ok: false, error: 'Bad request.' };
    const club = typeof act.club === 'string' ? await this.clubOf(act.club.trim().replace(/\s+/g, ' ').toLowerCase()) : null;
    if (!club || !club.members.includes(me)) return { ok: false, error: 'No such club.' };
    const id = club.name.toLowerCase();
    if (act.a === 'disband') {
      if (club.owner !== me) return { ok: false, error: 'Only the owner can disband a club.' };
      for (const m of club.members) await this.leave(m, id);
      await this.kv.delete(`cl:${id}`);
      return done();
    }
    const name = friendName(act.name);
    if (!name) return { ok: false, error: 'Usernames are 3-16 letters, numbers, _ or -.' };
    const them = name.toLowerCase();
    if (act.a === 'add') {
      if (club.owner !== me) return { ok: false, error: 'Only the owner can add members.' };
      if (club.members.includes(them)) return done();
      if (!(await this.friends.has(me, them))) return { ok: false, error: `${name} isn't on your friends list. Add them as a friend first.` };
      if (club.members.length >= CLUB_MEMBERS_MAX) return { ok: false, error: `A club holds up to ${CLUB_MEMBERS_MAX} members.` };
      if ((await this.mine(them)).length >= CLUBS_MAX) return { ok: false, error: `${name} is in ${CLUBS_MAX} clubs already.` };
      await this.kv.put(`cl:${id}`, { ...club, members: [...club.members, them] });
      await this.join(them, id);
      return done();
    }
    // remove: the owner takes anyone out, a member only themselves, and the owner can't leave (disband instead).
    if (!club.members.includes(them)) return done();
    if (them === club.owner) return { ok: false, error: 'The owner can disband the club but not leave it.' };
    if (club.owner !== me && them !== me) return { ok: false, error: 'Only the owner can remove other members.' };
    await this.kv.put(`cl:${id}`, { ...club, members: club.members.filter((m) => m !== them) });
    await this.leave(them, id);
    return done();
  }
}
