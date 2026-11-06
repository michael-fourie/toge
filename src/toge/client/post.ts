// The race's post chain: the scene into a multisampled HDR target, bloom (head and tail lights, neon,
// low sun on chrome), then a film grade (contrast, cool shadows, warm highlights, vignette, a little grain,
// a lens flare off the sun) and the tone mapping in the same last pass. Grading in linear HDR keeps the
// highlights from clipping before ACES rolls them off.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { drawLow } from './lowgfx.ts';

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
  /** Lens flare off the sun when it's in view and not behind a hill or a tree (0 = none, as at night). */
  flare: number;
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
    /** The sun on screen (uv), and the flare's strength for this frame (0 when it's behind the camera). */
    sunUv: { value: new THREE.Vector2(0.5, 2) },
    flare: { value: 0 },
  },
  vertexShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 sunUv;
    uniform float flare, exposure, aspect;
    varying vec2 vUv;
    // How much of the sun is showing, worked out once per corner of the screen quad (the same few texels for
    // every vertex, so it costs nothing per pixel): a hill, a tree or a car in front of it darkens those texels.
    varying float vSun;
    void main() {
      vUv = uv;
      float seen = 0.0;
      if (flare > 0.0) {
        vec2 r = vec2(0.006 / aspect, 0.006);
        for (int i = 0; i < 5; i++) {
          vec2 o = i == 0 ? vec2(0.0) : vec2(i == 1 ? 1.0 : i == 2 ? -1.0 : 0.0, i == 3 ? 1.0 : i == 4 ? -1.0 : 0.0) * r;
          vec3 c = textureLod(tDiffuse, clamp(sunUv + o, 0.0, 1.0), 0.0).rgb * exposure;
          seen += smoothstep(1.5, 5.0, dot(c, vec3(0.2126, 0.7152, 0.0722)));
        }
        // Fade out as the sun leaves the frame.
        vec2 off = max(vec2(0.0), abs(sunUv - 0.5) - 0.5);
        seen *= 0.2 * flare * (1.0 - smoothstep(0.0, 0.08, max(off.x, off.y)));
      }
      vSun = seen;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float contrast, saturation, vignette, exposure, aspect, time;
    uniform vec3 shadows, highlights;
    uniform vec2 sunUv;
    varying vec2 vUv;
    varying float vSun;
    // A soft disc of radius r for the flare's ghosts.
    float ghost(vec2 p, vec2 at, float r) { return 1.0 - smoothstep(r * 0.55, r, length(p - at)); }
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
      // Lens flare: a warm glow round the sun, a thin anamorphic streak through it, and a few faint ghosts
      // on the line from the sun through the middle of the frame.
      if (vSun > 0.001) {
        vec2 a = vec2(aspect, 1.0);
        vec2 d = (vUv - sunUv) * a;
        float r = length(d);
        vec3 f = vec3(1.0, 0.82, 0.6) * (0.8 * exp(-r * 10.0) + 0.14 * exp(-r * 3.0));
        f += vec3(0.65, 0.8, 1.0) * 0.8 * exp(-abs(d.y) * 140.0) * exp(-abs(d.x) * 2.2);
        vec2 p = vUv * a;
        vec2 s = sunUv * a, m = 0.5 * a, axis = m - s;
        f += vec3(0.5, 0.75, 1.0) * 0.45 * ghost(p, s + axis * 1.45, 0.05);
        f += vec3(0.8, 0.55, 1.0) * 0.28 * ghost(p, s + axis * 1.9, 0.11);
        f += vec3(0.6, 1.0, 0.7) * 0.18 * ghost(p, s + axis * 2.5, 0.2);
        f += vec3(1.0, 0.7, 0.45) * 0.35 * ghost(p, s + axis * 0.55, 0.035);
        e += f * vSun;
      }
      // Vignette (round, whatever the aspect) and a touch of moving grain.
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
      e *= 1.0 - vignette * smoothstep(0.35, 1.1, length(d) * 1.25);
      float n = fract(sin(dot(vUv * 1000.0 + time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      e *= 1.0 + n * 0.035;
      // Tone mapping (ACES, at the renderer's exposure) and sRGB here, not in a pass of their own.
      gl_FragColor = vec4(e / exposure, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
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

/**
 * On Low graphics (`low`), there is no chain at all: the scene goes straight to the screen (tone mapped there by the
 * renderer), with simple materials (lowgfx.ts). No HDR targets, no MSAA buffer, no bloom, no grade.
 */
export class Post {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private flare = 0;
  /** Where the sun is (a direction), for the flare; null for none. */
  sun: THREE.Vector3 | null = null;
  private sunAt = new THREE.Vector3();

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera, g: Grade, private low = false) {
    if (low) return;
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
    this.flare = g.flare;
    this.composer.addPass(this.grade);
  }

  setSize(w: number, h: number) {
    if (!this.composer || !this.grade) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h); // the bloom runs at half of this on its own
    this.grade.uniforms.aspect.value = w / Math.max(1, h);
  }

  render(time: number) {
    if (this.low || !this.composer || !this.grade) {
      drawLow(this.scene, () => this.renderer.render(this.scene, this.camera));
      return;
    }
    const u = this.grade.uniforms;
    u.time.value = time % 100;
    // The sun, projected onto the screen: no flare when it's behind the camera.
    let flare = 0;
    if (this.sun && this.flare > 0) {
      const cam = this.camera;
      cam.updateMatrixWorld();
      const p = this.sunAt.copy(this.sun).multiplyScalar(5000).add(cam.position).project(cam);
      if (p.z < 1) {
        u.sunUv.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
        flare = this.flare;
      }
    }
    u.flare.value = flare;
    this.composer.render();
  }

  dispose() {
    this.bloom?.dispose();
    this.composer?.dispose();
  }
}
