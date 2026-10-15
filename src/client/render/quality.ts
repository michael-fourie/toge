// Graphics quality: what the renderer turns on. `auto` picks by device; `?gfx=low|high|ultra` overrides for testing.

import { type Graphics, loadSettings } from '../settings.ts';
import { IS_TOUCH } from '../touch.ts';

export type Quality = Exclude<Graphics, 'auto'>;

export const QUALITY_NAME: Record<Graphics, string> = {
  auto: 'Auto',
  low: 'Low (fast)',
  high: 'High',
  ultra: 'Ultra',
};

export interface QualityProfile {
  /** Screen-space ambient occlusion (GTAO). */
  ao: boolean;
  /** Temporal anti-aliasing (TRAA); otherwise FXAA after the post chain, or MSAA without one. */
  taa: boolean;
  /** The post chain at all (AO, bloom, grading). Low renders straight to the screen with MSAA. */
  post: boolean;
  bloom: boolean;
  /** Sun shadow map size. */
  shadowMap: number;
  pixelRatioCap: number;
}

const PROFILES: Record<Quality, QualityProfile> = {
  low: { ao: false, taa: false, post: false, bloom: false, shadowMap: 1024, pixelRatioCap: 1.25 },
  high: { ao: true, taa: false, post: true, bloom: true, shadowMap: 2048, pixelRatioCap: 1.5 },
  ultra: { ao: true, taa: true, post: true, bloom: true, shadowMap: 4096, pixelRatioCap: 2 },
};

export function resolveQuality(): Quality {
  const forced = new URLSearchParams(location.search).get('gfx');
  if (forced === 'low' || forced === 'high' || forced === 'ultra') return forced;
  const s = loadSettings().graphics;
  if (s !== 'auto') return s;
  return IS_TOUCH ? 'low' : 'ultra';
}

export const profile = (q: Quality): QualityProfile => PROFILES[q];
