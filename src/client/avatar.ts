import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLAYER } from '../shared/constants.ts';
import { type Accessory, HAIR, type HairStyle, type Mouth, SCARF, type Skin, encodeSkin, seededSkin } from '../shared/skin.ts';
import { type Gear, itemById } from '../shared/items.ts';
import { DEFAULT_KNIFE, buildKnife } from './knife.ts';
import { buildScythe } from './scythe.ts';
import { toonRamp } from './textures.ts';
import { buildWear } from './wear.ts';

// Chibi anime sniper: big head (it *is* the head hitbox), huge eyes, spiky hair, a scarf that
// streams behind at speed, and an AWP. Every player has a look (hair, mouth, accessory): the skin they
// picked, or one seeded from their name + colour; the jacket and sleeves stay in the player's colour so you can tell
// people apart. Static parts are merged per material to keep draw calls low.

const HEAD_R = 0.25; // a touch inside PLAYER.headRadius so the hair stays inside the hit sphere
const HIP_Y = 0.78; // hips above feet; legs are this long
const NECK_Y = 0.55; // in upper-body space (pivots at the hips)
const AIM_Y = 0.44; // shoulder pivot for the arms + rifle, in upper-body space
const OUTLINE = 0.0028; // ink line thickness per metre of camera distance

type Vec = [number, number, number];
type Expr = 'open' | 'blink' | 'hype' | 'ko' | 'zombie';

const ZOMBIE_HAIR = [0x5d6b4f, 0x7a6f86, 0x8d8a78];

// ---------------------------------------------------------------------------
// Shared materials

const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() });
const skinMat = toon(0xf6d3b8);
const zombieSkinMat = toon(0x9fc48a); // minty-green, more Ghibli soot-sprite than gore
const pantsMat = toon(0x34385a);
const shoeMat = toon(0xf2efe6);
const shirtMat = toon(0xfaf6ec);
const innerEarMat = toon(0xf2a0b0);
const gunGreenMat = toon(0x5b7442);
const gunDarkMat = toon(0x2e2c2b);

/** Inverted-hull ink outline: back faces pushed out along the normal, thicker with distance so it stays visible. */
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x3a2820, side: THREE.BackSide });
outlineMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader.replace(
    '#include <begin_vertex>',
    `vec3 transformed = position;
     float camDist = -(modelViewMatrix * vec4(position, 1.0)).z;
     transformed += normal * ${OUTLINE.toFixed(5)} * clamp(camDist, 1.5, 14.0);`,
  );
};

// ---------------------------------------------------------------------------
// Geometry helpers (each builds a fresh geometry baked into its final pose, ready to merge)

const UP = new THREE.Vector3(0, 1, 0);
const mtx = new THREE.Matrix4();

function at(geo: THREE.BufferGeometry, p: Vec, rot: Vec = [0, 0, 0], s: Vec = [1, 1, 1]) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot));
  return geo.applyMatrix4(mtx.compose(new THREE.Vector3(...p), q, new THREE.Vector3(...s)));
}

/** A geometry whose local +Y is pointed along `dir`, origin moved to `base`. */
function aimed(geo: THREE.BufferGeometry, base: THREE.Vector3, dir: THREE.Vector3) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  return geo.applyMatrix4(mtx.compose(base, q, new THREE.Vector3(1, 1, 1)));
}

/** Capsule from a to b: arms. */
function limb(a: Vec, b: Vec, r: number) {
  const va = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(va);
  const geo = new THREE.CapsuleGeometry(r, Math.max(0.001, d.length()), 3, 8).translate(0, d.length() / 2, 0);
  return aimed(geo, va, d);
}

/** Point on the head sphere: `a` is azimuth from the face (+ = right), `e` is elevation. */
function onHead(a: number, e: number, r = HEAD_R) {
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).multiplyScalar(r);
}

/** A cone of hair rooted at head angle (a, e). `out` mixes the surface normal into a downward or upward sweep. */
function strand(a: number, e: number, len: number, rad: number, sweep: Vec, out: number) {
  const base = onHead(a, e, HEAD_R * 0.97);
  const n = base.clone().normalize();
  const dir = new THREE.Vector3(...sweep).addScaledVector(n, out);
  return aimed(new THREE.ConeGeometry(rad, len, 7).translate(0, len / 2, 0), base, dir);
}

/** Cone hanging down from its pivot (tip at -len): pony/twin tails. */
const hangingCone = (rad: number, len: number) => new THREE.ConeGeometry(rad, len, 8).rotateX(Math.PI).translate(0, -len / 2, 0);

const merge = (...geos: THREE.BufferGeometry[]) => {
  const g = mergeGeometries(geos)!;
  geos.forEach((x) => x.dispose());
  return g;
};

