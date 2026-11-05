import * as THREE from 'three';
import type { V3 } from '../shared/protocol.ts';

/** Seconds before it fades that a drop starts blinking. */
const BLINK = 6;

interface Drop {
  group: THREE.Group;
  until: number;
}

/**
 * Survival's Max Ammo drops on the client: a chunky ammo crate that spins and bobs over the floor in a green glow,
 * blinking when it's about to fade. The server says where they are and who grabbed one; this only draws them.
 */
export class Drops {
  private drops = new Map<number, Drop>();
  private label = labelTexture();

  constructor(private scene: THREE.Scene) {}

  add(id: number, p: V3, life: number, now: number) {
    this.remove(id);
    const group = new THREE.Group();
    group.position.set(p[0], p[1], p[2]);
    const crate = new THREE.Group();
    crate.name = 'crate';
    const wood = new THREE.MeshBasicMaterial({ color: 0x5e7d3a });
    const trim = new THREE.MeshBasicMaterial({ color: 0xffd45a });
    crate.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.36, 0.38), wood));
    for (const x of [-0.24, 0.24]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.38, 0.4), trim);
      band.position.x = x;
      crate.add(band);
    }
    // Three brass rounds standing on the lid.
    for (const x of [-0.1, 0, 0.1]) {
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), trim);
      shell.position.set(x, 0.28, 0);
      crate.add(shell);
    }
    crate.position.y = 0.9;
    group.add(crate);
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.7, 2.2, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    glow.position.y = 1.1;
    group.add(glow);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.label, transparent: true, depthWrite: false }));
    tag.scale.set(1.6, 0.4, 1);
    tag.position.y = 1.75;
    group.add(tag);
    this.scene.add(group);
    this.drops.set(id, { group, until: now + life });
  }

  remove(id: number) {
    const d = this.drops.get(id);
    if (!d) return;
    this.scene.remove(d.group);
    d.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.drops.delete(id);
  }

  update(now: number) {
    for (const d of this.drops.values()) {
      const crate = d.group.getObjectByName('crate')!;
      crate.rotation.y = now * 2;
      crate.position.y = 0.9 + Math.sin(now * 3) * 0.12;
      const left = d.until - now;
      d.group.visible = left > BLINK || Math.floor(now * (left < 2 ? 10 : 5)) % 2 === 0;
    }
  }

  dispose() {
    for (const id of [...this.drops.keys()]) this.remove(id);
    this.label.dispose();
  }
}

/** "MAX AMMO" in chunky letters for the tag over the crate. */
function labelTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '900 40px Manrope, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = '#1f3a1c';
  g.strokeText('MAX AMMO', 128, 34);
  g.fillStyle = '#b8ff9a';
  g.fillText('MAX AMMO', 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
