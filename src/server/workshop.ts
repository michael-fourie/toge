import type { Box } from '../shared/collision.ts';
import { CONTRAPTIONS, type ContraptionKind, WORKSHOP, contraptionDamage, placeProblem } from '../shared/contraptions.ts';
import { rayWorld } from '../shared/collision.ts';
import { FOUNDRY } from '../shared/foundry.ts';
import type { Vec3 } from '../shared/math.ts';
import { type ClientMsg, type ContraptionFx, type NetContraption, type ServerMsg, type V3, round3 } from '../shared/protocol.ts';
import type { Zombie } from '../shared/zombie.ts';
import type { Member } from './lobby.ts';

/** What the workshop needs from Survival: the horde, the building, the round, the dice, and its way of hurting zombies. */
export interface WorkshopHost {
  zombies(): Zombie[];
  /** Solid for players (placement) and for bullets (line of sight). */
  cols(): { move: readonly Box[]; shot: readonly Box[] };
  doors(): readonly boolean[];
  round(): number;
  rand(): number;
  clock(): number;
  /** Damage a zombie on behalf of `owner` (kills pay them points and count as theirs). */
  hurt(owner: number, z: Zombie, damage: number, dir: V3, by: ContraptionKind): void;
  broadcast(msg: ServerMsg): void;
  sendTo(m: Member, msg: ServerMsg): void;
  /** A signed-in player's account (their coins are the server's to take), or null for a guest (they paid themselves). */
  account?(m: Member): { spend(coins: number): Promise<boolean>; pay(coins: number): void } | null;
}

interface Contraption {
  id: number;
  kind: ContraptionKind;
  pos: Vec3;
  yaw: number;
  owner: number;
  /** Seconds until its next go. */
  cd: number;
}

interface Pile {
  n: number;
  from: number;
  pos: Vec3;
  charges: number;
  cd: number;
}

interface Bomb {
  from: number;
  at: Vec3;
  lands: number;
  damage: number;
}

const chest = (z: Zombie): Vec3 => ({ x: z.pos.x, y: z.pos.y + 1, z: z.pos.z });
const v3 = (p: Vec3): V3 => [round3(p.x), round3(p.y), round3(p.z)];
const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
const away = (from: Vec3, to: Vec3): V3 => {
  const l = Math.hypot(to.x - from.x, to.z - from.z) || 1;
  return [round3((to.x - from.x) / l), 0.4, round3((to.z - from.z) / l)];
};

/**
 * The Survival contraptions (Bloons-style towers) for one lobby: building and scrapping them, and running them every
 * tick against the server's zombies. Signed-in players pay from their account here; guests' coins are client-side, so
 * for them all we can do is cap how many there are and check where they go. Everything is cleared with the run.
 */
export class Workshop {
  private list: Contraption[] = [];
  private piles: Pile[] = [];
  private bombs: Bomb[] = [];
  private builtAt = new Map<number, number>();
  /** Signed-in builders whose account is being charged right now (one build at a time). */
  private paying = new Set<number>();
  private nextId = 1;
  private nextPile = 1;

  constructor(private host: WorkshopHost) {}

  /**
   * Someone wants a contraption here. A guest already paid (client-side), so a refusal refunds it. A signed-in player
   * is charged here, once the spot checks out (and checked again after, since the world moves while we wait).
   */
  build(m: Member, msg: Extract<ClientMsg, { t: 'build' }>, canBuild: () => boolean) {
    const def = CONTRAPTIONS[msg.k];
    if (!def) return;
    const refund = (why: string) => this.host.sendTo(m, { t: 'refund', k: msg.k, share: 1, why });
    const why = this.refusal(m, msg, canBuild());
    if (why) return refund(why);
    const account = this.host.account?.(m);
    if (!account) return this.place(m, msg);
    const id = m.info.id;
    this.paying.add(id);
    void account.spend(def.price).then(
      (paid) => {
        this.paying.delete(id);
        if (!paid) return refund('Not enough coins');
        const late = !m.client.lobby ? 'Gone' : this.refusal(m, msg, canBuild());
        if (!late) return this.place(m, msg);
        account.pay(def.price);
        refund(late);
      },
      () => {
        this.paying.delete(id);
        refund("Couldn't reach your account");
      },
    );
  }

  private place(m: Member, msg: Extract<ClientMsg, { t: 'build' }>) {
    const [x, y, z] = msg.p;
    this.list.push({ id: this.nextId++, kind: msg.k, pos: { x, y, z }, yaw: Number.isFinite(msg.yaw) ? msg.yaw : 0, owner: m.info.id, cd: 0.5 });
    this.builtAt.set(m.info.id, this.host.clock());
    this.sendList();
  }

