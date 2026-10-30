// Account levels: XP from kills, finished games and Survival rounds adds up to a level. Pure, unit-tested; the total is
// kept with the stash (on the server for accounts, like coins: see shared/stash.ts).

/** XP for each thing you do online. Practice earns none. */
export const XP = {
  battleKill: 20,
  battleMatch: 75, // finishing a match (win or lose)...
  battleWin: 100, // ...and this on top for the winners
  zombieKill: 5,
  round: 40, // a Survival round cleared (everyone in the lobby)
  boss: 150, // the Foreman goes down (everyone)
  survivalGame: 75, // a Survival run ends
  royaleWin: 200, // last one standing in a Battle Royale (on top of battleMatch)
};

/** XP to go from `level` to the next one: a little more every level. */
export const xpToNext = (level: number) => 200 + 75 * (level - 1);

/** Where a total puts you: your level, XP into it, and XP the level needs. */
export function levelOf(total: number): { level: number; into: number; need: number } {
  let level = 1;
  let left = Math.max(0, Math.floor(total));
  while (left >= xpToNext(level)) {
    left -= xpToNext(level);
    level++;
  }
  return { level, into: left, need: xpToNext(level) };
}
