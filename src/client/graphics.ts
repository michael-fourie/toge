// The site's graphics setting, saved per device: 'high' (everything on) or 'low' (laptops and older machines:
// native-or-lower resolution, no shadows, no post effects, simple materials, a frame cap). KANJO's Settings tab sets
// it; both games read it when they build their renderer, so a change applies to the next race or match.

export type Graphics = 'high' | 'low';

const KEY = 'atrous.graphics';
/** The choice in this tab, for when storage is blocked (it then lasts until reload). */
let held: Graphics | null = null;

export function graphics(): Graphics {
  if (held) return held;
  try {
    return localStorage.getItem(KEY) === 'low' ? 'low' : 'high';
  } catch {
    return 'high';
  }
}

export function setGraphics(g: Graphics) {
  held = g;
  try {
    localStorage.setItem(KEY, g);
  } catch {
    // blocked storage: `held` keeps it for this visit
  }
  globalThis.dispatchEvent?.(new CustomEvent('graphicschange', { detail: g }));
}

/** True on Low. */
export const lowGraphics = () => graphics() === 'low';

/** Low draws at most this many CSS pixels per screen pixel (1: a retina laptop renders a quarter of the pixels). */
export const LOW_PIXEL_RATIO = 1;

/**
 * Frame-rate cap: on Low, a frame is skipped unless `fps`' worth of time has passed since the last one drawn. Returns
 * a function to call at the top of each requestAnimationFrame: true means draw this frame. High never skips.
 */
export function frameGate(fps: number): (now: number) => boolean {
  const low = lowGraphics();
  const step = 1000 / fps;
  let next = -Infinity;
  return (now) => {
    if (!low) return true;
    // A little slack, so a 60 Hz screen never drops to 30 under a 60 fps cap; keeping the beat (next += step) rather
    // than restarting it from `now` keeps a 144 Hz screen near 60 too, not every third frame (48).
    if (now < next - 2) return false;
    next = now - next > step ? now + step : next + step;
    return true;
  };
}

/** The parts of a THREE.WebGLRenderer that `releaseRenderer` uses (typed loosely so tests can pass a stand-in). */
export interface Releasable {
  dispose(): void;
  forceContextLoss(): void;
  domElement: { remove(): void };
}

/**
 * Tears down a renderer for good: frees its GPU objects, gives its WebGL context back, and takes its canvas off
 * the page. `dispose()` alone isn't enough. Materials, geometries and textures that outlive a race (cached
 * cosmetics, shared trims, the driver models) keep a dispose listener that points back at every renderer that
 * ever drew them, so a disposed renderer is never garbage collected and its context, with the screen-sized
 * buffers, shadow map and every texture it uploaded, stayed alive: hundreds of MB of graphics memory per race until
 * the GPU ran out and the tab crashed or lost its context. Losing the context on purpose frees that memory now,
 * whatever still points at the renderer. Every renderer that isn't one long-lived offscreen singleton goes out
 * through here (tests/graphics.test.ts checks).
 */
export function releaseRenderer(r: Releasable) {
  r.dispose();
  try {
    r.forceContextLoss();
  } catch {
    // no WEBGL_lose_context, or already lost: nothing more to free
  }
  r.domElement.remove();
}
