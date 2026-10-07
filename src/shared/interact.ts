// Survival "press F" rules, shared so the client can show the right prompt and the server can check it. Pure.
import { SURVIVAL } from './constants.ts';
import type { SurvivalLayout } from './layout.ts';
import type { Vec3 } from './math.ts';
import { PERKS, type PerkId } from './perks.ts';
import type { BoxState, UseKind } from './protocol.ts';
import { type Slot, WEAPONS, ammoPrice, gunStats } from './weapons.ts';

type UseStatus = 'ready' | 'poor' | 'owned' | 'busy' | 'off';

/** Something within reach that F does something to. */
export interface Use {
  kind: UseKind;
  id: number;
  status: UseStatus;
  price: number;
  text: string;
}

/** Everything findUse needs to know about the player and the world. */
export interface UseCtx {
  lay: SurvivalLayout;
  doorsOpen: readonly boolean[];
  boards: readonly number[];
  box: BoxState;
  points: number;
  slots: readonly (Slot | null)[];
  cur: number;
  jug: boolean;
  /** The other perks this player has. */
  perks: readonly PerkId[];
  /** Teammates who are down (not this player), for reviving. */
  downed: readonly { id: number; pos: Vec3; name: string }[];
  self: number;
  /** The power is on (perk machines and the Pack-a-Punch work). */
  power: boolean;
  /** Scythe parts found, and the scythe: 0 not built, -1 on the bench, else who carries it. */
  parts: readonly boolean[];
  scythe: number;
}

/** Points from a zombie kill. */
export const killPoints = (headshot: boolean) => (headshot ? SURVIVAL.headPoints : SURVIVAL.bodyPoints);

/** A player's maximum health: with or without Juggernog. */
export const maxHp = (jug: boolean) => (jug ? SURVIVAL.jugHp : SURVIVAL.playerHp);

const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

