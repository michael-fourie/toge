import type { MapData } from '../shared/map.ts';
import type { RoyaleInfo } from '../shared/protocol.ts';
import { PHASES, ROYALE, type ZoneState, toSafety } from '../shared/royale.ts';
import type { Vec3 } from '../../shared/math.ts';
import './royale.css';

// Battle Royale HUD: the banner along the top (warmup clock, zone phase and timer, who's left), the minimap with the
// zone on it, the shield bar over the health, the storm tint while you're outside, and who you're spectating.

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
/** The minimap shows this many metres either side of the island's middle. */
const EXTENT = 265;
const SIZE = 168;

export interface HudState {
  info: RoyaleInfo;
  /** Seconds since `info` arrived (the warmup clock counts down locally). */
  since: number;
  zone: ZoneState | null;
  alive: number;
  me: Vec3;
  yaw: number;
  living: boolean;
  shield: number;
  spectating: string | null;
}

export class RoyaleHud {
  private readonly banner = document.createElement('div');
  private readonly map = document.createElement('canvas');
  private readonly shieldEl = document.createElement('div');
  private readonly storm = document.createElement('div');
  private readonly spec = document.createElement('div');
  private readonly base: HTMLCanvasElement;
  private html = '';
  private frame = 0;

  constructor(parent: HTMLElement, data: MapData) {
    this.banner.className = 'br-banner';
    this.map.className = 'br-map';
    this.shieldEl.className = 'br-shield';
    this.shieldEl.innerHTML = '<b>0</b><div class="bar"><i></i></div>';
    this.storm.className = 'br-storm';
    this.spec.className = 'br-spec';
    const k = Math.min(2, devicePixelRatio || 1);
    this.map.width = this.map.height = SIZE * k;
    this.base = drawIsland(data, SIZE * k);
    parent.append(this.storm, this.banner, this.map, this.shieldEl, this.spec);
  }

  update(s: HudState) {
    const outside = s.living && s.zone ? toSafety(s.zone, s.me) : 0;
    const html = `<div>${this.headline(s)}<em>${s.alive} alive</em></div>${outside > 0 ? `<div class="br-out">Outside the zone · ${Math.ceil(outside)} m to safety · ${s.zone!.dps} hp/s</div>` : ''}`;
    if (html !== this.html) {
      this.html = html;
      this.banner.innerHTML = html;
    }
    this.storm.classList.toggle('show', outside > 0);
    this.shieldEl.hidden = !s.living;
    this.shieldEl.querySelector('b')!.textContent = String(Math.ceil(s.shield));
    (this.shieldEl.querySelector('.bar i') as HTMLElement).style.width = `${(s.shield / ROYALE.maxShield) * 100}%`;
    this.shieldEl.classList.toggle('empty', s.shield <= 0);
    this.spec.hidden = !s.spectating;
    if (s.spectating) this.spec.innerHTML = `Spectating <b>${esc(s.spectating)}</b> · click for the next player`;
    if (this.frame++ % 3 === 0) this.drawMap(s);
  }

  private headline(s: HudState): string {
    const { info, zone } = s;
    if (info.phase === 'warmup') return `<b>WARMUP</b>the drop starts in ${Math.max(0, Math.ceil(info.left - s.since))}s · try out what you find`;
    if (info.phase === 'over' || !zone) return '<b>MATCH OVER</b>';
    if (zone.ph >= PHASES.length) return '<b>FINAL CIRCLE</b>the zone has closed';
    if (zone.shrinking) return `<b>ZONE CLOSING</b>${clock(zone.left)}`;
    return `<b>ZONE ${zone.ph + 1}/${PHASES.length}</b>closes in ${clock(zone.left)}`;
  }

