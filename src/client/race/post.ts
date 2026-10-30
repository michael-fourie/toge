// The race's post chain: the scene into a multisampled HDR target, bloom (head and tail lights, neon,
// low sun on chrome), then a film grade (contrast, cool shadows, warm highlights, vignette, a little grain)
// before tone mapping. Grading in linear HDR keeps the highlights from clipping before ACES rolls them off.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export interface Grade {
  /** Bloom strength, and the brightness (after exposure) where it starts. */
  bloom: number;
  threshold: number;
  contrast: number;
  saturation: number;
  /** Colour pushed into the shadows and into the highlights (linear RGB multipliers around 1). */
  shadows: [number, number, number];
  highlights: [number, number, number];
  vignette: number;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    contrast: { value: 1 },
    saturation: { value: 1 },
    shadows: { value: new THREE.Vector3(1, 1, 1) },
    highlights: { value: new THREE.Vector3(1, 1, 1) },
    vignette: { value: 0 },
    exposure: { value: 1 },
    aspect: { value: 1 },
    time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float contrast, saturation, vignette, exposure, aspect, time;
    uniform vec3 shadows, highlights;
    varying vec2 vUv;
    void main() {
      vec3 c = max(texture2D(tDiffuse, vUv).rgb, 0.0);
      // Work at the brightness the tone mapper will see, then hand back the same scale.
      vec3 e = c * exposure;
      float l = dot(e, vec3(0.2126, 0.7152, 0.0722));
      // Contrast about middle grey, in log space so it never crushes the highlights.
      float lc = 0.18 * pow(max(l, 1e-5) / 0.18, contrast);
      e *= lc / max(l, 1e-5);
      // Split tone: shadows lean one way, highlights the other.
      float w = smoothstep(0.02, 0.6, lc);
      e *= mix(shadows, highlights, w);
      e = mix(vec3(lc), e, saturation);
      // Vignette (round, whatever the aspect) and a touch of moving grain.
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
      e *= 1.0 - vignette * smoothstep(0.35, 1.1, length(d) * 1.25);
      float n = fract(sin(dot(vUv * 1000.0 + time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      e *= 1.0 + n * 0.035;
      gl_FragColor = vec4(e / exposure, 1.0);
    }`,
};

const ClampShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // NaN-safe: anything not a number goes black rather than spreading.
      c = all(equal(c, c)) ? clamp(c, 0.0, 64.0) : vec3(0.0);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Post {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, g: Grade) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    // A sun glint on a mirror-smooth clear coat is thousands of times brighter than white; the tone
    // mapper doesn't care, but the bloom would smear it into a fog over the whole screen. Clip first.
    this.composer.addPass(new ShaderPass(ClampShader));
    const exposure = renderer.toneMappingExposure;
    // Bloom runs before exposure, so its threshold is in scene units.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), g.bloom, 0.55, g.threshold / exposure);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    const u = this.grade.uniforms;
    u.contrast.value = g.contrast;
    u.saturation.value = g.saturation;
    u.shadows.value.set(...g.shadows);
    u.highlights.value.set(...g.highlights);
    u.vignette.value = g.vignette;
    u.exposure.value = exposure;
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h); // the bloom runs at half of this on its own
    this.grade.uniforms.aspect.value = w / Math.max(1, h);
  }

  render(time: number) {
    this.grade.uniforms.time.value = time % 100;
    this.composer.render();
  }

  dispose() {
    this.bloom.dispose();
    this.composer.dispose();
  }
}
