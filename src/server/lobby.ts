import { GRENADE, KNIFE, MOVE, NET, RESPAWN_SECONDS, SURVIVAL, WEAPON } from '../shared/constants.ts';
import { blastTargets } from '../shared/grenade.ts';
import type { MapData } from '../shared/map.ts';
import { mapFor } from '../shared/maps.ts';
import type { BattleMap, ClientMsg, DeathCause, GameMode, NetPlayerState, PlayerInfo, ServerMsg, V3 } from '../shared/protocol.ts';
import { type Gear, encodeGear } from '../shared/items.ts';
import { JACKETS, type Skin, encodeSkin } from '../shared/skin.ts';
import { RECENT_SPAWNS, pickSpawn } from '../shared/spawn.ts';
import { type KothState, inZone, newKoth, stepKoth } from '../shared/koth.ts';
import { KILL_LIMIT, MATCH_OVER_SECONDS, TEAMS, type Team, sameTeam, shuffleTeams, smallerTeam, winner } from '../shared/teams.ts';
import { Survival } from './survival.ts';

/** The slice of a WebSocket the lobby needs (satisfied by the Workers WebSocket). */
export interface Socket {
  readonly readyState: number;
  send(data: string): void;
}
const OPEN = 1;

export interface Client {
  id: number;
  ws: Socket;
  name: string;
  /** Chosen look; relayed to everyone. Its `jacket` is a colour preference, honoured when free. */
  skin?: Skin;
  gear?: Gear;
  lobby: Lobby | null;
}

export interface Member {
  client: Client;
  info: PlayerInfo;
  state: NetPlayerState;
  lastShot: number;
  /** When this player last threw a grenade, and the one still in flight (if any) for validating its blast. */
  nadeAt: number;
  nadeOut: { p: V3; t: number } | null;
  respawnAt: number;
  /** Survival only: zombies claw this down; Battle is one-shot-one-kill. */
  hp: number;
}

// Soft storybook palette: Kiki's bow red, sky blue, mustard, meadow green, lavender, Totoro grey, ...
const COLORS = JACKETS;

/** How often a live lobby re-announces itself so the directory can expire dead ones. */
export const HEARTBEAT_SECONDS = 30;

const send = (c: Client, msg: ServerMsg) => {
  if (c.ws.readyState === OPEN) c.ws.send(JSON.stringify(msg));
};

/**
 * A lobby is one running match. The prototype trusts clients for their own movement
 * (sim is shared code, so moving to server-authoritative + prediction later is a contained change)
 * and does light sanity checks on hits.
 */
export class Lobby {
  readonly members = new Map<number, Member>();
  hostId = 0;
  private timer: ReturnType<typeof setInterval>;
  private ticks = 0;
  private recentSpawns: number[] = [];
  private survival: Survival | null;
  /** Battle: set once someone reaches the kill limit; the next match starts when it passes. */
  private overAt = 0;
  private readonly data: MapData;
  /** King of the Hill: the hill's state, stepped every tick and sent with each snapshot. */
  private hill: KothState | null;

  /** `onChange` fires on join/leave and as a heartbeat; `onEmpty` once the last player leaves. */
  constructor(
    readonly code: string,
    readonly mode: GameMode,
    /** Battle only: two teams instead of free-for-all. */
    readonly teams: boolean,
    /** Battle: which arena. */
    readonly map: BattleMap,
    private onChange: (l: Lobby) => void,
    private onEmpty: (l: Lobby) => void,
    /** Battle teams: King of the Hill on Crown instead of a kill race (the room forces `teams` on for it). */
    readonly koth = false,
  ) {
    this.data = mapFor(mode, map, koth);
    this.hill = koth ? newKoth() : null;
    this.survival = mode === 'survival' ? new Survival(this) : null;
    this.timer = setInterval(() => this.tick(), 1000 / NET.snapshotRate);
  }

  get hostName() {
    return this.members.get(this.hostId)?.info.name ?? '?';
  }

  get full() {
    return this.members.size >= NET.maxPlayersPerLobby;
  }

