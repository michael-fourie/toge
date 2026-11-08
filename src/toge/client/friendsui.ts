// The Friends page (hub.ts hosts it): add friends by username, see who added you, and open a friend's profile:
// their garage (any car goes on the turntable, their driver beside it) and their best time on every track next to
// yours. Friends are site-wide (src/shared/friends.ts, /api/friends); a profile is `/api/garage?u=<name>`, which the
// server only answers for an account you've added. Signed in only; a guest still sees their own best times.

import { CARS, PAINTS, type OwnedCar, decodeCar } from '../shared/cars.ts';
import { TRACK_LENGTH_KM } from '../shared/garage.ts';
import { type FriendAction, type FriendList, type FriendResult } from '../../shared/friends.ts';
import { type Bests, type TogeProfile } from '../shared/records.ts';
import { RACE_TRACKS, TRACK_DEFS, type TrackId } from '../shared/track.ts';
import { esc } from '../../client/menu/ui.ts';
import { fmtTime } from './hud.ts';
import { trackKind } from './trackart.ts';

export interface FriendsView {
  user: string | null;
  /** Null while it loads. */
  list: FriendList | null;
  /** The friend whose profile is open, and which of their cars is on the turntable. */
  open: TogeProfile | null;
  openCar: number;
  bests: Bests;
  status: string;
}

export const friendsApi = {
  async list(): Promise<FriendList | null> {
    try {
      return ((await (await fetch('/api/friends')).json()) as { friends: FriendList | null }).friends;
    } catch {
      return null;
    }
  },
  async act(a: FriendAction['a'], name: string): Promise<FriendResult> {
    try {
      const res = await fetch('/api/friends', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a, name }) });
      return (await res.json()) as FriendResult;
    } catch {
      return { ok: false, error: 'Could not reach the game server.' };
    }
  },
  async profile(name: string): Promise<TogeProfile | null> {
    try {
      return ((await (await fetch(`/api/garage?u=${encodeURIComponent(name)}`)).json()) as { profile: TogeProfile | null }).profile;
    } catch {
      return null;
    }
  },
};

/** Every race track, climbs included, in the catalogue's order (not the open world: it keeps no times). */
const ALL_TRACKS = RACE_TRACKS;
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const carName = (code: string) => {
  const c = decodeCar(code);
  return c ? CARS[c.model].name : '';
};
const trackCell = (id: TrackId) => `<th scope="row"><b>${esc(TRACK_DEFS[id].name)}</b><small>${esc(trackKind(id))} · ${TRACK_LENGTH_KM[id]} km</small></th>`;
const status = (text: string) => `<p class="tg-status" role="status" data-status>${esc(text)}</p>`;

/** The car of `p` on the turntable (their selected one unless another was picked). */
export function friendCar(v: FriendsView): OwnedCar | null {
  return v.open ? decodeCar(v.open.cars[v.openCar] ?? v.open.cars[v.open.sel]) : null;
}

/** The page body. `badge` draws a car's class badge (hub.ts's classBadge). */
export function friendsTab(v: FriendsView, badge: (c: OwnedCar) => string): string {
  if (v.open) return profilePage(v, v.open, badge);
  if (!v.user) {
    return `
      <div class="tg-group tg-cardbox tg-friends-guest">
        <h2 class="tg-h">Friends</h2>
        <p>Sign in to add friends, look round their garages and race their best times.</p>
        <button class="tg-go" data-friends-signin data-autofocus>Sign in</button>
      </div>
      ${myTimes(v.bests)}
      ${status(v.status)}`;
  }
  const list = v.list;
  const mutual = new Set(list?.mutual.map((n) => n.toLowerCase()));
  return `
    <form class="tg-friend-add tg-cardbox" data-friend-form>
      <label><span class="tg-label">Add a friend</span><input data-friend-name maxlength="16" placeholder="Username" autocomplete="off" spellcheck="false" data-autofocus /></label>
      <button class="tg-go small" type="submit">Add</button>
    </form>
    <h2 class="tg-h">Friends <small>${list ? list.friends.length : ''}</small></h2>
    ${
      !list
        ? '<p class="tg-muted">Loading…</p>'
        : list.friends.length
          ? `<div class="tg-friends">${list.friends
              .map(
                (n) => `<div class="tg-friend tg-cardbox">
                  <span class="tg-friend-av" aria-hidden="true">${esc(n.slice(0, 1).toUpperCase())}</span>
                  <b>${esc(n)}</b>
                  ${mutual.has(n.toLowerCase()) ? '<span class="tg-tag">Mutual</span>' : '<span></span>'}
                  <button class="tg-pill" data-friend-open="${esc(n)}">Garage</button>
                  <button class="tg-pill danger" data-friend-remove="${esc(n)}" aria-label="Remove ${esc(n)}">Remove</button>
                </div>`,
              )
              .join('')}</div>`
          : '<p class="tg-muted">No friends yet. Add someone by their username.</p>'
    }
    ${
      list?.fans.length
        ? `<h2 class="tg-h">Added you <small>${list.fans.length}</small></h2>
      <div class="tg-friends">${list.fans
        .map(
          (n) => `<div class="tg-friend tg-cardbox">
            <span class="tg-friend-av" aria-hidden="true">${esc(n.slice(0, 1).toUpperCase())}</span>
            <b>${esc(n)}</b><span></span><span></span>
            <button class="tg-pill" data-friend-add="${esc(n)}">Add back</button>
          </div>`,
        )
        .join('')}</div>`
        : ''
    }
    ${myTimes(v.bests)}
    ${status(v.status)}`;
}

