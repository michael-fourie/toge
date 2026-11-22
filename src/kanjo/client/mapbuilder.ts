// The map builder (screen `maps`): build your own track in its 3D world, play any part of it, save it, race it online.
//
// The map is plain data (custommap.ts `CustomMap`): control points the road threads through, settings, features
// pinned to the points, and scenery and road props placed by hand. The middle of the screen is the map's real world
// in 3D (mapworld.ts: the race's own renderer under a free editor camera) with the builder's handles drawn over it:
// drag points over the ground, lift them on their arrow, drop jumps, ramps and features anywhere on the road (a point
// is put in where you click), place scenery and turn it on its ring. A top-down plan of the same map is one key away
// (M). Under it the elevation profile (drag a point's handle to raise or lower it); the left rail holds the map's
// settings and your library (saved maps, templates, remixes of built-in tracks, share codes); the right rail the
// tools, the scenery to place, the inspector for what's picked, and what's wrong. Every change rebuilds the road with
// the game's own track builder (`checkMap`), and the 3D world is rebuilt from it once an edit settles. Play drives the
// whole map, from a picked point or a section between two points, and comes straight back here. The work in progress
// is a draft saved as you go (mapstore.ts), so a drive or a reload never loses it.

import {
  type CustomMap,
  type DecoKind,
  type FeatureKind,
  type MapCheck,
  type MapFeature,
  type MapDeco,
  type MapIssue,
  type MapProps,
  type MapTraffic,
  type SavedMap,
  DECOS,
  DECO_GROUPS,
  DECO_SCALE,
  FEATURES,
  MAP,
  MAP_DENSITY,
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
  decoOnRoad,
  isPointFeature,
  isRoadDeco,
  mapCode,
  mapFromTrack,
  newMapId,
  registerMap,
  sectionMap,
} from '../shared/custommap.ts';
import { RACE_TRACKS, SAMPLE, TRACK_DEFS, type TrackId, spline } from '../shared/track.ts';
import type { Render } from '../../client/menu/router.ts';
import { copy, esc } from '../../client/menu/ui.ts';
import { account } from '../../client/account.ts';
import { ICON, LOGO } from './brand.ts';
import { THEME_ART } from './trackart.ts';
import { type Draft, loadDraft, mapApi, mapSvg, saveDraft } from './mapstore.ts';
import * as THREE from 'three';
import { MapWorld } from './mapworld.ts';
import './hub.css';
import './mapbuilder.css';

