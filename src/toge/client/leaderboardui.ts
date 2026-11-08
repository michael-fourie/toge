// The Leaderboard page (Race tab; hub.ts hosts it): every track's all-time board, one time per racer (their best
// there), from `/api/leaderboard`. Only accounts are on it, and only times the server timed in a record mode (a time
// trial, or a hill climb on its roads: recordMode; never a race or a solo run). records.ts, toge/server/recordStore.ts;
// guests' times stay in their browser. See src/toge/DESIGN.md.

import { CARS, decodeCar } from '../shared/cars.ts';
import { TRACK_LENGTH_KM } from '../shared/garage.ts';
import { BOARD, type BestTime, type BoardRow } from '../shared/records.ts';
import { RACE_TRACKS, TRACK_DEFS, type TrackId } from '../shared/track.ts';
import { esc } from '../../client/menu/ui.ts';
import { fmtTime, ordinal } from './hud.ts';
import { trackKind, trackMap, trackStyle } from './trackart.ts';

export type Leaders = Partial<Record<TrackId, BoardRow>>;

export interface BoardView {
  /** The track whose board is open. */
  track: TrackId;
  /** Every track's record (null while it loads). */
  leaders: Leaders | null;
  /** The open track's board (null while it loads). */
  rows: BoardRow[] | null;
  /** Signed in as (null: a guest). */
  user: string | null;
  /** Your friends, lower-cased, for a tag on their rows. */
  friends: Set<string>;
  /** Your own best on the open track (a guest's from this browser). */
  mine: BestTime | undefined;
  /** The data couldn't be loaded. */
  failed: boolean;
  status: string;
}

export const boardApi = {
  async leaders(): Promise<Leaders | null> {
    try {
      return ((await (await fetch('/api/leaderboard')).json()) as { leaders: Leaders }).leaders ?? null;
    } catch {
      return null;
    }
  },
  async board(track: TrackId): Promise<BoardRow[] | null> {
    try {
      return ((await (await fetch(`/api/leaderboard?t=${track}`)).json()) as { rows: BoardRow[] }).rows ?? null;
    } catch {
      return null;
    }
  },
};

/** Every race track, climbs included, in the catalogue's order (not the open world: it keeps no times). */
const ALL_TRACKS = RACE_TRACKS;
const carName = (code: string) => {
  const c = decodeCar(code);
  return c ? CARS[c.model].name : '';
};
const status = (text: string) => `<p class="tg-status" role="status" data-status>${esc(text)}</p>`;

export function leaderboardTab(v: BoardView): string {
  const d = TRACK_DEFS[v.track];
  const rows = v.rows;
  const top = rows?.[0];
  const me = v.user?.toLowerCase();
  const myRow = rows && me ? rows.findIndex((r) => r.name.toLowerCase() === me) : -1;
  return `
    <section class="tg-hero tg-lb-hero" style="${trackStyle(v.track)}">
      <span class="tg-hero-art" aria-hidden="true"></span>
      <div class="tg-hero-map">${trackMap(v.track)}</div>
      <div class="tg-hero-copy">
        <small class="tg-eyebrow">${esc(trackKind(v.track))} · ${TRACK_LENGTH_KM[v.track]} km</small>
        <h1 class="tg-display">${esc(d.name)}</h1>
        <p>${top ? `Record held by <b>${esc(top.name)}</b>` : rows ? 'No record yet. Set the first time.' : 'Loading the board…'}</p>
      </div>
      <dl class="tg-hero-facts">
        <div><dt>Track record</dt><dd class="tg-num">${top ? fmtTime(top.time) : '—'}</dd></div>
        <div><dt>Racers</dt><dd class="tg-num">${rows ? rows.length : '—'}</dd></div>
      </dl>
    </section>
    <div class="tg-lb-launch">
      <p class="tg-muted">${mineLine(v, myRow, top)}</p>
      ${d.climb ? '' : `<button class="tg-go small" data-lb-race="${v.track}">Race it</button>`}
    </div>
    <h2 class="tg-h">All-time board <small>${d.climb ? 'Hill climbs' : 'Time trials'} only · one time per racer · top ${BOARD.size}</small></h2>
    ${boardTable(v, myRow)}
    <h2 class="tg-h">Tracks <small>Record on each</small></h2>
    <div class="tg-lb-tracks">
      ${ALL_TRACKS.map((id) => {
        const r = v.leaders?.[id];
        return `<button class="tg-lb-track" data-lb-track="${id}" aria-pressed="${id === v.track}" ${id === v.track ? 'data-autofocus' : ''}>
          <span><b>${esc(TRACK_DEFS[id].name)}</b><small>${esc(trackKind(id))}</small></span>
          <span class="tg-num">${r ? `<b>${fmtTime(r.time)}</b><small>${esc(r.name)}</small>` : `<small>${v.leaders ? 'No record' : '…'}</small>`}</span>
        </button>`;
      }).join('')}
    </div>
    ${status(v.failed ? 'Could not load the leaderboard.' : v.status)}`;
}

/** "You're 4th, +1.234 off the record", or why you're not on the board. */
function mineLine(v: BoardView, myRow: number, top: BoardRow | undefined): string {
  if (!v.user) return v.mine ? `Your best here is ${fmtTime(v.mine.time)}. Sign in to put your times on the board.` : 'Sign in to put your times on the board.';
  if (!v.rows) return '';
  if (myRow === 0) return 'You hold the record.';
  if (myRow > 0) return `You're ${ordinal(myRow + 1)}, <span class="tg-num">+${(v.rows[myRow].time - top!.time).toFixed(3)}</span> off the record.`;
  if (v.mine) return `Your best here is ${fmtTime(v.mine.time)}, outside the top ${BOARD.size}.`;
  return 'Finish a race here to get on the board.';
}

function boardTable(v: BoardView, myRow: number): string {
  const rows = v.rows;
  if (!rows) return `<p class="tg-muted">${v.failed ? 'The board is out of reach right now.' : 'Loading…'}</p>`;
  if (!rows.length) return '<p class="tg-muted">Nobody has finished here yet. The first finish takes the record.</p>';
  const top = rows[0].time;
  return `<table class="tg-times tg-lb tg-cardbox"><tbody>${rows
    .map((r, i) => {
      const you = i === myRow;
      const friend = !you && v.friends.has(r.name.toLowerCase());
      return `<tr class="${you ? 'you' : ''}${i === 0 ? ' p1' : ''}">
        <td class="tg-lb-pos tg-num">${i + 1}</td>
        <th scope="row"><b>${esc(r.name)}</b><small>${esc(carName(r.car))}${r.at ? ` · ${new Date(r.at).toLocaleDateString()}` : ''}</small></th>
        <td class="tg-lb-tag">${you ? '<span class="tg-tag you">You</span>' : friend ? '<span class="tg-tag">Friend</span>' : ''}</td>
        <td class="tg-num"><b>${fmtTime(r.time)}</b><small>${i === 0 ? 'Record' : `+${(r.time - top).toFixed(3)}`}</small></td>
      </tr>`;
    })
    .join('')}</tbody></table>`;
}
