// Custom maps: tracks players build in the map builder (kanjo/client/mapbuilder.ts), drive solo and race online.
//
// A map is plain data (`CustomMap`): control points the road threads through (x, height, z in metres), what kind of
// road it is, and features pinned to its points. `mapDef` turns one into an ordinary TrackDef, so the physics, the AI,
// the renderer and the room build and drive it exactly like a built-in track. `checkMap` is the one judge of whether a
// map can be raced (the builder runs it live; the race room runs it on every map a host sends), and `registerMap`
// puts a map's track in TRACK_DEFS under an id made from its content (`custom:<hash>`), so every screen that looks a
// track up by id finds it. Built-in lists (RACE_TRACKS, the cups, the boards) are worked out when track.ts loads, so a
// custom map never joins them: it pays nothing, keeps no best times and has no record ghost.

import { TRACK_LENGTH_KM } from './garage.ts';
import { type Feature, type Theme, type Track, type TrackDef, type TrackId, SAMPLE, TRACK_DEFS, buildTrack, forgetTrack, getTrack } from './track.ts';

export const THEMES: { id: Theme; name: string }[] = [
  { id: 'alpine', name: 'Alpine' },
  { id: 'coast', name: 'Coast' },
  { id: 'desert', name: 'Desert' },
  { id: 'night', name: 'Night' },
  { id: 'autumn', name: 'Autumn' },
  { id: 'spring', name: 'Spring' },
  { id: 'city', name: 'City at night' },
];

/** What lines the road between the barriers (point-to-point roads only: circuits are always clean). */
export type MapProps = 'clean' | 'some' | 'course' | 'rockfall';
export const MAP_PROPS: Record<MapProps, { name: string; blurb: string }> = {
  clean: { name: 'Clean road', blurb: 'Nothing on the road but the racers.' },
  some: { name: 'A few props', blurb: 'Bales, barrels and cones here and there.' },
  course: { name: 'Obstacle course', blurb: 'Something on the road every 110-200 m: slaloms, gates, cone chicanes.' },
  rockfall: { name: 'Rockfall', blurb: 'Boulders and stones bitten into the road edges.' },
};

export type MapTraffic = 'none' | 'town' | 'highway';
export const MAP_TRAFFIC: Record<MapTraffic, { name: string; blurb: string; width: number }> = {
  none: { name: 'No traffic', blurb: 'An empty road.', width: 0 },
  town: { name: 'Town', blurb: 'Two lanes each way, cars coming at you.', width: 14 },
  highway: { name: 'Highway', blurb: 'Four lanes all going your way.', width: 16 },
};

/** How tall the hills round the road grow (TrackDef.relief). */
export const MAP_TERRAIN = [
  { name: 'Flat', relief: 30 },
  { name: 'Hills', relief: 140 },
  { name: 'Mountains', relief: 300 },
] as const;

/** A feature in a map: one of the track features, pinned to control points (indexes into `points`). */
export type MapFeature =
  | { kind: 'crest'; at: number; size: number; len: number }
  | { kind: 'jump'; at: number; size: number; kick: number; drop: number; land: number }
  | { kind: 'gap'; at: number; size: number; kick: number; drop: number; land: number; len: number }
  | { kind: 'bumps' | 'gravel' | 'canyon' | 'bridge' | 'tunnel'; from: number; to: number; size: number };
export type FeatureKind = MapFeature['kind'];
/** Features that sit at one point (the rest run from one point to a later one). */
export const POINT_FEATURES: FeatureKind[] = ['crest', 'jump', 'gap'];
export const isPointFeature = (f: MapFeature): f is Extract<MapFeature, { at: number }> => 'at' in f;

/**
 * Each feature's numbers, their safe range and the builder's preset. Ranges keep every map drivable: a crest you can
 * fly but not loop, a gap the slowest car clears with a run-up (GAP.runup), drops the suspension survives.
 */
