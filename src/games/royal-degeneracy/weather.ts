// The night's weather: a steady drizzle round the house. Short streaks fall through the yards, the side passages
// and the street, stop at the roof, and never fall indoors (the covered balcony and the porch stay dry). Seen
// through every window; night.ts plays the patter (louder outside, a drum on the roof upstairs).

import * as THREE from 'three';
import { DEPTH, GROUND, WIDTH } from './house.ts';

const COUNT = 1400;
const STREAK = 0.28;
const FALL = 7;
/** Where it rains: a box round the house. */
const AREA = { x0: -7, x1: WIDTH + 7, z0: -10, z1: DEPTH + 10, top: 10 };
/** The roof's height over the house (drops that reach it there are done). */
const ROOF = 8.6;

/** Under the house, the covered balcony or the porch roof: no rain gets here. */
function covered(x: number, z: number) {
  if (x > -0.2 && x < WIDTH + 0.2 && z > -0.2 && z < DEPTH + 0.2) return true;
  if (x > -0.1 && x < 4.1 && z > -3.3 && z < 0) return true;
  return x > -0.1 && x < 4.5 && z > DEPTH && z < DEPTH + 2.3;
}

export class Rain {
  readonly mesh: THREE.LineSegments;
  private pos: Float32Array;

  constructor() {
    this.pos = new Float32Array(COUNT * 6);
    for (let i = 0; i < COUNT; i++) this.drop(i, AREA.top * Math.random());
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9fb2dc, transparent: true, opacity: 0.38 }));
    this.mesh.frustumCulled = false;
  }

  /** A drop starts at height y somewhere in the area. */
  private drop(i: number, y: number) {
    const x = AREA.x0 + Math.random() * (AREA.x1 - AREA.x0);
    const z = AREA.z0 + Math.random() * (AREA.z1 - AREA.z0);
    const p = this.pos;
    const k = i * 6;
    p[k] = p[k + 3] = x + 0.02;
    p[k + 2] = p[k + 5] = z;
    p[k + 1] = y;
    p[k + 4] = y + STREAK;
  }

  update(dt: number) {
    const p = this.pos;
    for (let i = 0; i < COUNT; i++) {
      const k = i * 6;
      const y = p[k + 1] - FALL * dt;
      // A little slant in the wind.
      p[k] += 0.4 * dt;
      p[k + 3] += 0.4 * dt;
      if (y < GROUND || (y < ROOF && covered(p[k], p[k + 2]))) this.drop(i, AREA.top - Math.random() * 0.5);
      else {
        p[k + 1] = y;
        p[k + 4] = y + STREAK;
      }
    }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
