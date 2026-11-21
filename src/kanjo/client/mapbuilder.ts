// The map builder (screen `maps`): build your own track, test drive it, save it, race it online.
//
// The map is plain data (custommap.ts `CustomMap`): control points the road threads through, settings, features
// pinned to the points. The middle of the screen is a top-down canvas of the road at its real width (drag points,
// click to add or insert, pan and zoom), under it the elevation profile (drag a point's handle to raise or lower it);
// the left rail holds the map's settings and your library (saved maps, templates, remixes of built-in tracks,
// share codes); the right rail the tools, the inspector for the picked point and its features, and what's wrong.
// Every change rebuilds the road with the game's own track builder (`checkMap`), so what you see is what you drive.
// The work in progress is a draft saved as you go (mapstore.ts), so a test drive or a reload never loses it.

import {
  type CustomMap,
  type FeatureKind,
  type MapCheck,
  type MapFeature,
  type MapIssue,
  type MapProps,
  type MapTraffic,
  type SavedMap,
  FEATURES,
  MAP,
  MAP_PROPS,
  MAP_TEMPLATES,
  MAP_TERRAIN,
  MAP_TRAFFIC,
  POINT_FEATURES,
  THEMES,
  blankMap,
  checkMap,
  cleanMap,
  decodeMapCode,
  isPointFeature,
  mapCode,
  mapFromTrack,
  newMapId,
  registerMap,
} from '../shared/custommap.ts';
import { RACE_TRACKS, SAMPLE, TRACK_DEFS, type TrackId, spline } from '../shared/track.ts';
import type { Render } from '../../client/menu/router.ts';
import { copy, esc } from '../../client/menu/ui.ts';
import { account } from '../../client/account.ts';
import { ICON, LOGO } from './brand.ts';
import { THEME_ART } from './trackart.ts';
import { type Draft, loadDraft, mapApi, mapSvg, saveDraft } from './mapstore.ts';
import './hub.css';
import './mapbuilder.css';

type Tool = 'select' | 'add' | 'erase' | FeatureKind;
const TOOLS: { id: Tool; name: string; key: string; hint: string }[] = [
  { id: 'select', name: 'Move', key: 'V', hint: 'Drag a point to move it. Drag the ground to pan, scroll to zoom. Double-click the road to add a point there.' },
  { id: 'add', name: 'Add', key: 'A', hint: 'Click the ground to extend the road from its end (Shift: from its start). Click the road to add a point in it.' },
  { id: 'erase', name: 'Erase', key: 'X', hint: 'Click a point to take it out (its features go with it).' },
  { id: 'crest', name: 'Crest', key: '1', hint: 'Click a point: the road rises and falls away there.' },
  { id: 'jump', name: 'Drop jump', key: '2', hint: 'Click a point: a kicker, then the road drops onto the street below.' },
  { id: 'gap', name: 'Gap', key: '3', hint: 'Click a point: the road stops over a ravine. Too slow and you fall in.' },
  { id: 'bumps', name: 'Bumps', key: '4', hint: 'Click a point, then a later one: broken tarmac between them.' },
  { id: 'gravel', name: 'Gravel', key: '5', hint: 'Click a point, then a later one: a gravel stage between them.' },
  { id: 'canyon', name: 'Canyon', key: '6', hint: 'Click a point, then a later one: rock walls either side.' },
  { id: 'bridge', name: 'Bridge', key: '7', hint: 'Click a point, then a later one: the ground falls away under a bridge.' },
  { id: 'tunnel', name: 'Tunnel', key: '8', hint: 'Click a point, then a later one: a gallery through a hillside.' },
];
const isFeatureTool = (t: Tool): t is FeatureKind => Object.hasOwn(FEATURES, t);

/** Colours for features on the map and the profile (data colours, not the brand roles). */
const FEAT_COLOR: Record<FeatureKind, string> = {
  crest: '#ffc940',
  jump: '#ff7a2b',
  gap: '#ff3b30',
  bumps: '#f5a3ff',
  gravel: '#c8a26a',
  canyon: '#a7b0bd',
  bridge: '#38c9ff',
  tunnel: '#6f7c92',
};

/** Spline samples per segment between two control points (track.ts `spline`). */
const SEG = 60;
/** How close (screen px) counts as on a point, and on the road. */
const HIT_POINT = 11;
const HIT_ROAD = 10;
const HISTORY = 120;
/** Rebuild this long after the last change (ms): the build is the game's real one, 20-150 ms. */
const REBUILD_MS = 140;
/** Grid snap (m). */
const SNAP = 5;
const ZOOM = { min: 0.04, max: 6 };

