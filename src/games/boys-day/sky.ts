// Each leg's world: its sky (a shader dome: a three-colour gradient, stars that twinkle, an aurora), its moon or low
// sun, its light and fog, and its weather (fireflies, snow, embers, spores, rain, dust: one cloud of points that
// wraps round the camera). Everything here lasts the whole run and `apply` re-colours it for the next leg's biome
// and twist: lights are never added or removed mid-run (every lit shader would recompile).

import * as THREE from 'three';
import type { Biome, Twist } from './checkpoints.ts';

export type Weather = 'none' | 'fireflies' | 'snow' | 'embers' | 'spores' | 'rain' | 'dust';

export interface Look {
  /** The sky: overhead, mid-height, and at the horizon. */
  sky: [string, string, string];
  fog: [string, number, number];
  /** Sky and ground bounce, and how bright. */
  hemi: [string, string, number];
  /** The moon (or the low sun): its light, how bright, its disc's tint and size. */
  light: [string, number];
  moon: [string, number];
  stars: number;
  aurora: number;
  /** The ground: hollows, hilltops, and the worn dirt by the road. */
  ground: [string, string, string];
  /** What the leafy trees and the pines wear here. */
  leaves: string[];
  pines: string[];
  weather: Weather;
  /** The grade over the finished frame: a tint, saturation, and how dark the corners go. */
  grade: [string, number, number];
}

export const LOOKS: Record<Biome, Look> = {
  pines: {
    sky: ['#07061a', '#1d1440', '#4b2f5e'],
    fog: ['#241c3c', 45, 260],
    hemi: ['#8f8fd8', '#26301f', 1.15],
    light: ['#c4ccff', 1.5],
    moon: ['#eef0ff', 120],
    stars: 0.8,
    aurora: 0,
    ground: ['#2c4a2c', '#7d9a55', '#6b5a40'],
    leaves: ['#5f9e3a', '#79b345', '#e0a13a', '#c7562d'],
    pines: ['#2f6b3f', '#3a7d4a', '#2a5e3a'],
    weather: 'fireflies',
    grade: ['#ffffff', 1.08, 0.38],
  },
  swamp: {
    sky: ['#04100c', '#0f2a22', '#3c5a3a'],
    fog: ['#1c3a2c', 18, 150],
    hemi: ['#7fc9a0', '#1a2a18', 1.0],
    light: ['#a8ffd0', 1.1],
    moon: ['#c8ffd8', 150],
    stars: 0.25,
    aurora: 0,
    ground: ['#1f3a26', '#56753f', '#3d3a26'],
    leaves: ['#3f7a3a', '#5a8f3a', '#7a8a2a'],
    pines: ['#254f38', '#2f5f40'],
    weather: 'fireflies',
    grade: ['#d8ffe6', 0.95, 0.5],
  },
  desert: {
    sky: ['#1a1440', '#b0456a', '#ffb060'],
    fog: ['#c8785a', 60, 330],
    hemi: ['#ffc8a0', '#6a4530', 1.25],
    light: ['#ffb070', 2.1],
    moon: ['#ffd9a0', 190],
    stars: 0.35,
    aurora: 0,
    ground: ['#a8703f', '#e2b06a', '#c08a50'],
    leaves: ['#8a9a4a', '#a8a050'],
    pines: ['#5f7a3a'],
    weather: 'dust',
    grade: ['#ffe6c8', 1.15, 0.36],
  },
  snow: {
    sky: ['#040a1c', '#10305a', '#4a7aa0'],
    fog: ['#5a7a9a', 35, 230],
    hemi: ['#b8d8ff', '#6a7a8a', 1.35],
    light: ['#d0e4ff', 1.6],
    moon: ['#f4f8ff', 110],
    stars: 1,
    aurora: 1,
    ground: ['#b8c8d8', '#f4f8ff', '#8a9098'],
    leaves: ['#d8e4ee', '#c0d0dc'],
    pines: ['#dfeaf2', '#b8d0d8', '#3a6a5a'],
    weather: 'snow',
    grade: ['#dcecff', 0.92, 0.36],
  },
  shroom: {
    sky: ['#0c0420', '#3a1060', '#8a2a9a'],
    fog: ['#3a1650', 28, 190],
    hemi: ['#c890ff', '#20304a', 1.05],
    light: ['#e0a0ff', 1.2],
    moon: ['#ffb0f0', 160],
    stars: 0.9,
    aurora: 0.5,
    ground: ['#1f2a4a', '#4a5a8a', '#3a2a4a'],
    leaves: ['#7a4ac8', '#4a8ad0', '#c84aa8'],
    pines: ['#2a4a6a'],
    weather: 'spores',
    grade: ['#f0d8ff', 1.25, 0.42],
  },
  ember: {
    sky: ['#120404', '#4a1008', '#d84a1a'],
    fog: ['#4a1c10', 26, 200],
    hemi: ['#ff9a6a', '#2a1410', 1.0],
    light: ['#ff8a50', 1.5],
    moon: ['#ff7a3a', 210],
    stars: 0.1,
    aurora: 0,
    ground: ['#1c1614', '#4a3a30', '#2a2220'],
    leaves: ['#3a2a22'],
    pines: ['#2a2220'],
    weather: 'embers',
    grade: ['#ffd8c0', 1.12, 0.5],
  },
  neon: {
    sky: ['#060414', '#2a0c4a', '#c82a8a'],
    fog: ['#3a1048', 40, 240],
    hemi: ['#ff80d0', '#102a3a', 1.2],
    light: ['#80e8ff', 1.4],
    moon: ['#ff9adf', 130],
    stars: 0.3,
    aurora: 0,
    ground: ['#1a1a2a', '#3a3a52', '#2a2a36'],
    leaves: ['#2ad0c0', '#d02a9a'],
    pines: ['#2a5a6a'],
    weather: 'rain',
    grade: ['#ffe0f6', 1.3, 0.42],
  },
  grave: {
    sky: ['#03050c', '#0c1830', '#3a4a6a'],
    fog: ['#2a3448', 16, 150],
    hemi: ['#9ab0e0', '#1a2028', 0.95],
    light: ['#b8d0ff', 1.3],
    moon: ['#f0f6ff', 200],
    stars: 0.6,
    aurora: 0,
    ground: ['#232c2a', '#56645a', '#3a3a36'],
    leaves: ['#4a5a4a'],
    pines: ['#24382e', '#2a4034'],
    weather: 'dust',
    grade: ['#dce6ff', 0.8, 0.55],
  },
  crystal: {
    sky: ['#020a14', '#0a3a4a', '#2ac8b0'],
    fog: ['#124a50', 40, 260],
    hemi: ['#80fff0', '#203040', 1.15],
    light: ['#a0fff0', 1.5],
    moon: ['#c0fff4', 140],
    stars: 1,
    aurora: 0.7,
    ground: ['#2a3a4a', '#6a8a9a', '#3a4650'],
    leaves: ['#4ad0c0'],
    pines: ['#2a6a6a'],
    weather: 'spores',
    grade: ['#d8fff8', 1.2, 0.4],
  },
};