  private refusal(m: Member, msg: Extract<ClientMsg, { t: 'build' }>, canBuild: boolean): string | null {
    if (!canBuild) return "Can't build right now";
    const id = m.info.id;
    if (this.paying.has(id) || this.host.clock() - (this.builtAt.get(id) ?? -99) < WORKSHOP.buildCooldown) return 'Easy, one at a time';
    if (this.list.filter((g) => g.owner === id).length >= WORKSHOP.perPlayer) return `You have ${WORKSHOP.perPlayer} out already`;
    if (this.list.length >= WORKSHOP.perLobby) return 'The building is full of contraptions';
    if (!Array.isArray(msg.p) || msg.p.length !== 3 || !msg.p.every(Number.isFinite)) return 'Bad spot';
    const [x, y, z] = msg.p;
    const [px, py, pz] = m.state.p;
    if (Math.hypot(x - px, y - py, z - pz) > WORKSHOP.reach + 1.5) return 'Too far away';
    return placeProblem({ x, y, z }, { map: FOUNDRY, boxes: this.host.cols().move, doorsOpen: this.host.doors(), others: this.list });
  }

  /** F on your own contraption: it goes, and you get part of its price back. */
  scrap(m: Member, id: number) {
    const g = this.list.find((c) => c.id === id && c.owner === m.info.id);
    if (!g) return;
    this.remove(g);
    this.host.account?.(m)?.pay(Math.floor(CONTRAPTIONS[g.kind].price * WORKSHOP.scrapShare));
    this.host.sendTo(m, { t: 'refund', k: g.kind, share: WORKSHOP.scrapShare, why: 'Scrapped' });
    this.sendList();
  }

  /** What findUse needs to offer scrapping. */
  forUse() {
    return this.list.map((g) => ({ id: g.id, k: g.kind, pos: g.pos, owner: g.owner }));
  }

  /** A player left: their contraptions (and what they left lying about) go with them. */
  forget(owner: number) {
    const before = this.list.length + this.piles.length;
    for (const g of this.list.filter((c) => c.owner === owner)) this.remove(g);
    this.bombs = this.bombs.filter((b) => b.from !== owner);
    this.builtAt.delete(owner);
    if (this.list.length + this.piles.length !== before) this.sendList();
  }

  /** A new run: everything goes. */
  reset() {
    this.list = [];
    this.piles = [];
    this.bombs = [];
    this.builtAt.clear();
    this.sendList();
  }

  /** The whole list, to everyone (a change) or to one player (just joined). */
  sendList(to?: Member) {
    const list: NetContraption[] = this.list.map((g) => ({ id: g.id, k: g.kind, p: v3(g.pos), yaw: Math.round(g.yaw * 100) / 100, owner: g.owner }));
    const msg: ServerMsg = { t: 'contraptions', list, piles: this.piles.map((p) => ({ n: p.n, p: v3(p.pos) })) };
    if (to) this.host.sendTo(to, msg);
    else this.host.broadcast(msg);
  }

  private remove(g: Contraption) {
    this.list.splice(this.list.indexOf(g), 1);
    this.piles = this.piles.filter((p) => p.from !== g.id);
  }

  private fx(g: Contraption, fx: ContraptionFx, p?: Vec3[], n?: number) {
    this.host.broadcast({ t: 'cfx', id: g.id, fx, p: p?.map(v3), n });
  }

  // ---------------------------------------------------------------------------
  // Running them

  tick(dt: number) {
    for (const g of this.list) {
      g.cd -= dt;
      if (g.cd > 0) continue;
      g.cd = this.act(g) ? CONTRAPTIONS[g.kind].every : 0.1; // nothing to do: look again shortly
    }
    this.tickPiles(dt);
    this.tickBombs();
  }

  /** The eye of a contraption: where it looks from. */
  private eye(g: Contraption): Vec3 {
    return { x: g.pos.x, y: g.pos.y + 1, z: g.pos.z };
  }

  /** Can it see this point (walls and shut doors block; windows don't)? */
  private sees(from: Vec3, to: Vec3): boolean {
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const l = Math.hypot(d.x, d.y, d.z);
    if (l < 0.05) return true;
    return rayWorld(from, { x: d.x / l, y: d.y / l, z: d.z / l }, this.host.cols().shot, l) >= l - 0.05;
  }

  /** Zombies it can reach: in range, not far above or below (short-range kinds), and in sight. */
  private inReach(g: Contraption, range: number, tall = false): Zombie[] {
    const eye = this.eye(g);
    return this.host.zombies().filter((z) => flat(z.pos, g.pos) <= range && (tall || Math.abs(z.pos.y - g.pos.y) <= WORKSHOP.sight) && this.sees(eye, chest(z)));
  }

