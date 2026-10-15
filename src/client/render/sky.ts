// Skies and image-based light. Daytime maps get a physically based atmosphere (Preetham scattering with a real sun
// disc and drifting procedural cloud cover, three's SkyMesh); the Foundry's night keeps a hand-graded gradient.
// Whatever the sky is, it's baked into a prefiltered environment map so every PBR surface is lit and reflects it.

import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { Fn, cameraPosition, max, mix, normalize, positionWorld, pow, select, smoothstep, uniform, vec3, vec4 } from 'three/tsl';

export interface DayLook {
  /** Haze: 2 is crisp mountain air, 6+ a dusty desert afternoon. */
  turbidity: number;
  rayleigh: number;
  /** Fraction of the sky covered by cloud, 0..1. */
  clouds: number;
}

/** Preetham radiance to our light units (see daySky). */
const SKY_GAIN = 0.25;

const CLEAR: DayLook = { turbidity: 2.4, rayleigh: 1.2, clouds: 0.35 };

/** A physically based daytime sky lit by a sun along `sunDir`. */
export function daySky(sunDir: THREE.Vector3, look: DayLook = CLEAR): THREE.Mesh {
  const sky = new SkyMesh();
  sky.scale.setScalar(1000);
  sky.turbidity.value = look.turbidity;
  sky.rayleigh.value = look.rayleigh;
  sky.mieCoefficient.value = 0.004;
  sky.mieDirectionalG.value = 0.82;
  sky.cloudCoverage.value = look.clouds;
  sky.cloudDensity.value = 0.45;
  sky.cloudElevation.value = 0.55;
  sky.sunPosition.value.copy(sunDir).normalize();
  // Preetham's sky comes out several times brighter than our sun light's units (three's demos just lower exposure),
  // which as image-based light would fill every shadow in. Scale it into the sun's units (shade then sits around a
  // third of full sun, like a clear day).
  const scale = SKY_GAIN;
  sky.material.colorNode = vec4(scale, scale, scale, 1).mul(sky.material.colorNode as THREE.Node<'vec4'>);
  sky.userData.envIntensity = 0.8;
  markSky(sky);
  return sky;
}

export interface NightColours {
  zenith: number;
  sky: number;
  horizon: number;
  below: number;
  deep: number;
}

/** The night gradient (moonlit haze around `moonDir`), as a node material so it runs on WebGPU and WebGL alike. */
export function nightSky(P: NightColours, moonDir: THREE.Vector3): THREE.Mesh {
  const c = (hex: number) => uniform(new THREE.Color(hex));
  const zenith = c(P.zenith);
  const sky = c(P.sky);
  const horizon = c(P.horizon);
  const below = c(P.below);
  const deep = c(P.deep);
  const moon = uniform(moonDir.clone().normalize());
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  mat.colorNode = Fn(() => {
    const d = normalize(positionWorld.sub(cameraPosition));
    const h = d.y;
    const up = mix(mix(horizon, sky, smoothstep(0, 0.18, h)), zenith, smoothstep(0.18, 0.85, h));
    const down = mix(mix(horizon, below, smoothstep(0, 0.06, h.negate())), deep, smoothstep(0.1, 0.9, h.negate()));
    const base = select(h.greaterThan(0), up, down);
    const s = max(d.dot(moon), 0);
    const glow = vec3(0.45, 0.58, 1).mul(pow(s, 8).mul(0.25).add(pow(s, 200).mul(0.6))).mul(0.45);
    return vec4(base.add(glow), 1);
  })();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  mesh.userData.envIntensity = 2.5; // the gradient is dim; as light it stands in for moonlit haze and bounce
  markSky(mesh);
  return mesh;
}

function markSky(m: THREE.Mesh) {
  m.renderOrder = -2;
  m.frustumCulled = false;
  m.userData.sky = true;
}

/**
 * Bakes the scene's sky (the mesh marked by daySky/nightSky) into a prefiltered environment map and sets it as the
 * scene's image-based light (at the sky's own `userData.envIntensity`). Call after the renderer is initialised.
 */
export function bakeEnvironment(renderer: THREE.WebGPURenderer, scene: THREE.Scene): void {
  let sky: THREE.Mesh | undefined;
  scene.traverse((o) => {
    if (o.userData.sky && o instanceof THREE.Mesh) sky = o;
  });
  if (!sky) return;
  const probe = new THREE.Scene();
  const copy = new THREE.Mesh(sky.geometry, sky.material);
  copy.scale.copy(sky.scale);
  probe.add(copy);
  // Leave the sun disc out: the sun already lights the scene as a DirectionalLight (with shadows). Baked in too, its
  // enormous radiance would wash every shadow out with a second, shadowless sun.
  const disc = sky instanceof SkyMesh ? sky.showSunDisc : null;
  if (disc) disc.value = 0;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(probe, 0.02, 0.1, 900);
  pmrem.dispose();
  if (disc) disc.value = 1;
  scene.environment = target.texture;
  scene.environmentIntensity = (sky.userData.envIntensity as number | undefined) ?? 1;
}

/**
 * The colour for unlit cloud billboards: brighter than white, since the physical sky behind them is brighter than 1 in
 * linear light and a plain white cloud would read as a grey blob against it. `k` dims it (cloud tops seen from above).
 */
export const sunlit = (k = 1) => new THREE.Color().setScalar(1.8 * k);
