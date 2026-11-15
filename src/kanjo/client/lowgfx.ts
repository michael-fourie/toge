// Low graphics (the Settings tab; src/client/graphics.ts): while a frame is drawn, every lit PBR material
// (MeshStandard / MeshPhysical: clear coat, environment reflections, normal maps) is stood in for by a plain copy
// with the same colour, textures and glow: Lambert, or Phong for clear-coated paint and glass. Those shade each pixel
// with a fraction of the work, which is most of the GPU time on an integrated laptop chip. The swap lasts only for the
// draw: the game keeps its own materials (and keeps changing them, e.g. brake lights), so nothing else needs to know.

import * as THREE from 'three';

type Pbr = THREE.MeshStandardMaterial;

type Cheap = THREE.MeshLambertMaterial | THREE.MeshPhongMaterial;
const copies = new WeakMap<THREE.Material, Cheap>();

function lambertOf(m: Pbr): Cheap {
  let c = copies.get(m);
  if (c) return c;
  // Clear-coated things (paint, glass, chrome, rims) take Phong instead: still cheap, but a sun highlight keeps a
  // dark car from reading as a black hole without the sky reflections.
  const coat = (m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial === true;
  const Kind = coat ? THREE.MeshPhongMaterial : THREE.MeshLambertMaterial;
  c = new Kind({
    color: m.color,
    map: m.map,
    alphaMap: m.alphaMap,
    emissive: m.emissive,
    emissiveMap: m.emissiveMap,
    emissiveIntensity: m.emissiveIntensity,
    vertexColors: m.vertexColors,
    side: m.side,
    transparent: m.transparent,
    opacity: m.opacity,
    alphaTest: m.alphaTest,
    depthWrite: m.depthWrite,
    depthTest: m.depthTest,
    blending: m.blending,
    flatShading: m.flatShading,
    fog: m.fog,
    polygonOffset: m.polygonOffset,
    polygonOffsetFactor: m.polygonOffsetFactor,
    polygonOffsetUnits: m.polygonOffsetUnits,
  });
  // Metals are mostly reflection: as plain diffuse they'd go near black (or chalky), so meet in the middle.
  if (m.metalness > 0.5) c.color.multiplyScalar(0.75);
  if (coat) {
    const p = c as THREE.MeshPhongMaterial;
    p.specular.setScalar(0.35);
    p.shininess = 60;
    // Black paint is mostly reflection: lift it to a dark grey so the body's shape still shows.
    p.color.setRGB(Math.max(p.color.r, 0.04), Math.max(p.color.g, 0.04), Math.max(p.color.b, 0.045));
  }
  // A custom shader tweak on the original (the terrain's macro texture) works on Lambert too: same chunk names.
  if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) c.onBeforeCompile = m.onBeforeCompile;
  copies.set(m, c);
  const copy = c;
  m.addEventListener('dispose', function gone() {
    m.removeEventListener('dispose', gone);
    copy.dispose();
    copies.delete(m);
  });
  return c;
}

const isPbr = (m: THREE.Material): m is Pbr => (m as Pbr).isMeshStandardMaterial === true;

/** The swap for one material, with what the game changes from frame to frame carried over. */
function stand(m: THREE.Material): THREE.Material {
  if (!isPbr(m)) return m;
  const c = lambertOf(m);
  c.emissiveIntensity = m.emissiveIntensity;
  c.opacity = m.opacity;
  c.transparent = m.transparent;
  c.depthWrite = m.depthWrite;
  c.visible = m.visible;
  return c;
}

/**
 * Draws `scene` with Lambert stand-ins for its PBR materials (see the top of the file), via `draw`, then puts every
 * material back.
 */
export function drawLow(scene: THREE.Object3D, draw: () => void) {
  const put: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
  scene.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const was = mesh.material;
    const now = Array.isArray(was) ? was.map(stand) : stand(was);
    if (now === was || (Array.isArray(was) && (now as THREE.Material[]).every((m, i) => m === was[i]))) return;
    put.push([mesh, was]);
    mesh.material = now;
  });
  try {
    draw();
  } finally {
    for (const [mesh, was] of put) mesh.material = was;
  }
}
