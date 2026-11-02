import * as THREE from 'three';
import { BOSS, NET } from '../shared/constants.ts';
import { lerp } from '../../shared/math.ts';
import { type NetZombie, ZombieFlag } from '../shared/protocol.ts';
import { MOD, type ModId } from '../shared/modifiers.ts';
import { Avatar, type Corpses } from './avatar.ts';
import { JOB_COAT, dressJob } from './jobwear.ts';

/** Raggedy jacket colours; the look (hair, outfit) is seeded from these, so a few distinct zombies. */
const RAGS = [0x6f7d5c, 0x7d6a8f, 0x8f6f5a, 0x5a6f7d, 0x8a8456, 0x6d5a5a];
/** The boss wears the foreman's oxblood coat, so it reads at a glance. */
const BOSS_COAT = 0x7a2a26;

interface ZombieView {
  id: number;
  avatar: Avatar;
  buffer: { t: number; z: NetZombie }[];
  /** As rendered this frame: what the local player sees and shoots at. */
  pos: THREE.Vector3;
  yaw: number;
  /** Drawn (and hit-tested) this much bigger: BOSS.scale for the boss, else 1. */
  scale: number;
  /** Head size (and head hitbox) over normal: Big Heads rounds. */
  head: number;
  /** Bosses: health left, 0..1. */
  hp: number;
}

/** Survival zombies on the client: server snapshots in, interpolated avatars out (100 ms behind, like remotes). */
export class Horde {
  readonly zombies = new Map<number, ZombieView>();
  /** A boss just broke in. */
  onBoss?: () => void;
  /** The round's modifier: zombies that turn up during Shrink Ray are small, during Big Heads big-headed. */
  mod: ModId | null = null;

  constructor(private scene: THREE.Scene) {}

  onSnapshot(list: NetZombie[], now: number) {
    const seen = new Set<number>();
    for (const z of list) {
      seen.add(z.id);
      let v = this.zombies.get(z.id);
      if (!v) {
        const boss = (z.f & ZombieFlag.Boss) !== 0;
        const avatar = new Avatar(boss ? BOSS_COAT : z.j ? JOB_COAT[z.j] : RAGS[z.id % RAGS.length], undefined, true);
        if (z.j) dressJob(avatar, z.j);
        const scale = boss ? BOSS.scale : this.mod === 'tiny' ? MOD.tinyScale : 1;
        const head = !boss && this.mod === 'bighead' ? MOD.bigHead : 1;
        avatar.root.scale.setScalar(scale);
        avatar.head.scale.setScalar(head);
        avatar.root.visible = false; // until the first interpolated pose
        this.scene.add(avatar.root);
        v = { id: z.id, avatar, buffer: [], pos: new THREE.Vector3(...z.p), yaw: z.yaw, scale, head, hp: 1 };
        this.zombies.set(z.id, v);
        if (boss) this.onBoss?.();
      }
      if (z.hp !== undefined) v.hp = z.hp;
      v.buffer.push({ t: now, z });
    }
    // Gone without a death message (a game over reset): just remove.
    for (const id of this.zombies.keys()) if (!seen.has(id)) this.remove(id);
  }

  update(time: number) {
    const renderT = performance.now() - NET.interpDelayMs;
    for (const v of this.zombies.values()) {
      const buf = v.buffer;
      while (buf.length > 2 && buf[1].t <= renderT) buf.shift();
      if (!buf.length) continue;
      let a = buf[0];
      const b = buf[buf.length > 1 ? 1 : 0];
      if (renderT >= b.t) a = b;
      const k = b.t > a.t ? Math.min(1, Math.max(0, (renderT - a.t) / (b.t - a.t))) : 1;
      v.pos.set(lerp(a.z.p[0], b.z.p[0], k), lerp(a.z.p[1], b.z.p[1], k), lerp(a.z.p[2], b.z.p[2], k));
      v.yaw = b.z.yaw;
      v.avatar.root.visible = true;
      v.avatar.poseZombie(v.pos.x, v.pos.y, v.pos.z, v.yaw, time, (b.z.f & ZombieFlag.Crouching) !== 0, (b.z.f & ZombieFlag.Clawing) !== 0);
    }
  }

  /** Shot dead: fling the body like any other corpse. */
  kill(id: number, dir: THREE.Vector3, headshot: boolean, corpses: Corpses) {
    const v = this.zombies.get(id);
    if (!v) return;
    corpses.spawn(v.avatar.cloneBody(), v.pos.clone(), v.yaw, dir, headshot ? 38 : 26).obj.scale.setScalar(v.scale);
    this.remove(id);
  }

  /** The boss's health (0..1), or null when no boss is up. */
  bossHp(): number | null {
    for (const v of this.zombies.values()) if (v.scale > 1) return v.hp;
    return null;
  }

  /** Distance to the closest zombie (for groans), or Infinity. */
  nearest(p: THREE.Vector3): number {
    let best = Infinity;
    for (const v of this.zombies.values()) best = Math.min(best, v.pos.distanceTo(p));
    return best;
  }

  private remove(id: number) {
    this.zombies.get(id)?.avatar.dispose();
    this.zombies.delete(id);
  }

  dispose() {
    for (const id of [...this.zombies.keys()]) this.remove(id);
  }
}