export const mapBuilder: Render = (root, ctx) => {
  // ---- state ----------------------------------------------------------------------------------
  const draft: Draft = loadDraft() ?? { id: null, map: blankMap(), dirty: false };
  let map: CustomMap = draft.map;
  let savedId: string | null = draft.id;
  let dirty = draft.dirty;
  let tool: Tool = 'select';
  let sel = -1; // the picked control point
  let rangeFrom = -1; // a range tool's first click
  let hover = -1;
  let check: MapCheck = checkMap(map);
  let library: SavedMap[] = [];
  let libLoaded = false;
  let status = '';
  let snap = true;
  let rivals = 0;
  let leftTab: 'map' | 'library' = 'map';
  const past: string[] = [];
  const future: string[] = [];
  /** The road as drawn: the spline through the points (SEG samples a segment), and where each point sits in the build. */
  let dense: [number, number, number][] = [];
  let pointS: number[] = [];

  // ---- the shell --------------------------------------------------------------------------------
  root.innerHTML = `
    <main class="tg tg-mb" aria-label="Map builder">
      <header class="tg-top">
        <button class="tg-home" data-back aria-label="Back to the garage">${ICON.back}</button>
        ${LOGO}
        <div class="tg-mb-title">
          <span class="tg-lobby-title">Map builder</span>
          <label class="tg-mb-name"><span class="sr-only">Map name</span><input data-name maxlength="${MAP.nameMax}" spellcheck="false" /></label>
          <span class="tg-mb-state" data-state></span>
        </div>
        <div class="tg-mb-acts">
          <button class="tg-pill" data-undo title="Undo (Ctrl+Z)">Undo</button>
          <button class="tg-pill" data-redo title="Redo (Ctrl+Shift+Z)">Redo</button>
          <button class="tg-pill" data-save title="Save (Ctrl+S)">Save</button>
          <div class="tg-seg tg-mb-rivals" role="group" aria-label="Test drive with">
            <button class="tg-pill" data-rivals="0">Alone</button><button class="tg-pill" data-rivals="3">+3 CPU</button>
          </div>
          <button class="tg-go small" data-test>${ICON.flag}Test drive</button>
        </div>
      </header>
      <div class="tg-mb-body">
        <aside class="tg-mb-rail" data-left></aside>
        <section class="tg-mb-stage">
          <div class="tg-mb-view">
            <canvas class="tg-mb-canvas" data-canvas aria-label="The map, from above"></canvas>
            <div class="tg-mb-hud">
              <span data-scale></span>
              <button class="tg-pill" data-frame title="Fit the road in view (F)">Fit</button>
              <button class="tg-pill" data-snap aria-pressed="true" title="Snap points to a ${SNAP} m grid">Snap ${SNAP} m</button>
            </div>
            <p class="tg-mb-hint" data-hint></p>
          </div>
          <div class="tg-mb-profile">
            <canvas data-profile aria-label="Elevation profile"></canvas>
          </div>
        </section>
        <aside class="tg-mb-rail right" data-right></aside>
      </div>
    </main>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const canvas = $<HTMLCanvasElement>('[data-canvas]');
  const prof = $<HTMLCanvasElement>('[data-profile]');
  const g = canvas.getContext('2d')!;
  const pg = prof.getContext('2d')!;
  const left = $('[data-left]');
  const right = $('[data-right]');
  const nameIn = $<HTMLInputElement>('[data-name]');

  // ---- the view (world metres to canvas px) ----------------------------------------------------
  const view = { cx: 0, cz: 0, zoom: 0.5, w: 0, h: 0, dpr: 1 };
  const pw = { w: 0, h: 0 };
  const toScreen = (x: number, z: number): [number, number] => [(x - view.cx) * view.zoom + view.w / 2, (z - view.cz) * view.zoom + view.h / 2];
  const toWorld = (sx: number, sy: number): [number, number] => [(sx - view.w / 2) / view.zoom + view.cx, (sy - view.h / 2) / view.zoom + view.cz];

  function frame() {
    const pts = check.track ? null : map.points;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    if (pts || !check.track) for (const p of map.points) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
    else ({ x0, x1, z0, z1 } = check.track.bounds);
    if (!Number.isFinite(x0)) return;
    view.cx = (x0 + x1) / 2;
    view.cz = (z0 + z1) / 2;
    view.zoom = Math.max(ZOOM.min, Math.min(ZOOM.max, Math.min((view.w - 80) / Math.max(60, x1 - x0), (view.h - 80) / Math.max(60, z1 - z0))));
    draw();
  }

  function resize() {
    view.dpr = Math.min(2, devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    view.w = r.width;
    view.h = r.height;
    canvas.width = Math.round(r.width * view.dpr);
    canvas.height = Math.round(r.height * view.dpr);
    const q = prof.getBoundingClientRect();
    pw.w = q.width;
    pw.h = q.height;
    prof.width = Math.round(q.width * view.dpr);
    prof.height = Math.round(q.height * view.dpr);
    draw();
  }

  // ---- changes, history, rebuilds --------------------------------------------------------------
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  function layout() {
    dense = map.points.length >= 2 ? spline(map.points, map.loop) : map.points.slice();
    pointS = [];
    const t = check.track;
    if (!t) return;
    // Where each point sits along the built road: the nearest sample, searched forward from the last point.
    const i0 = t.lap ? Math.round(t.startS / SAMPLE) : 0;
    const i1 = t.lap ? i0 + t.lap : t.n;
    let from = i0;
    for (const p of map.points) {
      let best = from;
      let bd = Infinity;
      for (let i = from; i < i1; i++) {
        const d = (t.x[i] - p[0]) ** 2 + (t.z[i] - p[2]) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      pointS.push(best * SAMPLE);
      from = best;
    }
  }

  function rebuild() {
    rebuildTimer = null;
    check = checkMap(map);
    layout();
    draw();
    drawRight();
    drawState();
  }

  /** Something changed the map. `commit`: a step for Undo (drags commit once, at the end). */
  function changed(commit = true) {
    dirty = true;
    saveDraft({ id: savedId, map, dirty });
    dense = map.points.length >= 2 ? spline(map.points, map.loop) : map.points.slice();
    if (commit) future.length = 0;
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, REBUILD_MS);
    draw();
    drawState();
  }
  /** Call before a change: remembers the map as it was, for Undo. */
  function remember() {
    past.push(JSON.stringify(map));
    if (past.length > HISTORY) past.shift();
    future.length = 0;
  }
  function undo() {
    const prev = past.pop();
    if (!prev) return;
    future.push(JSON.stringify(map));
    map = cleanMap(JSON.parse(prev)) ?? map;
    sel = Math.min(sel, map.points.length - 1);
    changed(false);
    drawLeft();
    drawRight();
  }
  function redo() {
    const next = future.pop();
    if (!next) return;
    past.push(JSON.stringify(map));
    map = cleanMap(JSON.parse(next)) ?? map;
    sel = Math.min(sel, map.points.length - 1);
    changed(false);
    drawLeft();
    drawRight();
  }
  /** Replaces the whole map (a template, a saved map, a code). */
  function open(m: CustomMap, id: string | null, isDirty = false) {
    remember();
    map = m;
    savedId = id;
    dirty = isDirty;
    sel = -1;
    rangeFrom = -1;
    saveDraft({ id: savedId, map, dirty });
    check = checkMap(map);
    layout();
    nameIn.value = map.name;
    drawLeft();
    drawRight();
    drawState();
    frame();
  }

  // ---- editing the points ------------------------------------------------------------------------
  const snapTo = (v: number) => (snap ? Math.round(v / SNAP) * SNAP : Math.round(v * 10) / 10);

  /** Inserts a point before index `k` (features after it move along). */
  function insertPoint(k: number, p: [number, number, number]) {
    if (map.points.length >= MAP.maxPoints) return setStatus(`A map holds ${MAP.maxPoints} points at most.`);
    map.points.splice(k, 0, p);
    map.features = map.features.map((f) => (isPointFeature(f) ? { ...f, at: f.at >= k ? f.at + 1 : f.at } : { ...f, from: f.from >= k ? f.from + 1 : f.from, to: f.to >= k ? f.to + 1 : f.to }));
    sel = k;
  }
  function deletePoint(k: number) {
    const need = map.loop ? MAP.minLoopPoints : MAP.minPoints;
    if (map.points.length <= need) return setStatus(`The road needs at least ${need} points.`);
    remember();
    map.points.splice(k, 1);
    const last = map.points.length - 1;
    map.features = map.features
      .filter((f) => !(isPointFeature(f) && f.at === k))
      .map((f) => (isPointFeature(f) ? { ...f, at: f.at > k ? f.at - 1 : f.at } : { ...f, from: f.from > k ? f.from - 1 : f.from, to: f.to >= k ? f.to - 1 : f.to }))
      // A point feature can't sit on the new end, and a range needs two points.
      .filter((f) => (isPointFeature(f) ? f.at >= 1 && f.at < last : f.from < f.to));
    sel = -1;
    changed();
    drawRight();
  }
  /** Heights for a new point: carried on from its neighbours. */
  function heightNear(k: number, x: number, z: number): number {
    const pts = map.points;
    if (!pts.length) return 100;
    if (k <= 0) return pts[0][1];
    if (k >= pts.length) return pts[pts.length - 1][1];
    const a = pts[k - 1];
    const b = pts[k];
    const da = Math.hypot(x - a[0], z - a[2]);
    const db = Math.hypot(x - b[0], z - b[2]);
    return Math.round((a[1] + ((b[1] - a[1]) * da) / Math.max(1e-6, da + db)) * 10) / 10;
  }

  // ---- hit tests -----------------------------------------------------------------------------------
  function pointAtScreen(sx: number, sy: number): number {
    let best = -1;
    let bd = HIT_POINT;
    map.points.forEach((p, i) => {
      const [x, y] = toScreen(p[0], p[2]);
      const d = Math.hypot(x - sx, y - sy);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }
  /** The road under a screen point: which segment (insert before seg + 1) and where, or null. */
  function roadAtScreen(sx: number, sy: number): { seg: number; x: number; z: number } | null {
    const [wx, wz] = toWorld(sx, sy);
    const reach = map.width / 2 + HIT_ROAD / view.zoom;
    let best: { seg: number; x: number; z: number } | null = null;
    let bd = reach;
    for (let i = 0; i < dense.length; i++) {
      const d = Math.hypot(dense[i][0] - wx, dense[i][2] - wz);
      if (d < bd) {
        bd = d;
        best = { seg: Math.min(Math.floor(i / SEG), map.loop ? map.points.length - 1 : map.points.length - 2), x: dense[i][0], z: dense[i][2] };
      }
    }
    return best;
  }

  // ---- drawing: the map from above -------------------------------------------------------------------
  function draw() {
    if (!view.w) return;
    const d = view.dpr;
    g.setTransform(d, 0, 0, d, 0, 0);
    const art = THEME_ART[map.theme];
    // Ground, then a metric grid (the minor step grows as you zoom out).
    g.fillStyle = '#0a0f17';
    g.fillRect(0, 0, view.w, view.h);
    const grad = g.createRadialGradient(view.w * 0.5, view.h * 0.4, 0, view.w * 0.5, view.h * 0.4, Math.max(view.w, view.h) * 0.8);
    grad.addColorStop(0, art.accent + '1c');
    grad.addColorStop(1, 'transparent');
    g.fillStyle = grad;
    g.fillRect(0, 0, view.w, view.h);
    const steps = [10, 25, 50, 100, 250, 500, 1000, 2500];
    const minor = steps.find((s) => s * view.zoom >= 18) ?? 2500;
    const major = minor * (minor === 25 || minor === 250 || minor === 2500 ? 4 : 5);
    const [wx0, wz0] = toWorld(0, 0);
    const [wx1, wz1] = toWorld(view.w, view.h);
    for (const [step, alpha] of [[minor, 0.045], [major, 0.1]] as const) {
      g.strokeStyle = `rgba(255,255,255,${alpha})`;
      g.lineWidth = 1;
      g.beginPath();
      for (let x = Math.ceil(wx0 / step) * step; x <= wx1; x += step) {
        const sx = Math.round(toScreen(x, 0)[0]) + 0.5;
        g.moveTo(sx, 0);
        g.lineTo(sx, view.h);
      }
      for (let z = Math.ceil(wz0 / step) * step; z <= wz1; z += step) {
        const sy = Math.round(toScreen(0, z)[1]) + 0.5;
        g.moveTo(0, sy);
        g.lineTo(view.w, sy);
      }
      g.stroke();
    }
    $('[data-scale]').textContent = `Grid ${minor >= 1000 ? `${minor / 1000} km` : `${minor} m`}`;

    const t = check.track;
    // The run-up before the start and the runoff after the finish (point to point), faint.
    if (t && !t.lap) {
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.lineWidth = Math.max(2, t.half * 2 * view.zoom);
      g.lineCap = 'butt';
      for (const [a, b] of [[0, Math.round(t.startS / SAMPLE)], [Math.round(t.finishS / SAMPLE), t.n - 1]]) {
        g.beginPath();
        for (let i = a; i <= b; i += 2) {
          const [x, y] = toScreen(t.x[i], t.z[i]);
          i === a ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    // The road: verge, asphalt at its real width, then a centre line. Coloured by height (low is cool, high warm).
    if (dense.length >= 2) {
      const ys = map.points.map((p) => p[1]);
      const lo = Math.min(...ys);
      const hi = Math.max(...ys);
      const path = () => {
        g.beginPath();
        dense.forEach((p, i) => {
          const [x, y] = toScreen(p[0], p[2]);
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        });
        if (map.loop) g.closePath();
      };
      g.lineJoin = 'round';
      g.lineCap = 'round';
      path();
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.lineWidth = Math.max(4, (map.width + 2 * (map.sky ? 1.2 : 5.5)) * view.zoom);
      g.stroke();
      path();
      g.strokeStyle = map.sky ? '#26324a' : '#2a3140';
      g.lineWidth = Math.max(3, map.width * view.zoom);
      g.stroke();
      // Height tint along the road, segment by segment.
      if (hi - lo > 1) {
        g.lineWidth = Math.max(2, map.width * view.zoom * 0.55);
        for (let i = 0; i + 1 < dense.length; i += 6) {
          const j = Math.min(dense.length - 1, i + 6);
          const u = (dense[i][1] - lo) / (hi - lo);
          g.strokeStyle = `hsla(${200 - u * 170}, 80%, 55%, 0.32)`;
          const [ax, ay] = toScreen(dense[i][0], dense[i][2]);
          const [bx, by] = toScreen(dense[j][0], dense[j][2]);
          g.beginPath();
          g.moveTo(ax, ay);
          g.lineTo(bx, by);
          g.stroke();
        }
      }
      // Range features over the road.
      for (const f of map.features) {
        if (isPointFeature(f)) continue;
        const a = f.from * SEG;
        const b = Math.min(dense.length - 1, f.to * SEG);
        g.beginPath();
        for (let i = a; i <= b; i++) {
          const [x, y] = toScreen(dense[i][0], dense[i][2]);
          i === a ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.strokeStyle = FEAT_COLOR[f.kind] + (f.kind === 'tunnel' ? 'cc' : '88');
        g.lineWidth = Math.max(3, (map.width + (f.kind === 'canyon' ? 8 : f.kind === 'bridge' ? 4 : 0)) * view.zoom);
        g.setLineDash(f.kind === 'bumps' ? [6, 5] : []);
        g.stroke();
        g.setLineDash([]);
      }
      // Centre line, dashed, with direction arrows.
      path();
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 1.2;
      g.setLineDash([7, 7]);
      g.stroke();
      g.setLineDash([]);
      const every = Math.max(1, Math.round(160 / Math.max(0.05, view.zoom) / 4));
      g.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = SEG / 2; i + 1 < dense.length; i += every) {
        const [x, y] = toScreen(dense[i][0], dense[i][2]);
        const [x2, y2] = toScreen(dense[i + 1][0], dense[i + 1][2]);
        const a = Math.atan2(y2 - y, x2 - x);
        g.save();
        g.translate(x, y);
        g.rotate(a);
        g.beginPath();
        g.moveTo(5, 0);
        g.lineTo(-3, -4);
        g.lineTo(-3, 4);
        g.closePath();
        g.fill();
        g.restore();
      }
    }
    // Gaps in the built road: a red hole across it.
    if (t)
      for (const gp of t.gaps) {
        const i0 = Math.round(gp.s0 / SAMPLE);
        const i1 = Math.min(t.n - 1, Math.round(gp.s1 / SAMPLE));
        g.strokeStyle = '#05070b';
        g.lineWidth = Math.max(4, (t.half * 2 + 2) * view.zoom);
        g.lineCap = 'butt';
        g.beginPath();
        for (let i = i0; i <= i1; i++) {
          const [x, y] = toScreen(t.x[i], t.z[i]);
          i === i0 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.stroke();
      }
    // Start and finish lines.
    if (t) {
      const line = (s: number, label: string) => {
        const i = Math.min(t.n - 2, Math.round(s / SAMPLE));
        const [x, y] = toScreen(t.x[i], t.z[i]);
        const a = Math.atan2(t.tz[i], t.tx[i]);
        const half = Math.max(8, (t.half + 1) * view.zoom);
        g.save();
        g.translate(x, y);
        g.rotate(a);
        for (let k = 0; k < 6; k++) {
          g.fillStyle = k % 2 ? '#fff' : '#111';
          g.fillRect(-2, -half + (k * half) / 3, 4, half / 3);
        }
        g.restore();
        g.font = '700 11px Barlow Condensed, sans-serif';
        g.fillStyle = '#fff';
        g.fillText(label, x + 10, y - 10);
      };
      line(t.startS, t.lap ? 'START / FINISH' : 'START');
      if (!t.lap) line(t.finishS, 'FINISH');
    }
    // Point features: a marker beside their point.
    for (const f of map.features) {
      if (!isPointFeature(f)) continue;
      const p = map.points[f.at];
      if (!p) continue;
      const [x, y] = toScreen(p[0], p[2]);
      g.fillStyle = FEAT_COLOR[f.kind];
      g.beginPath();
      if (f.kind === 'crest') g.arc(x, y - 18, 6, Math.PI, 0);
      else if (f.kind === 'jump') {
        g.moveTo(x - 7, y - 12);
        g.lineTo(x + 7, y - 24);
        g.lineTo(x + 7, y - 12);
      } else {
        g.rect(x - 8, y - 22, 6, 9);
        g.rect(x + 2, y - 22, 6, 9);
      }
      g.fill();
    }
    // Issues: a red ring where something's wrong, amber for warnings.
    for (const [list, col] of [[check.errors, '#ff6b6b'], [check.warnings, '#ffc940']] as const)
      for (const is of list) {
        const at = is.at ?? (is.point !== undefined ? ([map.points[is.point]?.[0], map.points[is.point]?.[2]] as [number, number]) : null);
        if (!at || at[0] === undefined) continue;
        const [x, y] = toScreen(at[0], at[1]);
        g.strokeStyle = col;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, 16, 0, Math.PI * 2);
        g.stroke();
      }
    // The control points: numbered, the first green (start) and the last red (finish) on a point-to-point road.
    map.points.forEach((p, i) => {
      const [x, y] = toScreen(p[0], p[2]);
      const r = i === sel ? 8 : i === hover ? 7 : 6;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = i === sel ? '#38c9ff' : !map.loop && i === 0 ? '#3ddc84' : !map.loop && i === map.points.length - 1 ? '#ff3b30' : '#eef2f8';
      g.fill();
      g.lineWidth = i === rangeFrom ? 3 : 1.5;
      g.strokeStyle = i === rangeFrom ? FEAT_COLOR[tool as FeatureKind] ?? '#fff' : '#05070b';
      g.stroke();
      if (view.zoom > 0.12 || i === sel || i === 0) {
        g.font = '700 11px Barlow Condensed, sans-serif';
        g.fillStyle = i === sel ? '#38c9ff' : 'rgba(238,242,248,0.75)';
        g.fillText(String(i + 1), x + 9, y + 4);
      }
    });
    drawProfile();
  }

  // ---- drawing: the elevation profile ------------------------------------------------------------------
  /** The profile's frame for the current build: distance range and height range. */
  let pf = { s0: 0, s1: 1, y0: 0, y1: 1 };
  const profX = (s: number) => 44 + ((s - pf.s0) / Math.max(1, pf.s1 - pf.s0)) * (pw.w - 60);
  const profY = (y: number) => pw.h - 18 - ((y - pf.y0) / Math.max(1, pf.y1 - pf.y0)) * (pw.h - 34);
  function drawProfile() {
    if (!pw.w) return;
    const d = view.dpr;
    pg.setTransform(d, 0, 0, d, 0, 0);
    pg.fillStyle = '#080c13';
    pg.fillRect(0, 0, pw.w, pw.h);
    const t = check.track;
    pg.font = '700 10px Barlow Condensed, sans-serif';
    if (!t) {
      pg.fillStyle = '#8e9ab0';
      pg.fillText('ELEVATION · fix the issues on the right to see the road', 14, 18);
      return;
    }
    const i0 = Math.round(t.startS / SAMPLE);
    const i1 = t.lap ? i0 + t.lap : Math.round(t.finishS / SAMPLE);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = i0; i <= i1 && i < t.n; i++) {
      lo = Math.min(lo, t.y[i]);
      hi = Math.max(hi, t.y[i]);
    }
    for (const p of map.points) {
      lo = Math.min(lo, p[1]);
      hi = Math.max(hi, p[1]);
    }
    const pad = Math.max(6, (hi - lo) * 0.15);
    pf = { s0: t.startS, s1: i1 * SAMPLE, y0: lo - pad, y1: hi + pad };
    // Height lines every so many metres.
    const step = [5, 10, 25, 50, 100, 250][[5, 10, 25, 50, 100, 250].findIndex((s) => (pf.y1 - pf.y0) / s < 6)] ?? 500;
    pg.strokeStyle = 'rgba(255,255,255,0.06)';
    pg.fillStyle = '#5c6779';
    for (let y = Math.ceil(pf.y0 / step) * step; y <= pf.y1; y += step) {
      const sy = Math.round(profY(y)) + 0.5;
      pg.beginPath();
      pg.moveTo(40, sy);
      pg.lineTo(pw.w, sy);
      pg.stroke();
      pg.fillText(`${y} m`, 4, sy + 3);
    }
    // Features as bands.
    for (const f of map.features) {
      const s0 = isPointFeature(f) ? (pointS[f.at] ?? 0) - 30 : (pointS[f.from] ?? 0);
      const s1 = isPointFeature(f) ? (pointS[f.at] ?? 0) + 60 : (pointS[f.to] ?? 0);
      pg.fillStyle = FEAT_COLOR[f.kind] + '22';
      pg.fillRect(profX(s0), 8, Math.max(2, profX(s1) - profX(s0)), pw.h - 26);
    }
    // The road's height, filled, red where it's steeper than the warning grade.
    pg.beginPath();
    pg.moveTo(profX(t.startS), pw.h - 18);
    for (let i = i0; i <= i1 && i < t.n; i += 2) pg.lineTo(profX(i * SAMPLE), profY(t.y[i]));
    pg.lineTo(profX(Math.min(i1, t.n - 1) * SAMPLE), pw.h - 18);
    pg.closePath();
    const fill = pg.createLinearGradient(0, 0, 0, pw.h);
    fill.addColorStop(0, 'rgba(56,201,255,0.28)');
    fill.addColorStop(1, 'rgba(56,201,255,0.02)');
    pg.fillStyle = fill;
    pg.fill();
    pg.lineWidth = 2;
    for (let i = i0; i + 2 <= i1 && i + 2 < t.n; i += 2) {
      const grade = Math.abs(t.y[i + 2] - t.y[i]) / (2 * SAMPLE);
      pg.strokeStyle = t.hole[i] ? '#ff3b30' : grade > MAP.warnGrade ? '#ff6b6b' : '#38c9ff';
      pg.beginPath();
      pg.moveTo(profX(i * SAMPLE), profY(t.y[i]));
      pg.lineTo(profX((i + 2) * SAMPLE), profY(t.y[i + 2]));
      pg.stroke();
    }
    // Each point's handle at the height it asks for (drops shift the road under it; the handle stays where you put it).
    map.points.forEach((p, i) => {
      const s = pointS[i];
      if (s === undefined) return;
      const x = profX(s);
      const y = profY(p[1]);
      pg.beginPath();
      pg.arc(x, y, i === sel ? 6 : 4.5, 0, Math.PI * 2);
      pg.fillStyle = i === sel ? '#38c9ff' : '#eef2f8';
      pg.fill();
      pg.strokeStyle = '#05070b';
      pg.lineWidth = 1.5;
      pg.stroke();
    });
    pg.fillStyle = '#8e9ab0';
    pg.fillText(`ELEVATION · ${(check.km).toFixed(2)} km${t.lap ? ' (one lap shown)' : ''} · drag a handle to raise or lower its point`, 48, 14);
  }

  // ---- pointer input on the map ---------------------------------------------------------------------
  type Drag = { kind: 'pan'; sx: number; sy: number; cx: number; cz: number } | { kind: 'point'; i: number; moved: boolean; before: string } | { kind: 'height'; i: number; sy: number; y: number; scale: number; before: string };
  let drag: Drag | null = null;
  const pointers = new Map<number, [number, number]>();
  let pinch: { d: number; zoom: number } | null = null;
  const local = (e: PointerEvent | WheelEvent | MouseEvent, el: HTMLElement): [number, number] => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  canvas.addEventListener('pointerdown', (e) => {
    const [sx, sy] = local(e, canvas);
    pointers.set(e.pointerId, [sx, sy]);
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: view.zoom };
      drag = null;
      return;
    }
    const hit = pointAtScreen(sx, sy);
    const panning = e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey);
    if (panning) {
      drag = { kind: 'pan', sx, sy, cx: view.cx, cz: view.cz };
      return;
    }
    if (tool === 'select') {
      if (hit >= 0) {
        sel = hit;
        drag = { kind: 'point', i: hit, moved: false, before: JSON.stringify(map) };
        drawRight();
      } else {
        sel = -1;
        drag = { kind: 'pan', sx, sy, cx: view.cx, cz: view.cz };
        drawRight();
      }
      draw();
      return;
    }
    if (tool === 'erase') {
      if (hit >= 0) deletePoint(hit);
      return;
    }
    if (tool === 'add') {
      const road = hit < 0 ? roadAtScreen(sx, sy) : null;
      if (hit >= 0) {
        sel = hit;
        drag = { kind: 'point', i: hit, moved: false, before: JSON.stringify(map) };
      } else if (road) {
        remember();
        insertPoint(road.seg + 1, [snapTo(road.x), heightNear(road.seg + 1, road.x, road.z), snapTo(road.z)]);
        changed();
      } else {
        const [wx, wz] = toWorld(sx, sy);
        remember();
        const at = e.shiftKey ? 0 : map.points.length;
        const near = map.points[at === 0 ? 0 : map.points.length - 1];
        insertPoint(at, [snapTo(wx), near ? near[1] : 100, snapTo(wz)]);
        changed();
      }
      drawRight();
      draw();
      return;
    }
    if (isFeatureTool(tool)) {
      const i = hit >= 0 ? hit : nearestPointTo(sx, sy);
      if (i < 0) return;
      placeFeature(tool, i);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const [sx, sy] = local(e, canvas);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [sx, sy]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      view.zoom = Math.max(ZOOM.min, Math.min(ZOOM.max, (pinch.zoom * Math.hypot(a[0] - b[0], a[1] - b[1])) / Math.max(1, pinch.d)));
      draw();
      return;
    }
    if (!drag) {
      const h = pointAtScreen(sx, sy);
      if (h !== hover) {
        hover = h;
        draw();
      }
      canvas.style.cursor = h >= 0 ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
      return;
    }
    if (drag.kind === 'pan') {
      view.cx = drag.cx - (sx - drag.sx) / view.zoom;
      view.cz = drag.cz - (sy - drag.sy) / view.zoom;
      draw();
    } else if (drag.kind === 'point') {
      const [wx, wz] = toWorld(sx, sy);
      const p = map.points[drag.i];
      p[0] = Math.max(-MAP.reach, Math.min(MAP.reach, snapTo(wx)));
      p[2] = Math.max(-MAP.reach, Math.min(MAP.reach, snapTo(wz)));
      drag.moved = true;
      changed(false);
      drawInspector();
    }
  });

  const endDrag = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag?.kind === 'point' && drag.moved) {
      past.push(drag.before);
      if (past.length > HISTORY) past.shift();
      future.length = 0;
    }
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('dblclick', (e) => {
    if (tool !== 'select') return;
    const [sx, sy] = local(e, canvas);
    if (pointAtScreen(sx, sy) >= 0) return;
    const road = roadAtScreen(sx, sy);
    if (!road) return;
    remember();
    insertPoint(road.seg + 1, [snapTo(road.x), heightNear(road.seg + 1, road.x, road.z), snapTo(road.z)]);
    changed();
    drawRight();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const [sx, sy] = local(e, canvas);
      const [wx, wz] = toWorld(sx, sy);
      view.zoom = Math.max(ZOOM.min, Math.min(ZOOM.max, view.zoom * Math.exp(-e.deltaY * 0.0015)));
      // Keep the spot under the cursor where it was.
      view.cx = wx - (sx - view.w / 2) / view.zoom;
      view.cz = wz - (sy - view.h / 2) / view.zoom;
      draw();
    },
    { passive: false },
  );

  function nearestPointTo(sx: number, sy: number): number {
    let best = -1;
    let bd = 40;
    map.points.forEach((p, i) => {
      const [x, y] = toScreen(p[0], p[2]);
      const d = Math.hypot(x - sx, y - sy);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  // ---- the profile: drag handles up and down ------------------------------------------------------------
  prof.addEventListener('pointerdown', (e) => {
    const [sx, sy] = local(e, prof);
    let best = -1;
    let bd = 14;
    map.points.forEach((p, i) => {
      const s = pointS[i];
      if (s === undefined) return;
      const d = Math.hypot(profX(s) - sx, profY(p[1]) - sy);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best < 0) return;
    sel = best;
    prof.setPointerCapture(e.pointerId);
    drag = { kind: 'height', i: best, sy, y: map.points[best][1], scale: (pf.y1 - pf.y0) / Math.max(1, pw.h - 34), before: JSON.stringify(map) };
    drawRight();
    draw();
  });
  prof.addEventListener('pointermove', (e) => {
    if (drag?.kind !== 'height') return;
    const [, sy] = local(e, prof);
    const y = drag.y - (sy - drag.sy) * drag.scale;
    map.points[drag.i][1] = Math.round(Math.max(MAP.heightMin, Math.min(MAP.heightMax, y)) * (e.shiftKey ? 1 : 2)) / (e.shiftKey ? 1 : 2);
    changed(false);
    drawInspector();
  });
  const endHeight = () => {
    if (drag?.kind === 'height') {
      past.push(drag.before);
      if (past.length > HISTORY) past.shift();
      future.length = 0;
    }
    drag = null;
  };
  prof.addEventListener('pointerup', endHeight);
  prof.addEventListener('pointercancel', endHeight);

  // ---- features --------------------------------------------------------------------------------------------
  function defaults(kind: FeatureKind): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, r] of Object.entries(FEATURES[kind].keys)) out[k] = r.def;
    return out;
  }
  function placeFeature(kind: FeatureKind, i: number) {
    if (map.loop) return setStatus('Features are for point-to-point roads: circuits stay clean.');
    const last = map.points.length - 1;
    if (POINT_FEATURES.includes(kind)) {
      if (i <= 0 || i >= last) return setStatus(`A ${FEATURES[kind].name.toLowerCase()} can't go on the first or last point.`);
      remember();
      map.features = map.features.filter((f) => !(isPointFeature(f) && f.at === i));
      map.features.push({ kind, at: i, ...defaults(kind) } as MapFeature);
      sel = i;
      changed();
      drawRight();
      return;
    }
    if (rangeFrom < 0) {
      rangeFrom = i;
      setStatus(`${FEATURES[kind].name}: now click the point where it ends.`);
      draw();
      return;
    }
    const a = Math.min(rangeFrom, i);
    const b = Math.max(rangeFrom, i);
    rangeFrom = -1;
    if (a === b) return draw();
    remember();
    map.features.push({ kind, from: a, to: b, size: defaults(kind).size ?? 0 } as MapFeature);
    sel = a;
    setStatus(`${FEATURES[kind].name} from point ${a + 1} to ${b + 1}.`);
    changed();
    drawRight();
  }

  // ---- the left rail: settings and library -------------------------------------------------------------------
  const pills = <T extends string | number>(attr: string, opts: [T, string][], on: T, disabled = false) =>
    `<div class="tg-seg tg-mb-seg">${opts.map(([v, label]) => `<button class="tg-pill" data-${attr}="${v}" aria-pressed="${v === on}" ${disabled ? 'disabled' : ''}>${esc(label)}</button>`).join('')}</div>`;

  function drawLeft() {
    const tabs = `<nav class="tg-subtabs tg-mb-tabs" role="tablist"><button role="tab" data-ltab="map" aria-selected="${leftTab === 'map'}" class="${leftTab === 'map' ? 'on' : ''}">Map</button><button role="tab" data-ltab="library" aria-selected="${leftTab === 'library'}" class="${leftTab === 'library' ? 'on' : ''}">My maps</button></nav>`;
    left.innerHTML = tabs + (leftTab === 'map' ? settingsHtml() : libraryHtml());
    wireLeft();
  }

  function settingsHtml(): string {
    const m = map;
    const p2p = !m.loop;
    return `
      <div class="tg-mb-sec">
        <label class="tg-field"><span class="tg-label">Description</span><input data-blurb maxlength="${MAP.blurbMax}" placeholder="One line about it" value="${esc(m.blurb)}" /></label>
      </div>
      <div class="tg-mb-sec">
        <h3 class="tg-h">Road</h3>
        ${pills('loop', [['p2p', 'Point to point'], ['loop', 'Circuit']], m.loop ? 'loop' : 'p2p')}
        ${m.loop ? `<div class="tg-mb-row"><span class="tg-label">Laps</span><button class="tg-pill" data-lapstep="-1" ${m.laps <= MAP.laps.min ? 'disabled' : ''}>−</button><b class="tg-num tg-mb-big">${m.laps}</b><button class="tg-pill" data-lapstep="1" ${m.laps >= MAP.laps.max ? 'disabled' : ''}>+</button></div>` : ''}
        <label class="tg-mb-slider"><span class="tg-label">Width <b class="tg-num" data-widthv>${m.width} m</b></span><input type="range" data-width min="${MAP.width.min}" max="${MAP.width.max}" step="0.5" value="${m.width}" /></label>
        <div class="tg-mb-btns"><button class="tg-pill" data-reverse>Reverse direction</button><button class="tg-pill" data-smooth>Smooth heights</button></div>
      </div>
      <div class="tg-mb-sec">
        <h3 class="tg-h">World</h3>
        <div class="tg-mb-themes">${THEMES.map((t) => `<button class="tg-mb-theme" data-theme="${t.id}" aria-pressed="${t.id === m.theme}" style="--sky0:${THEME_ART[t.id].sky[0]};--sky1:${THEME_ART[t.id].sky[1]};--acc:${THEME_ART[t.id].accent}"><i></i><span>${esc(t.name)}</span></button>`).join('')}</div>
        <span class="tg-label">Hills</span>
        ${pills('terrain', MAP_TERRAIN.map((t, i): [number, string] => [i, t.name]), m.terrain, m.sky)}
        <span class="tg-label">Water</span>
        ${pills('sea', [['none', 'None'], ['lake', 'Lake below the road']], m.sea === null ? 'none' : 'lake', m.sky)}
        ${m.loop ? `<span class="tg-label">Sky road</span>${pills('sky', [['off', 'On the ground'], ['on', 'Floating, no walls']], m.sky ? 'on' : 'off')}` : ''}
      </div>
      <div class="tg-mb-sec">
        <h3 class="tg-h">Race</h3>
        <span class="tg-label">On the road</span>
        ${pills('props', (Object.keys(MAP_PROPS) as MapProps[]).map((k): [MapProps, string] => [k, MAP_PROPS[k].name]), m.props, !p2p)}
        <span class="tg-label">Traffic</span>
        ${pills('traffic', (Object.keys(MAP_TRAFFIC) as MapTraffic[]).map((k): [MapTraffic, string] => [k, MAP_TRAFFIC[k].name]), m.traffic, !p2p)}
        <span class="tg-label">Crash damage</span>
        ${pills('survival', [['off', 'Lobby decides'], ['on', 'Always on (survival)']], m.survival ? 'on' : 'off')}
        ${p2p ? '' : '<p class="tg-note">Circuits are clean: no props, traffic or features. Make it point to point for jumps, gaps and hazards.</p>'}
      </div>
      <div class="tg-mb-sec tg-mb-stats" data-stats></div>`;
  }

  function libraryHtml(): string {
    const remix = RACE_TRACKS.filter((id) => mapFromTrack(id));
    const cards = library
      .map(
        (s) => `<li class="tg-mb-card ${s.id === savedId ? 'on' : ''}" style="--acc:${THEME_ART[s.map.theme].accent}">
          <button class="tg-mb-card-open" data-open="${s.id}">${mapSvg(s.map)}<span><b>${esc(s.map.name)}</b><small>${s.map.loop ? `Circuit · ${s.map.laps} laps` : 'Point to point'} · ${s.map.points.length} points</small></span></button>
          <span class="tg-mb-card-acts"><button class="tg-pill" data-dup="${s.id}">Copy</button><button class="tg-pill" data-code="${s.id}">Share code</button><button class="tg-pill danger" data-del="${s.id}">Delete</button></span>
        </li>`,
      )
      .join('');
    return `
      <div class="tg-mb-sec">
        <h3 class="tg-h">Saved <small>${library.length} / ${MAP.maxSaved}${account.user ? ' · on your account' : ' · in this browser'}</small></h3>
        ${!libLoaded ? '<p class="tg-muted">Loading…</p>' : library.length ? `<ul class="tg-mb-cards">${cards}</ul>` : '<p class="tg-muted">Nothing saved yet. Save the map you’re building, or start from a template below.</p>'}
        ${account.user ? '' : '<p class="tg-note">Guests keep maps in this browser. Sign in to keep them on your account.</p>'}
      </div>
      <div class="tg-mb-sec">
        <h3 class="tg-h">New map</h3>
        <div class="tg-mb-temps">${MAP_TEMPLATES.map((t) => `<button class="tg-mb-temp" data-template="${t.id}">${mapSvg(t.make())}<b>${esc(t.name)}</b><small>${esc(t.blurb)}</small></button>`).join('')}</div>
        <label class="tg-field"><span class="tg-label">Remix a track</span>
          <select data-remix><option value="">Pick a track to start from…</option>${remix.map((id) => `<option value="${id}">${esc(TRACK_DEFS[id].name)}</option>`).join('')}</select>
        </label>
      </div>
      <div class="tg-mb-sec">
        <h3 class="tg-h">Share</h3>
        <div class="tg-mb-btns"><button class="tg-pill" data-mycode>Copy this map’s code</button></div>
        <label class="tg-field"><span class="tg-label">Open a code</span><input data-import placeholder="KJM1.…" spellcheck="false" autocomplete="off" /></label>
        <button class="tg-pill" data-importgo>Open</button>
      </div>`;
  }

  /** Changes a setting with an Undo step, then redraws what depends on it. */
  function setting(fn: () => void, redrawLeft = true) {
    remember();
    fn();
    map = cleanMap(map) ?? map;
    changed();
    if (redrawLeft) drawLeft();
    drawRight();
  }

  function wireLeft() {
    left.querySelectorAll<HTMLElement>('[data-ltab]').forEach((b) =>
      b.addEventListener('click', () => {
        leftTab = b.dataset.ltab as 'map' | 'library';
        drawLeft();
        if (leftTab === 'library') void loadLibrary();
      }),
    );
    const blurb = left.querySelector<HTMLInputElement>('[data-blurb]');
    blurb?.addEventListener('change', () => setting(() => (map.blurb = blurb.value), false));
    left.querySelectorAll<HTMLElement>('[data-loop]').forEach((b) =>
      b.addEventListener('click', () => {
        const loop = b.dataset.loop === 'loop';
        if (loop === map.loop) return;
        if (loop && map.points.length < MAP.minLoopPoints) return setStatus(`A circuit needs at least ${MAP.minLoopPoints} points.`);
        if (loop && map.features.length) setStatus('Circuits are clean: the features came off (Undo brings them back).');
        setting(() => {
          map.loop = loop;
          if (!loop) map.sky = false;
        });
      }),
    );
    left.querySelectorAll<HTMLElement>('[data-lapstep]').forEach((b) => b.addEventListener('click', () => setting(() => (map.laps += Number(b.dataset.lapstep)))));
    const width = left.querySelector<HTMLInputElement>('[data-width]');
    width?.addEventListener('input', () => {
      left.querySelector('[data-widthv]')!.textContent = `${width.value} m`;
      map.width = Number(width.value);
      changed(false);
    });
    width?.addEventListener('change', () => setting(() => (map.width = Number(width.value)), false));
    left.querySelectorAll<HTMLElement>('[data-theme]').forEach((b) => b.addEventListener('click', () => setting(() => (map.theme = b.dataset.theme as CustomMap['theme']))));
    left.querySelectorAll<HTMLElement>('[data-terrain]').forEach((b) => b.addEventListener('click', () => setting(() => (map.terrain = Number(b.dataset.terrain)))));
    left.querySelectorAll<HTMLElement>('[data-sea]').forEach((b) => b.addEventListener('click', () => setting(() => (map.sea = b.dataset.sea === 'lake' ? 8 : null))));
    left.querySelectorAll<HTMLElement>('[data-sky]').forEach((b) => b.addEventListener('click', () => setting(() => (map.sky = b.dataset.sky === 'on'))));
    left.querySelectorAll<HTMLElement>('[data-props]').forEach((b) => b.addEventListener('click', () => setting(() => (map.props = b.dataset.props as MapProps))));
    left.querySelectorAll<HTMLElement>('[data-traffic]').forEach((b) =>
      b.addEventListener('click', () =>
        setting(() => {
          map.traffic = b.dataset.traffic as MapTraffic;
          // Traffic needs its lanes: widen the road to fit.
          map.width = Math.max(map.width, MAP_TRAFFIC[map.traffic].width);
        }),
      ),
    );
    left.querySelectorAll<HTMLElement>('[data-survival]').forEach((b) => b.addEventListener('click', () => setting(() => (map.survival = b.dataset.survival === 'on'))));
    left.querySelector('[data-reverse]')?.addEventListener('click', () =>
      setting(() => {
        const last = map.points.length - 1;
        map.points.reverse();
        // Point features flip with the road; a jump's kicker would now face backwards, so they go.
        map.features = map.features.filter((f) => !isPointFeature(f)).map((f) => (isPointFeature(f) ? f : { ...f, from: last - f.to, to: last - f.from }));
        if (map.loop) map.points.unshift(map.points.pop()!);
        sel = -1;
      }, false),
    );
    left.querySelector('[data-smooth]')?.addEventListener('click', () =>
      setting(() => {
        const ys = map.points.map((p) => p[1]);
        const n = ys.length;
        map.points.forEach((p, i) => {
          if (!map.loop && (i === 0 || i === n - 1)) return;
          const a = ys[(i - 1 + n) % n];
          const b = ys[(i + 1) % n];
          p[1] = Math.round(((a + 2 * ys[i] + b) / 4) * 10) / 10;
        });
      }, false),
    );
    // Library.
    left.querySelectorAll<HTMLElement>('[data-open]').forEach((b) =>
      b.addEventListener('click', () => {
        const s = library.find((x) => x.id === b.dataset.open);
        if (!s) return;
        if (dirty && s.id !== savedId && !b.dataset.sure) {
          b.dataset.sure = '1';
          setStatus('Unsaved changes on this map. Press again to open the other one anyway.');
          return;
        }
        open(structuredClone(s.map), s.id);
        setStatus(`Opened ${s.map.name}.`);
      }),
    );
    left.querySelectorAll<HTMLElement>('[data-dup]').forEach((b) =>
      b.addEventListener('click', () => {
        const s = library.find((x) => x.id === b.dataset.dup);
        if (!s) return;
        open({ ...structuredClone(s.map), name: `${s.map.name} copy`.slice(0, MAP.nameMax) }, null, true);
        setStatus('A copy, not saved yet.');
      }),
    );
    left.querySelectorAll<HTMLElement>('[data-code]').forEach((b) =>
      b.addEventListener('click', () => {
        const s = library.find((x) => x.id === b.dataset.code);
        if (s) void copy(mapCode(s.map), 'Map code');
      }),
    );
    left.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) =>
      b.addEventListener('click', () => {
        if (!b.dataset.sure) {
          b.dataset.sure = '1';
          b.textContent = 'Sure? Press again';
          return;
        }
        void mapApi.act({ a: 'delete', id: b.dataset.del! }).then((r) => {
          if (!r.ok) return setStatus(r.error);
          library = r.maps;
          if (b.dataset.del === savedId) {
            savedId = null;
            dirty = true;
            saveDraft({ id: savedId, map, dirty });
          }
          setStatus('Deleted.');
          drawLeft();
          drawState();
        });
      }),
    );
    left.querySelectorAll<HTMLElement>('[data-template]').forEach((b) =>
      b.addEventListener('click', () => {
        const t = MAP_TEMPLATES.find((x) => x.id === b.dataset.template);
        if (t) open(t.make(), null, true);
        leftTab = 'map';
        drawLeft();
      }),
    );
    const remix = left.querySelector<HTMLSelectElement>('[data-remix]');
    remix?.addEventListener('change', () => {
      const m = remix.value ? mapFromTrack(remix.value as TrackId) : null;
      if (!m) return;
      open(m, null, true);
      setStatus(`Remixing ${TRACK_DEFS[remix.value as TrackId].name}.`);
      leftTab = 'map';
      drawLeft();
    });
    left.querySelector('[data-mycode]')?.addEventListener('click', () => void copy(mapCode(map), 'Map code'));
    const imp = left.querySelector<HTMLInputElement>('[data-import]');
    const importGo = () => {
      const m = imp ? decodeMapCode(imp.value) : null;
      if (!m) return setStatus("That isn't a map code (they start KJM1.).");
      open(m, null, true);
      setStatus(`Opened ${m.name} from a code. Save it to keep it.`);
      leftTab = 'map';
      drawLeft();
    };
    left.querySelector('[data-importgo]')?.addEventListener('click', importGo);
    imp?.addEventListener('keydown', (e) => e.key === 'Enter' && importGo());
    drawStats();
  }

  function drawStats() {
    const el = left.querySelector('[data-stats]');
    if (!el) return;
    const t = check.track;
    el.innerHTML = `<h3 class="tg-h">Stats</h3>
      <dl class="tg-mb-dl">
        <div><dt>Race</dt><dd class="tg-num">${t ? check.km.toFixed(2) : '–'}<small>km</small></dd></div>
        ${map.loop ? `<div><dt>Lap</dt><dd class="tg-num">${t ? ((t.lap * SAMPLE) / 1000).toFixed(2) : '–'}<small>km</small></dd></div>` : ''}
        <div><dt>Climb</dt><dd class="tg-num">${t ? Math.round(check.climb) : '–'}<small>m</small></dd></div>
        <div><dt>Drop</dt><dd class="tg-num">${t ? Math.round(check.drop) : '–'}<small>m</small></dd></div>
        <div><dt>Steepest</dt><dd class="tg-num">${t ? (check.grade * 100).toFixed(1) : '–'}<small>%</small></dd></div>
        <div><dt>Points</dt><dd class="tg-num">${map.points.length}<small>/ ${MAP.maxPoints}</small></dd></div>
      </dl>`;
  }

  async function loadLibrary() {
    library = await mapApi.list();
    libLoaded = true;
    if (leftTab === 'library' && root.isConnected) drawLeft();
  }

  // ---- the right rail: tools, inspector, issues ---------------------------------------------------------------
  function drawRight() {
    const t = TOOLS.find((x) => x.id === tool)!;
    right.innerHTML = `
      <div class="tg-mb-sec">
        <h3 class="tg-h">Tools</h3>
        <div class="tg-mb-tools">${TOOLS.map((x) => `<button class="tg-mb-tool" data-tool="${x.id}" aria-pressed="${x.id === tool}" ${isFeatureTool(x.id) && map.loop ? 'disabled' : ''} title="${esc(x.name)} (${x.key})" style="${isFeatureTool(x.id) ? `--fc:${FEAT_COLOR[x.id]}` : ''}"><i>${toolIcon(x.id)}</i><span>${esc(x.name)}</span><kbd>${x.key}</kbd></button>`).join('')}</div>
        <p class="tg-muted tg-mb-toolhint">${esc(t.hint)}</p>
      </div>
      <div class="tg-mb-sec" data-inspector></div>
      <div class="tg-mb-sec" data-issues></div>`;
    right.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool as Tool)));
    drawInspector();
    drawIssues();
    drawStats();
    $('[data-hint]').textContent = t.hint;
  }

  function setTool(t: Tool) {
    tool = t;
    rangeFrom = -1;
    drawRight();
    draw();
  }

  function drawInspector() {
    const el = right.querySelector<HTMLElement>('[data-inspector]');
    if (!el) return;
    // Don't rebuild the fields while one is being typed in (a drag elsewhere updates the numbers).
    if (el.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === 'INPUT') return;
    if (sel < 0 || !map.points[sel]) {
      el.innerHTML = `<h3 class="tg-h">Point</h3><p class="tg-muted">Pick a point on the map or on the profile to set where it is and how high, and to tune the features on it.</p>
        <p class="tg-muted tg-mb-keys"><kbd>Del</kbd> remove · <kbd>←↑→↓</kbd> nudge · <kbd>PgUp</kbd>/<kbd>PgDn</kbd> height · <kbd>Ctrl Z</kbd> undo · <kbd>F</kbd> fit</p>`;
      return;
    }
    const p = map.points[sel];
    const here = map.features.map((f, i) => ({ f, i })).filter(({ f }) => (isPointFeature(f) ? f.at === sel : sel >= f.from && sel <= f.to));
    const role = !map.loop && sel === 0 ? ' · start' : !map.loop && sel === map.points.length - 1 ? ' · finish' : '';
    el.innerHTML = `<h3 class="tg-h">Point ${sel + 1} <small>of ${map.points.length}${role}</small></h3>
      <div class="tg-mb-xyz">
        <label><span class="tg-label">East</span><input type="number" class="tg-num" data-px="0" value="${p[0]}" step="1" /></label>
        <label><span class="tg-label">South</span><input type="number" class="tg-num" data-px="2" value="${p[2]}" step="1" /></label>
        <label><span class="tg-label">Height</span><input type="number" class="tg-num" data-px="1" value="${p[1]}" step="0.5" /></label>
      </div>
      <div class="tg-mb-btns"><button class="tg-pill" data-hstep="-5">−5 m</button><button class="tg-pill" data-hstep="-1">−1 m</button><button class="tg-pill" data-hstep="1">+1 m</button><button class="tg-pill" data-hstep="5">+5 m</button><button class="tg-pill danger" data-delpoint>Remove point</button></div>
      ${here.length ? '' : `<p class="tg-muted">No features on this point.${map.loop ? '' : ' Pick a feature tool and click it.'}</p>`}
      ${here.map(({ f, i }) => featureHtml(f, i)).join('')}`;
    el.querySelectorAll<HTMLInputElement>('[data-px]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const v = Number(inp.value);
        if (!Number.isFinite(v)) return;
        const k = Number(inp.dataset.px);
        remember();
        map.points[sel][k] = k === 1 ? Math.max(MAP.heightMin, Math.min(MAP.heightMax, v)) : Math.max(-MAP.reach, Math.min(MAP.reach, v));
        changed();
      }),
    );
    el.querySelectorAll<HTMLElement>('[data-hstep]').forEach((b) =>
      b.addEventListener('click', () => {
        remember();
        map.points[sel][1] = Math.max(MAP.heightMin, Math.min(MAP.heightMax, map.points[sel][1] + Number(b.dataset.hstep)));
        changed();
        drawInspector();
      }),
    );
    el.querySelector('[data-delpoint]')?.addEventListener('click', () => deletePoint(sel));
    el.querySelectorAll<HTMLInputElement>('[data-fk]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const f = map.features[Number(inp.dataset.fi)] as unknown as Record<string, number>;
        const r = FEATURES[(f as unknown as MapFeature).kind].keys[inp.dataset.fk!];
        if (!f || !r) return;
        remember();
        f[inp.dataset.fk!] = Math.max(r.min, Math.min(r.max, Number(inp.value)));
        changed();
        drawInspector();
      }),
    );
    el.querySelectorAll<HTMLElement>('[data-delfeat]').forEach((b) =>
      b.addEventListener('click', () => {
        remember();
        map.features.splice(Number(b.dataset.delfeat), 1);
        changed();
        drawInspector();
      }),
    );
  }

  function featureHtml(f: MapFeature, i: number): string {
    const spec = FEATURES[f.kind];
    const span = isPointFeature(f) ? `at point ${f.at + 1}` : `points ${f.from + 1}-${f.to + 1}`;
    const rec = f as unknown as Record<string, number>;
    return `<div class="tg-mb-feat" style="--fc:${FEAT_COLOR[f.kind]}">
      <div class="tg-mb-feat-head"><b>${esc(spec.name)}</b><small>${span}</small><button class="tg-pill danger" data-delfeat="${i}">Remove</button></div>
      <p class="tg-muted">${esc(spec.blurb)}</p>
      ${Object.entries(spec.keys)
        .map(([k, r]) => `<label class="tg-mb-slider"><span class="tg-label">${esc(r.label)} <b class="tg-num">${rec[k]} ${r.unit}</b></span><input type="range" data-fi="${i}" data-fk="${k}" min="${r.min}" max="${r.max}" step="${r.max - r.min > 20 ? 1 : 0.1}" value="${rec[k]}" /></label>`)
        .join('')}
    </div>`;
  }

  function drawIssues() {
    const el = right.querySelector<HTMLElement>('[data-issues]');
    if (!el) return;
    const item = (is: MapIssue, kind: 'bad' | 'warn', n: number) => `<li class="${kind}"><button data-issue="${kind}:${n}"><i aria-hidden="true"></i>${esc(is.msg)}</button></li>`;
    el.innerHTML = `<h3 class="tg-h">Check <small>${check.ok ? 'ready to race' : `${check.errors.length} to fix`}</small></h3>
      ${check.ok && !check.warnings.length ? '<p class="tg-mb-ok">Ready to race. Test drive it, save it, then host a race and pick it under Your maps.</p>' : ''}
      <ul class="tg-mb-issues">${check.errors.map((is, n) => item(is, 'bad', n)).join('')}${check.warnings.map((is, n) => item(is, 'warn', n)).join('')}</ul>`;
    el.querySelectorAll<HTMLElement>('[data-issue]').forEach((b) =>
      b.addEventListener('click', () => {
        const [kind, n] = b.dataset.issue!.split(':');
        const is = (kind === 'bad' ? check.errors : check.warnings)[Number(n)];
        if (!is) return;
        const at = is.at ?? (is.point !== undefined ? [map.points[is.point][0], map.points[is.point][2]] : null);
        if (is.point !== undefined) sel = is.point;
        if (at) {
          view.cx = at[0];
          view.cz = at[1];
          view.zoom = Math.max(view.zoom, 0.6);
        }
        draw();
        drawInspector();
      }),
    );
  }

  // ---- the top bar ------------------------------------------------------------------------------------------
  function drawState() {
    const el = $('[data-state]');
    el.className = `tg-mb-state ${check.ok ? 'ok' : 'bad'}`;
    el.textContent = `${check.ok ? `${check.km.toFixed(2)} km · ready` : `${check.errors.length} to fix`}${dirty ? ' · unsaved' : savedId ? ' · saved' : ''}`;
    $<HTMLButtonElement>('[data-undo]').disabled = !past.length;
    $<HTMLButtonElement>('[data-redo]').disabled = !future.length;
    $<HTMLButtonElement>('[data-test]').disabled = !check.ok;
    $<HTMLButtonElement>('[data-save]').textContent = dirty || !savedId ? 'Save' : 'Saved';
    root.querySelectorAll<HTMLElement>('[data-rivals]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.rivals) === rivals)));
    if (status) $('[data-hint]').textContent = status;
  }
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  function setStatus(s: string) {
    status = s;
    $('[data-hint]').textContent = s;
    $('[data-hint]').classList.add('lit');
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      status = '';
      if (!root.isConnected) return;
      $('[data-hint]').classList.remove('lit');
      $('[data-hint]').textContent = TOOLS.find((x) => x.id === tool)!.hint;
    }, 4200);
  }

  async function save() {
    const m = cleanMap({ ...map, name: nameIn.value || map.name });
    if (!m) return setStatus('Give the map a name first.');
    map = m;
    const id = savedId ?? newMapId();
    const r = await mapApi.act({ a: 'save', map: { id, at: 0, map } });
    if (!r.ok) return setStatus(r.error);
    library = r.maps;
    libLoaded = true;
    savedId = id;
    dirty = false;
    saveDraft({ id: savedId, map, dirty });
    setStatus(account.user ? 'Saved to your account.' : 'Saved in this browser.');
    drawState();
    if (leftTab === 'library') drawLeft();
  }

  function testDrive() {
    if (!check.ok) return setStatus('Fix the issues on the right first.');
    saveDraft({ id: savedId, map, dirty });
    const track = registerMap(map);
    ctx.drive({ track, rivals, test: true });
  }

  nameIn.value = map.name;
  nameIn.addEventListener('input', () => {
    const name = nameIn.value.trim();
    if (!name) return;
    map.name = name.slice(0, MAP.nameMax);
    dirty = true;
    saveDraft({ id: savedId, map, dirty });
    drawState();
  });
  nameIn.addEventListener('change', () => {
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, REBUILD_MS);
  });
  $('[data-undo]').addEventListener('click', undo);
  $('[data-redo]').addEventListener('click', redo);
  $('[data-save]').addEventListener('click', () => void save());
  $('[data-test]').addEventListener('click', testDrive);
  root.querySelectorAll<HTMLElement>('[data-rivals]').forEach((b) =>
    b.addEventListener('click', () => {
      rivals = Number(b.dataset.rivals);
      drawState();
    }),
  );
  $('[data-frame]').addEventListener('click', frame);
  $('[data-snap]').addEventListener('click', (e) => {
    snap = !snap;
    (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(snap));
  });

  // ---- keys -----------------------------------------------------------------------------------------------
  const typing = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  };
  // Capture phase on the document, ahead of the page's own Esc = Back (src/client/main.ts): Esc first lets go of a
  // range tool's first click or the picked point, and only then leaves the builder.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && (rangeFrom >= 0 || sel >= 0 || tool !== 'select')) {
      e.stopPropagation();
      if (rangeFrom >= 0) rangeFrom = -1;
      else if (sel >= 0) sel = -1;
      else tool = 'select';
      drawRight();
      draw();
      return;
    }
    if (typing(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
      return;
    }
    if (mod) return;
    const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (t && !(isFeatureTool(t.id) && map.loop)) return setTool(t.id);
    if (e.key === 'f' || e.key === 'F') return frame();
    if (sel < 0) return;
    const p = map.points[sel];
    const step = e.shiftKey ? 10 : 1;
    const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key in nudge) {
      e.preventDefault();
      remember();
      p[0] += nudge[e.key][0];
      p[2] += nudge[e.key][1];
      changed();
      drawInspector();
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      remember();
      p[1] = Math.max(MAP.heightMin, Math.min(MAP.heightMax, p[1] + (e.key === 'PageUp' ? 1 : -1) * (e.shiftKey ? 5 : 1)));
      changed();
      drawInspector();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deletePoint(sel);
    }
  };
  document.addEventListener('keydown', onKey, true);

  // ---- go -------------------------------------------------------------------------------------------------
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  ro.observe(prof);
  layout();
  drawLeft();
  drawRight();
  drawState();
  resize();
  frame();
  void loadLibrary();
  const offAccount = account.onChange(() => void loadLibrary());

  return () => {
    document.removeEventListener('keydown', onKey, true);
    ro.disconnect();
    offAccount();
    if (rebuildTimer) clearTimeout(rebuildTimer);
    if (statusTimer) clearTimeout(statusTimer);
  };
};

