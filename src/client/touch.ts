import './touch.css';

// Is this a phone or tablet? Everything mobile hangs off this one check (plus the `touch` class on <html>
// for CSS), so the desktop page and game never change. `?touch=1` forces it on for testing on a desktop.

export const IS_TOUCH =
  (typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches) ||
  (typeof location !== 'undefined' && new URLSearchParams(location.search).has('touch'));

/** Marks the page for the touch styles and adds the "rotate your phone" card (CSS shows it only in portrait). */
export function setupTouchPage() {
  if (!IS_TOUCH) return;
  document.documentElement.classList.add('touch');
  const hint = document.createElement('div');
  hint.className = 'rotate-hint';
  hint.setAttribute('role', 'alert');
  hint.innerHTML = `<div class="rotate-card"><div class="rotate-phone" aria-hidden="true"><i></i></div><b>Rotate your phone</b><span>Gambol plays sideways</span></div>`;
  document.body.appendChild(hint);
}

/** Phones: go fullscreen and hold landscape when a match starts (needs a tap; quietly does nothing where unsupported). */
export function goFullscreen() {
  if (!IS_TOUCH) return;
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => {});
}