// Static geometry shared by every avatar. Upper-body space has its origin at the hips.
const GEO = {
  jacket: merge(
    at(new THREE.CapsuleGeometry(0.17, 0.3, 4, 12), [0, 0.28, 0], [0, 0, 0], [1.15, 1, 0.8]),
    at(new THREE.SphereGeometry(0.085, 10, 8), [-0.2, AIM_Y - 0.02, 0.01]),
    at(new THREE.SphereGeometry(0.085, 10, 8), [0.2, AIM_Y - 0.02, 0.01]),
    at(new THREE.CylinderGeometry(0.2, 0.25, 0.22, 14), [0, -0.03, 0]), // coat tails
  ),
  shirt: at(new THREE.BoxGeometry(0.09, 0.22, 0.03), [0, 0.38, -0.125], [-0.12, 0, 0]),
  neck: at(new THREE.CylinderGeometry(0.06, 0.065, 0.14, 10), [0, NECK_Y + 0.05, 0]),
  scarf: merge(
    at(new THREE.TorusGeometry(0.12, 0.05, 8, 18), [0, NECK_Y, 0], [Math.PI / 2, 0, 0]),
    at(new THREE.SphereGeometry(0.055, 8, 6), [0.06, NECK_Y - 0.02, -0.12]),
  ),
  scarfTail: new THREE.BoxGeometry(0.075, 0.34, 0.025).translate(0, -0.17, 0),
  head: new THREE.SphereGeometry(HEAD_R, 24, 16),
  // The face is a decal over the front of the head; canvas left = viewer's left.
  face: new THREE.SphereGeometry(HEAD_R * 1.006, 24, 16, Math.PI * 1.5 - 0.8, 1.6, 1.05, 1.4),
  ponytail: hangingCone(0.1, 0.5),
  twintail: hangingCone(0.085, 0.55),
  hairTie: new THREE.SphereGeometry(0.045, 8, 6),
  ahoge: new THREE.TorusGeometry(0.07, 0.013, 5, 12, Math.PI * 1.15).translate(-0.07, 0, 0),
  thigh: new THREE.CapsuleGeometry(0.075, 0.24, 3, 10).translate(0, -0.195, 0),
  shin: new THREE.CapsuleGeometry(0.066, 0.25, 3, 10).translate(0, -0.19, 0),
  shoe: at(new THREE.CapsuleGeometry(0.062, 0.12, 3, 10), [0, -0.335, -0.05], [Math.PI / 2, 0, 0], [1.1, 1, 0.9]),
  // Arms + rifle live in aim space (pivot at the shoulders, -Z is where they're aiming).
  // Right arm (holds the rifle's grip, or the knife) and left arm (steadies the rifle's fore-end).
  sleeves: merge(limb([0.21, 0.02, 0.02], [0.27, -0.17, -0.02], 0.055), limb([0.27, -0.17, -0.02], [0.13, -0.1, -0.2], 0.048)),
  hands: at(new THREE.SphereGeometry(0.048, 8, 6), [0.13, -0.09, -0.22]),
  sleevesL: merge(limb([-0.21, 0.02, 0.02], [-0.17, -0.17, -0.26], 0.055), limb([-0.17, -0.17, -0.26], [0.07, -0.08, -0.5], 0.048)),
  handsL: at(new THREE.SphereGeometry(0.048, 8, 6), [0.08, -0.07, -0.52]),
  // With the knife out the left arm hangs relaxed instead of reaching for a fore-end.
  sleevesRest: merge(limb([-0.21, 0.02, 0.02], [-0.25, -0.2, 0.0], 0.055), limb([-0.25, -0.2, 0.0], [-0.26, -0.36, -0.05], 0.048)),
  handsRest: at(new THREE.SphereGeometry(0.048, 8, 6), [-0.26, -0.38, -0.06]),
  // Zombies: both arms reaching straight out, slightly droopy, with grabby hands.
  zombieSleeves: merge(limb([0.21, 0.02, 0.02], [0.2, -0.04, -0.42], 0.052), limb([-0.21, 0.02, 0.02], [-0.2, -0.06, -0.42], 0.052)),
  zombieHands: merge(
    at(new THREE.SphereGeometry(0.058, 8, 6), [0.2, -0.05, -0.47], [0, 0, 0], [1, 0.75, 1.2]),
    at(new THREE.SphereGeometry(0.058, 8, 6), [-0.2, -0.07, -0.47], [0, 0, 0], [1, 0.75, 1.2]),
  ),
  gunGreen: merge(
    at(new THREE.BoxGeometry(0.06, 0.13, 0.3), [0.12, -0.07, -0.1]),
    at(new THREE.BoxGeometry(0.075, 0.1, 0.46), [0.12, -0.04, -0.4]),
  ),
  gunDark: merge(
    at(new THREE.CylinderGeometry(0.018, 0.02, 0.62, 8), [0.12, -0.02, -0.93], [Math.PI / 2, 0, 0]),
    at(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 8), [0.12, -0.02, -1.25], [Math.PI / 2, 0, 0]),
    at(new THREE.CylinderGeometry(0.034, 0.034, 0.3, 10), [0.12, 0.06, -0.38], [Math.PI / 2, 0, 0]),
    at(new THREE.CylinderGeometry(0.046, 0.04, 0.06, 10), [0.12, 0.06, -0.55], [Math.PI / 2, 0, 0]),
    at(new THREE.CylinderGeometry(0.04, 0.044, 0.06, 10), [0.12, 0.06, -0.22], [Math.PI / 2, 0, 0]),
    at(new THREE.BoxGeometry(0.05, 0.1, 0.09), [0.12, -0.12, -0.3]),
  ),
};

