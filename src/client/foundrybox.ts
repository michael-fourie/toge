import * as THREE from 'three';
import type { WallBuy } from '../shared/layout.ts';
import type { BoxState } from '../shared/protocol.ts';
import { WEAPONS, WEAPON_IDS, type WeaponId } from '../shared/weapons.ts';
import { signTexture } from './foundrytextures.ts';
import { softDot } from './textures.ts';
import { buildGunDisplay } from './weapon/guns.ts';
import { pbr } from './render/surface.ts';

const solid = (color: number) => pbr({ color });

/** A gun on a wall: a painted plate with its name and price, and the gun itself mounted over it. */
export function buildWallBuy(w: WallBuy, accent: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(w.pos.x, w.pos.y, w.pos.z);
  g.rotation.y = w.yaw;
  const def = WEAPONS[w.weapon];
  const back = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.1), new THREE.MeshBasicMaterial({ color: 0x59636f }));
  back.position.set(0, 0, 0.015);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 0.78),
    new THREE.MeshBasicMaterial({ map: signTexture([def.name.toUpperCase(), `${w.price}`], { w: 460, h: 156, bg: '#262a30', fg: '#f5efd6', border: '#8fe0c8' }), color: 0xcfd6e6 }),
  );
  label.position.set(0, -0.62, 0.02);
  const gun = buildGunDisplay(def.style, accent);
  const k = Math.min(2.0 / (gun.userData.length as number), 3.2);
  gun.scale.setScalar(k);
  gun.position.set(0, 0.34, 0.2);
  g.add(back, label, gun);
  // A thin glowing rail under the plate: the "you can buy this" cue, visible from across the room.
  const rail = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.06), new THREE.MeshBasicMaterial({ color: 0x8fe0c8 }));
  rail.position.set(0, -1.08, 0.02);
  g.add(rail);
  return g;
}

/** A sad little plush bunny: what the Mystery Box gives you instead of a gun, and your points back. */
function plush(): THREE.Group {
  const g = new THREE.Group();
  const fur = solid(0xf1e3d3);
  const pink = solid(0xf0a8b8);
  const ink = new THREE.MeshBasicMaterial({ color: 0x2a2024 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), fur);
  body.scale.set(1, 1.1, 0.9);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), fur);
  head.position.y = 0.42;
  g.add(body, head);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), fur);
    ear.scale.set(0.8, 3.2, 0.5);
    ear.position.set(s * 0.12, 0.8, 0);
    ear.rotation.z = -s * 0.18;
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), pink);
    inner.scale.set(0.7, 3, 0.3);
    inner.position.set(s * 0.12, 0.8, 0.04);
    inner.rotation.z = -s * 0.18;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), ink); // x_x: the box is not sorry
    eye.position.set(s * 0.09, 0.46, 0.22);
    const arm = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), fur);
    arm.scale.set(0.7, 1.4, 0.7);
    arm.position.set(s * 0.32, 0.1, 0.05);
    arm.name = s > 0 ? 'wave' : '';
    g.add(ear, inner, eye, arm);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), pink);
  nose.position.set(0, 0.4, 0.23);
  g.add(nose);
  return g;
}

export interface MysteryBox {
  obj: THREE.Group;
  /** Show the box in `st` at time `time`; `tick` is called each time the spinning gun changes. */
  update(time: number, st: BoxState, tick: () => void): void;
  /** Where the box sits (a spot changed: it pops in there). */
  moveTo(pos: THREE.Vector3, yaw: number): void;
}