  /** One go. Returns whether it did anything (else it looks again soon). */
  private act(g: Contraption): boolean {
    const def = CONTRAPTIONS[g.kind];
    const dmg = contraptionDamage(g.kind, this.host.round());
    switch (g.kind) {
      case 'spikes':
        return this.dropPile(g);
      case 'tacks': {
        const hit = this.inReach(g, def.range);
        if (!hit.length) return false;
        this.fx(g, 'tacks');
        for (const z of hit) this.host.hurt(g.owner, z, dmg, away(g.pos, z.pos), g.kind);
        return true;
      }
      case 'goo': {
        const hit = this.inReach(g, def.range);
        if (!hit.length) return false;
        for (const z of hit) z.goo = WORKSHOP.gooFor; // zombies only: the goo never touches a player
        if (this.host.rand() < 0.25) this.fx(g, 'goo', [chest(hit[0])]); // a squirt now and then, for show
        return true;
      }
      case 'lobber': {
        const z = this.nearest(g, this.inReach(g, def.range, true).filter((o) => flat(o.pos, g.pos) >= WORKSHOP.bombMinRange));
        if (!z) return false;
        const at = { ...z.pos };
        this.bombs.push({ from: g.owner, at, lands: this.host.clock() + WORKSHOP.bombFlight, damage: dmg });
        this.fx(g, 'bomb', [at]);
        return true;
      }
      case 'zapper': {
        const first = this.nearest(g, this.inReach(g, def.range));
        if (!first) return false;
        const chain = [first];
        let hop = dmg;
        this.host.hurt(g.owner, first, hop, away(g.pos, first.pos), g.kind);
        for (let i = 0; i < WORKSHOP.zapChain; i++) {
          const last = chain[chain.length - 1];
          const next = this.host.zombies().filter((o) => !chain.includes(o) && flat(o.pos, last.pos) <= WORKSHOP.zapHop && this.sees(chest(last), chest(o)));
          const to = this.nearest({ ...g, pos: last.pos }, next);
          if (!to) break;
          hop = Math.round(hop * WORKSHOP.zapFalloff);
          chain.push(to);
          this.host.hurt(g.owner, to, hop, away(last.pos, to.pos), g.kind);
        }
        this.fx(g, 'zap', chain.map(chest));
        return true;
      }
      case 'owl': {
        // The toughest one in sight: owls go for the boss.
        const seen = this.inReach(g, def.range, true);
        if (!seen.length) return false;
        const z = seen.reduce((a, b) => (b.hp > a.hp ? b : a));
        const at = chest(z);
        this.host.hurt(g.owner, z, dmg, away(g.pos, z.pos), g.kind);
        this.fx(g, 'owl', [at]);
        return true;
      }
    }
  }

  private nearest(g: { pos: Vec3 }, zs: Zombie[]): Zombie | null {
    let best: Zombie | null = null;
    for (const z of zs) if (!best || flat(z.pos, g.pos) < flat(best.pos, g.pos)) best = z;
    return best;
  }

  /** A spike dispenser drops a pile on free floor around itself, up to its limit. */
  private dropPile(g: Contraption): boolean {
    if (this.piles.filter((p) => p.from === g.id).length >= WORKSHOP.spikePiles) return false;
    const range = CONTRAPTIONS.spikes.range;
    for (let i = 0; i < 8; i++) {
      const a = this.host.rand() * Math.PI * 2;
      const r = 1.2 + this.host.rand() * (range - 1.2);
      const pos = { x: g.pos.x + Math.cos(a) * r, y: g.pos.y, z: g.pos.z + Math.sin(a) * r };
      const others = [...this.list.filter((o) => o !== g), ...this.piles];
      if (placeProblem(pos, { map: FOUNDRY, boxes: this.host.cols().move, doorsOpen: this.host.doors(), others }) || !this.sees(this.eye(g), { ...pos, y: pos.y + 0.3 })) continue;
      const pile = { n: this.nextPile++, from: g.id, pos, charges: WORKSHOP.spikeCharges, cd: 0 };
      this.piles.push(pile);
      this.fx(g, 'pile', [pos], pile.n);
      return true;
    }
    return false;
  }

  /** Piles poke whoever stands on them, and wear out. */
  private tickPiles(dt: number) {
    for (const p of [...this.piles]) {
      p.cd -= dt;
      if (p.cd > 0) continue;
      const g = this.list.find((c) => c.id === p.from);
      if (!g) continue;
      const on = this.host.zombies().filter((z) => flat(z.pos, p.pos) <= WORKSHOP.spikeRadius && Math.abs(z.pos.y - p.pos.y) < 0.8);
      if (!on.length) continue;
      p.cd = WORKSHOP.spikePoke;
      const dmg = contraptionDamage('spikes', this.host.round());
      for (const z of on) {
        if (p.charges <= 0) break;
        p.charges--;
        this.host.hurt(g.owner, z, dmg, away(p.pos, z.pos), 'spikes');
      }
      if (p.charges > 0) continue;
      this.piles.splice(this.piles.indexOf(p), 1);
      this.fx(g, 'pileGone', undefined, p.n);
    }
  }

  /** Bombs that have landed go off: everything around takes it, less toward the edge. */
  private tickBombs() {
    const now = this.host.clock();
    for (const b of this.bombs.filter((x) => x.lands <= now)) {
      this.bombs.splice(this.bombs.indexOf(b), 1);
      for (const z of [...this.host.zombies()]) {
        const d = Math.hypot(z.pos.x - b.at.x, z.pos.z - b.at.z);
        if (d > WORKSHOP.bombRadius || Math.abs(z.pos.y - b.at.y) > 2.5) continue;
        this.host.hurt(b.from, z, Math.round(b.damage * (1 - (d / WORKSHOP.bombRadius) * 0.5)), away(b.at, z.pos), 'lobber');
      }
    }
  }
}
