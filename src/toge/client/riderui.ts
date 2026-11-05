// The Driver page (hub.ts hosts it): the four drivers as cards, each in their glow colour. A pick shows on the
// platform beside your car at once and saves a moment later (free).

import { RIDERS, RIDER_IDS, type Rider } from '../shared/rider.ts';
import { esc } from '../../client/menu/ui.ts';
import { ICON } from './brand.ts';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** The page body. */
export function driverTab(r: Rider, status: string): string {
  const cards = RIDER_IDS.map((id) => {
    const d = RIDERS[id];
    const on = id === r;
    return `<button class="tg-driver tg-cardbox" data-rider="${id}" aria-pressed="${on}" style="--c:${hex(d.color)}"${on ? ' data-autofocus' : ''}>
      <small>${esc(d.tag)}</small><b>${esc(d.name)}</b><em>“${esc(d.nick)}”</em>${on ? '<span class="tg-tag">Driving</span>' : ''}
    </button>`;
  }).join('');
  return `
    <p class="tg-lede">Your driver sits in every car you race, rides your bike, waits by your car and lines up with the crew in race lobbies. Free to change, any time.</p>
    <div class="tg-drivers">${cards}</div>
    <p class="tg-status" role="status" data-status>${esc(status)}</p>`;
}

/** The card bottom right on the Driver page: who's on the platform. */
export function driverCard(r: Rider): string {
  const d = RIDERS[r];
  return `
    <p class="tg-card-ribbon cyan">Your driver</p>
    <div class="tg-card-head"><div><small>${esc(d.tag)}</small><h2 class="tg-title">${esc(d.name)}</h2></div></div>
    <p class="tg-nick" style="--c:${hex(d.color)}">“${esc(d.nick)}”</p>
    <p class="tg-bio">${esc(d.bio)}</p>
    <p class="tg-card-hint">${ICON.spin} Drag or right stick to turn</p>`;
}
