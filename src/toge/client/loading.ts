// TŌGE's own loading screen, shown while a race builds (main.ts drive()). It previews the road you're about to
// run: the theme's painted backdrop, the track's name and kind, its map drawing itself, a racing tip and a
// progress sweep. Pure DOM, no WebGL, so it paints instantly. See src/toge/DESIGN.md §8 (Loading).

import './loading.css';
import { TRACK_LENGTH_KM } from '../shared/garage.ts';
import { TRACK_DEFS } from '../shared/track.ts';
import { esc } from '../../client/menu/ui.ts';
import { LOGO } from './brand.ts';
import { trackKind, trackMap, trackStyle } from './trackart.ts';
import { LOADING_TIPS, type LoadingRun, raceKm, runLabel } from './loadingcopy.ts';

/** The loading screen's markup. */
export function loadingHtml(r: LoadingRun, tip = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)]): string {
  const d = TRACK_DEFS[r.track];
  const km = r.online?.mode === 'endurance' ? raceKm(r.track, r.online.laps) : TRACK_LENGTH_KM[r.track];
  // The road draws itself: pathLength="1" lets the CSS animate the dash from 1 to 0 whatever the road's length.
  const map = trackMap(r.track).replace('class="tg-map-road"', 'class="tg-map-road" pathLength="1"');
  return `<div class="tg-ld-art" aria-hidden="true"></div><div class="tg-ld-shade" aria-hidden="true"></div>
    <header class="tg-ld-top">${LOGO}<span class="tg-label tg-ld-run">${esc(runLabel(r))}</span></header>
    <main class="tg-ld-main">
      <div class="tg-ld-copy">
        <p class="tg-label tg-ld-eyebrow">${esc(trackKind(r.track, r.online?.mode === 'endurance' ? r.online.laps : undefined))} · <span class="tg-num">${km} km</span></p>
        <h1 class="tg-ld-name">${esc(d.name)}</h1>
        <p class="tg-ld-tag">${esc(d.tag)}</p>
        <div class="tg-kerb tg-ld-kerb" aria-hidden="true"></div>
      </div>
      <div class="tg-ld-map">${map}</div>
    </main>
    <footer class="tg-ld-foot">
      <p class="tg-ld-tip"><span class="tg-label">Tip</span>${esc(tip)}</p>
      <div class="tg-ld-bar" role="progressbar" aria-label="Loading the track"><i></i></div>
      <div class="tg-ld-status"><span class="tg-label">Loading the pass</span><span class="tg-ld-tagline">Own the pass.</span></div>
    </footer>`;
}

/**
 * Covers the screen with the TŌGE loading card. Returns `hide`, which keeps it up at least ~1.1 s (so the map has
 * time to draw and it never flashes) and then fades it out.
 */
export function showTogeLoading(r: LoadingRun): () => void {
  const el = document.createElement('div');
  el.className = `tg tg-loader ${TRACK_DEFS[r.track].theme}`;
  el.setAttribute('style', trackStyle(r.track));
  el.innerHTML = loadingHtml(r);
  document.body.appendChild(el);
  const shownAt = performance.now();
  return () => {
    setTimeout(
      () => {
        el.classList.add('done');
        setTimeout(() => el.remove(), 600);
      },
      Math.max(0, 1100 - (performance.now() - shownAt)),
    );
  };
}
