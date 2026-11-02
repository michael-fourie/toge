// Battle teams: who is on which side, and who has won. Pure, so it's unit-tested.

import type { PlayerInfo } from './protocol.ts';

export type Team = 0 | 1;

/** Sunset vs Tide: warm and cool, so teammates read at a glance through scope and across the map. */
export const TEAMS = [
  { name: 'Sunset', color: 0xe0674f },
  { name: 'Tide', color: 0x4f8fd9 },
] as const;

/** Every match (free-for-all or teams) is won by the first to this many kills (a team's kills add up). */
export const KILL_LIMIT = 30;

/** Seconds the winner is shown before the next match starts. */
export const MATCH_OVER_SECONDS = 10;

export const sameTeam = (a: { team?: Team }, b: { team?: Team }) => a.team !== undefined && a.team === b.team;

/** The side a newcomer joins: the smaller one (Sunset on a tie). */
export function smallerTeam(players: Iterable<{ team?: Team }>): Team {
  let a = 0;
  let b = 0;
  for (const p of players) {
    if (p.team === 0) a++;
    else if (p.team === 1) b++;
  }
  return b < a ? 1 : 0;
}

/** Random split that is as even as possible (the odd one out lands on a random side). */
export function shuffleTeams(ids: number[], rand: () => number = Math.random): Map<number, Team> {
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const first: Team = rand() < 0.5 ? 0 : 1;
  return new Map(order.map((id, i) => [id, ((i + first) % 2) as Team]));
}

export function teamKills(players: Iterable<PlayerInfo>): [number, number] {
  const t: [number, number] = [0, 0];
  for (const p of players) if (p.team !== undefined) t[p.team] += p.kills;
  return t;
}

export type Winner = { team: Team } | { id: number };

/** Who just reached the kill limit, if anyone. In teams mode the team total counts, otherwise the top player. */
export function winner(players: PlayerInfo[], teams: boolean, limit = KILL_LIMIT): Winner | null {
  if (teams) {
    const k = teamKills(players);
    return k[0] >= limit || k[1] >= limit ? { team: k[1] > k[0] ? 1 : 0 } : null;
  }
  const top = players.reduce<PlayerInfo | null>((best, p) => (!best || p.kills > best.kills ? p : best), null);
  return top && top.kills >= limit ? { id: top.id } : null;
}