/** The one thing F would do at `pos`: the nearest in reach (your own box gun first). Null when there is nothing. */
export function findUse(pos: Vec3, c: UseCtx): Use | null {
  const { lay } = c;
  const R = SURVIVAL.useRange;
  const afford = (price: number): UseStatus => (c.points >= price ? 'ready' : 'poor');
  const powered = (price: number): UseStatus => (c.power ? afford(price) : 'off');
  let best: Use | null = null;
  let bestD = Infinity;
  const offer = (d: number, u: Use) => {
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  };

  const spot = lay.boxSpots[c.box.spot];
  const dBox = flat(pos, spot.pos);
  if (dBox <= R && Math.abs(pos.y - spot.pos.y) < 2.5) {
    if (c.box.phase === 'ready' && c.box.owner === c.self && c.box.gun) {
      return { kind: 'take', id: 0, status: 'ready', price: 0, text: `Take ${WEAPONS[c.box.gun].name}` };
    }
    offer(dBox, c.box.phase === 'closed'
      ? { kind: 'box', id: 0, status: afford(SURVIVAL.boxPrice), price: SURVIVAL.boxPrice, text: 'Mystery Box' }
      : { kind: 'box', id: 0, status: 'busy', price: SURVIVAL.boxPrice, text: 'Mystery Box' });
  }

  for (const d of lay.doors) {
    if (c.doorsOpen[d.id]) continue;
    const { min, max } = d.box;
    const dx = Math.max(min.x - pos.x, 0, pos.x - max.x);
    const dz = Math.max(min.z - pos.z, 0, pos.z - max.z);
    const dist = Math.hypot(dx, dz);
    if (dist <= R && pos.y < max.y) offer(dist, { kind: 'door', id: d.id, status: afford(d.price), price: d.price, text: `Open ${d.name}` });
  }

  for (const w of lay.wallBuys) {
    const dist = flat(pos, w.pos);
    if (dist > R * 0.8 || Math.abs(pos.y - w.at.y) > 2.5) continue;
    const own = c.slots.find((s) => s?.w === w.weapon);
    const price = own ? ammoPrice(w.weapon, own.up) : w.price;
    offer(dist, { kind: 'wall', id: w.id, status: afford(price), price, text: `${own ? 'Ammo for' : 'Buy'} ${gunStats(w.weapon, own?.up ?? false).label}` });
  }

  const here = c.slots[c.cur];
  const dPunch = flat(pos, lay.punch);
  if (dPunch <= SURVIVAL.punchRange && Math.abs(pos.y - lay.punch.y) < 3) {
    const status: UseStatus = !here || here.up ? 'owned' : powered(SURVIVAL.punchPrice);
    offer(dPunch, { kind: 'punch', id: 0, status, price: SURVIVAL.punchPrice, text: here?.up ? 'Already Pack-a-Punched' : 'Pack-a-Punch' });
  }
  const dJug = flat(pos, lay.jug);
  if (dJug <= SURVIVAL.punchRange && Math.abs(pos.y - lay.jug.y) < 3) {
    offer(dJug, { kind: 'jug', id: 0, status: c.jug ? 'owned' : powered(SURVIVAL.jugPrice), price: SURVIVAL.jugPrice, text: c.jug ? 'Already Juggernogged' : 'Juggernog' });
  }

  lay.perks.forEach((p, id) => {
    const d = flat(pos, p.pos);
    if (d > SURVIVAL.punchRange || Math.abs(pos.y - p.pos.y) >= 3) return;
    const def = PERKS[p.kind];
    const have = c.perks.includes(p.kind);
    offer(d, { kind: 'perk', id, status: have ? 'owned' : powered(def.price), price: def.price, text: have ? `Already have ${def.name}` : `${def.name}: ${def.blurb}` });
  });

  const near = (p: Vec3, range = R) => {
    const d = flat(pos, p);
    return d <= range && Math.abs(pos.y - p.y) < 2.5 ? d : -1;
  };
  const dPower = near(lay.power.pos);
  if (dPower >= 0) offer(dPower, c.power ? { kind: 'power', id: 0, status: 'owned', price: 0, text: 'The power is on' } : { kind: 'power', id: 0, status: 'ready', price: 0, text: 'Turn the power on' });
  lay.parts.forEach((p, id) => {
    const d = near(p.pos);
    if (d >= 0 && !c.parts[id]) offer(d, { kind: 'part', id, status: 'ready', price: 0, text: 'Pick up a scythe part' });
  });
  const dBench = near(lay.bench.pos);
  if (dBench >= 0) {
    const found = lay.parts.filter((_, i) => c.parts[i]).length;
    if (c.scythe === 0 && found < lay.parts.length) offer(dBench, { kind: 'bench', id: 0, status: 'owned', price: 0, text: `Gale Scythe: ${found}/${lay.parts.length} parts found` });
    else if (c.scythe === 0) offer(dBench, { kind: 'bench', id: 0, status: 'ready', price: 0, text: 'Build the Gale Scythe' });
    else if (c.scythe === -1) offer(dBench, { kind: 'bench', id: 0, status: 'ready', price: 0, text: 'Take the Gale Scythe' });
    else offer(dBench, { kind: 'bench', id: 0, status: 'owned', price: 0, text: c.scythe === c.self ? 'You carry the Gale Scythe' : 'Someone carries the Gale Scythe' });
  }

  // A teammate down beside you comes before anything else in reach.
  for (const t of c.downed) {
    const d = Math.hypot(pos.x - t.pos.x, (pos.y - t.pos.y) * 0.5, pos.z - t.pos.z);
    if (d <= SURVIVAL.reviveRange) offer(d - 10, { kind: 'revive', id: t.id, status: 'ready', price: 0, text: `Hold to revive ${t.name}` });
  }

  for (const b of lay.barricades) {
    if ((c.boards[b.id] ?? 0) >= SURVIVAL.boards) continue;
    const inside = (pos.x - b.pos.x) * b.out.x + (pos.z - b.pos.z) * b.out.z < 0;
    const dist = flat(pos, b.pos);
    if (inside && dist <= R && Math.abs(pos.y - b.pos.y) < 2.5) offer(dist + 0.5, { kind: 'board', id: b.id, status: 'ready', price: 0, text: 'Hold to repair the window' });
  }
  return best;
}

/**
 * Zombies a shot passes through: those within `punchPierceRadius` of the shot line, beyond the point where it hit
 * the first one (`to`) and within `punchPierceRange` of it. Aim point is chest height. (Punched AWP only.)
 */
export function pierced(from: Vec3, to: Vec3, zombies: readonly { id: number; pos: Vec3 }[], skip: number): number[] {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const l = Math.hypot(d.x, d.y, d.z);
  if (l < 1e-6) return [];
  d.x /= l;
  d.y /= l;
  d.z /= l;
  const out: number[] = [];
  for (const z of zombies) {
    if (z.id === skip) continue;
    const v = { x: z.pos.x - to.x, y: z.pos.y + 1 - to.y, z: z.pos.z - to.z };
    const t = v.x * d.x + v.y * d.y + v.z * d.z;
    if (t < 0 || t > SURVIVAL.punchPierceRange) continue;
    if (Math.hypot(v.x - d.x * t, v.y - d.y * t, v.z - d.z * t) <= SURVIVAL.punchPierceRadius) out.push(z.id);
  }
  return out;
}