/** Small line icons for the tools (inline SVG, currentColor). */
function toolIcon(t: Tool): string {
  const p: Record<Tool, string> = {
    select: '<path d="M5 3l12 8-5 1.5L9.5 18z"/>',
    add: '<circle cx="11" cy="11" r="7"/><path d="M11 7v8M7 11h8"/>',
    erase: '<path d="M5 15l7-9 6 5-6 7H8z"/><path d="M4 19h14"/>',
    crest: '<path d="M2 16c4 0 5-8 9-8s5 8 9 8"/>',
    jump: '<path d="M2 14h7l4-4v8M13 18h7"/>',
    gap: '<path d="M2 12h6M14 12h6M8 12v6M14 12v6"/>',
    bumps: '<path d="M2 13q2-4 4 0t4 0 4 0 4 0 4 0"/>',
    gravel: '<circle cx="6" cy="13" r="1.5"/><circle cx="11" cy="9" r="1.5"/><circle cx="15" cy="14" r="1.5"/><circle cx="18" cy="9" r="1.2"/>',
    canyon: '<path d="M2 18V6l4 3v9M20 18V6l-4 3v9M9 18h4"/>',
    bridge: '<path d="M2 9h18M5 9v8M17 9v8M5 9q6 6 12 0"/>',
    tunnel: '<path d="M3 18V11a8 8 0 0116 0v7"/><path d="M7 18v-6a4 4 0 018 0v6"/>',
  };
  return `<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p[t]}</svg>`;
}