type Tool = 'select' | 'add' | 'feature' | 'deco' | 'erase';
/** What the Features tool drops: a ramp or one of the road's features. */
type FeatPick = FeatureKind | 'ramp';
const TOOLS: { id: Tool; name: string; key: string; hint: string }[] = [
  { id: 'select', name: 'Move', key: '1', hint: 'Click a point or a piece of scenery to pick it and drag it to move it. Drag a picked point’s yellow arrow to raise or lower it. Drag empty ground to pan, right-drag to orbit, scroll to zoom, WASD to move.' },
  { id: 'add', name: 'Road', key: '2', hint: 'Click the ground to carry the road on from its finish (Shift: from its start). Click the road itself to put a point in it.' },
  { id: 'feature', name: 'Features', key: '3', hint: 'Pick a ramp or a feature on the right, then click the road where it goes. Long ones (bumps, gravel, canyon, bridge, tunnel): click where it starts, then where it ends.' },
  { id: 'deco', name: 'Scenery', key: '4', hint: 'Pick a piece on the right, then click the ground to place it (it turns to face the road). Cones, barrels and bales go on the road.' },
  { id: 'erase', name: 'Erase', key: '5', hint: 'Click a point or a piece of scenery to take it out.' },
];
/** The Features tool's palette, in order: what each is and how it goes down. */
const FEAT_PICKS: { id: FeatPick; name: string; hint: string }[] = [
  { id: 'ramp', name: 'Ramp', hint: 'A kicker that throws you in the air and lands you back on the road.' },
  { id: 'crest', name: 'Crest', hint: 'The road rises and falls away: a blind brow.' },
  { id: 'jump', name: 'Drop jump', hint: 'A kicker, then the road drops onto the street below.' },
  { id: 'gap', name: 'Gap', hint: 'The road stops over a ravine. Too slow and you fall in.' },
  { id: 'bumps', name: 'Bumps', hint: 'Broken tarmac between two points.' },
  { id: 'gravel', name: 'Gravel', hint: 'A gravel stage between two points.' },
  { id: 'canyon', name: 'Canyon', hint: 'Rock walls either side between two points.' },
  { id: 'bridge', name: 'Bridge', hint: 'The ground falls away under a bridge between two points.' },
  { id: 'tunnel', name: 'Tunnel', hint: 'A gallery through a hillside between two points.' },
];
/** A ramp is a drop jump with no drop: a kicker you fly off and land back on the road (track.ts `jump`). */
const RAMP = { size: 2.6, kick: 22, drop: 0, land: 70 };
/** Colours for the scenery groups' markers (data colours, not the brand roles). */
const GROUP_COLOR: Record<string, string> = { nature: '#5fd38a', buildings: '#e0b872', roadside: '#a7b0bd', lights: '#ffe27a', landmarks: '#c792ff', road: '#ff7a2b' };
/** Handles float this far over their point in 3D (m). */
const LIFT = 1.5;
/** How long an edit has to settle before the 3D world is rebuilt (ms): the build is the race's own, 0.2-1.5 s. */
const WORLD_MS = 550;
const VIEW_KEY = 'atrous.mapView';
/** A leg steeper than this (rise over run) is drawn red on the point's height bar, as `checkMap` refuses it. */
const STEEP = MAP.maxGrade * 1.15;
const CAM_KEY = 'atrous.mapCam';
/** Tools that work on a point-to-point road only (features and ramps). */
const roadOnly = (t: Tool) => t === 'feature';
const HELP_KEY = 'atrous.mapHelp';

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
  let selDeco = -1; // the picked piece of scenery
  let decoKind: DecoKind = 'tree';
  let featKind: FeatPick = 'ramp';
  const featColor = () => FEAT_COLOR[featKind === 'ramp' ? 'jump' : featKind];
  /** The road under the cursor for the Features tool (where it would go). */
  let hoverRoad: [number, number] | null = null;
  /** The last check whose road built: the 3D world keeps showing it while the map can't be built. */
  let worldKey = '';
  let broken = '';
  let hoverAt: [number, number, number] | null = null;
  let clearArmed = false;
  /** A stretch to play on its own: from one point to a later one. */
  let section: [number, number] | null = null;
  let mode: '3d' | 'plan' = (() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'plan' ? 'plan' : '3d';
    } catch {
      return '3d';
    }
  })();
  const past: string[] = [];
  const future: string[] = [];
  /** The road as drawn: the spline through the points (SEG samples a segment), and where each point sits in the build. */
  let dense: [number, number, number][] = [];
  let pointS: number[] = [];
  /** Distance along the spline at each of `dense`'s samples, when the road doesn't build (the profile falls back on it). */
  let denseS: number[] = [];

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
          <button class="tg-go small" data-test title="Play the whole map">${ICON.flag}Play</button>
        </div>
      </header>
      <div class="tg-mb-body">
        <aside class="tg-mb-rail" data-left></aside>
        <section class="tg-mb-stage">
          <div class="tg-mb-view" data-mode="${mode}">
            <div class="tg-mb-world" data-world><canvas class="tg-mb-over" data-over aria-label="The map's world in 3D"></canvas></div>
            <canvas class="tg-mb-canvas" data-canvas aria-label="The map, from above"></canvas>
            <div class="tg-mb-hud">
              <span class="tg-mb-busy" data-busy hidden>Updating the world…</span>
              <span data-scale></span>
              <div class="tg-seg" role="group" aria-label="View"><button class="tg-pill" data-mode-to="3d" title="The map's world in 3D (M)">3D</button><button class="tg-pill" data-mode-to="plan" title="The map from above (M)">Plan</button></div>
              <button class="tg-pill" data-top title="Look straight down, and back (T)">Top</button>
              <button class="tg-pill" data-frame title="Fit the road in view (F)">Fit</button>
              <button class="tg-pill" data-snap aria-pressed="true" title="Snap points to a ${SNAP} m grid">Snap ${SNAP} m</button>
            </div>
            <div class="tg-mb-section" data-section hidden></div>
            <div class="tg-mb-pop" data-pop hidden></div>
            <button class="tg-mb-helpbtn" data-helpbtn title="Controls" aria-label="Controls">?</button>
            <div class="tg-mb-help" data-help hidden>${helpHtml()}</div>
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
  const over = $<HTMLCanvasElement>('[data-over]');
  const og = over.getContext('2d')!;
  const world = new MapWorld($('[data-world]'));
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
    world.frameBox(x0, x1, z0, z1, levelOf());
    view.cx = (x0 + x1) / 2;
    view.cz = (z0 + z1) / 2;
    view.zoom = Math.max(ZOOM.min, Math.min(ZOOM.max, Math.min((view.w - 80) / Math.max(60, x1 - x0), (view.h - 80) / Math.max(60, z1 - z0))));
    draw();
  }

  function resize() {
    view.dpr = Math.min(2, devicePixelRatio || 1);
    // The world, its overlay and the plan all fill the view (one shows at a time).
    const r = $('[data-mode]').getBoundingClientRect();
    if (r.width > 0 && r.height > 0) world.setSize(r.width, r.height);
    over.width = Math.round(r.width * view.dpr);
    over.height = Math.round(r.height * view.dpr);
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
    if (!t) {
      // No build: measure along the spline, so the profile still shows the points and they can be dragged back.
      let s = 0;
      denseS = [0];
      for (let i = 1; i < dense.length; i++) denseS.push((s += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][2] - dense[i - 1][2])));
      map.points.forEach((_, k) => pointS.push(denseS[Math.min(dense.length - 1, k * SEG)] ?? 0));
      return;
    }
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
    drawSection();
    scheduleWorld();
  }

  // ---- the 3D world: rebuilt from the checked road once edits settle ---------------------------------------------
  let worldTimer: ReturnType<typeof setTimeout> | null = null;
  let worldStale = true;
  /** The level the 3D view picks on without a road (and on a sky road): the points' middle height. */
  const levelOf = () => {
    const ys = map.points.map((p) => p[1]).sort((a, b) => a - b);
    return ys.length ? ys[Math.floor(ys.length / 2)] : 0;
  };
  /** What the 3D world is built from: the map less what doesn't show (its blurb, how busy the traffic is). */
  const keyOf = (m: CustomMap) => JSON.stringify({ ...m, blurb: '', density: 0 });
  function scheduleWorld(wait = WORLD_MS) {
    // A map that doesn't build keeps the last world that did (raise a point too far and the road is refused: the
    // world used to vanish), and says why on the chip.
    broken = check.track ? '' : map.points.length >= 2 ? (check.errors[0]?.msg ?? 'The road can’t be built as it is.') : '';
    const key = check.track ? keyOf(map) : worldKey;
    worldStale = key !== worldKey || !world.built;
    if (worldTimer) clearTimeout(worldTimer);
    showBusy();
    if (mode !== '3d' || !check.track || !worldStale) return;
    worldTimer = setTimeout(() => {
      worldTimer = null;
      // Not under a drag: the overlay shows the edit live, the world catches up when it's let go.
      if (drag) return scheduleWorld(150);
      if (!check.track) return;
      world.level = levelOf();
      world.setTrack(check.track);
      yMemo.clear();
      worldKey = keyOf(map);
      worldStale = false;
      showBusy();
    }, wait);
  }
  function showBusy() {
    const el = $('[data-busy]');
    const busy = mode === '3d' && (broken || (worldStale && !!check.track));
    el.hidden = !busy;
    el.classList.toggle('bad', !!broken);
    el.textContent = broken ? `${world.built ? 'Showing the last road that built · ' : ''}${broken}` : 'Updating the world…';
  }
  world.onFrame = () => drawOverlay();
  // Dev hook for measuring the builder (`window.__mb`).
  if (import.meta.env.DEV) (window as unknown as { __mb: unknown }).__mb = { world, map: () => map, check: () => check };
  world.keysOn = () => mode === '3d' && !typing(document.activeElement);
  /** Ground heights under markers, kept per world build (heightAt is too dear to ask 300 times a frame). */
  const yMemo = new Map<string, number>();
  const groundY = (x: number, z: number) => {
    const k = `${x},${z}`;
    let y = yMemo.get(k);
    if (y === undefined) {
      if (yMemo.size > 4000) yMemo.clear();
      yMemo.set(k, (y = world.groundY(x, z)));
    }
    return y;
  };

  /** Switches between the 3D world and the top-down plan. */
  function setMode(m: '3d' | 'plan') {
    mode = m;
    try {
      localStorage.setItem(VIEW_KEY, m);
    } catch {
      /* private window */
    }
    $('[data-mode]').dataset.mode = m;
    root.querySelectorAll<HTMLElement>('[data-mode-to]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modeTo === m)));
    resize();
    if (m === '3d') scheduleWorld(30);
    showBusy();
    draw();
  }

  /** The editor camera, kept across a drive so you come back where you were. */
  function saveCam() {
    try {
      sessionStorage.setItem(CAM_KEY, JSON.stringify({ x: world.pos.x, y: world.pos.y, z: world.pos.z, yaw: world.yaw, pitch: world.pitch }));
    } catch {
      /* private window */
    }
  }
  function loadCam(): boolean {
    try {
      const c = JSON.parse(sessionStorage.getItem(CAM_KEY) ?? 'null') as { x: number; y: number; z: number; yaw: number; pitch: number } | null;
      if (!c || ![c.x, c.y, c.z, c.yaw, c.pitch].every(Number.isFinite)) return false;
      world.pos.set(c.x, c.y, c.z);
      world.yaw = c.yaw;
      world.pitch = c.pitch;
      world.snap();
      return true;
    } catch {
      return false;
    }
  }

  /** Something changed the map. `commit`: a step for Undo (drags commit once, at the end). */
  function changed(commit = true) {
    dirty = true;
    dense = map.points.length >= 2 ? spline(map.points, map.loop) : map.points.slice();
    if (commit) future.length = 0;
    // Mid-drag only the handles and the line follow: the save, the check and the world wait for the drag's end.
    if (drag) return draw();
    saveDraft({ id: savedId, map, dirty });
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
    selDeco = -1;
    section = null;
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
    selDeco = -1;
    section = null;
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
    selDeco = -1;
    section = null;
    rangeFrom = -1;
    saveDraft({ id: savedId, map, dirty });
    check = checkMap(map);
    layout();
    nameIn.value = map.name;
    drawLeft();
    drawRight();
    drawState();
    frame();
    scheduleWorld(30);
  }

  // ---- editing the points ------------------------------------------------------------------------
  const snapTo = (v: number) => (snap ? Math.round(v / SNAP) * SNAP : Math.round(v * 10) / 10);

  /** Inserts a point before index `k` (features after it move along). */
  function insertPoint(k: number, p: [number, number, number]) {
    if (map.points.length >= MAP.maxPoints) return setStatus(`A map holds ${MAP.maxPoints} points at most.`);
    map.points.splice(k, 0, p);
    map.features = map.features.map((f) => (isPointFeature(f) ? { ...f, at: f.at >= k ? f.at + 1 : f.at } : { ...f, from: f.from >= k ? f.from + 1 : f.from, to: f.to >= k ? f.to + 1 : f.to }));
    if (rangeFrom >= k) rangeFrom++;
    if (section) section = [section[0] >= k ? section[0] + 1 : section[0], section[1] >= k ? section[1] + 1 : section[1]];
    sel = k;
    selDeco = -1;
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
    section = null;
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

  // ---- screen and world, in whichever view is up -----------------------------------------------------------
  const is3d = () => mode === '3d';
  /** A world point on the screen (the plan ignores height), or null when it's behind the 3D camera. */
  const proj = (x: number, y: number, z: number): [number, number] | null => (is3d() ? world.project(x, y, z) : toScreen(x, z));
  /** The ground under a screen point (in the plan, the point at height 0), or null. */
  function groundAt(sx: number, sy: number): [number, number, number] | null {
    if (is3d()) return world.pickGround(sx, sy);
    const [x, z] = toWorld(sx, sy);
    return [x, 0, z];
  }
  /** A point's handle: floating over where it asks the road to be. */
  const handleOf = (p: [number, number, number]) => proj(p[0], p[1] + LIFT, p[2]);
  const decoY = (d: MapDeco) => (is3d() ? groundY(d[1], d[2]) : 0);
  const decoR = (d: MapDeco) => DECOS[d[0]].r * (d[4] ?? 1);
  /** The yaw (degrees) that turns a piece at (x, z) to face the nearest stretch of road. */
  function faceRoad(x: number, z: number): number {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < dense.length; i += 3) {
      const d = (dense[i][0] - x) ** 2 + (dense[i][2] - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (!dense.length) return 0;
    const vx = dense[best][0] - x;
    const vz = dense[best][2] - z;
    return Math.round(((Math.atan2(-vx, -vz) * 180) / Math.PI + 360) % 360);
  }
  /** Distance from (x, z) to the road's centre line as drawn (m). */
  function roadGap(x: number, z: number): number {
    let bd = Infinity;
    for (let i = 0; i < dense.length; i++) bd = Math.min(bd, (dense[i][0] - x) ** 2 + (dense[i][2] - z) ** 2);
    return Math.sqrt(bd);
  }

  // ---- hit tests -----------------------------------------------------------------------------------
  function pointAtScreen(sx: number, sy: number): number {
    let best = -1;
    let bd = HIT_POINT + (is3d() ? 3 : 0);
    map.points.forEach((p, i) => {
      const h = handleOf(p);
      if (!h) return;
      const [x, y] = h;
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
    const g = groundAt(sx, sy);
    if (!g) return null;
    const [wx, wy, wz] = g;
    // A few pixels' grace past the road's edge, however far away it is.
    const reach = map.width / 2 + (is3d() ? Math.max(3, HIT_ROAD * world.metresPerPx(wx, wy, wz)) : HIT_ROAD / view.zoom);
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

  /** The piece of scenery under a screen point, or -1. */
  function decoAtScreen(sx: number, sy: number): number {
    const g = groundAt(sx, sy);
    let best = -1;
    let bd = Infinity;
    map.deco.forEach((d, i) => {
      const at = proj(d[1], decoY(d) + 0.6, d[2]);
      const px = at ? Math.hypot(at[0] - sx, at[1] - sy) : Infinity;
      const m = g ? Math.hypot(g[0] - d[1], g[2] - d[2]) : Infinity;
      // On its marker, or on its footprint.
      const score = px < 12 ? px : m < decoR(d) + 0.6 ? 12 + m : Infinity;
      if (score < bd) {
        bd = score;
        best = i;
      }
    });
    return best;
  }
  /** The rotate knob of the picked piece: on its ring, in front of it. */
  function knobOf(d: MapDeco): [number, number] | null {
    const r = Math.max(3, decoR(d) + 1.5);
    const a = (d[3] * Math.PI) / 180;
    return proj(d[1] - Math.sin(a) * r, decoY(d) + 0.3, d[2] - Math.cos(a) * r);
  }
  /** The lift arrow of the picked point (3D): its tip, 46 px above the handle. */
  function liftOf(p: [number, number, number]): [number, number] | null {
    if (!is3d()) return null;
    const h = handleOf(p);
    return h ? [h[0], h[1] - 46] : null;
  }

  // ---- drawing: the map from above -------------------------------------------------------------------
  let overlayQueued = false;
  function draw() {
    if (is3d()) {
      if (!overlayQueued) {
        overlayQueued = true;
        requestAnimationFrame(() => {
          overlayQueued = false;
          drawOverlay();
        });
      }
      drawProfile();
      return;
    }
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
    // Scenery and road props: a dot in their group's colour, their footprint when you're close enough to see it.
    map.deco.forEach((d, i) => {
      const [x, y] = toScreen(d[1], d[2]);
      if (x < -40 || y < -40 || x > view.w + 40 || y > view.h + 40) return;
      g.fillStyle = GROUP_COLOR[DECOS[d[0]].group];
      g.globalAlpha = 0.85;
      g.beginPath();
      g.arc(x, y, Math.max(2.5, decoR(d) * view.zoom), 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      if (i === selDeco) decoGizmo(g, d);
    });
    if (tool === 'deco' && hoverAt) ghost(g, hoverAt);
    queueMicrotask(placePop);
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
      g.strokeStyle = i === rangeFrom ? featColor() : '#05070b';
      g.stroke();
      if (view.zoom > 0.12 || i === sel || i === 0) {
        g.font = '700 11px Barlow Condensed, sans-serif';
        g.fillStyle = i === sel ? '#38c9ff' : 'rgba(238,242,248,0.75)';
        g.fillText(String(i + 1), x + 9, y + 4);
      }
    });
    drawProfile();
  }

  /** A ring on the ground round (x, z) of radius r (m), drawn through `proj` (3D or plan). */
  function ring(c: CanvasRenderingContext2D, x: number, y: number, z: number, r: number) {
    c.beginPath();
    let pen = false;
    for (let k = 0; k <= 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      const q = proj(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
      if (!q) {
        pen = false;
        continue;
      }
      pen ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]);
      pen = true;
    }
  }
  /** The picked piece: its footprint ring in cyan, the rotate knob in front, a tick showing which way it faces. */
  function decoGizmo(c: CanvasRenderingContext2D, d: MapDeco) {
    const y = decoY(d) + 0.3;
    c.strokeStyle = '#38c9ff';
    c.lineWidth = 2;
    ring(c, d[1], y, d[2], Math.max(3, decoR(d) + 1.5));
    c.stroke();
    const centre = proj(d[1], y, d[2]);
    const knob = knobOf(d);
    if (centre && knob) {
      c.beginPath();
      c.moveTo(centre[0], centre[1]);
      c.lineTo(knob[0], knob[1]);
      c.stroke();
      c.fillStyle = '#38c9ff';
      c.beginPath();
      c.arc(knob[0], knob[1], 6, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#05070b';
      c.font = '700 9px Barlow Condensed, sans-serif';
      c.fillText('⟳', knob[0] - 3.5, knob[1] + 3.5);
    }
  }
  /** Where the picked piece would go, under the cursor. */
  function ghost(c: CanvasRenderingContext2D, at: [number, number, number]) {
    const road = isRoadDeco(decoKind);
    const ok = road ? roadGap(at[0], at[2]) < map.width / 2 : roadGap(at[0], at[2]) > map.width / 2 + DECOS[decoKind].r + 1;
    c.strokeStyle = ok ? 'rgba(255,255,255,0.85)' : '#ff6b6b';
    c.setLineDash([4, 4]);
    c.lineWidth = 1.5;
    ring(c, at[0], at[1] + 0.3, at[2], Math.max(1, DECOS[decoKind].r));
    c.stroke();
    c.setLineDash([]);
  }

  /** The 3D view's overlay: the road's line as it is now (the world catches up when an edit settles), features,
   * scenery markers, issues, the points' handles and the picked thing's gizmo. */
  function drawOverlay() {
    if (!is3d()) return;
    const c = og;
    const w = over.width / view.dpr;
    const h = over.height / view.dpr;
    c.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    /** A polyline along the spline from sample a to b, lifted dy (breaks where it goes behind the camera). */
    const along = (a: number, b: number, dy: number, every = 3) => {
      c.beginPath();
      let pen = false;
      for (let i = a; i <= b; i += every) {
        const p = dense[Math.min(i, dense.length - 1)];
        const q = proj(p[0], p[1] + dy, p[2]);
        if (!q) {
          pen = false;
          continue;
        }
        pen ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]);
        pen = true;
      }
    };
    if (dense.length >= 2) {
      // A section to play: a broad green band.
      if (section) {
        along(section[0] * SEG, Math.min(dense.length - 1, section[1] * SEG), 0.8);
        c.strokeStyle = 'rgba(61,220,132,0.45)';
        c.lineWidth = 10;
        c.stroke();
      }
      for (const f of map.features) {
        if (isPointFeature(f)) continue;
        along(f.from * SEG, Math.min(dense.length - 1, f.to * SEG), 0.8);
        c.strokeStyle = FEAT_COLOR[f.kind];
        c.lineWidth = 5;
        c.stroke();
      }
      // The centre line: solid cyan while the world is catching up with an edit, a faint dash once it has.
      along(0, dense.length - 1 + (map.loop ? 3 : 0), 0.5, 2);
      if (map.loop) c.closePath();
      const live = worldStale || !!broken;
      c.strokeStyle = broken ? 'rgba(255,107,107,0.95)' : live ? 'rgba(56,201,255,0.95)' : 'rgba(255,255,255,0.45)';
      c.lineWidth = live ? 2.5 : 1.2;
      c.setLineDash(live ? [] : [6, 6]);
      c.stroke();
      c.setLineDash([]);
    }
    c.font = '700 11px Barlow Condensed, sans-serif';
    const t = check.track;
    if (t) {
      const label = (s: number, text: string, col: string) => {
        const i = Math.min(t.n - 1, Math.round(s / SAMPLE));
        const q = proj(t.x[i], t.y[i] + 6, t.z[i]);
        if (!q) return;
        c.fillStyle = col;
        c.fillRect(q[0] - 2, q[1] - 2, 4, 4);
        c.fillText(text, q[0] + 6, q[1] + 4);
      };
      label(t.startS, t.lap ? 'START / FINISH' : 'START', '#3ddc84');
      if (!t.lap) label(t.finishS, 'FINISH', '#ff3b30');
    }
    for (const f of map.features) {
      if (!isPointFeature(f)) continue;
      const p = map.points[f.at];
      const q = p && proj(p[0], p[1] + LIFT + 7, p[2]);
      if (!q) continue;
      c.fillStyle = FEAT_COLOR[f.kind];
      c.beginPath();
      c.arc(q[0], q[1], 5, 0, Math.PI * 2);
      c.fill();
      c.fillText(f.kind === 'jump' && f.drop === 0 ? 'RAMP' : FEATURES[f.kind].name.toUpperCase(), q[0] + 8, q[1] + 4);
    }
    // Scenery: a faint marker in its group's colour over each piece (the world draws the piece itself), so far-off or
    // tiny pieces can still be found and picked. Close up the piece speaks for itself and only the picked one is marked.
    c.lineWidth = 1;
    c.strokeStyle = '#05070b';
    map.deco.forEach((d, i) => {
      const y = decoY(d);
      const q = proj(d[1], y + 0.6, d[2]);
      if (!q || q[0] < -20 || q[1] < -20 || q[0] > w + 20 || q[1] > h + 20) return;
      const big = decoR(d) / world.metresPerPx(d[1], y, d[2]) > 14;
      if (i !== selDeco && big) return;
      c.globalAlpha = i === selDeco ? 1 : 0.6;
      c.fillStyle = GROUP_COLOR[DECOS[d[0]].group];
      c.beginPath();
      c.arc(q[0], q[1], i === selDeco ? 5 : 2.6, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.globalAlpha = 1;
      if (i === selDeco) decoGizmo(c, d);
    });
    if (tool === 'deco' && hoverAt) ghost(c, hoverAt);
    if (tool === 'feature' && hoverRoad && !map.loop) {
      const y = groundY(hoverRoad[0], hoverRoad[1]);
      c.strokeStyle = featColor();
      c.lineWidth = 3;
      ring(c, hoverRoad[0], y + 0.4, hoverRoad[1], Math.max(4, map.width / 2));
      c.stroke();
      const q = proj(hoverRoad[0], y + 4, hoverRoad[1]);
      if (q) {
        c.fillStyle = featColor();
        c.fillText(FEAT_PICKS.find((f) => f.id === featKind)!.name.toUpperCase() + (rangeFrom >= 0 ? ' · ENDS HERE' : ''), q[0] + 10, q[1]);
      }
    }
    for (const [list, col] of [[check.errors, '#ff6b6b'], [check.warnings, '#ffc940']] as const)
      for (const is of list) {
        const at = is.at ?? (is.point !== undefined && map.points[is.point] ? ([map.points[is.point][0], map.points[is.point][2]] as [number, number]) : null);
        if (!at) continue;
        c.strokeStyle = col;
        c.lineWidth = 2;
        ring(c, at[0], groundY(at[0], at[1]) + 0.5, at[1], 12);
        c.stroke();
      }
    // The points: a stem down to the ground, the handle, its number.
    map.points.forEach((p, i) => {
      const hq = handleOf(p);
      if (!hq) return;
      const gq = proj(p[0], Math.min(p[1], groundY(p[0], p[2])), p[2]);
      if (gq) {
        c.strokeStyle = 'rgba(255,255,255,0.5)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(gq[0], gq[1]);
        c.lineTo(hq[0], hq[1]);
        c.stroke();
      }
      const r = i === sel ? 8 : i === hover ? 7 : 6;
      c.beginPath();
      c.arc(hq[0], hq[1], r, 0, Math.PI * 2);
      c.fillStyle = i === sel ? '#38c9ff' : !map.loop && i === 0 ? '#3ddc84' : !map.loop && i === map.points.length - 1 ? '#ff3b30' : '#eef2f8';
      c.fill();
      c.lineWidth = i === rangeFrom ? 3 : 1.5;
      c.strokeStyle = i === rangeFrom ? (featColor()) : '#05070b';
      c.stroke();
      c.fillStyle = i === sel ? '#38c9ff' : 'rgba(238,242,248,0.85)';
      c.fillText(String(i + 1), hq[0] + 10, hq[1] + 4);
    });
    // The picked point's lift arrow.
    const sp = sel >= 0 ? map.points[sel] : null;
    const tip = sp && liftOf(sp);
    const base = sp && handleOf(sp);
    if (tip && base) {
      c.strokeStyle = '#ffc940';
      c.fillStyle = '#ffc940';
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(base[0], base[1] - 9);
      c.lineTo(tip[0], tip[1]);
      c.stroke();
      c.beginPath();
      c.moveTo(tip[0], tip[1] - 8);
      c.lineTo(tip[0] - 6, tip[1] + 2);
      c.lineTo(tip[0] + 6, tip[1] + 2);
      c.closePath();
      c.fill();
      c.fillText(`${sp[1]} m`, tip[0] + 9, tip[1] + 2);
    }
    placePop();
  }

  // ---- the picked point's bar: its height, nudges, the grades either side, play from it -------------------------
  const pop = $('[data-pop]');
  let popFor = '';
  /** The grade (rise over run) from point a to point b. */
  const gradeOf = (a: [number, number, number], b: [number, number, number]) => (b[1] - a[1]) / Math.max(1, Math.hypot(b[0] - a[0], b[2] - a[2]));
  function placePop() {
    const p = sel >= 0 ? map.points[sel] : null;
    const at = p && handleOf(p);
    if (!p || !at || at[0] < 0 || at[1] < 0 || at[0] > view.w || at[1] > view.h) {
      pop.hidden = true;
      popFor = '';
      return;
    }
    const n = map.points.length;
    const prev = sel > 0 ? map.points[sel - 1] : map.loop ? map.points[n - 1] : null;
    const next = sel < n - 1 ? map.points[sel + 1] : map.loop ? map.points[0] : null;
    const leg = (g: number | null, dir: string) => {
      if (g === null) return '';
      const pc = Math.round(Math.abs(g) * 100);
      const cls = Math.abs(g) > STEEP ? 'bad' : Math.abs(g) > MAP.warnGrade ? 'warn' : '';
      return `<span class="tg-mb-grade ${cls}" title="Grade ${dir}">${dir === 'before' ? '◂' : '▸'} ${g >= 0 ? '↗' : '↘'} ${pc}%</span>`;
    };
    const key = `${sel}|${p.join(',')}|${prev?.join(',')}|${next?.join(',')}|${n}|${map.loop}`;
    if (key !== popFor) {
      popFor = key;
      pop.innerHTML = `<b>Point ${sel + 1}</b><span class="tg-num">${p[1]} m</span>
        <button class="tg-pill" data-ph="-5" title="Lower 5 m (Shift+PgDn)">−5</button><button class="tg-pill" data-ph="-1" title="Lower 1 m (PgDn)">−1</button><button class="tg-pill" data-ph="1" title="Raise 1 m (PgUp)">+1</button><button class="tg-pill" data-ph="5" title="Raise 5 m (Shift+PgUp)">+5</button>
        ${leg(prev ? gradeOf(prev, p) : null, 'before')}${leg(next ? gradeOf(p, next) : null, 'after')}
        <button class="tg-pill primary" data-pplay title="Play from this point (P)">${ICON.flag}Play from here</button>`;
    }
    pop.hidden = false;
    // Beside the handle, kept inside the view.
    const r = pop.getBoundingClientRect();
    const x = Math.max(8, Math.min(view.w - r.width - 8, at[0] + 18));
    const y = Math.max(8, Math.min(view.h - r.height - 8, at[1] - r.height - 14));
    pop.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  pop.addEventListener('pointerdown', (e) => e.stopPropagation());
  pop.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b || sel < 0) return;
    if (b.dataset.pplay !== undefined) return playFrom(sel);
    remember();
    map.points[sel][1] = Math.max(MAP.heightMin, Math.min(MAP.heightMax, map.points[sel][1] + Number(b.dataset.ph)));
    changed();
    drawInspector();
  });

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
    if (!t) return drawRoughProfile();
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

  /** The profile of a map that doesn't build: the spline through the points, legs too steep in red. */
  function drawRoughProfile() {
    if (dense.length < 2 || !denseS.length) {
      pg.fillStyle = '#8e9ab0';
      pg.fillText('ELEVATION · place at least two points', 14, 18);
      return;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of dense) {
      lo = Math.min(lo, p[1]);
      hi = Math.max(hi, p[1]);
    }
    const pad = Math.max(6, (hi - lo) * 0.15);
    pf = { s0: 0, s1: Math.max(1, denseS[denseS.length - 1]), y0: lo - pad, y1: hi + pad };
    pg.lineWidth = 2;
    for (let i = 0; i + 1 < dense.length; i++) {
      const ds = Math.max(0.01, denseS[i + 1] - denseS[i]);
      const grade = Math.abs(dense[i + 1][1] - dense[i][1]) / ds;
      pg.strokeStyle = grade > STEEP ? '#ff3b30' : grade > MAP.warnGrade ? '#ff6b6b' : '#38c9ff';
      pg.beginPath();
      pg.moveTo(profX(denseS[i]), profY(dense[i][1]));
      pg.lineTo(profX(denseS[i + 1]), profY(dense[i + 1][1]));
      pg.stroke();
    }
    map.points.forEach((p, i) => {
      const x = profX(pointS[i] ?? 0);
      pg.beginPath();
      pg.arc(x, profY(p[1]), i === sel ? 6 : 4.5, 0, Math.PI * 2);
      pg.fillStyle = i === sel ? '#38c9ff' : '#eef2f8';
      pg.fill();
      pg.strokeStyle = '#05070b';
      pg.lineWidth = 1.5;
      pg.stroke();
    });
    pg.fillStyle = '#ff6b6b';
    pg.fillText('ELEVATION · the road can’t be built as it is: drag the points until no leg is red', 48, 14);
  }

  // ---- pointer input, on the 3D overlay or the plan ----------------------------------------------------------
  type Drag =
    | { kind: 'pan'; sx: number; sy: number; cx: number; cz: number }
    | { kind: 'grab'; y: number; x: number; z: number }
    | { kind: 'orbit'; sx: number; sy: number; p: THREE.Vector3 }
    | { kind: 'point'; i: number; moved: boolean; before: string; y: number }
    | { kind: 'lift'; i: number; sy: number; y: number; per: number; before: string }
    | { kind: 'deco'; i: number; moved: boolean; before: string; dx: number; dz: number }
    | { kind: 'turn'; i: number; before: string }
    | { kind: 'height'; i: number; sy: number; y: number; scale: number; before: string };
  let drag: Drag | null = null;
  const pointers = new Map<number, [number, number]>();
  let pinch: { d: number; zoom: number } | null = null;
  const local = (e: PointerEvent | WheelEvent | MouseEvent, el: HTMLElement): [number, number] => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  /** Commits a drag's before-state as one Undo step. */
  const commit = (before: string) => {
    past.push(before);
    if (past.length > HISTORY) past.shift();
    future.length = 0;
  };
  /** Starts panning: a grab of the ground in 3D, the plan's own pan otherwise. */
  function startPan(sx: number, sy: number) {
    if (!is3d()) {
      drag = { kind: 'pan', sx, sy, cx: view.cx, cz: view.cz };
      return;
    }
    const g = world.pickGround(sx, sy);
    if (g) drag = { kind: 'grab', x: g[0], y: g[1], z: g[2] };
  }
  /** The point a road tool works on: one under the cursor or within 15 m of the click, or a new one put in the road there. */
  function pointForRoad(sx: number, sy: number): number {
    const hit = pointAtScreen(sx, sy);
    if (hit >= 0) return hit;
    const road = roadAtScreen(sx, sy);
    if (!road) return -1;
    const near = map.points.findIndex((p) => Math.hypot(p[0] - road.x, p[2] - road.z) < 15);
    if (near >= 0) return near;
    remember();
    insertPoint(road.seg + 1, [Math.round(road.x * 10) / 10, heightNear(road.seg + 1, road.x, road.z), Math.round(road.z * 10) / 10]);
    changed();
    return road.seg + 1;
  }

  function down(e: PointerEvent, el: HTMLElement) {
    const [sx, sy] = local(e, el);
    pointers.set(e.pointerId, [sx, sy]);
    el.setPointerCapture(e.pointerId);
    if (pointers.size === 2 && !is3d()) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: view.zoom };
      drag = null;
      return;
    }
    if (is3d() && (e.button === 2 || (e.button === 0 && e.altKey))) {
      // Orbit round the ground you pressed on (or the middle of the view, over the sky).
      const c = world.pickGround(sx, sy) ?? world.pickGround(view.w / 2, view.h / 2);
      drag = { kind: 'orbit', sx, sy, p: c ? new THREE.Vector3(...c) : world.pos.clone().add(new THREE.Vector3(0, -150, -150)) };
      el.style.cursor = 'move';
      return;
    }
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) return startPan(sx, sy);
    const hit = pointAtScreen(sx, sy);
    if (tool === 'select') {
      // The picked thing's gizmo first: a point's lift arrow, a piece's rotate knob.
      const sp = sel >= 0 ? map.points[sel] : null;
      const tip = sp && liftOf(sp);
      if (sp && tip && Math.hypot(tip[0] - sx, tip[1] - sy) < 12) {
        drag = { kind: 'lift', i: sel, sy, y: sp[1], per: world.metresPerPx(sp[0], sp[1], sp[2]), before: JSON.stringify(map) };
        return;
      }
      const sd = selDeco >= 0 ? map.deco[selDeco] : null;
      const knob = sd && knobOf(sd);
      if (knob && Math.hypot(knob[0] - sx, knob[1] - sy) < 10) {
        drag = { kind: 'turn', i: selDeco, before: JSON.stringify(map) };
        return;
      }
      if (hit >= 0) {
        sel = hit;
        selDeco = -1;
        const p = map.points[hit];
        drag = e.shiftKey && is3d() ? { kind: 'lift', i: hit, sy, y: p[1], per: world.metresPerPx(p[0], p[1], p[2]), before: JSON.stringify(map) } : { kind: 'point', i: hit, moved: false, before: JSON.stringify(map), y: p[1] };
        drawRight();
        draw();
        return;
      }
      const dh = decoAtScreen(sx, sy);
      if (dh >= 0) {
        selDeco = dh;
        sel = -1;
        const d = map.deco[dh];
        const g = groundAt(sx, sy);
        drag = { kind: 'deco', i: dh, moved: false, before: JSON.stringify(map), dx: g ? d[1] - g[0] : 0, dz: g ? d[2] - g[2] : 0 };
        drawRight();
        draw();
        return;
      }
      if (sel >= 0 || selDeco >= 0) {
        sel = -1;
        selDeco = -1;
        drawRight();
      }
      startPan(sx, sy);
      draw();
      return;
    }
    if (tool === 'erase') {
      if (hit >= 0) return deletePoint(hit);
      const dh = decoAtScreen(sx, sy);
      if (dh >= 0) removeDeco(dh);
      return;
    }
    if (tool === 'add') {
      const road = hit < 0 ? roadAtScreen(sx, sy) : null;
      if (hit >= 0) {
        sel = hit;
        drag = { kind: 'point', i: hit, moved: false, before: JSON.stringify(map), y: map.points[hit][1] };
      } else if (road) {
        remember();
        insertPoint(road.seg + 1, [snapTo(road.x), heightNear(road.seg + 1, road.x, road.z), snapTo(road.z)]);
        changed();
      } else {
        const g = groundAt(sx, sy);
        if (!g) return;
        remember();
        const at = e.shiftKey ? 0 : map.points.length;
        const near = map.points[at === 0 ? 0 : map.points.length - 1];
        insertPoint(at, [snapTo(g[0]), near ? near[1] : 100, snapTo(g[2])]);
        changed();
      }
      drawRight();
      draw();
      return;
    }
    if (tool === 'deco') {
      const g = groundAt(sx, sy);
      if (g) placeDeco(g[0], g[2]);
      return;
    }
    if (tool === 'feature') {
      if (map.loop) return setStatus('Features and ramps are for point-to-point roads: circuits stay clean.');
      const i = pointForRoad(sx, sy);
      if (i < 0) return setStatus('Click on the road.');
      if (featKind === 'ramp') placeRamp(i);
      else placeFeature(featKind, i);
    }
  }

  function move(e: PointerEvent, el: HTMLElement) {
    const [sx, sy] = local(e, el);
    const prev = pointers.get(e.pointerId);
    if (prev) pointers.set(e.pointerId, [sx, sy]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      view.zoom = Math.max(ZOOM.min, Math.min(ZOOM.max, (pinch.zoom * Math.hypot(a[0] - b[0], a[1] - b[1])) / Math.max(1, pinch.d)));
      draw();
      return;
    }
    if (!drag) {
      const h = pointAtScreen(sx, sy);
      let redraw = h !== hover;
      hover = h;
      if (tool === 'deco') {
        hoverAt = groundAt(sx, sy);
        redraw = true;
      }
      if (tool === 'feature') {
        const r = h < 0 ? roadAtScreen(sx, sy) : null;
        const hp = h >= 0 ? map.points[h] : null;
        hoverRoad = r ? [r.x, r.z] : hp ? [hp[0], hp[2]] : null;
        redraw = true;
      }
      if (redraw) draw();
      el.style.cursor = h >= 0 ? 'grab' : tool === 'select' ? (decoAtScreen(sx, sy) >= 0 ? 'grab' : 'default') : tool === 'erase' ? 'not-allowed' : 'crosshair';
      return;
    }
    switch (drag.kind) {
      case 'pan':
        view.cx = drag.cx - (sx - drag.sx) / view.zoom;
        view.cz = drag.cz - (sy - drag.sy) / view.zoom;
        draw();
        break;
      case 'grab': {
        // Keep the grabbed spot of ground under the cursor.
        const q = world.pickPlane(sx, sy, drag.y);
        if (q) world.shift(drag.x - q[0], drag.z - q[1]);
        break;
      }
      case 'orbit':
        world.orbit(drag.p, sx - drag.sx, sy - drag.sy);
        drag.sx = sx;
        drag.sy = sy;
        break;
      case 'point': {
        // Over the ground at the point's own height (3D), or straight under the cursor (plan).
        const q = is3d() ? world.pickPlane(sx, sy, drag.y + LIFT) : toWorld(sx, sy);
        if (!q) break;
        const p = map.points[drag.i];
        p[0] = Math.max(-MAP.reach, Math.min(MAP.reach, snapTo(q[0])));
        p[2] = Math.max(-MAP.reach, Math.min(MAP.reach, snapTo(q[1])));
        drag.moved = true;
        changed(false);
        drawInspector();
        break;
      }
      case 'lift': {
        const p = map.points[drag.i];
        p[1] = Math.round(Math.max(MAP.heightMin, Math.min(MAP.heightMax, drag.y - (sy - drag.sy) * drag.per)) * 2) / 2;
        changed(false);
        drawInspector();
        break;
      }
      case 'deco': {
        const g = groundAt(sx, sy);
        if (!g) break;
        const d = map.deco[drag.i];
        d[1] = Math.round((g[0] + drag.dx) * 10) / 10;
        d[2] = Math.round((g[2] + drag.dz) * 10) / 10;
        drag.moved = true;
        changed(false);
        drawInspector();
        break;
      }
      case 'turn': {
        const d = map.deco[drag.i];
        const g = is3d() ? world.pickPlane(sx, sy, decoY(d) + 0.3) : toWorld(sx, sy);
        if (!g) break;
        const snapDeg = e.shiftKey ? 1 : 15;
        d[3] = ((Math.round(((Math.atan2(-(g[0] - d[1]), -(g[1] - d[2])) * 180) / Math.PI) / snapDeg) * snapDeg) % 360 + 360) % 360;
        changed(false);
        drawInspector();
        break;
      }
    }
  }

  function up(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    const d = drag;
    drag = null;
    (e.currentTarget as HTMLElement | null)?.style.removeProperty('cursor');
    // A drag that changed the map is one Undo step, and now it's saved, checked and the world rebuilt.
    const edited = d && (((d.kind === 'point' || d.kind === 'deco') && d.moved) || d.kind === 'lift' || d.kind === 'turn');
    if (d && edited && 'before' in d && d.before !== JSON.stringify(map)) {
      commit(d.before);
      changed(false);
      drawInspector();
    }
  }

  for (const el of [canvas, over]) {
    el.addEventListener('pointerdown', (e) => down(e, el));
    el.addEventListener('pointermove', (e) => move(e, el));
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => {
      if (hoverAt) {
        hoverAt = null;
        draw();
      }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dblclick', (e) => {
      if (tool !== 'select') return;
      const [sx, sy] = local(e, el);
      if (pointAtScreen(sx, sy) >= 0 || decoAtScreen(sx, sy) >= 0) return;
      const road = roadAtScreen(sx, sy);
      if (!road) return;
      remember();
      insertPoint(road.seg + 1, [snapTo(road.x), heightNear(road.seg + 1, road.x, road.z), snapTo(road.z)]);
      changed();
      drawRight();
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const [sx, sy] = local(e, el);
        if (is3d()) return world.zoom(sx, sy, -e.deltaY);
        const [wx, wz] = toWorld(sx, sy);
        view.zoom = Math.max(ZOOM.min, Math.min(ZOOM.max, view.zoom * Math.exp(-e.deltaY * 0.0015)));
        // Keep the spot under the cursor where it was.
        view.cx = wx - (sx - view.w / 2) / view.zoom;
        view.cz = wz - (sy - view.h / 2) / view.zoom;
        draw();
      },
      { passive: false },
    );
  }

  // ---- scenery ------------------------------------------------------------------------------------------------
  function placeDeco(x: number, z: number) {
    if (map.deco.length >= MAP.maxDeco) return setStatus(`A map holds ${MAP.maxDeco} pieces at most.`);
    const road = isRoadDeco(decoKind);
    if (road && map.loop) return setStatus('Cones, barrels and bales are for point-to-point roads: circuits stay clean.');
    const gap = roadGap(x, z);
    if (road && gap > map.width / 2) return setStatus(`${DECOS[decoKind].name}s go on the road.`);
    if (!road && gap < map.width / 2 + DECOS[decoKind].r + 1) return setStatus('Scenery stands off the road: place it on the verge or further out.');
    remember();
    map.deco.push([decoKind, Math.round(x * 10) / 10, Math.round(z * 10) / 10, faceRoad(x, z)]);
    selDeco = map.deco.length - 1;
    sel = -1;
    changed();
    drawRight();
    if (leftTab === 'map') drawLeft();
  }
  function removeDeco(i: number) {
    remember();
    map.deco.splice(i, 1);
    selDeco = -1;
    changed();
    drawRight();
    if (leftTab === 'map') drawLeft();
  }
  /** Lines the built road with a piece: every `every` m, `off` m past the barrier (plus up to `jitter`), one side or both. */
  function lineRoad(kind: DecoKind, every: number, off: number, both: boolean, jitter = 0) {
    const t = check.track;
    if (!t) return setStatus('Fix the road first: scenery lines up along the built road.');
    remember();
    const i0 = t.lap ? Math.round(t.startS / SAMPLE) : 0;
    const i1 = t.lap ? i0 + t.lap : t.n;
    const step = Math.max(1, Math.round(every / SAMPLE));
    let k = 0;
    let added = 0;
    let rnd = 12345;
    const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    for (let i = i0 + Math.floor(step / 2); i < i1; i += step, k++)
      for (const side of both ? [-1, 1] : [k % 2 ? 1 : -1]) {
        if (map.deco.length >= MAP.maxDeco) break;
        const d = side * (t.rail + (side < 0 ? t.runL[i] : t.runR[i]) + off + rand() * jitter);
        const x = Math.round((t.x[i] - t.tz[i] * d) * 10) / 10;
        const z = Math.round((t.z[i] + t.tx[i] * d) * 10) / 10;
        if (decoOnRoad(t, kind, x, z)) continue;
        map.deco.push([kind, x, z, Math.round(((Math.atan2(-(t.x[i] - x), -(t.z[i] - z)) * 180) / Math.PI + 360) % 360)]);
        added++;
      }
    setStatus(added ? `Added ${added} ${DECOS[kind].name.toLowerCase()}${added === 1 ? '' : 's'}.` : 'No room left for more.');
    changed();
    drawLeft();
    drawRight();
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
    const d = drag;
    drag = null;
    if (d?.kind === 'height' && d.before !== JSON.stringify(map)) {
      commit(d.before);
      changed(false);
      drawInspector();
    }
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

  function placeRamp(i: number) {
    if (map.loop) return setStatus('Ramps are for point-to-point roads: circuits stay clean.');
    if (i <= 0 || i >= map.points.length - 1) return setStatus("A ramp can't go on the first or last point.");
    remember();
    map.features = map.features.filter((f) => !(isPointFeature(f) && f.at === i));
    map.features.push({ kind: 'jump', at: i, ...RAMP });
    sel = i;
    selDeco = -1;
    setStatus(`Ramp at point ${i + 1}: tune its size and landing on the right.`);
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
        ${p2p && m.traffic !== 'none' ? `<span class="tg-label">How busy</span>${pills('density', MAP_DENSITY.map((d, i): [number, string] => [i, d.name]), m.density)}` : ''}
        <span class="tg-label">Crash damage</span>
        ${pills('survival', [['off', 'Lobby decides'], ['on', 'Always on (survival)']], m.survival ? 'on' : 'off')}
        ${p2p ? '' : '<p class="tg-note">Circuits are clean: no props, traffic or features. Make it point to point for jumps, gaps and hazards.</p>'}
      </div>
      <div class="tg-mb-sec">
        <h3 class="tg-h">Scenery <small>${m.deco.length} / ${MAP.maxDeco}</small></h3>
        <p class="tg-muted">Place pieces one by one with the Scenery tool (<kbd>S</kbd>), or line the road:</p>
        <div class="tg-mb-btns"><button class="tg-pill" data-line="lamp">Street lamps</button><button class="tg-pill" data-line="tree">Trees</button><button class="tg-pill" data-line="board">Sponsor boards</button><button class="tg-pill" data-line="pole">Telegraph poles</button></div>
        ${m.deco.length ? `<div class="tg-mb-btns"><button class="tg-pill danger" data-cleardeco>${clearArmed ? 'Press again to clear it all' : 'Clear all scenery'}</button></div>` : ''}
        ${m.sky ? '<p class="tg-note">A sky road floats in the clouds: no scenery shows on it.</p>' : ''}
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
    left.querySelectorAll<HTMLElement>('[data-density]').forEach((b) => b.addEventListener('click', () => setting(() => (map.density = Number(b.dataset.density)))));
    left.querySelectorAll<HTMLElement>('[data-line]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.line as DecoKind;
        if (k === 'lamp') lineRoad('lamp', 50, 1.2, true);
        else if (k === 'tree') lineRoad('tree', 30, 6, true, 25);
        else if (k === 'board') lineRoad('board', 120, 1.5, false);
        else lineRoad('pole', 45, 2, false);
      }),
    );
    left.querySelector('[data-cleardeco]')?.addEventListener('click', () => {
      if (!clearArmed) {
        clearArmed = true;
        drawLeft();
        setTimeout(() => {
          clearArmed = false;
          if (root.isConnected && leftTab === 'map') drawLeft();
        }, 3000);
        return;
      }
      clearArmed = false;
      selDeco = -1;
      setting(() => (map.deco = []));
    });
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
        <div class="tg-mb-tools">${TOOLS.map((x) => `<button class="tg-mb-tool" data-tool="${x.id}" aria-pressed="${x.id === tool}" ${roadOnly(x.id) && map.loop ? 'disabled' : ''} title="${esc(x.name)} (${x.key})"><i>${toolIcon(x.id)}</i><span>${esc(x.name)}</span><kbd>${x.key}</kbd></button>`).join('')}</div>
        <p class="tg-muted tg-mb-toolhint">${esc(t.hint)}</p>
      </div>
      ${tool === 'deco' ? paletteHtml() : tool === 'feature' ? featPaletteHtml() : ''}
      <div class="tg-mb-sec" data-inspector></div>
      <div class="tg-mb-sec" data-issues></div>`;
    right.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool as Tool)));
    right.querySelectorAll<HTMLElement>('[data-featk]').forEach((b) =>
      b.addEventListener('click', () => {
        featKind = b.dataset.featk as FeatPick;
        rangeFrom = -1;
        right.querySelectorAll<HTMLElement>('[data-featk]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        const f = FEAT_PICKS.find((x) => x.id === featKind)!;
        const note = right.querySelector('[data-feathint]');
        if (note) note.textContent = f.hint;
        setStatus(`${f.name}: ${f.hint} Click the road.`);
      }),
    );
    right.querySelectorAll<HTMLElement>('[data-decok]').forEach((b) =>
      b.addEventListener('click', () => {
        decoKind = b.dataset.decok as DecoKind;
        right.querySelectorAll<HTMLElement>('[data-decok]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        setStatus(`${DECOS[decoKind].name}: click the ${isRoadDeco(decoKind) ? 'road' : 'ground'} to place it.`);
      }),
    );
    drawInspector();
    drawIssues();
    drawStats();
    $('[data-hint]').textContent = t.hint;
  }

  /** The scenery to place, by group (the Scenery tool). Road props are greyed out on a circuit. */
  function paletteHtml(): string {
    const kinds = Object.keys(DECOS) as DecoKind[];
    return `<div class="tg-mb-sec"><h3 class="tg-h">Scenery <small>${map.deco.length} / ${MAP.maxDeco}</small></h3>
      ${DECO_GROUPS.map(
        (gr) => `<span class="tg-label">${esc(gr.name)}</span><div class="tg-mb-decos">${kinds
          .filter((k) => DECOS[k].group === gr.id)
          .map((k) => `<button class="tg-mb-deco" data-decok="${k}" aria-pressed="${k === decoKind}" style="--dc:${GROUP_COLOR[gr.id]}" ${isRoadDeco(k) && map.loop ? 'disabled' : ''}><i></i>${esc(DECOS[k].name)}</button>`)
          .join('')}</div>`,
      ).join('')}
    </div>`;
  }

  /** The ramp and the road's features, for the Features tool. */
  function featPaletteHtml(): string {
    return `<div class="tg-mb-sec"><h3 class="tg-h">Features</h3>
      <div class="tg-mb-feats">${FEAT_PICKS.map((f) => {
        const col = FEAT_COLOR[f.id === 'ramp' ? 'jump' : f.id];
        return `<button class="tg-mb-featb" data-featk="${f.id}" aria-pressed="${f.id === featKind}" style="--fc:${col}" title="${esc(f.hint)}"><i>${featIcon(f.id)}</i>${esc(f.name)}</button>`;
      }).join('')}</div>
      <p class="tg-muted" data-feathint>${esc(FEAT_PICKS.find((f) => f.id === featKind)!.hint)}</p>
    </div>`;
  }

  function setTool(t: Tool) {
    if (t === 'deco' && map.loop && isRoadDeco(decoKind)) decoKind = 'tree';
    tool = t;
    rangeFrom = -1;
    hoverRoad = null;
    hoverAt = null;
    drawRight();
    draw();
  }

  function drawInspector() {
    const el = right.querySelector<HTMLElement>('[data-inspector]');
    if (!el) return;
    // Don't rebuild the fields while one is being typed in (a drag elsewhere updates the numbers).
    if (el.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === 'INPUT') return;
    // Mid-drag, only the numbers change.
    if (drag) {
      if (sel >= 0 && map.points[sel]) el.querySelectorAll<HTMLInputElement>('[data-px]').forEach((inp) => (inp.value = String(map.points[sel][Number(inp.dataset.px)])));
      if (selDeco >= 0 && map.deco[selDeco]) el.querySelectorAll<HTMLInputElement>('[data-dx]').forEach((inp) => (inp.value = String(map.deco[selDeco][Number(inp.dataset.dx) as 1 | 2 | 3])));
      return;
    }
    if (selDeco >= 0 && map.deco[selDeco]) return decoInspector(el, selDeco);
    if (sel < 0 || !map.points[sel]) {
      el.innerHTML = `<h3 class="tg-h">Point</h3><p class="tg-muted">Pick a point on the map or on the profile to set where it is and how high, and to tune the features on it.</p>
        <p class="tg-muted tg-mb-keys"><kbd>Del</kbd> remove · <kbd>←↑→↓</kbd> nudge · <kbd>PgUp</kbd>/<kbd>PgDn</kbd> height · <kbd>Ctrl Z</kbd> undo · <kbd>P</kbd> play · <kbd>?</kbd> all the controls</p>`;
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
      <div class="tg-mb-btns tg-mb-play"><button class="tg-pill" data-playfrom>Play from here</button>${map.loop ? '' : `<button class="tg-pill" data-secfrom>Section from here</button><button class="tg-pill" data-secto>Section to here</button>`}</div>
      ${here.length ? '' : `<p class="tg-muted">No features on this point.${map.loop ? '' : ' Pick Features (3) and click the road.'}</p>`}
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
    el.querySelector('[data-playfrom]')?.addEventListener('click', () => playFrom(sel));
    el.querySelector('[data-secfrom]')?.addEventListener('click', () => setSection(sel, section ? section[1] : map.points.length - 1));
    el.querySelector('[data-secto]')?.addEventListener('click', () => setSection(section ? section[0] : 0, sel));
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

  /** The picked piece of scenery: where it stands, which way it faces, how big it is. */
  function decoInspector(el: HTMLElement, i: number) {
    const d = map.deco[i];
    const spec = DECOS[d[0]];
    const road = isRoadDeco(d[0]);
    const sc = d[4] ?? 1;
    el.innerHTML = `<h3 class="tg-h">${esc(spec.name)} <small>scenery ${i + 1} of ${map.deco.length}</small></h3>
      <div class="tg-mb-xyz">
        <label><span class="tg-label">East</span><input type="number" class="tg-num" data-dx="1" value="${d[1]}" step="1" /></label>
        <label><span class="tg-label">South</span><input type="number" class="tg-num" data-dx="2" value="${d[2]}" step="1" /></label>
        <label><span class="tg-label">Facing</span><input type="number" class="tg-num" data-dx="3" value="${d[3]}" step="15" /></label>
      </div>
      <div class="tg-mb-btns"><button class="tg-pill" data-dturn="-15">⟲ 15°</button><button class="tg-pill" data-dturn="15">⟳ 15°</button><button class="tg-pill" data-dface>Face the road</button></div>
      ${road ? '<p class="tg-muted">Road props keep their size: cars hit them as they are.</p>' : `<label class="tg-mb-slider"><span class="tg-label">Size <b class="tg-num">${Math.round(sc * 100)}%</b></span><input type="range" data-dscale min="${DECO_SCALE.min}" max="${DECO_SCALE.max}" step="0.05" value="${sc}" /></label>`}
      <div class="tg-mb-btns"><button class="tg-pill" data-ddup>Duplicate</button><button class="tg-pill danger" data-ddel>Remove</button></div>
      <p class="tg-muted tg-mb-keys">Drag it to move · drag the knob to turn · <kbd>R</kbd> turn · <kbd>[</kbd> <kbd>]</kbd> size · <kbd>Del</kbd> remove</p>`;
    const edit = (fn: (d: MapDeco) => void, commit = true) => {
      if (commit) remember();
      fn(map.deco[i]);
      changed(commit);
      draw();
    };
    el.querySelectorAll<HTMLInputElement>('[data-dx]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const v = Number(inp.value);
        if (!Number.isFinite(v)) return;
        const k = Number(inp.dataset.dx) as 1 | 2 | 3;
        edit((d) => (d[k] = k === 3 ? Math.round(((v % 360) + 360) % 360) : Math.max(-MAP.reach, Math.min(MAP.reach, Math.round(v * 10) / 10))));
      }),
    );
    el.querySelectorAll<HTMLElement>('[data-dturn]').forEach((b) => b.addEventListener('click', () => turnDeco(Number(b.dataset.dturn))));
    el.querySelector('[data-dface]')?.addEventListener('click', () => edit((d) => (d[3] = faceRoad(d[1], d[2]))));
    const scale = el.querySelector<HTMLInputElement>('[data-dscale]');
    scale?.addEventListener('input', () => {
      map.deco[i][4] = Number(scale.value);
      (scale.previousElementSibling!.querySelector('b') as HTMLElement).textContent = `${Math.round(Number(scale.value) * 100)}%`;
      draw();
    });
    let before = '';
    scale?.addEventListener('pointerdown', () => (before = JSON.stringify(map)));
    scale?.addEventListener('change', () => {
      if (before) {
        past.push(before);
        if (past.length > HISTORY) past.shift();
        future.length = 0;
        before = '';
      }
      changed();
    });
    el.querySelector('[data-ddup]')?.addEventListener('click', () => {
      if (map.deco.length >= MAP.maxDeco) return setStatus(`A map holds ${MAP.maxDeco} pieces at most.`);
      remember();
      const c = [...map.deco[i]] as MapDeco;
      // Beside the original, stepped away from the road so the copy doesn't land on it.
      const a = (c[3] * Math.PI) / 180;
      const off = Math.max(4, decoR(c) * 2 + 1);
      c[1] = Math.round((c[1] + Math.cos(a) * off) * 10) / 10;
      c[2] = Math.round((c[2] - Math.sin(a) * off) * 10) / 10;
      map.deco.push(c);
      selDeco = map.deco.length - 1;
      changed();
      drawRight();
    });
    el.querySelector('[data-ddel]')?.addEventListener('click', () => removeDeco(i));
  }
  function turnDeco(by: number) {
    if (selDeco < 0 || !map.deco[selDeco]) return;
    remember();
    const d = map.deco[selDeco];
    d[3] = Math.round((((d[3] + by) % 360) + 360) % 360);
    changed();
    drawInspector();
    draw();
  }
  function scaleDeco(by: number) {
    const d = selDeco >= 0 ? map.deco[selDeco] : null;
    if (!d || isRoadDeco(d[0])) return;
    remember();
    const v = Math.round(Math.max(DECO_SCALE.min, Math.min(DECO_SCALE.max, (d[4] ?? 1) + by)) * 20) / 20;
    if (v === 1) d.length = 4;
    else d[4] = v;
    changed();
    drawInspector();
    draw();
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

  /** Drives a map (the whole one, or a part of it) and comes back here: the draft keeps the whole map. */
  function play(m: CustomMap, what: string) {
    const c = checkMap(m);
    if (!c.ok || !c.track) return setStatus(`${what} can't be driven yet: ${c.errors[0]?.msg ?? 'fix the road first.'}`);
    saveCam();
    saveDraft({ id: savedId, map, dirty });
    ctx.drive({ track: registerMap(m), rivals, test: true });
  }
  function testDrive() {
    if (!check.ok) return setStatus('Fix the issues on the right first.');
    play(map, 'The map');
  }
  function playFrom(i: number) {
    if (i <= 0) return testDrive();
    if (!map.loop && i >= map.points.length - 1) return setStatus('That’s the finish: play from a point before it.');
    const m = sectionMap(map, i, null);
    if (m) play(m, `From point ${i + 1}, the road`);
  }
  function setSection(a: number, b: number) {
    if (map.loop) return;
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(map.points.length - 1, Math.max(a, b));
    if (hi - lo < 1) return setStatus('A section needs two different points.');
    section = [lo, hi];
    drawSection();
    draw();
  }
  function playSection() {
    if (!section) return;
    const m = sectionMap(map, section[0], section[1]);
    if (m) play(m, 'The section');
  }
  function drawSection() {
    const el = $('[data-section]');
    if (section && (map.loop || section[1] >= map.points.length)) section = null;
    el.hidden = !section;
    if (!section) return;
    // Checked as it would be driven, so a part too short to race says so here and not only when you press Play.
    const part = sectionMap(map, section[0], section[1]);
    const c = part && checkMap(part);
    const why = !c ? 'too short' : c.ok ? '' : c.errors[0].msg;
    el.innerHTML = `<span>Section · points ${section[0] + 1}-${section[1] + 1}${c?.ok ? ` · ${c.km.toFixed(2)} km` : ''}</span><button class="tg-pill primary" data-secplay ${why ? `disabled title="${esc(why)}"` : ''}>Play section</button><button class="tg-pill" data-secclear aria-label="Clear the section">✕</button>${why ? `<small class="tg-mb-why">${esc(why)}</small>` : ''}`;
    el.querySelector('[data-secplay]')!.addEventListener('click', playSection);
    el.querySelector('[data-secclear]')!.addEventListener('click', () => {
      section = null;
      drawSection();
      draw();
    });
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
  $('[data-top]').addEventListener('click', () => (is3d() ? world.topDown() : setMode('3d')));
  const help = $('[data-help]');
  function showHelp(on: boolean) {
    help.hidden = !on;
    if (!on)
      try {
        localStorage.setItem(HELP_KEY, '1');
      } catch {
        /* private window */
      }
  }
  $('[data-helpbtn]').addEventListener('click', () => showHelp(help.hidden));
  help.addEventListener('click', (e) => (e.target as HTMLElement).closest('[data-helpclose]') && showHelp(false));
  help.addEventListener('pointerdown', (e) => e.stopPropagation());
  root.querySelectorAll<HTMLElement>('[data-mode-to]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.modeTo as '3d' | 'plan')));
  $('[data-snap]').addEventListener('click', (e) => {
    snap = !snap;
    (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(snap));
  });

  // ---- keys -----------------------------------------------------------------------------------------------
  function typing(target: EventTarget | null) {
    const t = target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  }
  // Capture phase on the document, ahead of the page's own Esc = Back (src/client/main.ts): Esc first lets go of a
  // range tool's first click or the picked point, and only then leaves the builder.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !help.hidden) {
      e.stopPropagation();
      return showHelp(false);
    }
    if (e.key === 'Escape' && (rangeFrom >= 0 || sel >= 0 || selDeco >= 0 || tool !== 'select')) {
      e.stopPropagation();
      if (rangeFrom >= 0) rangeFrom = -1;
      else if (selDeco >= 0) selDeco = -1;
      else if (sel >= 0) sel = -1;
      else tool = 'select';
      drawRight();
      draw();
      return;
    }
    // While the right button flies the camera, WASDQE belong to it.
    if (typing(e.target)) return;
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
    const t = TOOLS.find((x) => x.key === e.key);
    if (t && !(roadOnly(t.id) && map.loop)) return setTool(t.id);
    const key = e.key.toLowerCase();
    // W A S D Q E move the camera (mapworld.ts).
    if ('wasdqe'.includes(key) && key.length === 1) return;
    if (e.key === '?') return showHelp(help.hidden);
    if (key === 'f') return frame();
    if (key === 't' && is3d()) return world.topDown();
    if (key === 'm') return setMode(is3d() ? 'plan' : '3d');
    if (key === 'p') return sel >= 0 ? playFrom(sel) : testDrive();
    if (selDeco >= 0 && map.deco[selDeco]) {
      if (key === 'r') turnDeco(e.shiftKey ? -15 : 15);
      else if (e.key === '[' || e.key === ']') scaleDeco(e.key === ']' ? 0.1 : -0.1);
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeDeco(selDeco);
      }
      return;
    }
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
  ro.observe($('[data-mode]'));
  ro.observe(prof);
  layout();
  drawLeft();
  drawRight();
  drawState();
  setMode(mode);
  if (!loadCam()) {
    frame();
    world.snap();
  } else {
    // The plan view is framed on the map either way.
    const keep = { x: world.pos.x, y: world.pos.y, z: world.pos.z, yaw: world.yaw, pitch: world.pitch };
    frame();
    world.pos.set(keep.x, keep.y, keep.z);
    world.yaw = keep.yaw;
    world.pitch = keep.pitch;
    world.snap();
  }
  scheduleWorld(30);
  try {
    if (!localStorage.getItem(HELP_KEY)) showHelp(true);
  } catch {
    /* private window */
  }
  void loadLibrary();
  const offAccount = account.onChange(() => void loadLibrary());

  return () => {
    document.removeEventListener('keydown', onKey, true);
    ro.disconnect();
    offAccount();
    if (rebuildTimer) clearTimeout(rebuildTimer);
    if (statusTimer) clearTimeout(statusTimer);
    if (worldTimer) clearTimeout(worldTimer);
    world.dispose();
  };
};

