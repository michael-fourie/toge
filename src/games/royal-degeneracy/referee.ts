// The host's referee: rules.ts plus what the host hears (everyone's latest pose) and owns (doors). It checks every
// request (phase, role, range, cooldown), updates the night and answers: public messages to everyone, private ones
// to one player. Secrets (roles, who's a Degenerate) only ever leave in private messages, or at the reveal.

import { CAST, tagFor } from './cast.ts';
import { caseById } from './cases.ts';
import { BONGUS_RANGE, LOOKOUT_RANGE, NPC_SIGHT, POWERS, hiddenNear, plantedIn, powerOf, powerProblem, proof, recordRooms, routerLog, spend, teaFact } from './abilities.ts';
import { CATS, ITEM, hint, inspect, label, nextRand, plant, post, search, traceable, unlock, valueOf, wipe } from './clues.ts';
import { WALK, newWalker, stepWalker, type Walker } from './move.ts';
import { rayWorld } from '../../shared/collision.ts';
import { BINBAG_DROP, DOORS, DUO_PAIRS, FLOOR_Y, REACH, ROOMS, SOLIDS, SPOTS, doorBox, floorOf, roomAt, type Door } from './house.ts';
import { SABOTAGES, fixSabotage, lockedDoors, startSabotage, wifiDown } from './sabotage.ts';
import type { Msg } from './net.ts';
import {
  REPORT_RANGE,
  castVote,
  legend,
  objection,
  settle,
  doChore,
  killProblem,
  leave,
  living,
  meetingProblem,
  newNight,
  playerOf,
  privateView,
  publicView,
  rattle,
  startMeeting,
  step,
  takeOut,
  type Joiner,
  type Night,
  type Settings,
} from './rules.ts';
import { PF } from './net.ts';
import type { Vec3 } from '../../shared/math.ts';

const SHOVE = { range: 1.5, slack: 0.8, cooldown: 3 };
/** The host re-sends the public view this often anyway, so everyone's clocks stay in step. */
const RESYNC = 2;

