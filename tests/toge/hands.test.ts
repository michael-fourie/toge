import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { gripClips } from '../../src/toge/client/hands.ts';
import { RIDER_IDS } from '../../src/toge/shared/rider.ts';

/** A driver's GLB without its textures (node has no image decoder; the rig and clips are all this needs). */
function load(id: string): Promise<GLTF> {
  const b = readFileSync(new URL(`../../public/models/drivers/${id}.glb`, import.meta.url));
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.toString('utf8', 20, 20 + len));
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    for (const k of Object.keys(m)) if (/Texture$/.test(k)) delete m[k];
    if (m.pbrMetallicRoughness) for (const k of Object.keys(m.pbrMetallicRoughness)) if (/Texture$/.test(k)) delete m.pbrMetallicRoughness[k];
    delete m.extensions;
  }
  json.extensionsUsed = (json.extensionsUsed ?? []).filter((e: string) => !/texture/i.test(e));
  json.extensionsRequired = (json.extensionsRequired ?? []).filter((e: string) => !/texture/i.test(e));
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const bin = b.subarray(20 + len);
  const head = Buffer.alloc(20);
  head.write('glTF', 0, 'ascii');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + text.length + bin.length, 8);
  head.writeUInt32LE(text.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  const glb = Buffer.concat([head, text, bin]);
  return new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
}

const at = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);

/** Poses a clone with `clip` at `t` and hands back its bones. */
function pose(g: GLTF, clips: THREE.AnimationClip[], name: string, t: number) {
  const scene = cloneSkinned(g.scene);
  const mixer = new THREE.AnimationMixer(scene);
  const a = mixer.clipAction(THREE.AnimationClip.findByName(clips, name)!);
  a.play();
  a.paused = true;
  a.time = t;
  mixer.update(0);
  scene.updateMatrixWorld(true);
  const bones = new Map<string, THREE.Object3D>();
  scene.traverse((o) => bones.set(o.name, o));
  return (n: string) => bones.get(n)!;
}

test('drivers hold the wheel: hands on the rim, fingers closed round it, at every steering angle', async () => {
  for (const id of RIDER_IDS) {
    const g = await load(id);
    const clips = gripClips(g.scene, g.animations);
    const drive = THREE.AnimationClip.findByName(clips, 'drive')!;
    // The rim's radius: the wheel's outermost vertices, in its bone's plane (the axis is the bone's Y).
    let rim = 0;
    const s0 = cloneSkinned(g.scene);
    s0.updateMatrixWorld(true);
    s0.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !/^wheel_/.test(m.name)) return;
      const i = m.skeleton.bones.findIndex((b) => b.name === 'wheel');
      const toBone = m.skeleton.boneInverses[i].clone().multiply(m.bindMatrix);
      const p = m.geometry.getAttribute('position');
      for (let j = 0; j < p.count; j++) {
        const x = new THREE.Vector3().fromBufferAttribute(p, j).applyMatrix4(toBone);
        rim = Math.max(rim, Math.hypot(x.x, x.z));
      }
    });
    assert.ok(rim > 0.12, `${id}: wheel found`);
    for (const k of [0, 4, 8, 12, 16]) {
      const bone = pose(g, clips, 'drive', (k / 16) * drive.duration);
      const toWheel = bone('wheel').matrixWorld.clone().invert();
      for (const s of ['l', 'r']) {
        const f = (n: string) => at(bone(`${n}_${s}`)).applyMatrix4(toWheel);
        // The rim's centre line by the middle finger, and whether the finger goes round it: the knuckle and the
        // fingertip joint sit on opposite sides of it, the middle joint close to it. A fist beside the rim (what the
        // baked clips had) has all three on one side.
        const kn = f('middle_01'), mid = f('middle_02'), tip = f('middle_03');
        const flat = new THREE.Vector3(mid.x, 0, mid.z).setLength(rim - 0.015);
        const round = kn.clone().sub(flat).angleTo(tip.clone().sub(flat));
        const near = mid.distanceTo(flat);
        // The wrist stays out by the rim, behind it, as in a real hold at quarter to three: the baked clips had it
        // in toward the hub, the hand lying over the rim from inside the wheel.
        const wrist = f('hand');
        const out = Math.hypot(wrist.x, wrist.z) - (rim - 0.015);
        assert.ok(out > -0.04, `${id} ${s} key ${k}: the wrist is ${(-out).toFixed(3)} m inside the rim`);
        assert.ok(round > 1.75, `${id} ${s} key ${k}: the fingers don't go round the rim (${round.toFixed(2)} rad)`);
        assert.ok(near < 0.04, `${id} ${s} key ${k}: the hand is ${near.toFixed(3)} m off the rim`);
      }
    }
  }
});

test('the fixed clips keep their names and lengths, and are computed once per model', async () => {
  const g = await load(RIDER_IDS[0]);
  const clips = gripClips(g.scene, g.animations);
  assert.deepEqual(clips.map((c) => c.name).sort(), g.animations.map((c) => c.name).sort());
  for (const c of clips) assert.equal(c.duration, THREE.AnimationClip.findByName(g.animations, c.name)!.duration);
  assert.equal(gripClips(g.scene, g.animations), clips);
});
