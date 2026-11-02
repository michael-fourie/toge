// The Driver page (hub.ts hosts it): every field of your driver as pills and swatches, grouped like a wardrobe,
// with Randomise and Reset. Changes show on the figure beside your car at once and save a moment later (free).

import { RIDER_FIELDS, RIDER_GROUPS, type Rider, type RiderField, riderField } from '../shared/rider.ts';
import { esc } from '../../client/menu/ui.ts';
import { ICON } from './brand.ts';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

const GROUP_NOTE: Record<string, string> = {
  Body: '',
  Face: '',
  Hair: '',
  Top: 'Jackets get a ribbed trim and a chest print',
  Bottoms: '',
  Gear: 'Headwear and gear take the trim colour',
  Pose: 'How you wait by the car',
};

function field(r: Rider, f: RiderField, first: boolean): string {
  const v = r[f.key];
  const auto = first ? ' data-autofocus' : '';
  const body = f.colors
    ? `<div class="tg-swatches">${f.colors
        .map((c, i) => `<button class="tg-sw" data-rider="${f.key}" data-v="${i}" aria-pressed="${v === i}" title="${esc(f.options[i])}" aria-label="${esc(f.label)}: ${esc(f.options[i])}" style="--sw:${hex(c)}"${i === 0 ? auto : ''}></button>`)
        .join('')}</div>`
    : `<div class="tg-seg">${f.options.map((o, i) => `<button class="tg-pill" data-rider="${f.key}" data-v="${i}" aria-pressed="${v === i}"${i === 0 ? auto : ''}>${esc(o)}</button>`).join('')}</div>`;
  return `<div class="tg-field"><span class="tg-label">${esc(f.label)} <small>${esc(f.options[v])}</small></span>${body}</div>`;
}

/** The page body. */
export function driverTab(r: Rider, status: string): string {
  let first = true;
  const groups = RIDER_GROUPS.map((g) => {
    const fields = RIDER_FIELDS.filter((f) => f.group === g && (!f.needs || r[f.needs] !== 0));
    const html = fields.map((f) => field(r, f, first && !(first = false))).join('');
    const note = GROUP_NOTE[g];
    return `<div class="tg-group tg-cardbox tg-rider-group"><h2 class="tg-h">${esc(g)}${note ? ` <small>${esc(note)}</small>` : ''}</h2>${html}</div>`;
  }).join('');
  return `
    <p class="tg-lede">Your driver waits by your car and lines up with the crew in race lobbies. Free to change, any time.</p>
    <div class="tg-row tg-rider-actions">
      <button class="tg-go alt small" data-rider-random>${ICON.spin}Randomise</button>
      <button class="tg-pill" data-rider-reset>Reset</button>
    </div>
    ${groups}
    <p class="tg-status" role="status" data-status>${esc(status)}</p>`;
}

/** The card bottom right on the Driver page: who's on the platform. */
export function driverCard(r: Rider, name: string): string {
  const pick = (k: Parameters<typeof riderField>[0]) => riderField(k).options[r[k]];
  return `
    <p class="tg-card-ribbon cyan">Your driver</p>
    <div class="tg-card-head"><div><small>${esc(pick('build'))} · ${esc(pick('height'))}</small><h2 class="tg-title">${esc(name)}</h2></div></div>
    <dl class="tg-specs tg-rider-specs">
      <div><dt>Hair</dt><dd>${esc(pick('hair'))}</dd></div>
      <div><dt>Top</dt><dd>${esc(pick('top'))}</dd></div>
      <div><dt>Pose</dt><dd>${esc(pick('pose'))}</dd></div>
    </dl>
    <p class="tg-card-hint">${ICON.spin} Drag or right stick to turn</p>`;
}
