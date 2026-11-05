// Race order, shared by the place readout and the leaderboard: finishers by time, then everyone still out by
// how far they've come. `progress` is distance covered (metres down the road), so a lap race passes
// laps done × lap length + distance into the lap and the same order holds.

export interface Standing<T> {
  who: T;
  /** Finish time (s), or null while still racing. */
  finished: number | null;
  progress: number;
}

export function standings<T>(field: Standing<T>[]): Standing<T>[] {
  return field
    .slice()
    .sort((a, b) => (a.finished !== null && b.finished !== null ? a.finished - b.finished : a.finished !== null ? -1 : b.finished !== null ? 1 : b.progress - a.progress));
}