  add(client: Client) {
    const used = new Set([...this.members.values()].map((m) => m.info.color));
    const wanted = client.skin?.jacket === undefined ? undefined : COLORS[client.skin.jacket];
    const color = wanted !== undefined && !used.has(wanted) ? wanted : (COLORS.find((c) => !used.has(c)) ?? COLORS[client.id % COLORS.length]);
    const team = this.teams ? smallerTeam([...this.members.values()].map((x) => x.info)) : undefined;
    const spawn = this.pickSpawn(team);
    const m: Member = {
      client,
      info: { id: client.id, name: client.name, color: team === undefined ? color : TEAMS[team].color, kills: 0, deaths: 0, alive: true, team, skin: client.skin && encodeSkin(client.skin), gear: client.gear && encodeGear(client.gear) },
      state: { id: client.id, p: spawn.p, v: [0, 0, 0], yaw: spawn.yaw, pitch: 0, f: 0 },
      lastShot: 0,
      nadeAt: 0,
      nadeOut: null,
      respawnAt: 0,
      hp: SURVIVAL.playerHp,
    };
    if (this.members.size === 0) this.hostId = client.id;
    this.broadcast({ t: 'playerJoined', player: m.info });
    this.members.set(client.id, m);
    client.lobby = this;
    send(client, {
      t: 'joined',
      code: this.code,
      mode: this.mode,
      hostId: this.hostId,
      teams: this.teams || undefined,
      map: this.mode === 'battle' && !this.koth ? this.map : undefined,
      koth: this.koth || undefined,
      players: [...this.members.values()].map((x) => x.info),
      spawn,
      wave: this.survival?.info(),
    });
    this.survival?.heal(m);
    this.onChange(this);
  }

  remove(client: Client) {
    if (!this.members.delete(client.id)) return;
    this.survival?.left(client.id);
    this.survival?.forget(client.id);
    client.lobby = null;
    if (this.members.size === 0) {
      clearInterval(this.timer);
      this.onEmpty(this);
      return;
    }
    if (this.hostId === client.id) this.hostId = this.members.keys().next().value!;
    this.broadcast({ t: 'playerLeft', id: client.id, hostId: this.hostId });
    this.onChange(this);
  }

  handle(client: Client, msg: ClientMsg) {
    const m = this.members.get(client.id);
    if (!m) return;
    switch (msg.t) {
      case 'state':
        if (!m.info.alive || this.survival?.isDown(client.id)) return; // the downed stay where they fell
        m.state.p = msg.p;
        m.state.v = msg.v;
        m.state.yaw = msg.yaw;
        m.state.pitch = msg.pitch;
        m.state.f = msg.f;
        m.state.g = validAnchor(msg.g, msg.p);
        return;
      case 'shoot':
        this.onShoot(m, msg);
        return;
      case 'team':
        if (this.teams && (msg.team === 0 || msg.team === 1)) this.setTeams(new Map([[client.id, msg.team]]));
        return;
      case 'shuffle':
        if (this.teams && client.id === this.hostId) this.setTeams(shuffleTeams([...this.members.keys()]));
        return;
      case 'again':
        this.survival?.again(m);
        return;
      case 'use':
        this.survival?.use(m, msg);
        return;
      case 'equip':
        this.survival?.equip(m, msg.slot);
        return;
      case 'nade':
        this.onNade(m, msg);
        return;
      case 'boom':
        this.onBoom(m, msg.p);
        return;
      case 'fell':
        if (m.info.alive) this.kill(m, m, 'void', [0, 1, 0]);
        return;
    }
  }

  /** Moves players to the given sides (their colour follows) and tells everyone. */
  private setTeams(sides: Map<number, Team>) {
    const changed: { id: number; team: Team; color: number }[] = [];
    for (const [id, team] of sides) {
      const m = this.members.get(id);
      if (!m) continue;
      m.info.team = team;
      m.info.color = TEAMS[team].color;
      changed.push({ id, team, color: m.info.color });
    }
    if (changed.length) this.broadcast({ t: 'teams', players: changed });
  }

  /** A grenade leaves a hand: rate limit, remember it for validating the blast, show it to everyone else. */
  private onNade(m: Member, msg: Extract<ClientMsg, { t: 'nade' }>) {
    const now = Date.now();
    if (!m.info.alive || now - m.nadeAt < GRENADE.cooldown * 1000 * 0.9) return;
    if (!finite3(msg.p) || !finite3(msg.v) || Math.hypot(...msg.v) > MOVE.maxSpeed + GRENADE.throwSpeed + 10) return;
    m.nadeAt = now;
    m.nadeOut = { p: msg.p, t: now };
    this.broadcast({ t: 'nade', id: m.info.id, p: msg.p, v: msg.v }, m.info.id);
  }

