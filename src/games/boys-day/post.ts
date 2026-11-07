// How the frame is drawn: straight to the screen, or ("fancy", the default) through a bloom pass so the headlights,
// lamps, lit windows, jack-o'-lanterns and the zombies' eyes glow in the fog, with the moon casting shadows round the
// bus. The choice is per browser (the pause menu), for laptops that can't keep up.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export const BLOOM = { strength: 0.55, radius: 0.45, threshold: 0.82 } as const;
const KEY = 'boys-day.fancy';

export function loadFancy() {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export class Post {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  fancy = loadFancy();

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    renderer.shadowMap.enabled = this.fancy;
    renderer.shadowMap.type = THREE.PCFShadowMap;
  }

  /** Flip fancy on or off (every lit material recompiles once, which is fine from the pause menu). */
  setFancy(on: boolean) {
    this.fancy = on;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      /* private mode: just this run */
    }
    this.renderer.shadowMap.enabled = on;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
    });
  }

  setSize(w: number, h: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render() {
    if (this.fancy) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.bloom.dispose();
    this.composer.dispose();
  }
}
