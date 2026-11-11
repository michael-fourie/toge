// Track pictures for the menus (hub.ts, lobby.ts): a theme sky with the theme's painted backdrop on the horizon,
// and the road drawn from above as a map. Pure DOM strings, no WebGL. See src/toge/DESIGN.md (track tile).

import { TRACK_LENGTH_KM } from '../shared/garage.ts';
import { RACE_TRACKS, TRACK_DEFS, type Theme, type TrackId } from '../shared/track.ts';
import { CUPS, cupKm, type CupId } from '../shared/cups.ts';
import { esc } from '../../client/menu/ui.ts';

/** Each theme's menu sky (top, horizon) and accent. Keep the mood in step with LOOKS in trackview.ts. */
export const THEME_ART: Record<Theme, { sky: [string, string]; accent: string }> = {
  alpine: { sky: ['#5f86b8', '#d8e4ef'], accent: '#9fd3ff' },
  coast: { sky: ['#3a7fc0', '#f3d6a8'], accent: '#5fd0ff' },
  desert: { sky: ['#d9733a', '#f5c98a'], accent: '#ff9a4a' },
  night: { sky: ['#070b1e', '#24305a'], accent: '#8fa8ff' },
  autumn: { sky: ['#c4572c', '#f2b46b'], accent: '#ff7b3a' },
  spring: { sky: ['#e59bbd', '#fbe1e6'], accent: '#ff8fc0' },
  city: { sky: ['#0a0718', '#3a1748'], accent: '#ff3d9a' },
};

/** The tracks you race solo or in a race / time trial lobby (hill-climb roads only run in a lobby's Hill climb). */
export const TRACK_IDS = RACE_TRACKS.filter((id) => !TRACK_DEFS[id].climb);

/** How far a road climbs from start to finish (m; negative = a descent). */
export const trackClimb = (id: TrackId) => {
  const p = TRACK_DEFS[id].points;
  return Math.round(p[p.length - 1][1] - p[0][1]);
};

/** What kind of road it is, for the eyebrow over the name. */
export function trackKind(id: TrackId): string {
  const d = TRACK_DEFS[id];
  if (d.world) return 'Open world · free roam';
  if (d.traffic) return 'City · live traffic';
  if (d.laps) return `Circuit · ${d.laps} laps`;
  if (d.climb) return `Hill climb · ${trackClimb(id)} m up`;
  if (d.clean) return 'Mountain pass · time trial';
  return 'Mountain pass';
}

/** CSS custom properties for a track's art: --sky1/--sky2/--accent and the backdrop image. */
export function trackStyle(id: TrackId): string {
  const theme = TRACK_DEFS[id].theme;
  const a = THEME_ART[theme];
  return `--sky1:${a.sky[0]};--sky2:${a.sky[1]};--accent:${a.accent};--art:url(/race/backdrops/${theme}.webp)`;
}

const maps = new Map<TrackId, string>();

/**
 * The road seen from above as an SVG path through its control points (Catmull-Rom, so it's smooth), fitted into
 * a 100 × 60 box. Circuits close the loop. A red dot marks the start; a pass gets a chequered end.
 */
export function trackMap(id: TrackId): string {
  const hit = maps.get(id);
  if (hit) return hit;
  const d = TRACK_DEFS[id];
  const pts = d.points.map(([x, , z]) => [x, z] as [number, number]);
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const W = 100;
  const H = 60;
  const pad = 6;
  const k = Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, z1 - z0));
  const ox = (W - (x1 - x0) * k) / 2;
  const oz = (H - (z1 - z0) * k) / 2;
  const p = pts.map(([x, z]) => [ox + (x - x0) * k, oz + (z - z0) * k] as [number, number]);
  const closed = !!d.laps || !!d.world;
  const at = (i: number) => (closed ? p[(i + p.length) % p.length] : p[Math.max(0, Math.min(p.length - 1, i))]);
  const f = (n: number) => n.toFixed(1);
  let path = `M${f(p[0][0])} ${f(p[0][1])}`;
  const segs = closed ? p.length : p.length - 1;
  for (let i = 0; i < segs; i++) {
    const [a, b, c, e] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6];
    const c2 = [c[0] - (e[0] - b[0]) / 6, c[1] - (e[1] - b[1]) / 6];
    path += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(c[0])} ${f(c[1])}`;
  }
  if (closed) path += 'Z';
  const end = p[p.length - 1];
  const svg = `<svg class="tg-map" viewBox="0 0 ${W} ${H}" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
    <path d="${path}" class="tg-map-under"/><path d="${path}" class="tg-map-road"/>
    ${closed ? '' : `<circle cx="${f(end[0])}" cy="${f(end[1])}" r="2.6" class="tg-map-end"/>`}
    <circle cx="${f(p[0][0])}" cy="${f(p[0][1])}" r="2.6" class="tg-map-start"/></svg>`;
  maps.set(id, svg);
  return svg;
}

/** A compact track tile (a button): art, map, name and length. `attrs` goes on the button. */
export function trackTile(id: TrackId, attrs: string): string {
  const d = TRACK_DEFS[id];
  return `<button class="tg-track ${d.theme}" style="${trackStyle(id)}" ${attrs}>
    <span class="tg-track-art" aria-hidden="true"></span>${trackMap(id)}
    <b>${esc(d.name)}</b><small>${d.laps ? `${d.laps} laps · ` : ''}${TRACK_LENGTH_KM[id]} km${d.climb ? ` · ${trackClimb(id)} m up` : ''}</small></button>`;
}

/**
 * A Grand Prix cup card (a button): the cup's colour and name, its line, and its rounds as little track strips
 * (art, map, name) in order. `at`: the round under way, marked (and the ones before it dimmed as raced).
 */
export function cupCard(id: CupId, attrs: string, at = -1): string {
  const c = CUPS[id];
  const rounds = c.tracks
    .map((t, i) => `<li class="${i === at ? 'now' : i < at ? 'done' : ''}" style="${trackStyle(t)}"><span class="tg-track-art" aria-hidden="true"></span><i class="tg-num">${i + 1}</i>${trackMap(t)}<b>${esc(TRACK_DEFS[t].name)}</b></li>`)
    .join('');
  return `<button class="tg-cup${c.tracks.length > 4 ? ' wide' : ''}" style="--cup:${c.color}" ${attrs}>
    <span class="tg-cup-head"><b>${esc(c.name)}</b><small>${esc(c.tag)} · ${cupKm(id, TRACK_LENGTH_KM)} km</small></span>
    <ol class="tg-cup-rounds">${rounds}</ol></button>`;
}
