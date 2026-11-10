// The race's post chain: the scene into a multisampled HDR target, bloom (head and tail lights, neon,
// low sun on chrome), then a film grade (contrast, cool shadows, warm highlights, vignette, a little grain,
// a lens flare off the sun, a speed blur at the edges at speed) and the tone mapping in the same last pass. Grading in linear HDR keeps the
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

/**
 * A sun glint on a mirror-smooth clear coat is thousands of times brighter than white (or Inf in a half float); the
 * tone mapper doesn't care, but the bloom would smear it into a fog over the whole screen. Everything that reads the
 * scene clips it first (NaN-safe: anything not a number goes black rather than spreading).
 */
const SAFE = /* glsl */ `vec3 safe(vec3 c) { return all(equal(c, c)) ? clamp(c, 0.0, 64.0) : vec3(0.0); }`;

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tBloom: { value: null as THREE.Texture | null },
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
    /** Speed blur toward the screen's edges (0 = none): see `Post.rush`. */
    rush: { value: 0 },
  },
  vertexShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    uniform vec2 sunUv;
    uniform float flare, exposure, aspect;
    varying vec2 vUv;
    // How much of the sun is showing, worked out once per corner of the screen quad (the same few texels for
    // every vertex, so it costs nothing per pixel): a hill, a tree or a car in front of it darkens those texels.
    varying float vSun;
    ${SAFE}
    void main() {
      vUv = uv;
      float seen = 0.0;
      if (flare > 0.0) {
        vec2 r = vec2(0.006 / aspect, 0.006);
        for (int i = 0; i < 5; i++) {
          vec2 o = i == 0 ? vec2(0.0) : vec2(i == 1 ? 1.0 : i == 2 ? -1.0 : 0.0, i == 3 ? 1.0 : i == 4 ? -1.0 : 0.0) * r;
          vec2 at = clamp(sunUv + o, 0.0, 1.0);
          vec3 c = (safe(textureLod(tDiffuse, at, 0.0).rgb) + textureLod(tBloom, at, 0.0).rgb) * exposure;
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
    uniform sampler2D tBloom;
    uniform float contrast, saturation, vignette, exposure, aspect, time, rush;
    uniform vec3 shadows, highlights;
    uniform vec2 sunUv;
    varying vec2 vUv;
    varying float vSun;
    // A soft disc of radius r for the flare's ghosts.
    float ghost(vec2 p, vec2 at, float r) { return 1.0 - smoothstep(r * 0.55, r, length(p - at)); }
    ${SAFE}
    void main() {
      // The scene, clipped as the bloom saw it (SAFE).
      vec3 c = safe(texture2D(tDiffuse, vUv).rgb);
      // Speed blur: the edges of the frame streak away from a point a little above the middle (where the road
      // goes), the middle (your car, the road ahead) stays sharp. Four more taps, and only where it shows: skipped
      // whole below cruising speed, and per pixel inside the sharp middle.
      if (rush > 0.0) {
        vec2 dir = vUv - vec2(0.5, 0.56);
        float k = rush * smoothstep(0.22, 0.75, length(dir * vec2(aspect, 1.0)));
        if (k > 0.004) {
          vec2 st = dir * k * 0.032;
          float j = 0.6 * fract(sin(dot(vUv, vec2(91.7, 37.3)) + time) * 4375.85); // a little dither: no ghost copies, no grain
          for (int i = 1; i <= 4; i++) c += safe(texture2D(tDiffuse, vUv - st * (float(i) - j)).rgb);
          c *= 0.2;
        }
      }
      // Plus the bloom, added here rather than in a full-screen pass of its own.
      c += texture2D(tBloom, vUv).rgb;
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
      // Lens flare: a warm glow round the sun, a thin anamorphic streak through it, and two faint ghosts
      // on the line from the sun through the middle of the frame.
      if (vSun > 0.001) {
        vec2 a = vec2(aspect, 1.0);
        vec2 d = (vUv - sunUv) * a;
        float r = length(d);
        vec3 f = vec3(1.0, 0.82, 0.6) * (0.8 * exp(-r * 10.0) + 0.14 * exp(-r * 3.0));
        f += vec3(0.65, 0.8, 1.0) * 0.8 * exp(-abs(d.y) * 140.0) * exp(-abs(d.x) * 2.2);
        vec2 p = vUv * a;
        vec2 s = sunUv * a, m = 0.5 * a, axis = m - s;
        // Two small, faint ones: big saturated discs read as blobs of paint sitting on the road.
        f += vec3(0.6, 0.78, 1.0) * 0.16 * ghost(p, s + axis * 1.45, 0.028);
        f += vec3(1.0, 0.75, 0.5) * 0.2 * ghost(p, s + axis * 0.55, 0.02);
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

/**
 * The bloom, left in a texture of its own (half size) for the grade pass to add. UnrealBloomPass would blend it over
 * the full-size scene, a full-screen pass the grade can do for free; and its bright pass clips the scene (`safe`) tap by
 * tap, so the old full-screen clamp pass before it is gone too: the same picture for two fewer full-screen passes.
 */
const BLUR_X = new THREE.Vector2(1, 0);
const BLUR_Y = new THREE.Vector2(0, 1);

class Bloom extends UnrealBloomPass {
  private texel = { value: new THREE.Vector2() };
  private oldClear = new THREE.Color();

  constructor(strength: number, radius: number, threshold: number) {
    super(new THREE.Vector2(256, 256), strength, radius, threshold);
    const hp = this.materialHighPassFilter;
    hp.uniforms.texel = this.texel;
    // The bright pass runs at half size: four taps, one on each full-size texel under its pixel, each clipped on its own
    // (as the clamp pass did before the bloom filtered it).
    hp.fragmentShader = /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 texel;
      uniform float luminosityThreshold;
      uniform float smoothWidth;
      varying vec2 vUv;
      ${SAFE}
      vec3 tap(vec2 o) { return safe(texture2D(tDiffuse, vUv + o * texel).rgb); }
      void main() {
        vec3 c = 0.25 * (tap(vec2(-0.5, -0.5)) + tap(vec2(0.5, -0.5)) + tap(vec2(-0.5, 0.5)) + tap(vec2(0.5, 0.5)));
        float a = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, luminance(c));
        gl_FragColor = vec4(c * a, a);
      }`;
    hp.needsUpdate = true;
  }

  /** The finished bloom (half size), for the grade pass. */
  get texture() {
    return this.renderTargetsHorizontal[0].texture;
  }

  setSize(width: number, height: number) {
    super.setSize(width, height);
    this.texel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const quad = (this as unknown as { _fsQuad: { material: THREE.Material; render(r: THREE.WebGLRenderer): void } })._fsQuad;
    renderer.getClearColor(this.oldClear);
    const oldAlpha = renderer.getClearAlpha();
    const oldAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    const draw = (mat: THREE.Material, to: THREE.WebGLRenderTarget) => {
      quad.material = mat;
      renderer.setRenderTarget(to);
      renderer.clear();
      quad.render(renderer);
    };
    this.materialHighPassFilter.uniforms.tDiffuse.value = read.texture;
    this.materialHighPassFilter.uniforms.luminosityThreshold.value = this.threshold;
    draw(this.materialHighPassFilter, this.renderTargetBright);
    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const blur = this.separableBlurMaterials[i];
      blur.uniforms.colorTexture.value = input.texture;
      blur.uniforms.direction.value = BLUR_X;
      draw(blur, this.renderTargetsHorizontal[i]);
      blur.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      blur.uniforms.direction.value = BLUR_Y;
      draw(blur, this.renderTargetsVertical[i]);
      input = this.renderTargetsVertical[i];
    }
    const comp = this.compositeMaterial;
    comp.uniforms.bloomStrength.value = this.strength;
    comp.uniforms.bloomRadius.value = this.radius;
    comp.uniforms.bloomTintColors.value = this.bloomTintColors;
    draw(comp, this.renderTargetsHorizontal[0]);
    renderer.setClearColor(this.oldClear, oldAlpha);
    renderer.autoClear = oldAuto;
  }
}

/**
 * On Low graphics (`low`), there is no chain at all: the scene goes straight to the screen (tone mapped there by the
 * renderer), with simple materials (lowgfx.ts). No HDR targets, no MSAA buffer, no bloom, no grade.
 */
export class Post {
  private composer: EffectComposer | null = null;
  private bloom: Bloom | null = null;
  private grade: ShaderPass | null = null;
  private flare = 0;
  /** Speed blur at the frame's edges, 0..1 (racegame.ts sets it from the camera's car: speed and boost). */
  rush = 0;
  /** Where the sun is (a direction), for the flare; null for none. */
  sun: THREE.Vector3 | null = null;
  private sunAt = new THREE.Vector3();

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera, g: Grade, private low = false) {
    if (low) return;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    const exposure = renderer.toneMappingExposure;
    // Bloom runs before exposure, so its threshold is in scene units.
    this.bloom = new Bloom(g.bloom, 0.55, g.threshold / exposure);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    const u = this.grade.uniforms;
    u.tBloom.value = this.bloom.texture;
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
    u.rush.value = this.rush;
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
