// Clubs: a named group of accounts. Anyone signed in can start one and add accounts from their friends list; a member
// can leave, the owner can remove members or disband it. Site-wide, kept by the Accounts DO (src/server/clubStore.ts).

/** Most clubs one account can be in, most members in one club, and the length of a club's name. */
export const CLUBS_MAX = 5;
export const CLUB_MEMBERS_MAX = 30;
export const CLUB_NAME = { min: 3, max: 20 };

export type ClubAction =
  /** Start a club called `club` (you own it and are its first member). */
  | { a: 'create'; club: string }
  /** Owner: put one of your friends in the club. */
  | { a: 'add'; club: string; name: string }
  /** Owner: take a member out. Anyone: `name` as yourself leaves. */
  | { a: 'remove'; club: string; name: string }
  /** Owner: close the club. */
  | { a: 'disband'; club: string };

/** A club as its members see it. */
export interface ClubView {
  name: string;
  /** Display names. */
  owner: string;
  /** The owner first, then the rest A-Z. */
  members: string[];
  /** You own it. */
  mine: boolean;
}

export type ClubResult = { ok: true; clubs: ClubView[] } | { ok: false; error: string };

/** A club name as typed (spaces squeezed), or null if it can't be one: letters, numbers, spaces, _ and -. */
export const clubName = (x: unknown): string | null => {
  if (typeof x !== 'string') return null;
  const n = x.trim().replace(/\s+/g, ' ');
  return n.length >= CLUB_NAME.min && n.length <= CLUB_NAME.max && /^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(n) ? n : null;
};
