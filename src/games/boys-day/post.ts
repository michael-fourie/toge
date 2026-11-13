// How the frame is drawn: straight to the screen, or ("fancy", the default) through a bloom pass and a grade so the headlights,
// lamps, lit windows, jack-o'-lanterns and the zombies' eyes glow in the fog, with the moon casting shadows round the
// bus. The choice is per browser (the pause menu), for laptops that can't keep up.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
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

/**
 * The last look at the frame: each world's tint and saturation, dark corners, a red pulse when you're bitten, and
 * what the bong does to your eyes (the picture swims and its colours split).
 */
const GRADE = {
  uniforms: {
    tDiffuse: { value: null },
    uTint: { value: new THREE.Color('#ffffff') },
    uSat: { value: 1 },
    uVig: { value: 0.4 },
    uHigh: { value: 0 },
    uHurt: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec3 uTint; uniform float uSat, uVig, uHigh, uHurt, uTime; varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      uv += uHigh * 0.012 * vec2(sin(uv.y * 9.0 + uTime * 1.7), cos(uv.x * 7.0 + uTime * 1.3));
      vec2 off = (uv - 0.5) * uHigh * 0.02;
      vec3 c = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, uSat + uHigh * 0.5) * uTint;
      c += uHigh * 0.06 * vec3(sin(uTime + uv.x * 4.0), sin(uTime * 1.3 + uv.y * 4.0 + 2.0), sin(uTime * 0.7 + 4.0)) * l;
      float d = distance(vUv, vec2(0.5));
      c *= 1.0 - uVig * smoothstep(0.35, 0.85, d);
      c = mix(c, vec3(0.75, 0.02, 0.02), uHurt * smoothstep(0.25, 0.8, d));
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Post {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
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
    this.grade = new ShaderPass(GRADE);
    this.composer.addPass(this.grade);
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

  /** A leg's own grade (sky.ts `Look.grade`: tint, saturation, how dark the corners go). */
  setGrade(g: readonly [string, number, number]) {
    const u = this.grade.uniforms;
    (u.uTint.value as THREE.Color).set(g[0]);
    u.uSat.value = g[1];
    u.uVig.value = g[2];
  }

  /** Per frame: how high you are (0-1) and how freshly bitten (0-1). */
  feel(t: number, high: number, hurt: number) {
    const u = this.grade.uniforms;
    u.uTime.value = t;
    u.uHigh.value = high;
    u.uHurt.value = hurt;
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