  /** The thrower's client reports where its grenade went off; we only trust it for the one we saw thrown. */
  private onBoom(m: Member, p: V3) {
    const out = m.nadeOut;
    if (!out || !finite3(p)) return;
    const age = Date.now() - out.t;
    if (age < 300 || age > (GRENADE.fuse + 4) * 1000) return;
    if (Math.hypot(p[0] - out.p[0], p[1] - out.p[1], p[2] - out.p[2]) > 120) return;
    m.nadeOut = null;
    this.broadcast({ t: 'blast', id: m.info.id, p });
    const center = { x: p[0], y: p[1], z: p[2] };
    if (this.survival) return this.survival.blast(m, center);
    const targets = [...this.members.values()].filter((v) => v !== m && v.info.alive && !sameTeam(v.info, m.info)).map((v) => ({ id: v.info.id, pos: { x: v.state.p[0], y: v.state.p[1], z: v.state.p[2] } }));
    for (const id of blastTargets(center, targets, this.data.boxes)) {
      const v = this.members.get(id)!;
      this.kill(v, m, 'grenade', [v.state.p[0] - p[0], v.state.p[1] + 1 - p[1] + 0.8, v.state.p[2] - p[2]]);
    }
  }

  private onShoot(m: Member, msg: Extract<ClientMsg, { t: 'shoot' }>) {
    const now = Date.now();
    const cooldown = msg.knife ? KNIFE.cooldown : this.survival ? this.survival.fireCooldown(m) : WEAPON.fireCooldown; // each gun has its own rate of fire
    if (!m.info.alive || now - m.lastShot < cooldown * 1000 * 0.9) return;
    m.lastShot = now;
    // A stab is silent to everyone else and must be within arm's reach (plus a little for lag).
    if (msg.knife && Math.hypot(...sub(msg.to, msg.from)) > KNIFE.range + 1) return;
    if (!msg.knife) this.broadcast({ t: 'shot', id: m.info.id, from: msg.from, to: msg.to, ...this.survival?.shotLook(m) }, m.info.id);

    if (this.survival) {
      this.survival.shoot(m, msg); // co-op: no friendly fire
      return;
    }
    if (msg.victim === undefined) return;
    const v = this.members.get(msg.victim);
    if (!v || v === m || !v.info.alive || sameTeam(v.info, m.info)) return;
    // Client-side hit detection ("favour the shooter"); reject hits nowhere near where we last saw the victim.
    const [x, y, z] = v.state.p;
    if (Math.hypot(msg.to[0] - x, msg.to[1] - (y + 1), msg.to[2] - z) > 6) return;
    const dir = sub(msg.to, msg.from);
    this.kill(v, m, msg.knife ? 'knife' : msg.headshot ? 'headshot' : 'snipe', dir);
  }

  kill(victim: Member, killer: Member, cause: DeathCause, dir: V3) {
    if (this.overAt) return; // the match is decided: the scores are final
    victim.info.alive = false;
    victim.info.deaths++;
    if (killer !== victim) killer.info.kills++;
    // In Survival you stay down until the round ends.
    victim.respawnAt = this.survival ? Infinity : Date.now() + RESPAWN_SECONDS * 1000;
    const l = Math.hypot(...dir) || 1;
    this.broadcast({ t: 'kill', killer: killer.info.id, victim: victim.info.id, cause, dir: [dir[0] / l, dir[1] / l, dir[2] / l] });
    if (!this.survival && !this.hill) this.checkWinner(); // King of the Hill is won on the hill, not by kills
  }

  private checkWinner() {
    const infos = [...this.members.values()].map((m) => m.info);
    const won = winner(infos, this.teams, KILL_LIMIT);
    if (!won) return;
    this.overAt = Date.now() + MATCH_OVER_SECONDS * 1000;
    this.broadcast({ t: 'matchOver', winner: won, players: infos, restartIn: MATCH_OVER_SECONDS });
  }

  /** Zero the scores and put everyone back on the map. */
  private startMatch() {
    this.overAt = 0;
    if (this.hill) this.hill = newKoth();
    for (const m of this.members.values()) {
      m.info.kills = 0;
      m.info.deaths = 0;
    }
    this.broadcast({ t: 'matchStart', players: [...this.members.values()].map((m) => m.info) });
    for (const m of this.members.values()) this.respawn(m);
  }

