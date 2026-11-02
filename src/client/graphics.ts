// The site's graphics setting, saved per device: 'high' (everything on) or 'low' (laptops and older machines:
// native-or-lower resolution, no shadows, no post effects, simple materials, a frame cap). TŌGE's Settings tab sets
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