  private drawMap(s: HudState) {
    const g = this.map.getContext('2d')!;
    const W = this.map.width;
    const k = W / (EXTENT * 2);
    const px = (x: number) => (x + EXTENT) * k;
    g.clearRect(0, 0, W, W);
    g.drawImage(this.base, 0, 0);
    const z = s.zone;
    if (z) {
      // The storm: everything outside the circle, tinted.
      g.save();
      g.beginPath();
      g.rect(0, 0, W, W);
      g.arc(px(z.x), px(z.z), Math.max(0, z.r * k), 0, Math.PI * 2, true);
      g.fillStyle = '#8a5cd8';
      g.globalAlpha = 0.45;
      g.fill('evenodd');
      g.restore();
      g.lineWidth = Math.max(1, W / 120);
      g.strokeStyle = '#d9c2ff';
      g.beginPath();
      g.arc(px(z.x), px(z.z), Math.max(0, z.r * k), 0, Math.PI * 2);
      g.stroke();
      if (z.nr < z.r) {
        g.setLineDash([W / 40, W / 60]);
        g.strokeStyle = '#fffdf3';
        g.beginPath();
        g.arc(px(z.nx), px(z.nz), Math.max(0.5, z.nr * k), 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
      // Outside: a line to the nearest safe spot.
      if (s.living && toSafety(z, s.me) > 0) {
        const d = Math.hypot(s.me.x - z.x, s.me.z - z.z) || 1;
        g.strokeStyle = '#ffe28a';
        g.beginPath();
        g.moveTo(px(s.me.x), px(s.me.z));
        g.lineTo(px(z.x + ((s.me.x - z.x) / d) * z.r), px(z.z + ((s.me.z - z.z) / d) * z.r));
        g.stroke();
      }
    }
    // You: an arrow the way you face (yaw 0 looks -Z, which is up on the map).
    g.save();
    g.translate(px(s.me.x), px(s.me.z));
    g.rotate(-s.yaw);
    const a = W / 26;
    g.fillStyle = s.living ? '#ffe28a' : '#fffdf3';
    g.strokeStyle = '#2a3e5a';
    g.lineWidth = W / 110;
    g.beginPath();
    g.moveTo(0, -a);
    g.lineTo(a * 0.7, a * 0.8);
    g.lineTo(0, a * 0.4);
    g.lineTo(-a * 0.7, a * 0.8);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  dispose() {
    for (const el of [this.banner, this.map, this.shieldEl, this.storm, this.spec]) el.remove();
  }
}

/** The island from above, drawn once: meadow, hills lighter the higher they are, rooftops, trees, the surf. */
function drawIsland(data: MapData, W: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = W;
  const g = c.getContext('2d')!;
  const k = W / (EXTENT * 2);
  const rect = (b: { min: Vec3; max: Vec3 }) => g.fillRect((b.min.x + EXTENT) * k, (b.min.z + EXTENT) * k, Math.max(1, (b.max.x - b.min.x) * k), Math.max(1, (b.max.z - b.min.z) * k));
  const order = [...data.boxes].sort((a, b) => a.max.y - b.max.y);
  for (const b of order) {
    if (b.kind === 'floor') g.fillStyle = b.min.y < -10 ? '#7fb35a' : `hsl(95, 38%, ${Math.min(72, 52 + b.max.y * 1.4)}%)`;
    else if (b.kind === 'ramp') g.fillStyle = '#93c46c';
    else if (b.kind === 'surf') g.fillStyle = '#7fc4e8';
    else if (b.kind === 'wall' && b.max.y - b.min.y > 3) g.fillStyle = '#c9a27e';
    else if (b.kind === 'trunk') g.fillStyle = '#3f6e30';
    else continue;
    rect(b);
  }
  g.fillStyle = '#4f8a3c';
  for (const d of data.decor) {
    g.beginPath();
    g.arc((d.pos.x + EXTENT) * k, (d.pos.z + EXTENT) * k, Math.max(1.5, d.radius * k), 0, Math.PI * 2);
    g.fill();
  }
  return c;
}