  respawn(m: Member) {
    const spawn = this.pickSpawn(m.info.team);
    m.info.alive = true;
    m.state.p = spawn.p;
    m.state.v = [0, 0, 0];
    m.state.yaw = spawn.yaw;
    m.state.g = undefined;
    this.broadcast({ t: 'respawn', id: m.info.id, p: spawn.p, yaw: spawn.yaw });
  }

  private tick() {
    const now = Date.now();
    if (++this.ticks % (NET.snapshotRate * HEARTBEAT_SECONDS) === 0) this.onChange(this);
    this.survival?.tick(1 / NET.snapshotRate);
    if (this.overAt && now >= this.overAt) this.startMatch();
    const players: NetPlayerState[] = [];
    for (const m of this.members.values()) {
      if (!m.info.alive && now >= m.respawnAt) this.respawn(m);
      if (m.info.alive) players.push(m.state);
    }
    if (this.hill && !this.overAt) this.stepHill(1 / NET.snapshotRate);
    this.broadcast({ t: 'snapshot', players, zombies: this.survival?.snapshot(), koth: this.hill ?? undefined });
  }

  /** King of the Hill: count who's standing on it (living players, by team) and run the rules; a full clock ends the match. */
  private stepHill(dt: number) {
    const zone = this.data.koth!.zone;
    const on: [number, number] = [0, 0];
    for (const m of this.members.values()) {
      if (!m.info.alive || m.info.team === undefined) continue;
      if (inZone(zone, { x: m.state.p[0], y: m.state.p[1], z: m.state.p[2] })) on[m.info.team]++;
    }
    const ev = stepKoth(this.hill!, on, dt);
    if (ev.won === undefined) return;
    this.overAt = Date.now() + MATCH_OVER_SECONDS * 1000;
    this.broadcast({ t: 'matchOver', winner: { team: ev.won }, players: [...this.members.values()].map((m) => m.info), restartIn: MATCH_OVER_SECONDS });
  }

  /**
   * Battle: a random good spot from across the map (spawn.ts). King of the Hill: your own team's base.
   * Survival: the Office, spread out among whoever is already up.
   */
  private pickSpawn(team?: Team): { p: V3; yaw: number } {
    const living = [...this.members.values()].filter((m) => m.info.alive);
    const bases = this.data.koth?.teamSpawns;
    if (bases && team !== undefined) {
      const enemies = living.filter((m) => m.info.team !== team).map((m) => ({ x: m.state.p[0], y: m.state.p[1], z: m.state.p[2] }));
      const s = bases[team][pickSpawn(bases[team], enemies, [], this.data.boxes)];
      return { p: [s.pos.x, s.pos.y, s.pos.z], yaw: s.yaw };
    }
    if (this.survival) {
      const starts = this.data.spawns;
      let best = starts[0];
      let bestDist = -1;
      for (const s of starts) {
        const nearest = Math.min(Infinity, ...living.map((m) => Math.hypot(m.state.p[0] - s.pos.x, m.state.p[2] - s.pos.z)));
        const score = nearest + Math.random() * 3;
        if (score > bestDist) {
          bestDist = score;
          best = s;
        }
      }
      return { p: [best.pos.x, best.pos.y, best.pos.z], yaw: best.yaw };
    }
    const enemies = living.map((m) => ({ x: m.state.p[0], y: m.state.p[1], z: m.state.p[2] }));
    const i = pickSpawn(this.data.spawns, enemies, this.recentSpawns, this.data.boxes);
    this.recentSpawns.push(i);
    if (this.recentSpawns.length > RECENT_SPAWNS) this.recentSpawns.shift();
    const best = this.data.spawns[i];
    return { p: [best.pos.x, best.pos.y, best.pos.z], yaw: best.yaw };
  }

  sendTo(m: Member, msg: ServerMsg) {
    send(m.client, msg);
  }

  broadcast(msg: ServerMsg, except?: number) {
    const data = JSON.stringify(msg);
    for (const m of this.members.values()) {
      if (m.info.id !== except && m.client.ws.readyState === OPEN) m.client.ws.send(data);
    }
  }
}

const finite3 = (v: unknown): v is V3 => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

/** A grapple anchor is only relayed if it's a real point within rope reach of the player. */
function validAnchor(g: V3 | undefined, p: V3): V3 | undefined {
  if (!Array.isArray(g) || g.length !== 3 || !g.every(Number.isFinite)) return undefined;
  return Math.hypot(g[0] - p[0], g[1] - p[1], g[2] - p[2]) <= MOVE.grappleRange * 1.5 ? g : undefined;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export { send };