const hairGeos = new Map<HairStyle, THREE.BufferGeometry>();

/** Hair shell + bangs + style-specific strands, all one mesh. Hanging tails are separate so they can sway. */
function hairGeo(style: HairStyle) {
  let g = hairGeos.get(style);
  if (g) return g;
  const R = HEAD_R * 1.05;
  const parts: THREE.BufferGeometry[] = [
    new THREE.SphereGeometry(R, 24, 8, 0, Math.PI * 2, 0, 1.15), // crown
    new THREE.SphereGeometry(R, 16, 8, -0.5, Math.PI + 1, 1.1, 1.15), // back and sides
  ];
  const down: Vec = [0, -1, 0];
  // Bangs over the forehead, longest in the middle.
  for (const a of [-0.62, -0.31, 0, 0.31, 0.62]) parts.push(strand(a, 0.78, a === 0 ? 0.17 : 0.15, 0.068, down, 0.45));
  const lock = style === 'bob' ? 0.34 : 0.24;
  for (const s of [-1, 1]) parts.push(strand(s * 1.2, 0.35, lock, 0.06, down, 0.25)); // side locks frame the face
  if (style === 'spiky') {
    const spikes: [number, number, number][] = [
      [0.4, 0.95, 0.24], [-0.4, 0.95, 0.24], [0, 1.25, 0.26], [1.0, 0.95, 0.24], [-1.0, 0.95, 0.24],
      [1.7, 0.6, 0.24], [-1.7, 0.6, 0.24], [2.4, 0.55, 0.27], [-2.4, 0.55, 0.27], [Math.PI, 0.75, 0.28],
      [Math.PI, 0.15, 0.24], [2.3, 0.0, 0.2], [-2.3, 0.0, 0.2],
    ];
    for (const [a, e, len] of spikes) parts.push(strand(a, e, len, 0.085, [0, 0.45, 0.4], 1));
  } else {
    // Soft volume at the nape.
    for (const a of [2.3, Math.PI, -2.3]) parts.push(strand(a, -0.25, style === 'bob' ? 0.3 : 0.2, 0.09, down, 0.3));
    if (style === 'bob') for (const s of [-1, 1]) parts.push(strand(s * 1.75, 0.2, 0.34, 0.08, down, 0.3));
  }
  g = merge(...parts);
  hairGeos.set(style, g);
  return g;
}

const accessoryGeos = new Map<Accessory, { geo: THREE.BufferGeometry; mat: 'hair' | 'inner' | 'jacket' }[]>();

function accessoryParts(acc: Accessory) {
  let parts = accessoryGeos.get(acc);
  if (parts) return parts;
  parts = [];
  if (acc === 'catears') {
    const ear = (r: number, h: number, inset: number) =>
      merge(
        ...[-1, 1].map((s) => {
          const base = onHead(s * 0.6, 0.95, HEAD_R * 1.0).add(new THREE.Vector3(0, 0, -inset));
          return aimed(new THREE.ConeGeometry(r, h, 4).translate(0, h / 2, 0), base, base.clone().normalize().add(new THREE.Vector3(0, 0.6, 0)));
        }),
      );
    parts.push({ geo: ear(0.085, 0.17, 0), mat: 'hair' }, { geo: ear(0.05, 0.12, 0.03), mat: 'inner' });
  } else if (acc === 'headband') {
    parts.push({
      geo: merge(
        // Ring hugging the hair on a plane tipped back (front higher), so the bangs show below it.
        at(new THREE.TorusGeometry(0.226, 0.02, 6, 28), [0, 0.136, 0.035], [Math.PI / 2 + 0.25, 0, 0]),
        at(new THREE.SphereGeometry(0.04, 8, 6), [0, 0.08, 0.235]),
        at(new THREE.BoxGeometry(0.05, 0.16, 0.015).translate(0, -0.08, 0), [0.03, 0.08, 0.245], [0.3, 0, 0.25]),
      ),
      mat: 'jacket',
    });
  } else if (acc === 'bow') {
    const c = onHead(0.95, 0.75, HEAD_R * 1.08);
    const loop = (s: number) => aimed(new THREE.ConeGeometry(0.06, 0.12, 6).translate(0, 0.06, 0), c, new THREE.Vector3(s, 0.35, 0.3));
    parts.push({ geo: merge(loop(1), loop(-1), at(new THREE.SphereGeometry(0.035, 8, 6), [c.x, c.y, c.z])), mat: 'jacket' });
  }
  accessoryGeos.set(acc, parts);
  return parts;
}

