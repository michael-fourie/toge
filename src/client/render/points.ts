// Sized, round particles that work on WebGPU, where THREE.Points only draws 1-pixel dots: one camera-facing quad per
// point (an instanced Sprite), placed from the geometry's positions.

import * as THREE from 'three/webgpu';
import { instancedDynamicBufferAttribute, materialColor, vec4 } from 'three/tsl';

/**
 * `geo`'s position (and colour, with vertexColors) attributes become per-instance data; keep writing into
 * `geo.attributes.position` and setting `needsUpdate` to move the points, as before.
 */
export function pointSprites(geo: THREE.BufferGeometry, params: THREE.PointsMaterialParameters | THREE.PointsNodeMaterial): THREE.Sprite {
  const mat = params instanceof THREE.PointsNodeMaterial ? params : new THREE.PointsNodeMaterial(params);
  const instanced = (name: string) => {
    const a = geo.getAttribute(name) as THREE.BufferAttribute;
    const inst = new THREE.InstancedBufferAttribute(a.array, a.itemSize);
    geo.setAttribute(name, inst);
    return inst;
  };
  const pos = instanced('position');
  mat.positionNode = instancedDynamicBufferAttribute(pos);
  if (mat.vertexColors) {
    const col = instancedDynamicBufferAttribute(instanced('color')) as unknown as THREE.Node<'vec3'>;
    mat.colorNode = materialColor.mul(vec4(col, 1));
    mat.vertexColors = false; // the sprite's own quad has no colour attribute
  }
  const sprite = new THREE.Sprite(mat);
  sprite.count = pos.count;
  sprite.frustumCulled = false;
  return sprite;
}
