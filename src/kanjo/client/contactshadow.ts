// Contact shadows: a soft dark patch on the road under every car, where the body shuts out the sky. The sun's
// shadow map draws the car's outline at a distance, but nothing darkened the ground right underneath, so cars
// looked pasted onto the tarmac (and on Low graphics, with no shadow map at all, they floated). One instanced
// quad for every car together: a single draw call, no texture (the shape is worked out in the shader).

import * as THREE from 'three';

const MAX = 24;

interface Caster {
  root: THREE.Object3D;
  /** The body's footprint (m) and its centre of gravity's height, where the root sits. */
  length: number;
  width: number;
  cg: number;
  /** 0..1: how firmly the car is on the ground (fades the patch as it leaves it). */
  grounded: () => number;
}

const vertexShader = /* glsl */ `
  attribute float shade;
  varying vec2 vP;
  varying float vShade;
  #include <fog_pars_vertex>
  void main() {
    vP = position.xz * 2.0;
    vShade = shade;
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const fragmentShader = /* glsl */ `
  uniform vec2 inner;
  varying vec2 vP;
  varying float vShade;
  #include <fog_pars_fragment>
  void main() {
    // A rounded box that fades out to the quad's edge: darkest under the middle of the car.
    vec2 q = max(abs(vP) - inner, 0.0) / (1.0 - inner);
    float a = 1.0 - smoothstep(0.0, 1.0, length(q));
    a *= a * vShade;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
    #ifdef USE_FOG
      // Fade into the fog with everything else.
      #ifdef FOG_EXP2
        gl_FragColor.a *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        gl_FragColor.a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
      #endif
    #endif
  }`;

export class ContactShadows {
  private mesh: THREE.InstancedMesh;
  private shade = new Float32Array(MAX);
  private casters: Caster[] = [];
  private m = new THREE.Matrix4();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3();

  constructor(scene: THREE.Scene, private strength = 0.62) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    geo.setAttribute('shade', new THREE.InstancedBufferAttribute(this.shade, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { inner: { value: new THREE.Vector2(0.45, 0.62) } }]),
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      fog: true,
      // Over the road and its markings, under skid marks (those sit at -6).
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -0.5; // after the backdrop, before smoke and ghosts
    scene.add(this.mesh);
  }

  add(root: THREE.Object3D, length: number, width: number, cg: number, grounded: () => number = () => 1) {
    if (this.casters.length < MAX) this.casters.push({ root, length, width, cg, grounded });
  }

  remove(root: THREE.Object3D) {
    this.casters = this.casters.filter((c) => c.root !== root);
  }

  /** Lays every patch under its car, after the cars are posed for the frame. */
  update() {
    const { m, p, s, up } = this;
    let n = 0;
    for (const c of this.casters) {
      const shade = c.root.visible ? c.grounded() : 0;
      if (shade <= 0.01) continue;
      // Straight down the car's own up axis to the road (so it lies flat on banked and sloping road too).
      up.set(0, 1, 0).applyQuaternion(c.root.quaternion);
      p.copy(c.root.position).addScaledVector(up, -c.cg + 0.02);
      s.set(c.width + 0.9, 1, c.length + 1.1);
      m.compose(p, c.root.quaternion, s);
      this.mesh.setMatrixAt(n, m);
      this.shade[n] = shade * this.strength;
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.getAttribute('shade').needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
