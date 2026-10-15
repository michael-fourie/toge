// The game's renderer: three.js WebGPURenderer (WebGPU where the browser has it, WebGL 2 otherwise; `?gpu=webgl`
// forces the fallback) plus a node-based post chain:
//   scene (HDR, MRT: colour + normals + velocity) → GTAO ambient occlusion → bloom → grade/vignette → TRAA or FXAA.
// The first-person gun is drawn after the chain, straight onto the canvas with its own depth, so it never clips into
// walls and isn't smeared by temporal AA.

import * as THREE from 'three/webgpu';
import {
  unpackRGBToNormal,
  packNormalToRGB,
  float,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
  sample,
  screenUV,
  smoothstep,
  vec4,
  velocity,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { type Quality, type QualityProfile, profile } from './quality.ts';
import { bakeEnvironment } from './sky.ts';

export type Renderer = THREE.WebGPURenderer;

// three r186 passes `swizzle: 'rgba'` (the identity) to every createView; Chrome builds from before that part of the
// spec settled reject the value and the frame throws. Dropping the identity swizzle is harmless everywhere.
const GPUTex = (globalThis as { GPUTexture?: { prototype: { createView(d?: object): unknown } } }).GPUTexture;
if (GPUTex) {
  const createView = GPUTex.prototype.createView;
  GPUTex.prototype.createView = function (this: unknown, d?: { swizzle?: string }) {
    if (d?.swizzle === 'rgba') {
      const { swizzle: _identity, ...rest } = d;
      return createView.call(this, rest);
    }
    return createView.call(this, d);
  };
}

interface Overlay {
  scene: THREE.Scene;
  camera: THREE.Camera;
}

export class Gfx {
  readonly renderer: Renderer;
  readonly profile: QualityProfile;
  /** Resolves once the GPU device is up; nothing renders before then. */
  readonly ready: Promise<void>;
  private initialized = false;
  private pipeline: THREE.RenderPipeline | null = null;
  private overlay: Overlay | null = null;
  /** The sun whose shadow follows the camera, how far back along its rays it sits, and its shadow texel size. */
  private follow: { sun: THREE.DirectionalLight; ray: THREE.Vector3; snap: number } | null = null;

  constructor(readonly quality: Quality) {
    this.profile = profile(quality);
    const forceWebGL = new URLSearchParams(location.search).get('gpu') === 'webgl';
    // MSAA only without the post chain: the chain's own AA (TRAA/FXAA) replaces it and MSAA on MRT targets is costly.
    this.renderer = new THREE.WebGPURenderer({ antialias: !this.profile.post, powerPreference: 'high-performance', forceWebGL });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.profile.pixelRatioCap));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // ACES: the filmic curve most games grade to; keeps contrast and saturation (AgX looked washed out here).
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    // Clear to transparent: the gun pass relies on it (its alpha is the coverage it is composited with). The world's
    // sky covers every pixel, so nothing else sees the clear colour.
    this.renderer.setClearColor(0x000000, 0);
    this.ready = this.renderer.init().then(() => {
      this.initialized = true;
    });
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Which GPU API we ended up on, for the debug panel. */
  get backend(): string {
    const b = (this.renderer as unknown as { backend: { isWebGPUBackend?: boolean } }).backend;
    return b.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
  }

  /**
   * Readies a freshly built world: sun shadow resolution for this quality, the post chain, and (once the GPU is up)
   * the sky baked into the environment light of the world and the overlay. `manualShadows` redraws shadows only when
   * asked (`sun.shadow.needsUpdate`). Returns the shadow-casting sun.
   */
  stage(scene: THREE.Scene, camera: THREE.PerspectiveCamera, overlay: Overlay, manualShadows = false): THREE.DirectionalLight | null {
    let sun: THREE.DirectionalLight | null = null;
    scene.traverse((o) => {
      if (o instanceof THREE.DirectionalLight && o.castShadow) sun = o;
    });
    this.follow = null;
    if (sun) {
      const light = sun as THREE.DirectionalLight;
      const s = light.shadow;
      s.mapSize.setScalar(this.profile.shadowMap);
      s.autoUpdate = !manualShadows;
      // A shadow map covers a patch, not a whole map: keep the patch centred on the player, so shadows are everywhere
      // you are and stay sharp. (Manual-shadow maps are small enough to cover whole.)
      if (!manualShadows) {
        const ray = light.position.clone().sub(light.target.position);
        this.follow = { sun: light, ray, snap: (s.camera.right - s.camera.left) / this.profile.shadowMap };
      }
    }
    this.overlay = overlay;
    this.buildPipeline(scene, camera, overlay);
    void this.ready.then(() => {
      bakeEnvironment(this.renderer, scene);
      overlay.scene.environment = scene.environment; // the gun reflects the map's sky
      overlay.scene.environmentIntensity = scene.environmentIntensity;
    });
    return sun;
  }

  /**
   * The post chain. The overlay (first-person gun) is its own pass composited on top at the end: it has its own depth
   * so it never clips into walls, and it skips TRAA so it doesn't smear while the view swings.
   */
  private buildPipeline(scene: THREE.Scene, camera: THREE.PerspectiveCamera, overlay: Overlay) {
    this.pipeline?.dispose();
    this.pipeline = null;
    const p = this.profile;
    if (!p.post) return;

    const pipeline = new THREE.RenderPipeline(this.renderer);
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView), velocity }));
    // Normals fit in 8 bits per channel; halves the bandwidth of the biggest extra target.
    scenePass.getTexture('normal').type = THREE.UnsignedByteType;
    const color = scenePass.getTextureNode('output');
    const depth = scenePass.getTextureNode('depth');
    const normals = scenePass.getTextureNode('normal');
    const vel = scenePass.getTextureNode('velocity');

    let lit: THREE.Node<'vec4'> = color;
    if (p.ao) {
      const sceneNormal = sample((uv) => unpackRGBToNormal(normals.sample(uv)));
      const aoPass = ao(depth, sceneNormal, camera);
      aoPass.resolutionScale = 0.5;
      aoPass.radius.value = 0.6;
      aoPass.thickness.value = 1;
      aoPass.useTemporalFiltering = p.taa; // TRAA resolves GTAO's noise over frames
      lit = vec4(color.rgb.mul(aoPass.getTextureNode().r), color.a);
    }
    if (p.bloom) {
      // Threshold well above white: only the sun disc, glints and glowing pads bloom, not every bright wall or the sky
      // (a low threshold veils the whole frame in haze).
      const glow = bloom(lit, 0.12, 0.3, 1.6);
      lit = vec4(lit.rgb.add(glow.rgb), lit.a);
    }
    // Lens vignette: a gentle darkening toward the corners, as a real lens does.
    const d = screenUV.sub(0.5).length();
    const vignette = float(1).sub(smoothstep(0.45, 0.95, d).mul(0.28));
    lit = vec4(lit.rgb.mul(vignette), 1);

    // The gun: cleared to transparent black, so its colour is already weighted by coverage (premultiplied). It has
    // its own MSAA since neither TRAA nor FXAA smooths it.
    const gunPass = pass(overlay.scene, overlay.camera, { samples: 4 });
    const gun = gunPass.getTextureNode('output');
    const over = (under: THREE.Node<'vec4'>, top: THREE.Node<'vec4'>) => vec4(under.rgb.mul(top.a.oneMinus()).add(top.rgb), 1);

    if (p.taa) {
      pipeline.outputNode = over(traa(lit, depth, vel, camera), gun);
    } else {
      // FXAA wants display-referred colour: tone map the world, smooth its edges, then lay the (tone mapped) gun on top.
      pipeline.outputColorTransform = false;
      pipeline.outputNode = over(fxaa(renderOutput(lit)) as unknown as THREE.Node<'vec4'>, renderOutput(gun));
    }
    this.pipeline = pipeline;
  }

  setSize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
  }

  /** Draws a frame: the world, then the overlay (the gun) on top unless `showOverlay` is false (scoped, dead). */
  render(scene: THREE.Scene, camera: THREE.Camera, showOverlay: boolean) {
    if (!this.initialized) return;
    const r = this.renderer;
    const overlay = this.overlay;
    if (overlay) overlay.scene.visible = showOverlay;
    if (this.follow) {
      const { sun, ray, snap } = this.follow;
      const p = camera.position;
      // Moved in whole shadow texels, so edges don't shimmer as you move.
      sun.target.position.set(Math.round(p.x / snap) * snap, Math.round(p.y / snap) * snap, Math.round(p.z / snap) * snap);
      sun.position.copy(sun.target.position).add(ray);
    }
    if (this.pipeline) {
      this.pipeline.render();
      return;
    }
    r.autoClear = true;
    r.render(scene, camera);
    if (overlay && showOverlay) {
      r.autoClear = false;
      r.clearDepth();
      r.render(overlay.scene, overlay.camera);
      r.autoClear = true;
    }
  }

  dispose() {
    this.pipeline?.dispose();
    this.renderer.dispose();
  }
}