function myTimes(bests: Bests): string {
  const set = ALL_TRACKS.filter((id) => bests[id]);
  return `
    <h2 class="tg-h">Your best times <small>${set.length}/${ALL_TRACKS.length} tracks</small></h2>
    ${
      set.length
        ? `<table class="tg-times tg-cardbox"><tbody>${set
            .map((id) => {
              const b = bests[id]!;
              return `<tr>${trackCell(id)}<td class="tg-num"><b>${fmtTime(b.time)}</b><small>${esc(carName(b.car))}${b.at ? ` · ${new Date(b.at).toLocaleDateString()}` : ''}</small></td></tr>`;
            })
            .join('')}</tbody></table>`
        : '<p class="tg-muted">Finish a race to set your first time. Every track keeps your quickest.</p>'
    }`;
}

function profilePage(v: FriendsView, p: TogeProfile, badge: (c: OwnedCar) => string): string {
  const rate = p.races ? Math.round((p.wins / p.races) * 100) : 0;
  const shown = v.openCar;
  const tracks = ALL_TRACKS.filter((id) => p.bests[id] || v.bests[id]);
  return `
    <button class="tg-link tg-back" data-friend-close>‹ All friends</button>
    <h1 class="tg-display tg-friend-name">${esc(p.name)}</h1>
    <dl class="tg-profile">
      <div><dt>Races</dt><dd class="tg-num">${p.races}</dd></div>
      <div><dt>Wins</dt><dd class="tg-num">${p.wins}</dd></div>
      <div><dt>Win rate</dt><dd class="tg-num">${rate}<small>%</small></dd></div>
      <div><dt>Cars</dt><dd class="tg-num">${p.cars.length}</dd></div>
    </dl>
    <h2 class="tg-h">Their garage <small>${p.cars.length} owned</small></h2>
    <div class="tg-cars">
      ${p.cars
        .map((code, i) => {
          const c = decodeCar(code);
          if (!c) return '';
          const b = CARS[c.model];
          return `<div class="tg-owned tg-cardbox ${i === shown ? 'on' : ''}" style="--paint:${hex(PAINTS[c.look.paint])}">
            <div class="tg-owned-name"><small>${esc(b.maker)}</small><b>${esc(b.name)}</b></div>
            ${badge(c)}
            <div class="tg-owned-meta">${i === p.sel ? '<span class="tg-tag">Driving</span>' : ''}</div>
            <div class="tg-owned-act"><button class="tg-pill" data-friend-car="${i}" aria-pressed="${i === shown}" ${i === shown ? 'data-autofocus' : ''}>View</button></div>
          </div>`;
        })
        .join('')}
    </div>
    <h2 class="tg-h">Best times <small>Theirs and yours</small></h2>
    ${
      tracks.length
        ? `<table class="tg-times tg-cardbox"><thead><tr><th></th><th>${esc(p.name)}</th><th>You</th></tr></thead><tbody>${tracks
            .map((id) => {
              const t = p.bests[id];
              const m = v.bests[id];
              const d = t && m ? m.time - t.time : null;
              return `<tr>${trackCell(id)}
                <td class="tg-num">${t ? `<b>${fmtTime(t.time)}</b><small>${esc(carName(t.car))}</small>` : '<small>—</small>'}</td>
                <td class="tg-num">${m ? `<b>${fmtTime(m.time)}</b>${d !== null ? `<small class="${d <= 0 ? 'good' : 'bad'}">${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(3)}</small>` : ''}` : '<small>—</small>'}</td></tr>`;
            })
            .join('')}</tbody></table>`
        : `<p class="tg-muted">Neither of you has finished a race yet.</p>`
    }
    ${status(v.status)}`;
}