/** A twist's own weather over the biome's: a blood moon, thick fog, a storm. */
export function lookFor(biome: Biome, twist: Twist): Look {
  const l = LOOKS[biome];
  if (twist === 'blood') return { ...l, moon: ['#ff2a2a', l.moon[1] * 1.5], light: ['#ff7a6a', l.light[1]], fog: ['#3a1014', l.fog[1], l.fog[2] * 0.85], sky: ['#0c0204', '#3a0810', l.sky[2]], grade: ['#ffc8c0', 1.15, 0.5] };
  if (twist === 'fog') return { ...l, fog: [l.fog[0], 6, 70], stars: 0, aurora: 0 };
  if (twist === 'storm') return { ...l, weather: 'rain', stars: 0, aurora: 0, fog: [l.fog[0], l.fog[1] * 0.7, l.fog[2] * 0.7], hemi: [l.hemi[0], l.hemi[1], l.hemi[2] * 0.85] };
  return l;
}

const WEATHER: Record<Weather, { n: number; color: string; size: number; vel: [number, number, number]; glow: boolean; twinkle: number; streak: number }> = {
  none: { n: 0, color: '#ffffff', size: 1, vel: [0, 0, 0], glow: false, twinkle: 0, streak: 0 },
  fireflies: { n: 160, color: '#d8ff7a', size: 0.22, vel: [0.3, 0.1, 0.2], glow: true, twinkle: 1, streak: 0 },
  snow: { n: 900, color: '#ffffff', size: 0.16, vel: [0.8, -2.2, 0.4], glow: false, twinkle: 0, streak: 0 },
  embers: { n: 420, color: '#ff8a2a', size: 0.16, vel: [0.9, 1.6, 0.3], glow: true, twinkle: 0.7, streak: 0 },
  spores: { n: 380, color: '#c8a0ff', size: 0.2, vel: [0.2, 0.35, 0.15], glow: true, twinkle: 0.5, streak: 0 },
  rain: { n: 900, color: '#a8c8ff', size: 0.1, vel: [1.5, -19, 0.5], glow: false, twinkle: 0, streak: 1 },
  dust: { n: 260, color: '#e8d8b8', size: 0.14, vel: [1.6, 0.05, 0.6], glow: false, twinkle: 0, streak: 0 },
};
const BOX = new THREE.Vector3(70, 34, 70);
const MAX_POINTS = 900;
const MOON = { x: -60, y: 90, z: -40, box: 55 };

