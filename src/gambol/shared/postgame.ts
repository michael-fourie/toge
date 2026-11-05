// Survival post-game bookkeeping: who scored what, who is ready to go again. Pure, so it's unit-tested.

import type { PostRow } from './protocol.ts';

export interface RunRecord {
  name: string;
  color: number;
  kills: number;
}

/** Rows for the post-game board. Players who left mid-run keep their kills but can't be waited on. */
export function buildRows(records: Map<number, RunRecord>, present: Set<number>, ready: Set<number>): PostRow[] {
  const rows: PostRow[] = [];
  for (const [id, r] of records) {
    rows.push({ id, name: r.name, color: r.color, kills: r.kills, ready: present.has(id) && ready.has(id), gone: !present.has(id) });
  }
  return rankRows(rows);
}

/** Most kills first; ties keep their order (the sort is stable). */
export function rankRows(rows: PostRow[]): PostRow[] {
  return [...rows].sort((a, b) => b.kills - a.kills);
}

/** The MVP is the top scorer, if anyone scored. A shared top spot crowns everyone tied. */
export function mvpIds(rows: PostRow[]): Set<number> {
  const top = Math.max(0, ...rows.map((r) => r.kills));
  return new Set(top > 0 ? rows.filter((r) => r.kills === top).map((r) => r.id) : []);
}

export const totalKills = (rows: PostRow[]) => rows.reduce((n, r) => n + r.kills, 0);

/** Players still in the lobby who haven't pressed Play again. */
export function waitingFor(present: Set<number>, ready: Set<number>): number {
  let n = 0;
  for (const id of present) if (!ready.has(id)) n++;
  return n;
}

/** Restart when everyone present is ready (and someone is), or when the timeout runs out. */
export function shouldRestart(present: Set<number>, ready: Set<number>, timer: number): boolean {
  return timer <= 0 || (present.size > 0 && waitingFor(present, ready) === 0);
}
