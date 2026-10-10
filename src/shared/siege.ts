// Zombies and windows: a zombie that spawns in the yard heads for its window, rips the boards off one by one, climbs in,
// and from then on chases players through the rooms. This is the Brain the horde runs on in Survival.
import type { SurvivalLayout } from './layout.ts';
import type { Nav } from './nav.ts';
import type { Aim, Brain, Zombie, ZombieTarget } from './zombie.ts';

const HOLD = 0.55; // metres from the spot in front of the boards at which a zombie stops walking and starts tearing

/** `boards` is read live: it is the server's per-window plank count. */
export function makeBrain(nav: Nav, lay: SurvivalLayout, boards: readonly number[]): Brain {
  return {
    cost: (from, to) => nav.cost(from, to),
    steer(z: Zombie, t: ZombieTarget | null): Aim | null {
      if (z.gate >= 0) {
        const b = lay.barricades[z.gate];
        if ((boards[b.id] ?? 0) > 0) return { pos: b.outside, claw: false, hold: Math.hypot(z.pos.x - b.outside.x, z.pos.z - b.outside.z) < HOLD };
        return { pos: { ...b.inside, y: z.pos.y }, claw: false, hold: false };
      }
      if (!t) return null;
      let g = nav.goal(z.pos, t.pos);
      // Through a doorway, finish stepping through before thinking again: where a room wraps round another's door (the
      // Undercroft stairs in the Hall), the next straight line could lead right back in, and round and round.
      if (g.through) z.exit = { x: g.x, y: g.y, z: g.z };
      else if (z.exit) {
        if (Math.hypot(z.pos.x - z.exit.x, z.pos.z - z.exit.z) < 1 || z.stuck > 0.5) z.exit = undefined;
        else g = z.exit;
      }
      // A doorway or ramp foot is on the way, not up a ledge: keep it level so zombies don't pounce at it.
      return { pos: g === t.pos ? t.pos : { x: g.x, y: z.pos.y, z: g.z }, claw: true, hold: false };
    },
  };
}

/** True once a zombie that was breaking in is through the wall (and can chase players). */
export function isThrough(z: Zombie, lay: SurvivalLayout): boolean {
  const b = lay.barricades[z.gate];
  return (z.pos.x - b.pos.x) * b.out.x + (z.pos.z - b.pos.z) * b.out.z < -0.8;
}
