// The Settings page (hub.ts hosts it): device settings, saved in this browser. For now one: Graphics, High or Low
// (src/client/graphics.ts). The showroom rebuilds at once when it changes; a race picks it up when it starts.

import { type Graphics } from '../../client/graphics.ts';
import { esc } from '../../client/menu/ui.ts';

const MODES: { id: Graphics; name: string; for: string; what: string[] }[] = [
  {
    id: 'high',
    name: 'High',
    for: 'Gaming PCs and desktop graphics cards',
    what: ['Full resolution on high-DPI screens, anti-aliased', 'Soft sun shadows', 'Reflective paint and chrome', 'Bloom and film grade', 'Full forests', 'Your screen’s full frame rate'],
  },
  {
    id: 'low',
    name: 'Low',
    for: 'Laptops: runs cooler and quieter',
    what: ['Standard resolution, no anti-aliasing (softer on high-DPI screens)', 'No shadows', 'Simple matte lighting', 'No bloom or post effects, no clouds', 'Half the trees, thinned out further away', 'Capped at 60 fps (30 in the garage)'],
  },
];

/** The page body. */
export function settingsTab(g: Graphics, status: string): string {
  return `
    <p class="tg-lede">Saved on this device. Graphics apply to TŌGE and Gambol.</p>
    <div class="tg-group tg-cardbox">
      <h2 class="tg-h">Graphics <small>Takes effect in the garage now, in races from the next one</small></h2>
      <div class="tg-gfx" role="group" aria-label="Graphics">
        ${MODES.map(
          (m) => `
          <button class="tg-gfx-opt" data-graphics="${m.id}" aria-pressed="${m.id === g}"${m.id === g ? ' data-autofocus' : ''}>
            <span class="tg-title">${esc(m.name)}</span>
            <small>${esc(m.for)}</small>
            <ul>${m.what.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
          </button>`,
        ).join('')}
      </div>
    </div>
    <p class="tg-status" role="status" data-status>${esc(status)}</p>`;
}
