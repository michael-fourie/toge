// The host's referee: rules.ts plus what the host hears (everyone's latest pose) and owns (doors). It checks every
// request (phase, role, range, cooldown), updates the night and answers: public messages to everyone, private ones
// to one player. Secrets (roles, who's a Degenerate) only ever leave in private messages, or at the reveal.

import { CAST, tagFor } from './cast.ts';
import { ITEM, inspect, label, plant, post, search, wipe } from './clues.ts';
import { DOORS, REACH, SPOTS, doorBox, type Door } from './house.ts';
import type { Msg } from './net.ts';
import {
  REPORT_RANGE,
  castVote,
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
        if (!pose || !them || killProblem(n, from, m.v, dist(pose, them))) return;
        takeOut(n, from, m.v, them);
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
      case 'chore': {
        const s = SPOTS.find((x) => x.id === m.spot);
        if (!pose || !s || dist(pose, s.pos) > REACH + 1.5 || !doChore(n, from, m.spot)) return;
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
