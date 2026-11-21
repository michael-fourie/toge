// Your custom maps (the map builder): on your account when you're signed in (`/api/maps`, kanjo/server/mapStore.ts),
// in this browser when you're a guest (`atrous.maps`). Both run the same rules (custommap.ts `applyMapAction`). The
// builder's work in progress is kept separately as a draft (`atrous.mapDraft`), saved as you edit, so a test drive or
// a reload never loses it.

import { type CustomMap, type MapAction, type SavedMap, applyMapAction, cleanMap, cleanSaved } from '../shared/custommap.ts';
import { spline } from '../shared/track.ts';
import { account } from '../../client/account.ts';

const LOCAL = 'atrous.maps';
const DRAFT = 'atrous.mapDraft';

function localList(): SavedMap[] {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL) ?? '[]') as unknown;
    return Array.isArray(v) ? v.map(cleanSaved).filter((s): s is SavedMap => !!s) : [];
  } catch {
    return [];
  }
}

export type MapResult = { ok: true; maps: SavedMap[] } | { ok: false; error: string };

export const mapApi = {
  /** Your saved maps, newest first. */
  async list(): Promise<SavedMap[]> {
    if (!account.user) return localList();
    try {
      const r = (await (await fetch('/api/maps')).json()) as { maps: unknown };
      return Array.isArray(r.maps) ? r.maps.map(cleanSaved).filter((s): s is SavedMap => !!s) : [];
    } catch {
      return [];
    }
  },

  async act(action: MapAction): Promise<MapResult> {
    if (!account.user) {
      const r = applyMapAction(localList(), action, Date.now());
      if (!r.ok) return r;
      try {
        localStorage.setItem(LOCAL, JSON.stringify(r.list));
      } catch {
        return { ok: false, error: "This browser won't keep it (storage is full or blocked)." };
      }
      return { ok: true, maps: r.list };
    }
    try {
      const res = await fetch('/api/maps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) });
      const r = (await res.json()) as { ok: boolean; maps?: unknown; error?: string };
      if (!r.ok) return { ok: false, error: r.error ?? 'Could not save.' };
      return { ok: true, maps: Array.isArray(r.maps) ? r.maps.map(cleanSaved).filter((s): s is SavedMap => !!s) : [] };
    } catch {
      return { ok: false, error: 'Could not reach the game server.' };
    }
  },
};

/** The builder's open map: the map, which saved map it is (null: not saved yet) and whether it has unsaved changes. */
export interface Draft {
  id: string | null;
  map: CustomMap;
  dirty: boolean;
}

export function loadDraft(): Draft | null {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFT) ?? 'null') as { id?: unknown; map?: unknown; dirty?: unknown } | null;
    const map = v && cleanMap(v.map);
    return map ? { id: typeof v!.id === 'string' ? v!.id : null, map, dirty: v!.dirty === true } : null;
  } catch {
    return null;
  }
}

export function saveDraft(d: Draft) {
  try {
    localStorage.setItem(DRAFT, JSON.stringify(d));
  } catch {
    /* private window: the draft just won't survive a reload */
  }
}

/** A map's shape as a little SVG line (the lobby's and the builder's map cards), fitted into a 100 × 64 box. */
export function mapSvg(m: CustomMap): string {
  const xs = m.points.map((p) => p[0]);
  const zs = m.points.map((p) => p[2]);
  const x0 = Math.min(...xs);
  const z0 = Math.min(...zs);
  const w = Math.max(1, Math.max(...xs) - x0);
  const h = Math.max(1, Math.max(...zs) - z0);
  const k = Math.min(88 / w, 52 / h);
  const ox = (100 - w * k) / 2;
  const oz = (64 - h * k) / 2;
  // The spline the road follows, thinned out (60 samples a segment is far more than a thumbnail needs).
  const dense = spline(m.points, m.loop).filter((_, i, a) => i % 12 === 0 || i === a.length - 1);
  const pts = dense.map((p) => `${(ox + (p[0] - x0) * k).toFixed(1)},${(oz + (p[2] - z0) * k).toFixed(1)}`);
  const d = `M${pts.join('L')}${m.loop ? 'Z' : ''}`;
  const [sx, sz] = pts[0].split(',');
  return `<svg viewBox="0 0 100 64" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${sx}" cy="${sz}" r="3.4" fill="#fff"/></svg>`;
}
