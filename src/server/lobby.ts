import { NET, RESPAWN_SECONDS, SURVIVAL, WEAPON } from '../shared/constants.ts';
import { MAP, type SpawnPoint } from '../shared/map.ts';
import type { ClientMsg, DeathCause, GameMode, NetPlayerState, PlayerInfo, ServerMsg, V3 } from '../shared/protocol.ts';
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
  lobby: Lobby | null;
}

export interface Member {
  client: Client;
  info: PlayerInfo;
  state: NetPlayerState;
  lastShot: number;
  respawnAt: number;
  /** Survival only: zombies claw this down; Battle is one-shot-one-kill. */
  hp: number;
}

// Soft storybook palette: Kiki's bow red, sky blue, mustard, meadow green, lavender, Totoro grey, ...
const COLORS = [0xe0614f, 0x5f9fd6, 0xe8b84a, 0x76ac5a, 0xa98bd1, 0x8d96a3, 0xf2a35e, 0x4fae9f, 0xe58fa8, 0x4a6fa5, 0xb3a24f, 0xf08a6b];

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
  private survival: Survival | null;

  /** `onChange` fires on join/leave and as a heartbeat; `onEmpty` once the last player leaves. */
  constructor(
    readonly code: string,
    readonly mode: GameMode,
    private onChange: (l: Lobby) => void,
    private onEmpty: (l: Lobby) => void,
  ) {
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
    const color = COLORS.find((c) => !used.has(c)) ?? COLORS[client.id % COLORS.length];
    const spawn = this.pickSpawn();
    const m: Member = {
      client,
      info: { id: client.id, name: client.name, color, kills: 0, deaths: 0, alive: true },
      state: { id: client.id, p: spawn.p, v: [0, 0, 0], yaw: spawn.yaw, pitch: 0, f: 0 },
      lastShot: 0,
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
      players: [...this.members.values()].map((x) => x.info),
      spawn,
      wave: this.survival?.info(),
    });
    this.survival?.heal(m);
    this.onChange(this);
  }

  remove(client: Client) {
    if (!this.members.delete(client.id)) return;
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
        if (!m.info.alive) return;
        m.state.p = msg.p;
        m.state.v = msg.v;
        m.state.yaw = msg.yaw;
        m.state.pitch = msg.pitch;
        m.state.f = msg.f;
        return;
      case 'shoot':
        this.onShoot(m, msg);
        return;
      case 'fell':
        if (m.info.alive) this.kill(m, m, 'void', [0, 1, 0]);
        return;
    }
  }

  private onShoot(m: Member, msg: Extract<ClientMsg, { t: 'shoot' }>) {
    const now = Date.now();
    if (!m.info.alive || now - m.lastShot < WEAPON.fireCooldown * 1000 * 0.9) return;
    m.lastShot = now;
    this.broadcast({ t: 'shot', id: m.info.id, from: msg.from, to: msg.to }, m.info.id);

    if (this.survival) {
      if (msg.zombie !== undefined) this.survival.shoot(m, msg); // co-op: no friendly fire
      return;
    }
    if (msg.victim === undefined) return;
    const v = this.members.get(msg.victim);
    if (!v || v === m || !v.info.alive) return;
    // Client-side hit detection ("favour the shooter"); reject hits nowhere near where we last saw the victim.
    const [x, y, z] = v.state.p;
    if (Math.hypot(msg.to[0] - x, msg.to[1] - (y + 1), msg.to[2] - z) > 6) return;
    const dir = sub(msg.to, msg.from);
    this.kill(v, m, msg.headshot ? 'headshot' : 'snipe', dir);
  }

  kill(victim: Member, killer: Member, cause: DeathCause, dir: V3) {
    victim.info.alive = false;
    victim.info.deaths++;
    if (killer !== victim) killer.info.kills++;
    // In Survival you stay down until the round ends.
    victim.respawnAt = this.survival ? Infinity : Date.now() + RESPAWN_SECONDS * 1000;
    const l = Math.hypot(...dir) || 1;
    this.broadcast({ t: 'kill', killer: killer.info.id, victim: victim.info.id, cause, dir: [dir[0] / l, dir[1] / l, dir[2] / l] });
  }

  respawn(m: Member) {
    const spawn = this.pickSpawn();
    m.info.alive = true;
    m.state.p = spawn.p;
    m.state.v = [0, 0, 0];
    m.state.yaw = spawn.yaw;
    this.broadcast({ t: 'respawn', id: m.info.id, p: spawn.p, yaw: spawn.yaw });
  }

  private tick() {
    const now = Date.now();
    if (++this.ticks % (NET.snapshotRate * HEARTBEAT_SECONDS) === 0) this.onChange(this);
    this.survival?.tick(1 / NET.snapshotRate);
    const players: NetPlayerState[] = [];
    for (const m of this.members.values()) {
      if (!m.info.alive && now >= m.respawnAt) this.respawn(m);
      if (m.info.alive) players.push(m.state);
    }
    this.broadcast({ t: 'snapshot', players, zombies: this.survival?.snapshot() });
  }

  /** Spawn point furthest from every living player (Survival: around the Great Tree). */
  private pickSpawn(): { p: V3; yaw: number } {
    const spawns: SpawnPoint[] = this.survival ? MAP.survivalSpawns : MAP.spawns;
    let best = spawns[0];
    let bestDist = -1;
    for (const s of spawns) {
      let nearest = Infinity;
      for (const m of this.members.values()) {
        if (!m.info.alive) continue;
        const [x, , z] = m.state.p;
        nearest = Math.min(nearest, Math.hypot(x - s.pos.x, z - s.pos.z));
      }
      // Jitter so an empty server doesn't always pick the same spot.
      const score = nearest + Math.random() * 5;
      if (score > bestDist) {
        bestDist = score;
        best = s;
      }
    }
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

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export { send };