/** The Mystery Box: a battered crate with a glowing "?" that opens to a beam of light and a floating gun. */
export function buildMysteryBox(accent: number): MysteryBox {
  const obj = new THREE.Group();
  const wood = solid(0x7d5a38);
  const brass = solid(0xd9a441);
  const dark = solid(0x3a2c20);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = obj) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(1.5, 0.7, 0.9), wood, 0, 0.35, 0);
  for (const x of [-0.7, 0.7]) add(new THREE.BoxGeometry(0.1, 0.72, 0.94), brass, x, 0.35, 0);
  add(new THREE.BoxGeometry(1.52, 0.06, 0.92), dark, 0, 0.03, 0);
  const lid = new THREE.Group();
  lid.position.set(0, 0.7, -0.45);
  obj.add(lid);
  add(new THREE.BoxGeometry(1.5, 0.14, 0.9), wood, 0, 0.07, 0.45, lid);
  for (const x of [-0.7, 0.7]) add(new THREE.BoxGeometry(0.1, 0.16, 0.94), brass, x, 0.07, 0.45, lid);
  const qTex = signTexture(['?'], { w: 128, h: 128, bg: '#0d2430', fg: '#8ff5ee', border: '#8ff5ee' });
  const q = new THREE.MeshBasicMaterial({ map: qTex });
  for (const [x, z, ry] of [[0, 0.455, 0], [0.755, 0, Math.PI / 2], [-0.755, 0, -Math.PI / 2]]) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), q);
    face.position.set(x, 0.36, z);
    face.rotation.y = ry;
    obj.add(face);
  }
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x9ff4ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.7, 7, 14, 1, true), beamMat);
  beam.position.y = 3.9;
  obj.add(beam);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0x9ff4ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  halo.scale.setScalar(3);
  halo.position.y = 0.9;
  obj.add(halo);

  const displays = new Map<WeaponId, THREE.Group>();
  const show = new THREE.Group();
  show.position.y = 1.9;
  obj.add(show);
  const gunOf = (id: WeaponId) => {
    let d = displays.get(id);
    if (!d) {
      d = buildGunDisplay(WEAPONS[id].style, accent);
      d.scale.setScalar(Math.min(1.5 / (d.userData.length as number), 3.2));
      d.visible = false;
      show.add(d);
      displays.set(id, d);
    }
    return d;
  };
  const bunny = plush();
  bunny.visible = false;
  bunny.position.y = -0.2;
  show.add(bunny);

  let shown: WeaponId | null = null;
  let nextFlip = 0;
  let pop = 1;
  let last = 0;
  let spinIdx = 0;
  let openness = 0;
  let wave: THREE.Object3D | undefined;
  bunny.traverse((o) => {
    if (o.name === 'wave') wave = o;
  });

  const showGun = (id: WeaponId | null) => {
    if (shown) gunOf(shown).visible = false;
    shown = id;
    if (id) gunOf(id).visible = true;
  };

  return {
    obj,
    moveTo(pos, yaw) {
      obj.position.copy(pos);
      obj.rotation.y = yaw;
      pop = 0;
    },
    update(time, st, tick) {
      const dt = Math.min(0.1, Math.max(0, time - last));
      last = time;
      pop = Math.min(1, pop + dt * 2.4);
      obj.scale.setScalar(st.phase === 'leaving' && st.left < 0.5 ? Math.max(0.001, st.left * 2) * pop : 0.001 + pop);
      const open = st.phase === 'closed' ? 0 : 1;
      openness += (open - openness) * Math.min(1, dt * 7);
      lid.rotation.x = -1.15 * openness;
      beamMat.opacity = openness * (0.2 + 0.06 * Math.sin(time * 9));
      (halo.material as THREE.SpriteMaterial).opacity = 0.2 + 0.25 * openness + 0.06 * Math.sin(time * 3);
      show.visible = openness > 0.4;
      show.position.y = 1.9 + Math.sin(time * 2.2) * 0.08;
      if (st.phase === 'rolling') {
        if (time >= nextFlip) {
          nextFlip = time + 0.13;
          spinIdx = (spinIdx + 1 + Math.floor(Math.random() * 3)) % WEAPON_IDS.length;
          showGun(WEAPON_IDS[spinIdx]);
          bunny.visible = false;
          tick();
        }
        show.rotation.y = time * 3;
      } else if (st.phase === 'ready' || st.phase === 'leaving') {
        const plushed = st.gun === null;
        bunny.visible = plushed;
        showGun(plushed ? null : st.gun);
        show.rotation.y = plushed ? Math.sin(time * 5) * 0.4 : time * 1.4;
        if (wave) wave.rotation.z = -0.9 + Math.sin(time * 9) * 0.5;
      } else {
        showGun(null);
        bunny.visible = false;
      }
    },
  };
}