/** Small line icons for the tools and the features (inline SVG, currentColor). */
const svg = (d: string) => `<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
function toolIcon(t: Tool): string {
  const p: Record<Tool, string> = {
    select: '<path d="M5 3l12 8-5 1.5L9.5 18z"/>',
    add: '<path d="M3 18c4-1 5-6 8-8s6-2 8-6"/><circle cx="19" cy="4" r="1.6"/><path d="M5 9v6M2 12h6"/>',
    feature: '<path d="M2 17h7l9-7"/><path d="M15 6l4 3"/>',
    deco: '<path d="M11 3l5 8h-3l4 6H5l4-6H6z"/><path d="M11 17v3"/>',
    erase: '<path d="M5 15l7-9 6 5-6 7H8z"/><path d="M4 19h14"/>',
  };
  return svg(p[t]);
}
function featIcon(k: FeatPick): string {
  const p: Record<FeatPick, string> = {
    ramp: '<path d="M2 17h7l9-7"/><path d="M15 6l4 3"/>',
    crest: '<path d="M2 16c4 0 5-8 9-8s5 8 9 8"/>',
    jump: '<path d="M2 14h7l4-4v8M13 18h7"/>',
    gap: '<path d="M2 12h6M14 12h6M8 12v6M14 12v6"/>',
    bumps: '<path d="M2 13q2-4 4 0t4 0 4 0 4 0 4 0"/>',
    gravel: '<circle cx="6" cy="13" r="1.5"/><circle cx="11" cy="9" r="1.5"/><circle cx="15" cy="14" r="1.5"/><circle cx="18" cy="9" r="1.2"/>',
    canyon: '<path d="M2 18V6l4 3v9M20 18V6l-4 3v9M9 18h4"/>',
    bridge: '<path d="M2 9h18M5 9v8M17 9v8M5 9q6 6 12 0"/>',
    tunnel: '<path d="M3 18V11a8 8 0 0116 0v7"/><path d="M7 18v-6a4 4 0 018 0v6"/>',
  };
  return svg(p[k]);
}

/** The controls card (the ? button; shown once on the first visit). */
function helpHtml(): string {
  const row = (k: string, v: string) => `<li><span>${k}</span><b>${v}</b></li>`;
  return `<div class="tg-mb-helpcard" role="dialog" aria-label="Map builder controls">
    <h3 class="tg-h">Controls</h3>
    <div class="tg-mb-helpcols">
      <ul><li class="tg-label">Camera</li>
        ${row('Drag empty ground', 'Pan')}
        ${row('Right-drag (or Alt + drag)', 'Orbit round that spot')}
        ${row('Scroll', 'Zoom toward the cursor')}
        ${row('<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> · <kbd>Q</kbd><kbd>E</kbd>', 'Move · turn (Shift: faster)')}
        ${row('<kbd>T</kbd> · <kbd>F</kbd> · <kbd>M</kbd>', 'Look down · fit the road · 3D / plan')}
      </ul>
      <ul><li class="tg-label">Building</li>
        ${row('<kbd>1</kbd>–<kbd>5</kbd>', 'Move, Road, Features, Scenery, Erase')}
        ${row('Drag a point', 'Move it over the ground')}
        ${row('Its yellow arrow, or <kbd>PgUp</kbd> <kbd>PgDn</kbd>', 'Raise or lower it')}
        ${row('Double-click the road', 'Put a point in it')}
        ${row('<kbd>Ctrl</kbd> <kbd>Z</kbd> · <kbd>Ctrl</kbd> <kbd>S</kbd>', 'Undo · save')}
        ${row('<kbd>P</kbd>', 'Play from the picked point (or the start)')}
      </ul>
    </div>
    <button class="tg-go small" data-helpclose>Got it</button>
  </div>`;
}