export const FEATURES: Record<FeatureKind, { name: string; blurb: string; keys: Record<string, { min: number; max: number; def: number; label: string; unit: string }> }> = {
  crest: { name: 'Crest', blurb: 'The road rises and falls away: fast cars fly.', keys: { size: { min: 0.5, max: 4, def: 2.2, label: 'Height', unit: 'm' }, len: { min: 24, max: 80, def: 46, label: 'Length', unit: 'm' } } },
  jump: {
    name: 'Drop jump',
    blurb: 'A kicker, then the road drops onto the street below.',
    keys: { size: { min: 0, max: 4, def: 1.6, label: 'Kicker', unit: 'm' }, kick: { min: 15, max: 40, def: 24, label: 'Run-up', unit: 'm' }, drop: { min: 0, max: 20, def: 9, label: 'Drop', unit: 'm' }, land: { min: 60, max: 180, def: 110, label: 'Landing', unit: 'm' } },
  },
  gap: {
    name: 'Gap',
    blurb: 'The road stops over a ravine. Too slow and you fall in.',
    keys: { size: { min: 0.5, max: 4, def: 1.5, label: 'Kicker', unit: 'm' }, kick: { min: 15, max: 40, def: 24, label: 'Run-up', unit: 'm' }, drop: { min: 4, max: 20, def: 12, label: 'Drop', unit: 'm' }, land: { min: 120, max: 180, def: 175, label: 'Landing', unit: 'm' }, len: { min: 12, max: 40, def: 26, label: 'Gap', unit: 'm' } },
  },
  bumps: { name: 'Bumps', blurb: 'Broken, heaved tarmac that throws the car about.', keys: { size: { min: 0.1, max: 0.4, def: 0.28, label: 'Height', unit: 'm' } } },
  gravel: { name: 'Gravel', blurb: 'A loose stage: less grip, more slide.', keys: {} },
  canyon: { name: 'Canyon', blurb: 'Rock walls rise either side of the road.', keys: { size: { min: 10, max: 40, def: 28, label: 'Walls', unit: 'm' } } },
  bridge: { name: 'Bridge', blurb: 'The ground falls away under a bridge.', keys: { size: { min: 20, max: 60, def: 45, label: 'Drop below', unit: 'm' } } },
  tunnel: { name: 'Tunnel', blurb: 'A gallery through a raised hillside.', keys: { size: { min: 12, max: 24, def: 16, label: 'Hill', unit: 'm' } } },
};

export interface CustomMap {
  v: 1;
  name: string;
  /** A line about it, shown on its card and the loading screen. */
  blurb: string;
  theme: Theme;
  /** A closed circuit raced `laps` laps, or a point-to-point road from the first point to the last. */
  loop: boolean;
  laps: number;
  width: number;
  /** MAP_TERRAIN index. */
  terrain: number;
  /** A lake or sea this far under the road's lowest point (m), or none. */
  sea: number | null;
  /** Control points [x, height, z] in metres, start to finish (once round a circuit). */
  points: [number, number, number][];
  /** Point-to-point only. */
  features: MapFeature[];
  props: MapProps;
  traffic: MapTraffic;
  /** Crash damage always on (a survival road: knocks and landings soaked as on Jigoku Drop). */
  survival: boolean;
  /** Circuits only: a floating sky road, no walls, fall off and respawn. */
  sky: boolean;
}

export const MAP = {
  nameMin: 1,
  nameMax: 28,
  blurbMax: 140,
  minPoints: 2,
  minLoopPoints: 4,
  maxPoints: 160,
  /** Control points stay this close to the origin (m). */
  reach: 5000,
  heightMin: -100,
  heightMax: 2000,
  /** Neighbouring control points at least this far apart (m). */
  minStep: 4,
  maxStep: 1500,
  width: { min: 9, max: 22 },
  laps: { min: 1, max: 10 },
  /** The race distance must be at least this (m) and the road at most `maxRoad` m long (laps included). */
  minRace: 400,
  maxRoad: 16000,
  /** The steepest grade allowed outside crests, jumps and bumps (and the gentler one the builder warns about). */
  maxGrade: 0.16,
  warnGrade: 0.12,
  /** Bends tighter than this radius (m) get a warning: cars barely turn that tight. */
  tightRadius: 14,
  /** How many maps an account (or this browser, for a guest) keeps. */
  maxSaved: 30,
  /** A map's JSON at most this long (it goes in a socket message). */
  maxBytes: 6000,
};

