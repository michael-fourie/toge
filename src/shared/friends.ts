// Friends: who you've added (by username) and who has added you. Site-wide, kept by the Accounts DO
// (src/server/friendStore.ts); a game decides what a friend can see (TŌGE: your garage and best times).

/** Most friends one account can add. */
export const FRIENDS_MAX = 100;

export type FriendAction = { a: 'add' | 'remove'; name: string };

export interface FriendList {
  /** Accounts you've added (display names, as they signed up). */
  friends: string[];
  /** The ones of `friends` who've added you back. */
  mutual: string[];
  /** Accounts that added you and you haven't added back. */
  fans: string[];
}

export type FriendResult = { ok: true; list: FriendList } | { ok: false; error: string };

/** A username as typed into the add box, or null if it can't be one (the rules are checkCredentials'). */
export const friendName = (x: unknown): string | null => (typeof x === 'string' && /^[A-Za-z0-9_-]{3,16}$/.test(x.trim()) ? x.trim() : null);
