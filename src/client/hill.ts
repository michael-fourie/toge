import * as THREE from 'three';
import { KOTH, type KothState, type Zone } from '../shared/koth.ts';
import { TEAMS, type Team } from '../shared/teams.ts';
import './hill.css';
import { pbr } from './render/surface.ts';

// King of the Hill on the client: the zone drawn in the world, and the Overwatch-style bar along the top.
// Both only draw the state the server sends (snapshot.koth); the rules live in shared/koth.ts.

const NEUTRAL = 0xfff2c8;
const LOCKED = 0x9aa3ad;
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** A soft vertical fade for the zone's wall of light. */
function fadeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, '#ffffffff');
  grad.addColorStop(0.35, '#ffffff66');
  grad.addColorStop(1, '#ffffff00');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  return new THREE.CanvasTexture(c);
}

/** The hill in the world: a glowing ring and wall of light in the owner's colour, a capture arc, and a gem overhead. */
export class HillFx {
  private readonly group = new THREE.Group();
  private readonly ringMat = new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.9 });
  private readonly wallMat: THREE.MeshBasicMaterial;
  private readonly arcMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  private readonly gemMat = pbr({ color: NEUTRAL, emissive: new THREE.Color(NEUTRAL), emissiveIntensity: 0.6 });
  private arc: THREE.Mesh | null = null;
  private arcProg = -1;
  private readonly gem: THREE.Mesh;

  constructor(scene: THREE.Scene, private readonly zone: Zone) {
    this.group.position.set(zone.x, zone.y, zone.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(zone.r, 0.12, 8, 96), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    this.wallMat = new THREE.MeshBasicMaterial({ color: NEUTRAL, alphaMap: fadeTexture(), transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(zone.r, zone.r, 2.4, 96, 1, true), this.wallMat);
    wall.position.y = 1.2;
    this.gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), this.gemMat);
    this.gem.scale.y = 1.5;
    this.gem.position.y = zone.h + 1.5;
    this.group.add(ring, wall, this.gem);
    scene.add(this.group);
  }

  update(s: KothState | null, time: number) {
    if (!s) return;
    let color = s.lock > 0 ? LOCKED : s.owner === null ? NEUTRAL : TEAMS[s.owner].color;
    // Contested: flicker between the two sides so it's obvious from anywhere.
    if (s.contested && s.lock === 0) color = Math.sin(time * 10) > 0 ? TEAMS[0].color : TEAMS[1].color;
    this.ringMat.color.setHex(color);
    this.wallMat.color.setHex(color);
    this.gemMat.color.setHex(color);
    this.gemMat.emissive.setHex(color);
    this.wallMat.opacity = s.lock > 0 ? 0.2 : 0.35 + 0.12 * Math.sin(time * 2.5);
    this.gem.rotation.y = time * 1.4;
    this.gem.position.y = this.zone.h + 1.5 + Math.sin(time * 2) * 0.25;

    // The capture arc fills around the inside of the ring in the capturing team's colour.
    const prog = s.cap === null ? 0 : Math.round(s.prog * 100) / 100;
    if (prog !== this.arcProg) {
      this.arcProg = prog;
      this.arc?.geometry.dispose();
      this.arc?.removeFromParent();
      this.arc = null;
      if (prog > 0) {
        this.arc = new THREE.Mesh(new THREE.RingGeometry(this.zone.r - 0.9, this.zone.r - 0.25, 96, 1, Math.PI / 2, -prog * Math.PI * 2), this.arcMat);
        this.arc.rotation.x = -Math.PI / 2;
        this.arc.position.y = 0.06;
        this.group.add(this.arc);
      }
    }
    if (s.cap !== null) this.arcMat.color.setHex(TEAMS[s.cap].color);
  }
}

/** The bar along the top: both teams' clocks, the hill in the middle (owner, capture ring, who's on it) and what to do now. */
export class HillHud {
  private readonly el = document.createElement('div');
  private html = '';

  constructor(parent: HTMLElement) {
    this.el.className = 'hill';
    parent.appendChild(this.el);
  }

  update(s: KothState | null, me: Team | undefined, here: boolean) {
    this.el.hidden = !s;
    if (!s) return;
    const side = (t: Team) => {
      const pct = Math.min(100, Math.floor((s.held[t] / KOTH.holdToWin) * 100));
      return `<div class="hill-team t${t}${me === t ? ' mine' : ''}${s.owner === t ? ' owns' : ''}" style="--c:${hex(TEAMS[t].color)}">
        <span class="hill-name">${TEAMS[t].name}${me === t ? ' (you)' : ''}</span>
        <b class="hill-pct">${pct}%</b>
        <div class="hill-bar"><i style="width:${pct}%"></i></div>
        <small>${clock(Math.max(0, KOTH.holdToWin - s.held[t]))} to win</small>
      </div>`;
    };
    const ring = 2 * Math.PI * 26;
    const cap = s.cap === null ? 0 : s.prog;
    const mid = `<div class="hill-mid" style="--o:${s.owner === null ? hex(s.lock > 0 ? LOCKED : NEUTRAL) : hex(TEAMS[s.owner].color)}">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="26" class="hill-face"/>
          <circle cx="32" cy="32" r="26" class="hill-cap" style="stroke:${s.cap === null ? 'transparent' : hex(TEAMS[s.cap].color)}; stroke-dasharray:${(cap * ring).toFixed(1)} ${ring.toFixed(1)}"/>
          <path d="M20 40 L22 26 L28 33 L32 22 L36 33 L42 26 L44 40 Z" class="hill-crown"/>
        </svg>
        <div class="hill-on">${'<i class="d0"></i>'.repeat(Math.min(6, s.on[0]))}${'<i class="d1"></i>'.repeat(Math.min(6, s.on[1]))}</div>
      </div>`;
    const html = `${side(0)}${mid}${side(1)}<div class="hill-status${here ? ' here' : ''}${s.contested || s.overtime ? ' alert' : ''}">${this.status(s, me, here)}</div>`;
    if (html !== this.html) {
      this.html = html;
      this.el.innerHTML = html;
    }
  }

  private status(s: KothState, me: Team | undefined, here: boolean): string {
    if (s.lock > 0) return `The hill opens in ${Math.ceil(s.lock)}`;
    const you = here ? ' · you are on the hill' : '';
    if (s.overtime) return `OVERTIME${you}`;
    if (s.contested) return `CONTESTED${you}`;
    if (s.cap !== null && s.prog > 0) return `${TEAMS[s.cap].name} capturing ${Math.floor(s.prog * 100)}%${you}`;
    if (s.owner === null) return `Capture the hill${you}`;
    return (s.owner === me ? 'Defend the hill' : 'Retake the hill') + you;
  }

  dispose() {
    this.el.remove();
  }
}