interface Pose extends Vec3 {
  f: number;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Is anyone standing in this doorway (so it mustn't swing shut on them)? */
export function doorBlocked(d: Door, people: Iterable<Vec3>): boolean {
  const b = doorBox(d);
  for (const p of people) {
    const pad = 0.45;
    if (p.x > b.min.x - pad && p.x < b.max.x + pad && p.z > b.min.z - pad && p.z < b.max.z + pad && p.y > b.min.y - 0.5 && p.y < b.max.y) return true;
  }
  return false;
}

export class Referee {
  readonly night: Night;
  readonly poses = new Map<number, Pose>();
  readonly open = new Set<string>();
  private shovedAt = new Map<number, number>();
  private clock = 0;
  private sinceSync = 0;
  /** How many of the case's texts have gone out. */
  private textsSent = 0;
  private sinceRooms = 0;
  /** Two-person chores: who's holding which end, since when (referee clock). */
  private holding = new Map<string, { id: number; since: number }>();
  /** High-five / hug offers: from → [to, kind, when]. */
  private offers = new Map<number, [number, 'five' | 'hug', number]>();
  /** Bike Stu's randoms, wandering from door to door. */
  private npcs: { w: Walker; goal: { x: number; z: number }; stuck: number; last: number }[] = [];
  private sinceNpcs = 0;
  /** The raccoon: when it next gets in (roam), and its visit while it's inside. */
  private coonAt = 100;
  private coon: { w: Walker; goal: { x: number; z: number }; until: number; stuck: number; rattle: number; took: boolean } | null = null;
  /** Everyone's position every half second, for the reveal's replays: [roam, [id, x, z, floor][]]. */
  private frames: [number, [number, number, number, number][]][] = [];
  private sinceFrame = 0;
  private replays: { k: number; v: number; f: [number, number, number, number][][] }[] = [];
  private replaysSent = false;
  /** True once the night is over and its end card has had its time. */
  done = false;

  constructor(
    people: readonly Joiner[],
    settings: Settings,
    seed: number,
    private out: (m: Msg, to?: number) => void,
  ) {
    this.night = newNight(people, settings, seed);
    // Bedroom doors start shut, the rest open.
    for (const d of DOORS) if (!['dev', 'mikol', 'selby', 'xang', 'will', 'jung', 'wags', 'bath2', 'bath3', 'hatch-back', 'hatch-front', 'balcony', 'frontbalcony'].includes(d.id)) this.open.add(d.id);
  }

  /** Sends everyone the opening state. */
  begin() {
    this.broadcast(true);
    this.out({ t: 'doors', open: [...this.open] });
  }

  private broadcast(privates: boolean) {
    this.sinceSync = 0;
    this.out({ t: 'st', v: publicView(this.night) });
    if (privates)
      for (const p of this.night.players) {
        const v = privateView(this.night, p.id);
        if (v && !p.gone) this.out({ t: 'me', v }, p.id);
      }
  }

  private privateTo(id: number) {
    const v = privateView(this.night, id);
    if (v) this.out({ t: 'me', v }, id);
  }

  tick(dt: number) {
    this.clock += dt;
    this.sinceSync += dt;
    if (step(this.night, dt)) this.broadcast(true);
    else if (this.sinceSync > RESYNC) this.broadcast(false);
    const texts = this.night.mystery.texts;
    while (this.night.phase === 'night' && this.textsSent < texts.length && this.night.roam >= texts[this.textsSent][0]) {
      const [, from, text] = texts[this.textsSent++];
      this.out({ t: 'feed', from, text, clue: -1 });
    }
    if (this.night.phase === 'over' && this.night.left <= 0) this.done = true;
    if (this.night.phase === 'over' && !this.replaysSent) {
      this.replaysSent = true;
      for (const r of this.replays) this.out({ t: 'replay', ...r });
    }
    if (this.night.phase === 'night') {
      this.tickCoon(dt);
      this.sinceFrame += dt;
      if (this.sinceFrame > 0.5) {
        this.sinceFrame = 0;
        const r1 = (v: number) => Math.round(v * 10) / 10;
        this.frames.push([this.night.roam, [...this.poses].filter(([id]) => { const p = playerOf(this.night, id); return !!p && living(p); }).map(([id, p]) => [id, r1(p.x), r1(p.z), floorOf(p.y + 0.1)])]);
        while (this.frames.length > 24) this.frames.shift();
      }
    }
    if (this.night.phase !== 'night') return;
    this.sinceRooms += dt;
    if (this.sinceRooms > 1) {
      this.sinceRooms = 0;
      const live = new Map([...this.poses].filter(([id]) => { const p = playerOf(this.night, id); return !!p && living(p); }));
      recordRooms(this.night, live);
    }
    this.tickDuo();
    this.tickNpcs(dt);
    // Shota overheats: off comes the shirt, wherever he's standing.
    const n = this.night;
    if (!n.shirt.pos && n.roam >= n.shirt.at) {
      const shota = n.players.find((p) => p.char === 'shota' && living(p));
      const pose = shota && this.poses.get(shota.id);
      if (pose) {
        n.shirt.pos = { x: pose.x, y: pose.y, z: pose.z };
        this.out({ t: 'feed', from: 'Shota', text: 'too hot. shirt’s off. no further questions', clue: -1 });
        this.broadcast(false);
      } else n.shirt.at = Infinity;
    }
  }

  private pw(to: number, text: string, extra: { pos?: [number, number, number][]; ids?: number[]; until?: number } = {}) {
    this.out({ t: 'pw', text, pos: extra.pos ?? [], ids: extra.ids ?? [], until: extra.until ?? 0 }, to);
  }

  /** After a takeout: Wags's phone buzzes if it was on his floor; Bike Stu's randoms may have seen it. */
  private afterCrime(killer: number, at: Pose) {
    const n = this.night;
    const f = floorOf(at.y + 0.1);
    for (const p of n.players) {
      const pose = this.poses.get(p.id);
      if (p.char === 'wags' && living(p) && pose && floorOf(pose.y + 0.1) === f) this.out({ t: 'buzz', x: at.x, y: at.y, z: at.z, text: 'Something bad just happened on your floor.' }, p.id);
    }
    if (n.powers.stuUntil <= n.roam) return;
    const k = playerOf(n, killer)!;
    for (const npc of this.npcs) {
      const e = { x: npc.w.pos.x, y: npc.w.pos.y + 1.6, z: npc.w.pos.z };
      const d = { x: at.x - e.x, y: at.y + 1 - e.y, z: at.z - e.z };
      const len = Math.hypot(d.x, d.y, d.z);
      if (len > NPC_SIGHT || floorOf(npc.w.pos.y + 0.1) !== f) continue;
      if (rayWorld(e, { x: d.x / len, y: d.y / len, z: d.z / len }, SOLIDS, len) < len - 0.5) continue;
      const cats = CATS.filter((c) => c !== 'belonging' && traceable(c, valueOf(k, c)));
      const cat = cats[Math.floor(nextRand(n) * cats.length)];
      const room = roomAt({ ...at, y: at.y + 0.1 })?.name ?? 'somewhere';
      this.pw(n.powers.stuBy, `📱 random from bike stu: yo ${hint(cat, valueOf(k, cat))} just bonked someone in ${room}. anyway see u at the session`);
      return;
    }
  }

  /** Someone used their ability. */
  private power(from: number, target: number, crime: number) {
    const n = this.night;
    const me = playerOf(n, from);
    const pose = this.poses.get(from);
    if (!me || !pose) return;
    const kind = powerOf(me.char, me.name);
    if (kind === 'legend' || kind === 'objection') {
      const ok = kind === 'legend' ? legend(n, from) : objection(n, from);
      if (!ok) return;
      this.out({ t: 'feed', from: tagFor(me.char, me.name), text: kind === 'legend' ? 'pulled the Campus Legend card: my vote counts double 😎' : 'OBJECTION! That vote is void. Vote again.', clue: -1 });
      return this.broadcast(false);
    }
    if (n.phase !== 'night' || powerProblem(n, from)) return;
    const def = POWERS[kind];
    const until = n.roam + (def.dur ?? 0);
    switch (kind) {
      case 'toboggan':
        spend(n, from);
        this.out({ t: 'fx', k: 'toboggan', x: pose.x, y: pose.y, z: pose.z });
        this.pw(from, '', { until });
        break;
      case 'router': {
        const r = SPOTS.find((s) => s.kind === 'router')!;
        if (dist(pose, r.pos) > REACH + 1) return this.pw(from, 'You need to be at the router (the shelf by the front door).');
        if (wifiDown(n)) return this.pw(from, 'The WiFi’s down: no logs. Reboot the router first.');
        spend(n, from);
        this.pw(from, ['Router logs, last 90 s:', ...routerLog(n)].join('\n'));
        break;
      }
      case 'proof': {
        const t = playerOf(n, target);
        if (!t || !n.mystery.crimes[crime]) return;
        const r = proof(n, target, crime);
        if (!r) return this.pw(from, 'Nothing to go on: nobody has posted a real photo from that crime yet. (No use spent.)');
        spend(n, from);
        this.pw(from, `Proof: ${tagFor(t.char, t.name)} is ${r === 'consistent' ? 'CONSISTENT with' : 'a CONTRADICTION to'} the real photos from that crime.`);
        break;
      }
      case 'bongus':
        spend(n, from);
        this.pw(from, '', { pos: hiddenNear(n, pose, BONGUS_RANGE), until });
        break;
      case 'bikestu':
        spend(n, from);
        n.powers.stuUntil = until;
        n.powers.stuBy = from;
        this.npcs = [0, 1].map((i) => ({ w: newWalker({ x: pose.x + (i ? 0.5 : -0.5), y: pose.y, z: pose.z }), goal: this.npcGoal(pose), stuck: 0, last: 0 }));
        this.out({ t: 'feed', from: 'Selby', text: 'come through to bike stu 🎤 (two people you’ve never met are now in the house)', clue: -1 });
        break;
      case 'lookout': {
        const t = playerOf(n, target);
        const them = this.poses.get(target);
        if (!t || !them || t === me || !living(t) || dist(pose, them) > LOOKOUT_RANGE + SHOVE.slack) return this.pw(from, 'Look right at a friend, close up.');
        spend(n, from);
        n.powers.guard.set(target, { by: from, until });
        this.pw(from, `You’re looking out for ${tagFor(t.char, t.name)} for 30 s.`);
        break;
      }
      case 'inspection': {
        const room = roomAt({ ...pose, y: pose.y + 0.1 });
        if (!room) return;
        spend(n, from);
        const ids = plantedIn(n, room.id);
        this.pw(from, ids.length ? `Something in ${room.name} was planted. It’s sparkling.` : `Nothing in ${room.name} is out of place.`, { ids, until: n.roam + 10 });
        break;
      }
      case 'wallhack':
      case 'eavesdrop':
        spend(n, from);
        this.pw(from, '', { until });
        break;
      case 'ruck': {
        spend(n, from);
        let opened = false;
        for (const d of DOORS)
          if (!this.open.has(d.id) && Math.abs(FLOOR_Y[d.floor] - pose.y) < 1 && Math.hypot(d.x - pose.x, d.z - pose.z) < 2.2) {
            this.open.add(d.id);
            opened = true;
          }
        if (opened) this.out({ t: 'doors', open: [...this.open] });
        for (const [id, p] of this.poses) {
          const t = playerOf(n, id);
          if (id === from || !t || !living(t) || dist(pose, p) > 2.2) continue;
          const l = Math.hypot(p.x - pose.x, p.z - pose.z) || 1;
          this.out({ t: 'shoved', id, x: Math.round(((p.x - pose.x) / l) * 100) / 100, z: Math.round(((p.z - pose.z) / l) * 100) / 100 });
          this.out({ t: 'fx', k: 'oof', x: p.x, y: p.y, z: p.z });
        }
        break;
      }
      case 'swab': {
        const c = n.mystery.clues[target];
        if (!c || c.state !== 'view' || dist(pose, c.pos) > REACH + 1.5) return this.pw(from, 'Look right at a clue to swab it.');
        spend(n, from);
        this.pw(from, `Swab result for evidence #${c.id + 1}: ${c.planted ? 'PLANTED. Someone put that there.' : 'real.'}`);
        break;
      }
      case 'tea': {
        const fact = teaFact(n, from, () => nextRand(n));
        if (!fact) return this.pw(from, 'No tea yet. Give it a minute. (No use spent.)');
        spend(n, from);
        this.pw(from, `☕ ${fact}`);
        break;
      }
    }
    this.privateTo(from);
  }

  /** Bike Stu's randoms head for a doorway on their floor, then somewhere in that room. */
  private npcGoal(at: Vec3): { x: number; z: number } {
    const f = floorOf(at.y + 0.1);
    const rooms = ROOMS.filter((r) => r.floor === f && !r.outside && !r.id.startsWith('stairs') && !r.id.startsWith('eaves'));
    const r = rooms[Math.floor(nextRand(this.night) * rooms.length)];
    return { x: r.min.x + 0.6 + nextRand(this.night) * (r.max.x - r.min.x - 1.2), z: r.min.z + 0.6 + nextRand(this.night) * (r.max.z - r.min.z - 1.2) };
  }

  private tickNpcs(dt: number) {
    const n = this.night;
    if (!this.npcs.length) return;
    if (n.powers.stuUntil <= n.roam) {
      this.npcs = [];
      this.out({ t: 'npcs', p: [] });
      return;
    }
    const doors = DOORS.filter((d) => !this.open.has(d.id)).map(doorBox);
    const walls = [...SOLIDS, ...doors];
    for (const npc of this.npcs) {
      const w = npc.w;
      const dx = npc.goal.x - w.pos.x;
      const dz = npc.goal.z - w.pos.z;
      const far = Math.hypot(dx, dz);
      // Head for the goal; when a wall's in the way, slide along it, and give up on goals they can't reach.
      w.yaw = Math.atan2(-dx, -dz) + Math.sin(this.clock * 0.7 + npc.last) * 0.4;
      const before = { ...w.pos };
      stepWalker(w, { fwd: far > 0.5 ? 0.45 : 0, side: 0, jump: false, crouch: false, up: false }, dt, walls);
      npc.stuck = Math.hypot(w.pos.x - before.x, w.pos.z - before.z) < WALK.speed * 0.45 * dt * 0.3 ? npc.stuck + dt : 0;
      if (far < 0.5 || npc.stuck > 1.2) {
        npc.goal = this.npcGoal(w.pos);
        npc.stuck = 0;
        npc.last += 1;
      }
    }
    this.sinceNpcs += dt;
    if (this.sinceNpcs > 0.2) {
      this.sinceNpcs = 0;
      const r2 = (v: number) => Math.round(v * 100) / 100;
      this.out({ t: 'npcs', p: this.npcs.map((x) => [r2(x.w.pos.x), r2(x.w.pos.y), r2(x.w.pos.z), r2(x.w.yaw)]) });
    }
  }

  /**
   * The raccoon lives on the covered balcony and now and then gets into the floor-2 rooms: it knocks things over
   * (noises that sound a lot like a crime) and may run off with a clue lying on view, stashing it on its balcony.
   */
  private tickCoon(dt: number) {
    const n = this.night;
    if (!this.coon) {
      if (n.roam < this.coonAt) return;
      const w = newWalker({ x: 2, y: FLOOR_Y[1], z: 0.8 });
      this.coon = { w, goal: this.npcGoal(w.pos), until: n.roam + 30, stuck: 0, rattle: 3, took: false };
    }
    const c = this.coon;
    if (n.roam > c.until) {
      this.coon = null;
      this.coonAt = n.roam + this.coonGap();
      this.out({ t: 'coon', p: null });
      return;
    }
    const walls = [...SOLIDS, ...DOORS.filter((d) => !this.open.has(d.id) && d.id !== 'balcony').map(doorBox)];
    const dx = c.goal.x - c.w.pos.x;
    const dz = c.goal.z - c.w.pos.z;
    c.w.yaw = Math.atan2(-dx, -dz);
    const before = { ...c.w.pos };
    stepWalker(c.w, { fwd: 0.7, side: 0, jump: false, crouch: false, up: false }, dt, walls);
    c.stuck = Math.hypot(c.w.pos.x - before.x, c.w.pos.z - before.z) < dt * 0.5 ? c.stuck + dt : 0;
    if (Math.hypot(dx, dz) < 0.5 || c.stuck > 1) {
      c.goal = this.npcGoal(c.w.pos);
      c.stuck = 0;
    }
    c.rattle -= dt;
    if (c.rattle < 0) {
      c.rattle = 6 + nextRand(n) * 6;
      this.out({ t: 'fx', k: 'rattle', x: c.w.pos.x, y: c.w.pos.y, z: c.w.pos.z });
    }
    if (!c.took) {
      const clue = n.mystery.clues.find((x) => x.state === 'view' && !x.lock && Math.hypot(x.pos.x - c.w.pos.x, x.pos.z - c.w.pos.z) < 1.2 && Math.abs(x.pos.y - c.w.pos.y) < 1);
      if (clue && nextRand(n) < 0.02) {
        c.took = true;
        clue.state = 'hidden';
        clue.spot = 's-balcony';
        clue.pos = { ...SPOTS.find((s) => s.id === 's-balcony')!.pos };
        this.broadcast(false);
      }
    }
    const r2 = (v: number) => Math.round(v * 100) / 100;
    if (Math.floor(n.roam * 5) !== Math.floor((n.roam - dt) * 5)) this.out({ t: 'coon', p: [r2(c.w.pos.x), r2(c.w.pos.y), r2(c.w.pos.z), r2(c.w.yaw)] });
  }

  /** Seconds until the raccoon's next visit (much sooner in Who Let the Raccoon In). */
  private coonGap() {
    const every = caseById(this.night.caseId).coonEvery;
    return every ? every * (0.7 + nextRand(this.night) * 0.6) : 90 + nextRand(this.night) * 60;
  }

  /** Two-person chores: both ends held for 4 s (or Shota at either end, alone). */
  private tickDuo() {
    const n = this.night;
    for (const [a, b, what] of DUO_PAIRS) {
      if (n.duoDone.includes(a)) continue;
      const ha = this.holding.get(a);
      const hb = this.holding.get(b);
      const shota = (h?: { id: number }) => !!h && playerOf(n, h.id)?.char === 'shota';
      const both = ha && hb && ha.id !== hb.id;
      const since = both ? Math.max(ha.since, hb.since) : shota(ha) ? ha!.since : shota(hb) ? hb!.since : null;
      if (since === null || this.clock - since < 4) continue;
      n.duoDone.push(a);
      const names = [ha, hb].filter((h) => h).map((h) => { const p = playerOf(n, h!.id)!; return tagFor(p.char, p.name); });
      this.holding.delete(a);
      this.holding.delete(b);
      this.out({ t: 'feed', from: 'House', text: `${[...new Set(names)].join(' and ')} ${what}. Teamwork.`, clue: -1 });
      this.out({ t: 'fx', k: 'chore', x: 0, y: 0, z: 0 });
      settle(n);
      this.broadcast(true);
    }
  }

  private victim(id: number | null): [keyof typeof CAST, string] {
    const p = id === null ? undefined : playerOf(this.night, id);
    return p ? [p.char, p.name] : ['guest', 'someone'];
  }

  /** A player dropped out of the room. */
  left(id: number) {
    leave(this.night, id);
    this.poses.delete(id);
    this.broadcast(false);
  }

  handle(from: number, m: Msg) {
    const n = this.night;
    const me = playerOf(n, from);
    if (!me) return;
    const pose = this.poses.get(from);
    switch (m.t) {
      case 'p':
        this.poses.set(from, { x: m.x, y: m.y, z: m.z, f: m.f });
        return;
      case 'door': {
        const d = DOORS.find((x) => x.id === m.id);
        if (!d || !pose || !living(me) || dist(pose, { x: d.x, y: pose.y, z: d.z }) > REACH + 0.6) return;
        // Locked by a sabotage: only JJ's spare keys or Shota's shoulder get through.
        if (lockedDoors(n).includes(d.id) && me.char !== 'jj' && me.char !== 'shota') return this.pw(from, 'Locked. JJ has the spare keys. Or wait it out.');
        if (this.open.has(d.id)) {
          const people = [...this.poses].filter(([id]) => (playerOf(n, id) ? living(playerOf(n, id)!) : false)).map(([, p]) => p);
          if (doorBlocked(d, people)) return;
          this.open.delete(d.id);
        } else this.open.add(d.id);
        this.out({ t: 'doors', open: [...this.open] });
        return;
      }
      case 'shove': {
        const them = this.poses.get(m.to);
        const t = playerOf(n, m.to);
        if (!pose || !them || !t || t === me || !living(me) || !living(t) || (them.f & PF.busy) || (them.f & PF.sit)) return;
        if (this.clock - (this.shovedAt.get(from) ?? -99) < SHOVE.cooldown) return;
        if (dist(pose, them) > SHOVE.range + SHOVE.slack) return;
        this.shovedAt.set(from, this.clock);
        const dx = them.x - pose.x;
        const dz = them.z - pose.z;
        const l = Math.hypot(dx, dz) || 1;
        this.out({ t: 'shoved', id: m.to, x: Math.round((dx / l) * 100) / 100, z: Math.round((dz / l) * 100) / 100 });
        this.out({ t: 'fx', k: 'oof', x: them.x, y: them.y, z: them.z });
        return;
      }
      case 'kill': {
        const them = this.poses.get(m.v);
        if (!pose || !them) return;
        const why = killProblem(n, from, m.v, dist(pose, them));
        if (why === 'guarded') {
          // Wags is looking out: nothing happens, and he hears about it.
          const g = n.powers.guard.get(m.v)!;
          const v = playerOf(n, m.v)!;
          this.pw(g.by, `Someone just tried to take out ${tagFor(v.char, v.name)}! You were looking out.`);
          this.pw(from, `${tagFor(v.char, v.name)} is being looked out for. Not now.`);
          return;
        }
        if (why) return;
        takeOut(n, from, m.v, them);
        // The last 10 s before it, for the reveal.
        this.replays.push({ k: from, v: m.v, f: this.frames.slice(-20).map(([, f]) => f) });
        this.afterCrime(from, them);
        this.out({ t: 'fx', k: 'bonk', x: them.x, y: them.y, z: them.z });
        this.broadcast(false);
        this.privateTo(from);
        return;
      }
      case 'report': {
        const body = n.bodies.find((b) => b.id === m.body);
        if (!pose || !body || meetingProblem(n, from, m.body) || dist(pose, body.pos) > REPORT_RANGE + 0.8) return;
        startMeeting(n, 'body', from, m.body);
        this.out({ t: 'fx', k: 'bell', x: body.pos.x, y: body.pos.y, z: body.pos.z });
        this.broadcast(true);
        return;
      }
      case 'bell': {
        const bell = SPOTS.find((s) => s.kind === 'bell')!;
        if (!pose || meetingProblem(n, from, -1) || dist(pose, bell.pos) > REACH + 1) return;
        startMeeting(n, 'bell', from);
        this.out({ t: 'fx', k: 'bell', x: bell.pos.x, y: bell.pos.y, z: bell.pos.z });
        this.broadcast(true);
        return;
      }
      case 'vote':
        if (castVote(n, from, m.v)) this.broadcast(false);
        return;
      case 'unlock': {
        const c = pose && unlock(n, from, m.id, pose);
        if (c) {
          this.out({ t: 'clue', id: c.id, cat: c.cat, value: c.value, crime: c.crime }, from);
          this.broadcast(false);
        }
        return;
      }
      case 'power':
        return this.power(from, m.target, m.crime);
      case 'sabotage': {
        if (!pose || !startSabotage(n, from, m.kind, floorOf(pose.y + 0.1))) return;
        if (m.kind === 'lock') {
          for (const id of lockedDoors(n)) this.open.delete(id);
          this.out({ t: 'doors', open: [...this.open] });
        }
        this.out({ t: 'feed', from: 'House', text: `⚠ ${SABOTAGES[m.kind].name}! ${SABOTAGES[m.kind].text}`, clue: -1 });
        this.broadcast(true);
        return;
      }
      case 'fix': {
        const s = SPOTS.find((x) => x.id === m.spot);
        if (!pose || !s || dist(pose, s.pos) > REACH + 1.5) return;
        const r = fixSabotage(n, from, m.spot);
        if (!r) return;
        if (r === 'half') return this.pw(from, 'Half done! Someone has to do the other half (the stopcock under the kitchen sink / the toilet) right now.');
        this.out({ t: 'feed', from: 'House', text: r === 'rebooting' ? `${tagFor(me.char, me.name)} rebooted the router. WiFi back in 10 s…` : `${tagFor(me.char, me.name)} fixed it.`, clue: -1 });
        this.broadcast(true);
        return;
      }
      case 'sneak': {
        const s = SPOTS.find((x) => x.id === m.spot && x.kind === 'sneak');
        const to = s?.pair && SPOTS.find((x) => x.id === s.pair);
        if (!pose || !s || !to || me.role !== 'degenerate' || !living(me) || n.phase !== 'night' || dist(pose, s.pos) > REACH + 1.5) return;
        const r = roomAt(to.pos);
        const y = r?.outside && r.surface !== 'porch' ? -0.75 : FLOOR_Y[floorOf(to.pos.y)];
        this.out({ t: 'warp', x: to.pos.x, y, z: to.pos.z }, from);
        // A curtain twitches at both ends.
        for (const e of [s.pos, to.pos]) this.out({ t: 'fx', k: 'rattle', x: e.x, y: e.y - 1, z: e.z });
        return;
      }
      case 'shoo': {
        const c = this.coon;
        if (!c || !pose || !living(me) || dist(pose, c.w.pos) > REACH + 1) return;
        this.coon = null;
        this.coonAt = n.roam + this.coonGap();
        this.out({ t: 'coon', p: null });
        this.out({ t: 'feed', from: 'House', text: `${tagFor(me.char, me.name)} shooed the raccoon back out onto its balcony.`, clue: -1 });
        return;
      }
      case 'duo': {
        const s = SPOTS.find((x) => x.id === m.spot && x.kind === 'duo');
        if (!s) return;
        for (const [k, h] of this.holding) if (h.id === from) this.holding.delete(k);
        if (m.on && pose && living(me) && n.phase === 'night' && dist(pose, s.pos) < REACH + 1.5) this.holding.set(m.spot, { id: from, since: this.clock });
        return;
      }
      case 'ping': {
        if (!pose || !living(me)) return;
        for (const p of n.players) if (p.char === 'shota' && living(p) && p.id !== from) this.out({ t: 'buzz', x: pose.x, y: pose.y, z: pose.z, text: `${tagFor(me.char, me.name)} pinged you. You’re down.` }, p.id);
        return;
      }
      case 'greet': {
        const them = this.poses.get(m.to);
        const t = playerOf(n, m.to);
        if (!pose || !them || !t || !living(me) || !living(t) || dist(pose, them) > SHOVE.range + SHOVE.slack) return;
        const theirs = this.offers.get(m.to);
        if (theirs && theirs[0] === from && theirs[1] === m.k && this.clock - theirs[2] < 3) {
          this.offers.delete(m.to);
          this.out({ t: 'greeted', a: from, b: m.to, k: m.k });
        } else this.offers.set(from, [m.to, m.k, this.clock]);
        return;
      }
      case 'chore': {
        const s = SPOTS.find((x) => x.id === m.spot);
        // The bin bag is done at the wheelie bin, not where it was picked up.
        const at = s?.chore === 'binbag' ? BINBAG_DROP : s?.pos;
        if (!pose || !at || dist(pose, at) > REACH + 1.5 || !doChore(n, from, m.spot)) return;
        this.privateTo(from);
        this.broadcast(false);
        return;
      }
      case 'inspect': {
        const c = pose && inspect(n, from, m.id, pose);
        if (c) this.out({ t: 'clue', id: c.id, cat: c.cat, value: c.value, crime: c.crime }, from);
        return;
      }
      case 'search': {
        if (!pose) return;
        const c = search(n, from, m.spot, pose);
        if (c === false) return;
        this.out({ t: 'found', spot: m.spot, id: c ? c.id : -1 }, from);
        if (c) {
          this.out({ t: 'clue', id: c.id, cat: c.cat, value: c.value, crime: c.crime }, from);
          this.broadcast(false);
        }
        return;
      }
      case 'post': {
        if (wifiDown(n)) return this.pw(from, 'No WiFi. The photo won’t send. (Someone reboot the router.)');
        const c = post(n, from, m.id);
        if (!c) return;
        const crime = n.mystery.crimes[c.crime];
        const about = crime.kind === 'case' ? 'the case' : `${tagFor(...this.victim(crime.victim))}’s takeout`;
        this.out({ t: 'feed', from: tagFor(me.char, me.name), text: `📸 ${ITEM[c.cat]} from ${about}: ${label(c.cat, c.value)}`, clue: c.id });
        this.broadcast(false);
        return;
      }
      case 'plant':
        if (pose && plant(n, from, m.cat, m.value, pose)) {
          this.privateTo(from);
          this.broadcast(false);
        }
        return;
      case 'wipe':
        if (pose && wipe(n, from, m.id, pose)) this.broadcast(false);
        return;
      case 'rattle':
        if (pose && rattle(n, from)) {
          this.out({ t: 'fx', k: 'rattle', x: pose.x, y: pose.y, z: pose.z });
          this.privateTo(from);
        }
        return;
    }
  }
}
