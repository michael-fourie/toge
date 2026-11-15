// Soft cel shading for the drivers (driver.ts, wardrobe.ts). The models are built cartoonish (tools/drivers:
// big heads and eyes, flat skin tones, pastel cloth), and this is the other half of that look: a lit material's
// direct light stops fading smoothly round a form and falls into two soft bands instead, lit and shade, like a
// painted cel. The shade band is never dark (`TOON.shade` of the light still reaches it, on every side), so a driver
// keeps their colour under one showroom spot or at night. Sky and garage reflections stay as they were, as a
// gentle fill.
//
// It's a patch on the material's own shader (MeshStandard / MeshPhysical, and the Lambert / Phong stand-ins Low
// graphics draws with, which copy `onBeforeCompile`), not a new material: maps, skinning, the wardrobe's recolour,
// alpha cards, fog, shadows and the glow all keep working, and it costs a `smoothstep` per light.

import * as THREE from 'three';

export const TOON = {
  /** Where the lit band ends, on the wrapped light (0 facing away, 0.5 side on, 1 facing the light). */
  edge: 0.46,
  /** Half the width of the blend between the bands: soft, so nothing aliases and faces don't get a hard mask. */
  soft: 0.09,
  /** The share of a light that reaches the shade band. */
  shade: 0.42,
  /** Scales the lit band: wrapped light is brighter all round than Lambert's, so it's brought back down. */
  gain: 0.66,
  /** Light every surface gives off in its own colour, so the deepest shade is still a colour, not black. */
  floor: 0.05,
};

// Only the diffuse light is banded. Highlights keep the true angle: a GGX highlight fed light on a face turned away
// from it blows up into white sparkles.
const DOT = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert(';
const BANDED = 'reflectedLight.directDiffuse += toonBand( dot( geometryNormal, directLight.direction ) ) * directLight.color * BRDF_Lambert(';
const f = (x: number) => x.toFixed(4);
const BAND = `
float toonBand( float d ) {
	float lit = smoothstep( ${f(TOON.edge - TOON.soft)}, ${f(TOON.edge + TOON.soft)}, d * 0.5 + 0.5 );
	return mix( ${f(TOON.shade)}, 1.0, lit ) * ${f(TOON.gain)};
}`;
/** The lighting chunks of the materials a driver is drawn with (High: physical; Low: lambert and phong). */
const CHUNKS = ['lights_physical_pars_fragment', 'lights_lambert_pars_fragment', 'lights_phong_pars_fragment'] as const;

const done = new WeakSet<THREE.Material>();

type Lit = THREE.MeshStandardMaterial;

/**
 * Gives a lit material the drivers' soft cel shading, once (unlit ones, like the pass gear's glow, are left alone).
 * Whatever shader patch it already has (the wardrobe's recolour) still runs first.
 */
export function toon<T extends THREE.Material>(m: T): T {
  if (done.has(m) || !(m as unknown as Lit).isMeshStandardMaterial) return m;
  done.add(m);
  const before = m.onBeforeCompile;
  const key = m.customProgramCacheKey;
  m.onBeforeCompile = (s, r) => {
    before.call(m, s, r);
    let frag = s.fragmentShader.replace('#include <common>', `#include <common>${BAND}`);
    for (const c of CHUNKS) frag = frag.replace(`#include <${c}>`, THREE.ShaderChunk[c].replace(DOT, BANDED));
    s.fragmentShader = frag.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * ${f(TOON.floor)};`);
  };
  // The patch is the same text for every driver material; what ran before it keeps its own key.
  m.customProgramCacheKey = () => `toon|${before === THREE.Material.prototype.onBeforeCompile ? '' : key.call(m)}`;
  return m;
}

/** `toon()` on every material under `root`. */
export function toonAll(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) toon(x);
  });
}

/** A copy of a driver's material that keeps its shader patches (three's `clone()` drops them). */
export function cloneToon<T extends THREE.Material>(src: T): T {
  const c = src.clone();
  c.onBeforeCompile = src.onBeforeCompile;
  c.customProgramCacheKey = src.customProgramCacheKey;
  if (done.has(src)) done.add(c);
  return c;
}
