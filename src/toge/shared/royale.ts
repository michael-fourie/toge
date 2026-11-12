// Battle royale (2026-11-12, Michael: "a battle royale type in Toge where each lap the last person gets killed. Do laps
// til one left"): an elimination race on a lap circuit. Each time the field completes a lap, the last car still to
// cross the line is destroyed, and the laps go on until one car is left: the winner.
//
// Pure and deterministic, so the room (online, from the poses it relays) and a solo race (from the AI and your own
// car) run exactly the same rules.

export const ROYALE = {
  /**
   * Once the first car crosses the line to finish a lap, the rest have this long (s) to cross it too. Anyone still
   * behind when it runs out is out (slowest first), so a car that stops, or a pack that's all stuck, can't hold the
   * race up. Normally it never runs out: the moment all but one have crossed, the last is out.
   */
  grace: 30,
  /** A solo battle royale races at least this many CPU rivals (there must be someone to outlast). */
  minRivals: 3,
  /** How long the eliminated car's wreck burns before it's taken off the road (s), on every screen. */
  wreckSeconds: 1.2,
};

/** One car knocked out: who, on which lap, and the place it ends the race in (the field's size when it went out, counting down). */
export interface Knockout {
  id: number;
  lap: number;
  place: number;
  /** The race clock (s) when it went out. */
  at: number;
}

/**
 * The elimination clock for one race. Give it every car still in the race each step with how far it has raced
 * (`car.s`: the line for lap k is at `startS + k * lapLen`); it says who's out. Cars that leave the race are simply no
 * longer passed in.
 */
export class Royale {
  /** The lap being decided next (1: the first time round). */
  lap = 1;
  /** When the first car finished `lap` (race clock, s), or null while nobody has. */
  private firstAt: number | null = null;
  readonly out = new Map<number, Knockout>();
  /** The winner, once they're the last car left. */
  winner: number | null = null;

  constructor(
    readonly startS: number,
    readonly lapLen: number,
  ) {}

  /** Where the line for lap `k` is (distance raced). */
  line(k = this.lap) {
    return this.startS + k * this.lapLen;
  }

  /** The cars in `field` still in the race. */
  alive(field: Iterable<number>): number[] {
    return [...field].filter((id) => !this.out.has(id));
  }

  /**
   * One step at race clock `now`: `progress` has each car still in the race (anyone eliminated is ignored) and how far
   * it has raced. Returns the cars knocked out by this step, in the order they went (last place first).
   */
  step(progress: Map<number, number>, now: number): Knockout[] {
    const gone: Knockout[] = [];
    if (this.winner !== null) return gone;
    for (;;) {
      const alive = this.alive(progress.keys());
      if (alive.length <= 1) {
        if (alive.length === 1 && this.out.size > 0) this.winner = alive[0];
        return gone;
      }
      const line = this.line();
      const behind = alive.filter((id) => progress.get(id)! < line).sort((a, b) => progress.get(a)! - progress.get(b)!);
      if (behind.length === alive.length) {
        this.firstAt = null;
        return gone;
      }
      this.firstAt ??= now;
      // All but one have crossed: the last one is out. Or the grace ran out: everyone still behind is out.
      // (Everyone over the line in the same step: the one furthest back crossed it last.)
      const last = alive.reduce((a, b) => (progress.get(b)! < progress.get(a)! ? b : a));
      const due = behind.length === 0 ? [last] : behind.length === 1 || now - this.firstAt >= ROYALE.grace ? behind : [];
      if (!due.length) return gone;
      for (const id of due) {
        const k: Knockout = { id, lap: this.lap, place: this.alive(progress.keys()).length, at: now };
        this.out.set(id, k);
        gone.push(k);
      }
      this.lap++;
      this.firstAt = null;
      // (Loop: a car may already be over the next lap's line, e.g. after a long grace.)
    }
  }
}