// ---------------------------------------------------------------------------
// Looks: per-player style + materials + face textures, cached by name/colour

interface Look {
  zombie: boolean;
  skin: THREE.Material;
  style: HairStyle;
  accessory: Accessory;
  ahoge: boolean;
  jacket: THREE.Material;
  hair: THREE.Material;
  scarf: THREE.Material;
  faces: Record<Expr, THREE.Material>;
}

const looks = new Map<string, Look>();

function lookFor(color: number, name = '', zombie = false, skin?: Skin | null): Look {
  const key = `${color}:${name}:${zombie}:${skin ? encodeSkin(skin) : ''}`;
  let look = looks.get(key);
  if (look) return look;
  const sk = skin ?? seededSkin(color, name);
  const hair = zombie ? ZOMBIE_HAIR[sk.hair % ZOMBIE_HAIR.length] : HAIR[sk.hair];
  const face = (e: Expr) =>
    new THREE.MeshBasicMaterial({ map: faceTexture(e, color, hair, sk.mouth), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const alive = zombie ? face('zombie') : null;
  look = {
    zombie,
    skin: zombie ? zombieSkinMat : skinMat,
    style: sk.style,
    accessory: sk.accessory,
    ahoge: sk.ahoge,
    jacket: toon(color),
    hair: toon(hair),
    scarf: toon(SCARF[sk.scarf]),
    faces: alive
      ? { open: alive, blink: alive, hype: alive, ko: face('ko'), zombie: alive }
      : { open: face('open'), blink: face('blink'), hype: face('hype'), ko: face('ko'), zombie: face('zombie') },
  };
  looks.set(key, look);
  return look;
}

/** `f` < 1 darkens towards black, > 1 lightens towards white. */
function shade(c: number, f: number) {
  const ch = [16, 8, 0].map((s) => {
    const v = (c >> s) & 255;
    return Math.round(f <= 1 ? v * f : v + (255 - v) * (f - 1));
  });
  return `rgb(${ch.join(',')})`;
}

/** Anime face on a transparent 256² canvas: big glossy eyes, blush hatching, and a mouth. */
function faceTexture(expr: Expr, iris: number, hair: number, mouth: Mouth) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const ink = '#2b1d18';
  const line = (w: number, style = ink) => {
    g.lineWidth = w;
    g.strokeStyle = style;
  };
  const ellipse = (x: number, y: number, rx: number, ry: number, a0 = 0, a1 = Math.PI * 2) => {
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, a0, a1);
  };
  g.lineCap = g.lineJoin = 'round';

  // Blush with the little diagonal hatching (zombies get sleepless purple rings instead).
  if (expr === 'zombie') {
    for (const s of [-1, 1]) {
      g.fillStyle = 'rgba(110,70,140,0.35)';
      ellipse(128 + s * 52, 132, 34, 40);
      g.fill();
    }
  } else for (const s of [-1, 1]) {
    const bx = 128 + s * 80;
    g.fillStyle = 'rgba(242,120,135,0.42)';
    ellipse(bx, 170, 22, 10);
    g.fill();
    line(2.5, 'rgba(214,80,100,0.7)');
    for (const k of [-1, 0, 1]) {
      g.beginPath();
      g.moveTo(bx + k * 9 - 3, 175);
      g.lineTo(bx + k * 9 + 4, 165);
      g.stroke();
    }
  }

  for (const s of [-1, 1]) {
    line(4, shade(hair, 0.55)); // eyebrow
    ellipse(128 + s * 52, 76, 24, 9, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();
    // Eyes are drawn around (0,0) and scaled up: anime eyes are *big*.
    g.save();
    g.translate(128 + s * 52, 120);
    g.scale(1.35, 1.35);
    const cx = 0;
    const cy = 0;
    if (expr === 'open') {
      g.save();
      ellipse(cx, cy, 24, 31);
      g.clip();
      g.fillStyle = '#fffdf8';
      g.fillRect(cx - 30, cy - 40, 60, 80);
      const grad = g.createLinearGradient(0, cy - 24, 0, cy + 30);
      grad.addColorStop(0, shade(iris, 0.3));
      grad.addColorStop(0.55, shade(iris, 0.85));
      grad.addColorStop(1, shade(iris, 1.45));
      g.fillStyle = grad;
      ellipse(cx, cy + 4, 19, 27);
      g.fill();
      g.fillStyle = shade(iris, 0.18);
      ellipse(cx, cy + 2, 8, 13);
      g.fill();
      g.fillStyle = '#fff';
      ellipse(cx - 7, cy - 8, 7, 9);
      g.fill();
      ellipse(cx + 8, cy + 14, 3.5, 3.5);
      g.fill();
      g.restore();
      line(7); // heavy upper lash
      ellipse(cx, cy, 25, 32, Math.PI * 1.08, Math.PI * 1.92);
      g.stroke();
      line(5);
      g.beginPath();
      g.moveTo(cx + s * 22, cy - 14);
      g.lineTo(cx + s * 32, cy - 21);
      g.stroke();
      line(2.5);
      ellipse(cx, cy, 22, 30, Math.PI * 0.3, Math.PI * 0.7);
      g.stroke();
    } else if (expr === 'zombie') {
      // Dead little eyes, mismatched: a big blank one and a small one with a pinprick pupil.
      const r = s < 0 ? 22 : 15;
      g.fillStyle = '#f4f7e8';
      ellipse(cx, cy, r, r);
      g.fill();
      line(5);
      g.stroke();
      g.fillStyle = ink;
      ellipse(cx + s * 3, cy + 2, 3.5, 3.5);
      g.fill();
    } else if (expr === 'blink') {
      line(6);
      ellipse(cx, cy - 4, 22, 11, Math.PI * 0.1, Math.PI * 0.9);
      g.stroke();
    } else {
      line(7);
      g.beginPath();
      if (expr === 'hype') {
        // > <  squeezed shut with excitement
        g.moveTo(cx + s * 14, cy - 15);
        g.lineTo(cx - s * 12, cy);
        g.lineTo(cx + s * 14, cy + 15);
      } else {
        // X X  knocked out
        g.moveTo(cx - 14, cy - 14);
        g.lineTo(cx + 14, cy + 14);
        g.moveTo(cx + 14, cy - 14);
        g.lineTo(cx - 14, cy + 14);
      }
      g.stroke();
    }
    g.restore();
  }

  line(2, 'rgba(120,70,50,0.6)'); // tiny nose
  g.beginPath();
  g.moveTo(129, 152);
  g.lineTo(127, 158);
  g.stroke();

  const openMouth = (w: number, depth: number) => {
    g.beginPath();
    g.moveTo(128 - w, 180);
    g.lineTo(128 + w, 180);
    g.quadraticCurveTo(128, 180 + depth * 2, 128 - w, 180);
    g.fillStyle = '#8a2d33';
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = '#f08a92';
    ellipse(128, 180 + depth, w * 0.6, depth * 0.45);
    g.fill();
    g.restore();
    line(3);
    g.stroke();
  };
  if (expr === 'zombie') {
    line(4); // stitched grimace
    g.beginPath();
    g.moveTo(104, 186);
    g.quadraticCurveTo(128, 178, 152, 188);
    g.stroke();
    line(2.5);
    for (let i = 0; i < 5; i++) {
      const x = 110 + i * 9;
      g.beginPath();
      g.moveTo(x, 177);
      g.lineTo(x + 2, 194);
      g.stroke();
    }
  } else if (expr === 'hype') openMouth(18, 18);
  else if (expr === 'ko') {
    line(3.5); // wobbly mouth + tongue out
    g.beginPath();
    g.moveTo(110, 186);
    for (let i = 1; i <= 6; i++) g.lineTo(110 + i * 6, 186 + (i % 2 ? -5 : 5));
    g.stroke();
    g.fillStyle = '#f08a92';
    ellipse(134, 194, 7, 9, 0, Math.PI);
    g.fill();
  } else if (mouth === 'cat') {
    line(3.5); // ω
    ellipse(119, 182, 9, 8, 0, Math.PI);
    g.stroke();
    ellipse(137, 182, 9, 8, 0, Math.PI);
    g.stroke();
  } else if (mouth === 'smile') openMouth(12, 10);
  else {
    line(3.5); // smirk with one anime fang
    g.beginPath();
    g.moveTo(113, 181);
    g.quadraticCurveTo(128, 193, 143, 181);
    g.stroke();
    g.beginPath();
    g.moveTo(131, 187);
    g.lineTo(140, 184);
    g.lineTo(136, 195);
    g.closePath();
    g.fillStyle = '#fff';
    g.fill();
    line(1.5);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, outline = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  if (outline) m.add(new THREE.Mesh(geo, outlineMat));
  parent.add(m);
  return m;
}

/** Adds the ink outline to every lit mesh under `obj` (glowing halos stay clean). */
function inked(obj: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  obj.traverse((o) => o instanceof THREE.Mesh && !(o.material instanceof THREE.MeshBasicMaterial) && meshes.push(o));
  for (const m of meshes) m.add(new THREE.Mesh(m.geometry, outlineMat));
  return obj;
}

function pivot(parent: THREE.Object3D, x: number, y: number, z: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** A chibi anime sniper with a streaming scarf. Root sits at the feet, facing -Z. */
export class Avatar {
  readonly root = new THREE.Group();
  readonly head: THREE.Group;
  private readonly lean = new THREE.Group();
  private readonly hips: THREE.Group;
  private readonly upper: THREE.Group;
  private readonly aim: THREE.Group;
  private readonly legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  private readonly scarfTails: THREE.Group[] = [];
  private readonly hairTails: THREE.Group[] = [];
  private readonly ahoge?: THREE.Group;
  private readonly rifle: THREE.Group;
  private readonly knife: THREE.Group;
  private scythe?: THREE.Object3D;
  private readonly rifleArm: THREE.Group;
  private readonly restArm: THREE.Group;
  private readonly wings: THREE.Object3D[] = [];
  private readonly face: THREE.Mesh;
  private readonly look: Look;
  private readonly vel = new THREE.Vector3();
  private lastTime = -1;
  private stride = 0;
  private air = 0;
  private slideAmt = 0;
  private nextBlink = 1 + Math.random() * 3;
  private nameTag?: THREE.Sprite;
  private clawT = 0; // seconds into the current swipe
  private zombieTime = 0;

  constructor(
    readonly color: number,
    name?: string,
    zombie = false,
    skin?: Skin | null,
    gear?: Gear | null,
  ) {
    const look = (this.look = lookFor(color, name, zombie, skin));
    this.root.add(this.lean);
    this.hips = pivot(this.lean, 0, HIP_Y, 0);
    this.upper = pivot(this.hips, 0, 0, 0);

    for (const s of [-1, 1]) {
      const hip = pivot(this.hips, s * 0.1, 0, 0);
      mesh(GEO.thigh, pantsMat, hip);
      const knee = pivot(hip, 0, -0.39, 0);
      mesh(GEO.shin, pantsMat, knee);
      mesh(GEO.shoe, shoeMat, knee);
      this.legs.push({ hip, knee });
    }

    mesh(GEO.jacket, look.jacket, this.upper);
    mesh(GEO.shirt, shirtMat, this.upper, false);
    mesh(GEO.neck, look.skin, this.upper);
    mesh(GEO.scarf, look.scarf, this.upper);
    for (const s of [-1, 1]) {
      const tail = pivot(this.upper, s * 0.045, NECK_Y, 0.12);
      tail.rotation.y = s * 0.2;
      mesh(GEO.scarfTail, look.scarf, tail);
      this.scarfTails.push(tail);
    }

    this.aim = pivot(this.upper, 0, AIM_Y, 0);
    if (zombie) {
      mesh(GEO.zombieSleeves, look.jacket, this.aim);
      mesh(GEO.zombieHands, look.skin, this.aim);
    } else {
      mesh(GEO.sleeves, look.jacket, this.aim);
      mesh(GEO.hands, look.skin, this.aim);
    }
    this.rifleArm = pivot(this.aim, 0, 0, 0);
    this.restArm = pivot(this.aim, 0, 0, 0);
    if (!zombie) {
      mesh(GEO.sleevesL, look.jacket, this.rifleArm);
      mesh(GEO.handsL, look.skin, this.rifleArm);
      mesh(GEO.sleevesRest, look.jacket, this.restArm);
      mesh(GEO.handsRest, look.skin, this.restArm);
    }
    this.restArm.visible = false;
    this.rifle = pivot(this.aim, 0, 0, 0);
    this.knife = pivot(this.aim, 0.13, -0.09, -0.24);
    if (!zombie) {
      const rifleItem = itemById(gear?.rifle ?? '');
      const paint = rifleItem?.slot === 'rifle' ? rifleItem.paint : undefined;
      const glow = (c: number) => new THREE.MeshToonMaterial({ color: c, gradientMap: toonRamp(), emissive: paint?.glow ? c : 0, emissiveIntensity: 0.35 });
      mesh(GEO.gunGreen, paint ? glow(paint.body) : gunGreenMat, this.rifle);
      mesh(GEO.gunDark, paint ? toon(paint.trim) : gunDarkMat, this.rifle);
      const knifeItem = itemById(gear?.knife ?? '');
      const blade = buildKnife(knifeItem?.slot === 'knife' ? knifeItem.paint : DEFAULT_KNIFE);
      blade.scale.setScalar(1.3);
      this.knife.add(inked(blade));
    }
    this.knife.visible = false;

    this.head = pivot(this.upper, 0, PLAYER.headCenter - HIP_Y, 0);
    mesh(GEO.head, look.skin, this.head);
    this.face = mesh(GEO.face, look.faces.open, this.head, false);
    this.face.name = 'face';
    mesh(hairGeo(look.style), look.hair, this.head);
    for (const part of accessoryParts(look.accessory)) {
      mesh(part.geo, part.mat === 'hair' ? look.hair : part.mat === 'inner' ? innerEarMat : look.jacket, this.head, part.mat !== 'inner');
    }
    for (const slot of ['hat', 'face', 'back'] as const) {
      const item = itemById(gear?.[slot] ?? '');
      if (zombie || !item || !('wear' in item)) continue;
      const w = inked(buildWear(item.wear));
      (slot === 'back' ? this.upper : this.head).add(w);
      w.traverse((o) => o.userData.wing && this.wings.push(o));
    }
    if (look.ahoge) {
      this.ahoge = pivot(this.head, 0.02, HEAD_R * 1.02, 0.02);
      this.ahoge.rotation.y = 0.4;
      mesh(GEO.ahoge, look.hair, this.ahoge);
    }
    const tails: [number, number, number, number][] =
      look.style === 'ponytail' ? [[0, 0.13, HEAD_R * 0.97, 0]] : look.style === 'twintails' ? [[-0.22, 0.1, 0.07, -1], [0.22, 0.1, 0.07, 1]] : [];
    for (const [x, y, z, side] of tails) {
      const p = pivot(this.head, x, y, z);
      p.userData.side = side;
      mesh(side ? GEO.twintail : GEO.ponytail, look.hair, p);
      mesh(GEO.hairTie, look.scarf, p);
      this.hairTails.push(p);
    }

    if (name) {
      this.nameTag = makeNameTag(name, color);
      this.nameTag.position.y = 2.3;
      this.root.add(this.nameTag);
    }
  }

  /**
   * Pose from network state. `wallSide` tilts the body into the wall: -1 left, 1 right, 0 none.
   * `sliding` drops into a baseball slide, legs first. Velocity is inferred from successive poses
   * and drives the run cycle, the jump tuck and how hard the scarf streams.
   */
  pose(x: number, y: number, z: number, yaw: number, pitch: number, wallSide: number, time: number, sliding = false) {
    const dt = this.lastTime < 0 ? 0 : clamp(time - this.lastTime, 0, 0.1);
    this.lastTime = time;
    if (dt > 0) {
      const p = this.root.position;
      const vx = (x - p.x) / dt;
      const vy = (y - p.y) / dt;
      const vz = (z - p.z) / dt;
      const k = Math.min(1, dt * 12);
      if (vx * vx + vy * vy + vz * vz > 60 * 60) this.vel.set(0, 0, 0); // respawn teleport
      else this.vel.set(mix(this.vel.x, vx, k), mix(this.vel.y, vy, k), mix(this.vel.z, vz, k));
    }
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;

    const v = this.vel;
    const hs = Math.hypot(v.x, v.z);
    const fwd = -Math.sin(yaw) * v.x - Math.cos(yaw) * v.z;
    const right = Math.cos(yaw) * v.x - Math.sin(yaw) * v.z;
    const ease = Math.min(1, dt * 10);
    this.air += ((Math.abs(v.y) > 0.8 ? 1 : 0) - this.air) * ease;
    this.slideAmt += ((sliding ? 1 : 0) - this.slideAmt) * 0.25;
    this.stride += hs * dt * 2.4;
    const amp = Math.min(1, hs / 4) * (1 - this.air);
    const slide = this.slideAmt;

    this.lean.rotation.z += (wallSide * 0.35 - this.lean.rotation.z) * 0.2;
    this.hips.position.y = HIP_Y - slide * 0.32 + Math.abs(Math.sin(this.stride)) * 0.04 * amp;
    // Lean back into the slide, forward into a sprint.
    const tilt = slide * 0.5 - Math.min(0.22, hs * 0.015) * (1 - slide);
    this.upper.rotation.x = tilt;
    this.legs.forEach((leg, i) => {
      const ph = this.stride + i * Math.PI;
      const run = Math.sin(ph) * 0.8 * amp;
      const runKnee = -(0.15 + 0.7 * (0.5 - 0.5 * Math.cos(ph))) * amp;
      const hip = mix(mix(run, i ? 0.9 : 0.2, this.air), 1.3, slide); // jump: one knee tucked up
      const knee = mix(mix(runKnee, i ? -1.4 : -0.5, this.air), i ? -0.15 : -0.6, slide);
      leg.hip.rotation.x = hip;
      leg.knee.rotation.x = knee;
    });

    // Keep the rifle and gaze on target whatever the body is doing.
    this.aim.rotation.x = pitch - tilt;
    this.knife.rotation.x = Math.PI / 2 - this.aim.rotation.x; // blade straight up whatever the pitch
    this.head.rotation.x = (pitch - tilt) * 0.6;
    this.head.rotation.z = Math.sin(time * 1.3 + this.nextBlink) * 0.04 - wallSide * 0.1;

    // Scarf and hair stream opposite the motion; falling lifts them.
    const flow = fwd + Math.max(0, -v.y) * 0.6;
    const flap = Math.min(1, (hs + Math.abs(v.y)) / 10);
    this.scarfTails.forEach((t, i) => {
      t.rotation.x = -0.15 - clamp(flow * 0.12, -1, 1.4) + Math.sin(time * 17 + i * 1.9) * 0.18 * flap;
      t.rotation.z = clamp(-right * 0.08, -0.7, 0.7) + Math.sin(time * 13 + i) * 0.1 * flap;
    });
    for (const t of this.hairTails) {
      const side = t.userData.side as number;
      t.rotation.x = -(side ? 0.1 : 0.45) - clamp(flow * 0.06, -0.5, 0.9) + Math.sin(time * 9 + side) * 0.08 * flap;
      t.rotation.z = side * 0.3 + clamp(-right * 0.04, -0.4, 0.4);
    }
    if (this.ahoge) {
      this.ahoge.rotation.z = Math.sin(time * 7) * 0.15;
      this.ahoge.rotation.x = -Math.min(0.7, hs * 0.04);
    }

    for (const w of this.wings) w.rotation.y = (w.userData.wing as number) * (0.08 + Math.sin(time * 11) * 0.4 * this.air);

    // Expressions: hyped at speed or mid-trick, otherwise blink every few seconds.
    if (time > this.nextBlink + 0.13) this.nextBlink = time + 2 + Math.random() * 3;
    const f = this.look.faces;
    this.face.material = sliding || wallSide !== 0 || hs > 13 ? f.hype : time > this.nextBlink ? f.blink : f.open;
  }

  /** Zombie pose: shamble with arms out, head lolling. Crouching = about to pounce; clawing = arms up, then swipe. */
  poseZombie(x: number, y: number, z: number, yaw: number, time: number, crouching: boolean, clawing: boolean) {
    this.pose(x, y, z, yaw, 0, 0, time);
    this.clawT = clawing ? this.clawT + Math.min(0.1, time - this.zombieTime) : 0;
    this.zombieTime = time;
    // Wind up over the swipe's windup, arms high, then chop down.
    const k = clamp(this.clawT / 0.45, 0, 1);
    const swing = clawing ? (k < 0.8 ? mix(0, 1.3, k / 0.8) : mix(1.3, -0.7, (k - 0.8) / 0.2)) : 0;
    this.aim.rotation.x = 0.1 + swing + Math.sin(time * 3.1 + this.nextBlink) * 0.06;
    this.aim.rotation.z = Math.sin(time * 2.3) * 0.08;
    this.head.rotation.z = 0.3 + Math.sin(time * 1.7 + this.nextBlink) * 0.12;
    this.head.rotation.x = 0.15;
    if (crouching) {
      this.hips.position.y = HIP_Y - 0.3;
      this.upper.rotation.x = -0.5;
      this.legs.forEach((leg) => {
        leg.hip.rotation.x = 1.1;
        leg.knee.rotation.x = -1.9;
      });
    }
  }

  /** A copy without the name tag, for flinging across the map. Knocked out, naturally. */
  /** Put on extra clothes (a zombie's work outfit): on the head, the torso, or the arms. */
  wear(obj: THREE.Object3D, on: 'head' | 'upper' | 'aim') {
    (on === 'head' ? this.head : on === 'upper' ? this.upper : this.aim).add(inked(obj));
  }

  /** Carrying the Gale Scythe: it takes the knife's place in hand. */
  holdScythe(on: boolean) {
    if (on && !this.scythe) {
      this.scythe = inked(buildScythe());
      this.scythe.scale.setScalar(1.3);
      this.knife.add(this.scythe);
    }
    if (this.scythe) this.scythe.visible = on;
    for (const c of this.knife.children) if (c !== this.scythe) c.visible = !on;
  }

  /** Knife out (true) or rifle out (false). */
  holdKnife(on: boolean) {
    this.knife.visible = on;
    this.rifle.visible = !on;
    this.rifleArm.visible = !on;
    this.restArm.visible = on;
  }

  cloneBody(): THREE.Group {
    const g = new THREE.Group();
    const inner = this.lean.clone(true);
    (inner.getObjectByName('face') as THREE.Mesh).material = this.look.faces.ko;
    g.add(inner);
    return g;
  }

  dispose() {
    this.root.removeFromParent();
    if (this.nameTag) {
      this.nameTag.material.map?.dispose();
      this.nameTag.material.dispose();
    }
  }
}

function makeNameTag(name: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '800 34px Manrope, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(52,38,26,0.8)';
  g.strokeText(name, 128, 34);
  g.fillStyle = '#' + color.toString(16).padStart(6, '0');
  g.fillText(name, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Depth-tested on purpose: tags showing through walls would be a free wallhack.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.renderOrder = 10;
  return sprite;
}

interface Corpse {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

/** Ragdoll-ish corpses: no physics, just yeeted along the shot direction, spinning, until they fall away. */
export class Corpses {
  readonly list: Corpse[] = [];
  constructor(private scene: THREE.Scene) {}

  spawn(body: THREE.Object3D, pos: THREE.Vector3, yaw: number, dir: THREE.Vector3, power: number): Corpse {
    body.position.copy(pos);
    body.rotation.y = yaw;
    this.scene.add(body);
    const vel = dir.clone().multiplyScalar(power).add(new THREE.Vector3(0, power * 0.35 + 4, 0));
    const spin = new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
    const c = { obj: body, vel, spin, life: 4 };
    this.list.push(c);
    return c;
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.life -= dt;
      c.vel.y -= 14 * dt;
      c.obj.position.addScaledVector(c.vel, dt);
      c.obj.rotation.x += c.spin.x * dt;
      c.obj.rotation.y += c.spin.y * dt;
      c.obj.rotation.z += c.spin.z * dt;
      if (c.life < 0.5) c.obj.scale.setScalar(Math.max(0.001, c.life * 2));
      if (c.life <= 0) {
        c.obj.removeFromParent();
        this.list.splice(i, 1);
      }
    }
  }
}