export class Sky {
  private dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private hemi = new THREE.HemisphereLight('#8f8fd8', '#26301f', 1.15);
  private moonLight = new THREE.DirectionalLight('#c4ccff', 1.5);
  private moon: THREE.Sprite;
  private moonTex: THREE.CanvasTexture;
  private points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private fog = new THREE.Fog('#241c3c', 45, 260);
  private flashT = 0;
  private hemiBase = 1.15;
  private t = 0;
  private at = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    scene.fog = this.fog;
    scene.add(this.hemi);
    // The moonlight casts shadows in a box round the camera (it follows you down the road).
    const ml = this.moonLight;
    ml.castShadow = true;
    ml.shadow.mapSize.set(2048, 2048);
    Object.assign(ml.shadow.camera, { left: -MOON.box, right: MOON.box, top: MOON.box, bottom: -MOON.box, near: 10, far: 260 });
    ml.shadow.bias = -0.0008;
    ml.shadow.normalBias = 0.04;
    scene.add(ml, ml.target);

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(480, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uLow: { value: new THREE.Color() }, uStars: { value: 0 }, uAurora: { value: 0 }, uTime: { value: 0 }, uFlash: { value: 0 } },
        vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
          varying vec3 vDir;
          uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uLow;
          uniform float uStars; uniform float uAurora; uniform float uTime; uniform float uFlash;
          float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col = mix(uLow, uMid, smoothstep(-0.02, 0.22, h));
            col = mix(col, uTop, smoothstep(0.18, 0.7, h));
            col = mix(col, uLow * 0.55, smoothstep(0.0, -0.25, h));
            // Stars: one in a few cells of a grid on the dome, twinkling.
            vec3 cell = floor(d * 190.0);
            float s = hash(cell);
            float star = step(0.9965, s) * (0.55 + 0.45 * sin(uTime * (1.5 + s * 40.0) + s * 300.0));
            col += vec3(1.0, 0.96, 0.9) * star * uStars * smoothstep(0.03, 0.3, h) * 1.6;
            // An aurora: curtains swaying across the north.
            float band = sin(d.x * 5.0 + uTime * 0.25 + sin(d.z * 3.0 + uTime * 0.13) * 1.6);
            float curtain = pow(max(0.0, band), 3.0) * smoothstep(0.08, 0.3, h) * smoothstep(0.75, 0.35, h);
            float rays = 0.6 + 0.4 * sin(d.x * 60.0 + d.z * 40.0 + uTime * 0.9);
            col += mix(vec3(0.15, 1.0, 0.55), vec3(0.6, 0.3, 1.0), smoothstep(0.2, 0.6, h)) * curtain * rays * uAurora * 0.9;
            col += vec3(0.7, 0.75, 1.0) * uFlash * 0.6;
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // The moon: a big glowing disc that stays in the same spot of sky wherever you drive.
    const mc = document.createElement('canvas');
    mc.width = mc.height = 256;
    const mg = mc.getContext('2d')!;
    const halo = mg.createRadialGradient(128, 128, 40, 128, 128, 128);
    halo.addColorStop(0, 'rgba(255,255,255,0.55)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    mg.fillStyle = halo;
    mg.fillRect(0, 0, 256, 256);
    mg.fillStyle = '#ffffff';
    mg.beginPath();
    mg.arc(128, 128, 52, 0, 7);
    mg.fill();
    mg.fillStyle = 'rgba(150,150,170,0.4)';
    for (const [x, y, r] of [[110, 112, 12], [146, 140, 9], [132, 100, 6], [120, 150, 7]]) {
      mg.beginPath();
      mg.arc(x, y, r, 0, 7);
      mg.fill();
    }
    this.moonTex = new THREE.CanvasTexture(mc);
    this.moonTex.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.moonTex, fog: false, depthWrite: false }));
    this.moon.renderOrder = -9;
    scene.add(this.moon);

    // The weather: points scattered through a box that wraps round the camera, so it's everywhere you go.
    const base = new Float32Array(MAX_POINTS * 3);
    for (let i = 0; i < base.length; i++) base[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(base, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: { uCam: { value: new THREE.Vector3() }, uBox: { value: BOX }, uVel: { value: new THREE.Vector3() }, uTime: { value: 0 }, uSize: { value: 1 }, uColor: { value: new THREE.Color() }, uTwinkle: { value: 0 }, uStreak: { value: 0 }, uScale: { value: 600 } },
        vertexShader: `
          uniform vec3 uCam; uniform vec3 uBox; uniform vec3 uVel; uniform float uTime; uniform float uSize; uniform float uTwinkle; uniform float uScale;
          varying float vA;
          void main() {
            vec3 w = position * uBox + uVel * uTime + vec3(sin(uTime * 0.7 + position.y * 30.0), 0.0, cos(uTime * 0.5 + position.x * 30.0)) * 0.6;
            vec3 rel = mod(w - uCam + uBox * 0.5, uBox) - uBox * 0.5;
            vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = uSize * uScale / max(0.5, -mv.z);
            float edge = 1.0 - smoothstep(0.38, 0.5, max(abs(rel.x) / uBox.x, abs(rel.z) / uBox.z));
            vA = edge * mix(1.0, 0.5 + 0.5 * sin(uTime * (2.0 + position.z * 3.0) + position.x * 50.0), uTwinkle);
          }`,
        fragmentShader: `
          uniform vec3 uColor; uniform float uStreak;
          varying float vA;
          void main() {
            vec2 p = gl_PointCoord - 0.5;
            p.x *= mix(1.0, 5.0, uStreak);
            float a = smoothstep(0.5, 0.1, length(p)) * vA;
            gl_FragColor = vec4(uColor * (1.0 + a), a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  /** Re-colours everything for a leg's world. */
  apply(look: Look) {
    const u = this.dome.material.uniforms;
    (u.uTop.value as THREE.Color).set(look.sky[0]);
    (u.uMid.value as THREE.Color).set(look.sky[1]);
    (u.uLow.value as THREE.Color).set(look.sky[2]);
    u.uStars.value = look.stars;
    u.uAurora.value = look.aurora;
    this.fog.color.set(look.fog[0]);
    this.fog.near = look.fog[1];
    this.fog.far = look.fog[2];
    this.hemi.color.set(look.hemi[0]);
    this.hemi.groundColor.set(look.hemi[1]);
    this.hemiBase = this.hemi.intensity = look.hemi[2];
    this.moonLight.color.set(look.light[0]);
    this.moonLight.intensity = look.light[1];
    this.moon.material.color.set(look.moon[0]);
    this.moon.scale.setScalar(look.moon[1]);
    const w = WEATHER[look.weather];
    const p = this.points.material;
    this.points.visible = w.n > 0;
    this.points.geometry.setDrawRange(0, w.n);
    (p.uniforms.uColor.value as THREE.Color).set(w.color);
    p.uniforms.uSize.value = w.size;
    (p.uniforms.uVel.value as THREE.Vector3).set(...w.vel);
    p.uniforms.uTwinkle.value = w.twinkle;
    p.uniforms.uStreak.value = w.streak;
    p.blending = w.glow ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.scene.background = null;
  }

  update(camera: THREE.Camera, dt: number, viewH: number) {
    this.t += dt;
    const c = camera.getWorldPosition(this.at);
    this.dome.position.copy(c);
    this.dome.material.uniforms.uTime.value = this.t;
    this.moon.position.set(c.x - 250, c.y + 150, c.z - 360);
    this.moonLight.target.position.copy(c);
    this.moonLight.position.set(c.x + MOON.x, c.y + MOON.y, c.z + MOON.z);
    const p = this.points.material.uniforms;
    (p.uCam.value as THREE.Vector3).copy(c);
    p.uTime.value = this.t;
    p.uScale.value = viewH;
    // Lightning: a double flicker that fades.
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    const k = this.flashT > 0.32 ? 1 : this.flashT > 0.22 ? 0.2 : this.flashT > 0.12 ? 0.8 : this.flashT / 0.12;
    this.hemi.intensity = this.hemiBase + k * 3.5;
    this.dome.material.uniforms.uFlash.value = k;
  }

  flash() {
    this.flashT = 0.45;
  }

  dispose() {
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.moonTex.dispose();
    this.moon.material.dispose();
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