/** Rounded the way maps are stored, so the same road always gives the same id. */
const r1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** A map's name or blurb: control characters and angle brackets out, spaces squeezed, trimmed to `max`. */
export function cleanText(x: unknown, max: number): string {
  if (typeof x !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return x.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Anything (a saved map, a socket message, a pasted code) as a well-formed CustomMap, or null when it isn't one.
 * Numbers are clamped into range and rounded; features that point nowhere, overlap or don't belong on this kind of
 * road are dropped. Whether the road itself can be raced is `checkMap`'s question.
 */
export function cleanMap(x: unknown): CustomMap | null {
  if (!x || typeof x !== 'object') return null;
  const m = x as Record<string, unknown>;
  const name = cleanText(m.name, MAP.nameMax);
  if (name.length < MAP.nameMin) return null;
  if (!Array.isArray(m.points) || m.points.length < MAP.minPoints || m.points.length > MAP.maxPoints) return null;
  const points: [number, number, number][] = [];
  for (const p of m.points) {
    if (!Array.isArray(p) || p.length !== 3 || !p.every(num)) return null;
    points.push([r1(clamp(p[0], -MAP.reach, MAP.reach)), r1(clamp(p[1], MAP.heightMin, MAP.heightMax)), r1(clamp(p[2], -MAP.reach, MAP.reach))]);
  }
  const loop = m.loop === true;
  if (loop && points.length < MAP.minLoopPoints) return null;
  const theme = THEMES.some((t) => t.id === m.theme) ? (m.theme as Theme) : 'alpine';
  const features: MapFeature[] = [];
  if (!loop && Array.isArray(m.features)) {
    const last = points.length - 1;
    const pinned = new Set<number>();
    for (const f of m.features as Record<string, unknown>[]) {
      if (!f || typeof f !== 'object' || !Object.hasOwn(FEATURES, f.kind as string) || features.length >= 60) continue;
      const kind = f.kind as FeatureKind;
      const nums: Record<string, number> = {};
      for (const [k, r] of Object.entries(FEATURES[kind].keys)) nums[k] = r1(clamp(num(f[k]) ? (f[k] as number) : r.def, r.min, r.max));
      if (POINT_FEATURES.includes(kind)) {
        const at = f.at;
        // A jump at either end would have its kicker or landing off the road; one feature per point.
        if (!Number.isInteger(at) || (at as number) < 1 || (at as number) >= last || pinned.has(at as number)) continue;
        pinned.add(at as number);
        features.push({ kind, at, ...nums } as MapFeature);
      } else {
        const from = f.from;
        const to = f.to;
        if (!Number.isInteger(from) || !Number.isInteger(to) || (from as number) < 0 || (to as number) > last || (from as number) >= (to as number)) continue;
        features.push({ kind, from, to, size: nums.size ?? 0 } as MapFeature);
      }
    }
  }
  const props = Object.hasOwn(MAP_PROPS, m.props as string) ? (m.props as MapProps) : 'clean';
  const traffic = !loop && Object.hasOwn(MAP_TRAFFIC, m.traffic as string) ? (m.traffic as MapTraffic) : 'none';
  return {
    v: 1,
    name,
    blurb: cleanText(m.blurb, MAP.blurbMax),
    theme,
    loop,
    laps: Math.round(clamp(num(m.laps) ? m.laps : 3, MAP.laps.min, MAP.laps.max)),
    width: r1(clamp(num(m.width) ? m.width : 13, MAP.width.min, MAP.width.max)),
    terrain: Math.round(clamp(num(m.terrain) ? m.terrain : 1, 0, MAP_TERRAIN.length - 1)),
    sea: num(m.sea) ? r1(clamp(m.sea, 2, 200)) : null,
    points,
    features,
    props: loop ? 'clean' : props,
    traffic,
    survival: m.survival === true,
    sky: loop && m.sky === true,
  };
}

/** A short, stable hash of a string (FNV-1a, base 36). */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const CUSTOM = 'custom:';
/** The track id a map races under: made from everything that shapes the road, so an edited map is a new track. */
export const mapTrackId = (m: CustomMap): TrackId => `${CUSTOM}${hashText(JSON.stringify(m))}` as TrackId;
/** True for a custom map's track id. */
export const isCustomTrack = (id: string) => id.startsWith(CUSTOM);

/** A map as a TrackDef (under `id`, mapTrackId's by default). */
export function mapDef(m: CustomMap, id: TrackId = mapTrackId(m)): TrackDef {
  const seed = parseInt(hashText(m.name + m.points.length), 36) % 100000;
  const low = Math.min(...m.points.map((p) => p[1]));
  const features: Feature[] = m.loop
    ? []
    : m.features.map((f): Feature => {
        if (f.kind === 'gravel') return { kind: 'gravel', from: f.from, to: f.to };
        return { ...f } as Feature;
      });
  const traffic = m.traffic === 'town' ? true : m.traffic === 'highway' ? ('highway' as const) : undefined;
  return {
    id,
    name: m.name,
    tag: `Custom map · ${m.loop ? `circuit · ${m.laps} lap${m.laps === 1 ? '' : 's'}` : 'point to point'}`,
    blurb: m.blurb || 'A map built in the map builder.',
    theme: m.theme,
    seed,
    points: m.points.map((p) => [p[0], p[1], p[2]]),
    width: m.width,
    relief: MAP_TERRAIN[m.terrain].relief,
    ...(m.sea !== null ? { water: low - m.sea } : {}),
    ...(m.loop ? { laps: m.laps } : {}),
    ...(m.sky ? { sky: true as const } : {}),
    ...(traffic ? { traffic } : {}),
    ...(m.survival ? { survival: { hit: 0.5, land: 0.15 } } : {}),
    ...(!m.loop && m.props === 'clean' ? { clean: true } : {}),
    ...(!m.loop && m.props === 'course' ? { obstacles: true as const } : {}),
    ...(!m.loop && m.props === 'rockfall' ? { rockfall: true as const } : {}),
    ...(features.length ? { features } : {}),
  };
}

/** Something wrong with a map, and where (a control point, or a distance along the road), so the builder can show it. */
export interface MapIssue {
  msg: string;
  /** The control point it's about. */
  point?: number;
  /** The place on the road it's about [x, z]. */
  at?: [number, number];
}

export interface MapCheck {
  /** The map can be raced. */
  ok: boolean;
  errors: MapIssue[];
  warnings: MapIssue[];
  /** The built road (when it built). */
  track: Track | null;
  /** Race distance (m), climb and drop over the run (m), steepest grade. */
  km: number;
  climb: number;
  drop: number;
  grade: number;
}

/**
 * Can this map be raced? Checks the shape of the data, builds the road and walks it: long enough and not too long,
 * no two stretches of road close enough to overlap (the road never crosses itself), grades sane outside jumps and
 * bumps. Warnings (tight bends, steep but legal grades) don't stop a race.
 */
export function checkMap(m: CustomMap): MapCheck {
  const errors: MapIssue[] = [];
  const warnings: MapIssue[] = [];
  const out: MapCheck = { ok: false, errors, warnings, track: null, km: 0, climb: 0, drop: 0, grade: 0 };
  const pts = m.points;
  const need = m.loop ? MAP.minLoopPoints : MAP.minPoints;
  if (pts.length < need) {
    errors.push({ msg: m.loop ? `A circuit needs at least ${need} points.` : 'Place at least two points: a start and a finish.' });
    return out;
  }
  if (JSON.stringify(m).length > MAP.maxBytes) errors.push({ msg: 'This map has too much in it. Take out some points or features.' });
  const steps = m.loop ? pts.length : pts.length - 1;
  for (let i = 0; i < steps && errors.length < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (d < MAP.minStep) errors.push({ msg: `Points ${i + 1} and ${((i + 1) % pts.length) + 1} are only ${d.toFixed(0)} m apart.`, point: i });
    else if (d > MAP.maxStep) errors.push({ msg: `Points ${i + 1} and ${((i + 1) % pts.length) + 1} are over ${MAP.maxStep / 1000} km apart: add points between them.`, point: i });
    else if (Math.abs(b[1] - a[1]) / d > MAP.maxGrade * 1.15) errors.push({ msg: `Point ${i + 1} to ${((i + 1) % pts.length) + 1} climbs ${((Math.abs(b[1] - a[1]) / d) * 100).toFixed(0)}%: keep it under ${MAP.maxGrade * 100}%.`, point: i });
  }
  if (m.traffic !== 'none' && m.width < MAP_TRAFFIC[m.traffic].width) errors.push({ msg: `${MAP_TRAFFIC[m.traffic].name} traffic needs a road at least ${MAP_TRAFFIC[m.traffic].width} m wide.` });
  if (errors.length) return out;
  let t: Track;
  try {
    t = buildTrack(mapDef(m));
  } catch {
    errors.push({ msg: "This road can't be built. Try spacing the points out." });
    return out;
  }
  out.track = t;
  const race = t.finishS - t.startS;
  out.km = race / 1000;
  const lapLen = t.lap ? t.lap * SAMPLE : race;
  if (race < MAP.minRace) errors.push({ msg: `The race is only ${race.toFixed(0)} m. Make it at least ${MAP.minRace} m.` });
  if (t.length > MAP.maxRoad) errors.push({ msg: `The road is ${(t.length / 1000).toFixed(1)} km with its laps. Keep it under ${MAP.maxRoad / 1000} km.` });
  if (t.lap && lapLen < 300) errors.push({ msg: 'A lap needs to be at least 300 m.' });
  // Legs too close: the same check every built-in track passes (racephysics), one lap of a circuit.
  const n = t.lap || t.n;
  const wide = (k: number) => t.edge + Math.max(t.runL[k], t.runR[k]);
  let clash = 0;
  for (let i = 0; i < n && clash < 3; i += 3)
    for (let j = i + 100; j < n; j += 3) {
      if (t.lap && j - i > t.lap - 100) continue;
      const d = Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]);
      if (d < wide(i) + wide(j) + 40) {
        errors.push({ msg: d < t.half * 2 ? 'The road crosses itself here.' : `Two stretches of road are only ${d.toFixed(0)} m apart here: they'd overlap.`, at: [(t.x[i] + t.x[j]) / 2, (t.z[i] + t.z[j]) / 2] });
        clash++;
        // Skip ahead so one long brush is one issue.
        i += 60;
        break;
      }
    }
  // Grades, outside crests, jumps and bumps (as the track test does).
  const onCrest = (s: number) => t.crests.some((c) => Math.abs(s - c.s) < c.len / 2 + 2 * SAMPLE) || t.bumps.some((b) => s > b.s0 - 5 * SAMPLE && s < b.s1);
  let worst = 0;
  let worstAt = 0;
  const end = Math.min(t.n, t.lap ? t.lap + Math.round(t.startS / SAMPLE) : t.n);
  for (let i = Math.round(t.startS / SAMPLE); i + 5 < end; i++) {
    if (onCrest(i * SAMPLE)) continue;
    const g = Math.abs(t.y[i + 5] - t.y[i]) / (5 * SAMPLE);
    if (g > worst) {
      worst = g;
      worstAt = i;
    }
  }
  out.grade = worst;
  if (worst > MAP.maxGrade) errors.push({ msg: `The road is ${(worst * 100).toFixed(0)}% steep here: keep it under ${MAP.maxGrade * 100}%.`, at: [t.x[worstAt], t.z[worstAt]] });
  else if (worst > MAP.warnGrade) warnings.push({ msg: `Steep: ${(worst * 100).toFixed(0)}% here. Slow cars will crawl up it.`, at: [t.x[worstAt], t.z[worstAt]] });
  // Climb and drop over the race (one lap of a circuit).
  const i0 = Math.round(t.startS / SAMPLE);
  const i1 = t.lap ? i0 + t.lap : Math.round(t.finishS / SAMPLE);
  for (let i = i0; i < i1 && i + 1 < t.n; i++) {
    const dy = t.y[i + 1] - t.y[i];
    if (dy > 0) out.climb += dy;
    else out.drop -= dy;
  }
  // Tight bends.
  let tight = 0;
  for (let i = i0; i < i1 && tight < 3; i++)
    if (Math.abs(t.curv[i]) > 1 / MAP.tightRadius) {
      warnings.push({ msg: `A very tight bend (under ${MAP.tightRadius} m): most cars can't take it without a drift.`, at: [t.x[i], t.z[i]] });
      tight++;
      i += 40;
    }
  if (m.features.some((f) => f.kind === 'gap') && !m.survival) warnings.push({ msg: 'Gaps are harsher with crash damage on: think about turning on Survival.' });
  out.ok = errors.length === 0;
  return out;
}

/**
 * Puts a map's track in TRACK_DEFS (and its distance in TRACK_LENGTH_KM) under its id, so it can be built with
 * getTrack and looked up by every screen, and returns the id. The same map twice is the same id. Keeps the last
 * `KEEP` maps' built roads: older ones are dropped from the build cache.
 */
const KEEP = 4;
const registered: TrackId[] = [];
export function registerMap(m: CustomMap): TrackId {
  const id = mapTrackId(m);
  const defs = TRACK_DEFS as Record<string, TrackDef>;
  if (!defs[id]) {
    const def = mapDef(m, id);
    defs[id] = def;
    // The distance: the race (laps included). The build stays in getTrack's cache for the race.
    const t = getTrack(id);
    (TRACK_LENGTH_KM as Record<string, number>)[id] = Math.round((t.finishS - t.startS) / 100) / 10;
  }
  const at = registered.indexOf(id);
  if (at >= 0) registered.splice(at, 1);
  registered.push(id);
  while (registered.length > KEEP) forgetTrack(registered.shift()!);
  return id;
}

/** A map as a code to share (base64 of its JSON), and back. */
export function mapCode(m: CustomMap): string {
  const json = JSON.stringify(m);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `KJM1.${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
export function decodeMapCode(code: string): CustomMap | null {
  const s = code.trim();
  if (!s.startsWith('KJM1.')) return null;
  try {
    const b64 = s.slice(5).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return cleanMap(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/** A saved map: the map and its own id (stable across edits) and when it was last saved. */
export interface SavedMap {
  id: string;
  at: number;
  map: CustomMap;
}

/** A saved map from storage or a request, or null. */
export function cleanSaved(x: unknown): SavedMap | null {
  if (!x || typeof x !== 'object') return null;
  const s = x as Record<string, unknown>;
  const id = typeof s.id === 'string' && /^[a-z0-9]{4,16}$/.test(s.id) ? s.id : null;
  const map = cleanMap(s.map);
  return id && map ? { id, at: num(s.at) ? s.at : 0, map } : null;
}

/** What /api/maps takes: save one (new or over the same id) or delete one. */
export type MapAction = { a: 'save'; map: SavedMap } | { a: 'delete'; id: string };

/**
 * Applies a MapAction to a list of saved maps (newest first): the same rules for an account on the server and a
 * guest's browser. Returns the new list, or an error.
 */
export function applyMapAction(list: SavedMap[], act: MapAction, now: number): { ok: true; list: SavedMap[] } | { ok: false; error: string } {
  if (!act || typeof act !== 'object') return { ok: false, error: 'Bad request.' };
  if (act.a === 'delete') {
    if (typeof act.id !== 'string') return { ok: false, error: 'Bad request.' };
    return { ok: true, list: list.filter((s) => s.id !== act.id) };
  }
  if (act.a === 'save') {
    const s = cleanSaved(act.map);
    if (!s) return { ok: false, error: "That map isn't valid." };
    if (JSON.stringify(s.map).length > MAP.maxBytes) return { ok: false, error: 'That map is too big.' };
    const rest = list.filter((x) => x.id !== s.id);
    if (rest.length >= MAP.maxSaved) return { ok: false, error: `You can keep ${MAP.maxSaved} maps. Delete one first.` };
    return { ok: true, list: [{ ...s, at: now }, ...rest] };
  }
  return { ok: false, error: 'Bad request.' };
}

/** A fresh id for a new saved map. */
export const newMapId = (rand: () => number = Math.random) => Array.from({ length: 10 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36)]).join('');

/** A blank map: a gentle S down a hill, so the builder opens on something you can drive straight away. */
export function blankMap(): CustomMap {
  return {
    v: 1,
    name: 'My map',
    blurb: '',
    theme: 'alpine',
    loop: false,
    laps: 3,
    width: 13,
    terrain: 1,
    sea: null,
    points: [
      [0, 120, 0],
      [0, 112, -220],
      [90, 100, -420],
      [240, 88, -560],
      [260, 76, -780],
      [150, 62, -960],
      [140, 50, -1180],
    ],
    features: [],
    props: 'clean',
    traffic: 'none',
    survival: false,
    sky: false,
  };
}

/** Starting points for a new map. */
export const MAP_TEMPLATES: { id: string; name: string; blurb: string; make(): CustomMap }[] = [
  { id: 'blank', name: 'Mountain road', blurb: 'A gentle S down a hill, point to point.', make: blankMap },
  {
    id: 'oval',
    name: 'Ring circuit',
    blurb: 'A rounded loop raced for laps.',
    make: () => ({
      ...blankMap(),
      name: 'My circuit',
      loop: true,
      laps: 3,
      points: Array.from({ length: 10 }, (_, i): [number, number, number] => {
        const a = (i / 10) * Math.PI * 2;
        return [r1(Math.sin(a) * 320), r1(40 + Math.sin(a * 2) * 4), r1(-Math.cos(a) * 200)];
      }),
    }),
  },
  {
    id: 'downhill',
    name: 'Jump downhill',
    blurb: 'A steep run with a crest, a drop and a gap. Crash damage on.',
    make: () => ({
      ...blankMap(),
      name: 'My downhill',
      theme: 'desert',
      terrain: 2,
      survival: true,
      props: 'course',
      points: [
        [0, 400, 0],
        [0, 380, -240],
        [120, 356, -460],
        [300, 330, -600],
        [330, 300, -860],
        [210, 272, -1060],
        [200, 244, -1320],
        [320, 214, -1540],
        [520, 186, -1660],
      ],
      features: [
        { kind: 'crest', at: 2, size: 2.2, len: 46 },
        { kind: 'jump', at: 4, size: 1.6, kick: 24, drop: 8, land: 110 },
        { kind: 'gap', at: 6, size: 1.5, kick: 24, drop: 12, land: 175, len: 24 },
      ],
    }),
  },
];

/**
 * A built-in track as a map to remix, when it's something the builder can hold (no forks, shortcuts, rivers or
 * figure-8 bridges, few enough points); null otherwise.
 */
export function mapFromTrack(id: TrackId): CustomMap | null {
  const d = TRACK_DEFS[id];
  if (!d || d.world || d.fork || d.rivers || d.overpass || d.royale || d.points.length > MAP.maxPoints) return null;
  if (d.features?.some((f) => f.kind === 'cut')) return null;
  const features: MapFeature[] = [];
  for (const f of d.features ?? []) {
    if (f.kind === 'cut') continue;
    if (f.kind === 'gravel' || f.kind === 'canyon' || f.kind === 'bridge' || f.kind === 'tunnel') features.push({ kind: f.kind, from: f.from, to: f.to, size: f.size ?? FEATURES[f.kind].keys.size?.def ?? 0 });
    else features.push({ ...f } as MapFeature);
  }
  const relief = d.relief;
  const terrain = relief < 80 ? 0 : relief < 220 ? 1 : 2;
  return cleanMap({
    v: 1,
    name: `${d.name} remix`.slice(0, MAP.nameMax),
    blurb: '',
    theme: d.theme,
    loop: !!d.laps,
    laps: d.laps ?? 3,
    width: d.width,
    terrain,
    sea: null,
    points: d.points,
    features,
    props: d.clean ? 'clean' : d.obstacles ? 'course' : d.rockfall || d.climb ? 'rockfall' : 'some',
    traffic: d.traffic === 'highway' ? 'highway' : d.traffic ? 'town' : 'none',
    survival: !!d.survival,
    sky: !!d.sky,
  });
}
