// The Leaderboard page (Race tab; hub.ts hosts it): every track's all-time board, one time per racer (their best
// there), from `/api/leaderboard`. Only accounts are on it, and only times the server timed in a record mode (a time
// trial, or a hill climb on its roads: recordMode; never a race or a solo run). records.ts, kanjo/server/recordStore.ts;
// guests' times stay in their browser. See src/kanjo/DESIGN.md.

import { CARS, decodeCar } from '../shared/cars.ts';
import { TRACK_LENGTH_KM } from '../shared/garage.ts';
import { BOARD, BOARD_TRACKS, type BestTime, type BoardRow, type MedalRow, type Notice } from '../shared/records.ts';
import { TRACK_DEFS, type TrackId } from '../shared/track.ts';
import type { GhostRun } from '../shared/ghost.ts';
import { esc } from '../../client/menu/ui.ts';
import { fmtTime, ordinal } from './hud.ts';
import { trackKind, trackMap, trackStyle } from './trackart.ts';

export type Leaders = Partial<Record<TrackId, BoardRow>>;

export interface BoardView {
  /** The track whose board is open. */
  track: TrackId;
  /** Every track's record (null while it loads). */
  leaders: Leaders | null;
  /** The medal table over every board's top three (null while it loads). */
  medals: MedalRow[] | null;
  /** Your unseen "your time was beaten" notices, newest first (none for guests). */
  notices: Notice[];
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
  /** Every track's record and the medal table. */
  async leaders(): Promise<{ leaders: Leaders; medals: MedalRow[] } | null> {
    try {
      const r = (await (await fetch('/api/leaderboard')).json()) as { leaders?: Leaders; medals?: MedalRow[] };
      return r.leaders ? { leaders: r.leaders, medals: Array.isArray(r.medals) ? r.medals : [] } : null;
    } catch {
      return null;
    }
  },
  /** Your unseen notices (null: a guest, or the server is out of reach). */
  async notices(): Promise<Notice[] | null> {
    try {
      const r = await fetch('/api/notices');
      return r.ok ? (((await r.json()) as { notices: Notice[] | null }).notices ?? null) : null;
    } catch {
      return null;
    }
  },
  /** You've seen every notice up to `at`. */
  async seen(at: number): Promise<void> {
    try {
      await fetch('/api/notices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seen: at }) });
    } catch {
      // they come back next time: no harm
    }
  },
  /** The track record's run, to watch (null: no record, no run kept with it, or out of reach). */
  async ghost(track: TrackId): Promise<GhostRun | null> {
    try {
      const r = await fetch(`/api/ghost?t=${track}`);
      return r.ok ? (((await r.json()) as { run: GhostRun | null }).run ?? null) : null;
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

/** The tracks with a board on the page, in the catalogue's order: the playable ones (records.ts BOARD_TRACKS). */
const ALL_TRACKS = BOARD_TRACKS;
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
    ${noticesCard(v.notices)}
    <h2 class="tg-h">Overall <small>Medals across every track: 1st, 2nd and 3rd on each board</small></h2>
    ${medalsTable(v)}
    <section class="tg-hero tg-lb-hero" style="${trackStyle(v.track)}">
      <span class="tg-hero-art" aria-hidden="true"></span>
      <div class="tg-hero-map">${trackMap(v.track)}</div>
      <div class="tg-hero-copy">
        <small class="tg-eyebrow">${esc(trackKind(v.track))} · ${TRACK_LENGTH_KM[v.track]} km</small>
        <h1 class="tg-display">${esc(d.name)}</h1>
        <p>${top ? `Record held by <b>${esc(top.name)}</b>` : rows ? 'No record yet. Set the first time.' : 'Loading the board…'}</p>
        ${top ? watchButton(v.track) : ''}
      </div>
      <dl class="tg-hero-facts">
        <div><dt>Track record</dt><dd class="tg-num">${top ? `<button class="tg-lb-rec" data-lb-watch="${v.track}" aria-label="Watch the record run, ${fmtTime(top.time)}">${fmtTime(top.time)}</button>` : '—'}</dd></div>
        <div><dt>Racers</dt><dd class="tg-num">${rows ? rows.length : '—'}</dd></div>
      </dl>
    </section>
    <div class="tg-lb-launch">
      <p class="tg-muted">${mineLine(v, myRow, top)}</p>
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

/**
 * The leaderboard as a large modal (Race home's Leaderboard button; 2026-11-15, Michael): a header, every track down the
 * left with its record, and the open track's hero, your standing, its board and the overall medal table on the right.
 * Same pieces and hooks as `leaderboardTab` (`data-lb-track`, `data-notices-seen`).
 */
export function leaderboardModal(v: BoardView): string {
  const d = TRACK_DEFS[v.track];
  const rows = v.rows;
  const top = rows?.[0];
  const me = v.user?.toLowerCase();
  const myRow = rows && me ? rows.findIndex((r) => r.name.toLowerCase() === me) : -1;
  return `
    <header class="tg-lbm-head">
      <div><small class="tg-eyebrow">All-time · one time per racer</small><h2 class="tg-display" id="tg-lbm-title">Leaderboard</h2></div>
      <button class="tg-go alt small" data-lbm-close data-autofocus>Close</button>
    </header>
    <div class="tg-lbm-cols">
      <nav class="tg-lbm-tracks" aria-label="Tracks">
        ${ALL_TRACKS.map((id) => {
          const r = v.leaders?.[id];
          return `<button class="tg-lb-track" data-lb-track="${id}" aria-pressed="${id === v.track}">
            <span><b>${esc(TRACK_DEFS[id].name)}</b><small>${esc(trackKind(id))}</small></span>
            <span class="tg-num">${r ? `<b>${fmtTime(r.time)}</b><small>${esc(r.name)}</small>` : `<small>${v.leaders ? 'No record' : '…'}</small>`}</span>
          </button>`;
        }).join('')}
      </nav>
      <div class="tg-lbm-main">
        ${noticesCard(v.notices)}
        <section class="tg-hero tg-lb-hero" style="${trackStyle(v.track)}">
          <span class="tg-hero-art" aria-hidden="true"></span>
          <div class="tg-hero-map">${trackMap(v.track)}</div>
          <div class="tg-hero-copy">
            <small class="tg-eyebrow">${esc(trackKind(v.track))} · ${TRACK_LENGTH_KM[v.track]} km</small>
            <h1 class="tg-display">${esc(d.name)}</h1>
            <p>${top ? `Record held by <b>${esc(top.name)}</b>` : rows ? 'No record yet. Set the first time.' : 'Loading the board…'}</p>
        ${top ? watchButton(v.track) : ''}
          </div>
          <dl class="tg-hero-facts">
            <div><dt>Track record</dt><dd class="tg-num">${top ? `<button class="tg-lb-rec" data-lb-watch="${v.track}" aria-label="Watch the record run, ${fmtTime(top.time)}">${fmtTime(top.time)}</button>` : '—'}</dd></div>
            <div><dt>Racers</dt><dd class="tg-num">${rows ? rows.length : '—'}</dd></div>
          </dl>
        </section>
        <p class="tg-muted">${mineLine(v, myRow, top)}</p>
        <div class="tg-lbm-grid">
          <div>
            <h2 class="tg-h">Board <small>${d.climb ? 'Hill climbs' : 'Time trials'} only · top ${BOARD.size}</small></h2>
            ${boardTable(v, myRow)}
          </div>
          <div>
            <h2 class="tg-h">Overall <small>Medals on every board</small></h2>
            ${medalsTable(v)}
          </div>
        </div>
        ${status(v.failed ? 'Could not load the leaderboard.' : v.status)}
      </div>
    </div>`;
}

/** How many medal rows to show before folding the rest (you're always shown). */
const MEDAL_ROWS = 10;

/** The overall table: place, racer, golds, silvers, bronzes (2026-11-10, Andrew). */
function medalsTable(v: BoardView): string {
  const m = v.medals;
  if (!m) return `<p class="tg-muted">${v.failed ? 'The medal table is out of reach right now.' : 'Loading…'}</p>`;
  if (!m.length) return '<p class="tg-muted">No medals yet. Set a time on any track to take one.</p>';
  const me = v.user?.toLowerCase();
  // Ties share a place (same golds, silvers and bronzes).
  const place = (i: number) => {
    let p = i;
    while (p > 0 && m[p - 1].gold === m[i].gold && m[p - 1].silver === m[i].silver && m[p - 1].bronze === m[i].bronze) p--;
    return p + 1;
  };
  const mine = me ? m.findIndex((r) => r.name.toLowerCase() === me) : -1;
  const shown = m.map((_, i) => i).filter((i) => i < MEDAL_ROWS || i === mine);
  const medal = (kind: 'g' | 's' | 'b', n: number, label: string) => `<td class="tg-medal-n"><span class="tg-medal ${kind}${n ? '' : ' none'}" aria-label="${n} ${label}">${n}</span></td>`;
  return `<table class="tg-times tg-medals tg-cardbox">
    <thead><tr><th scope="col"><span class="sr-only">Place</span></th><th scope="col">Racer</th><th scope="col"><span class="sr-only">Tag</span></th><th scope="col" class="tg-medal-h g">Gold</th><th scope="col" class="tg-medal-h s">Silver</th><th scope="col" class="tg-medal-h b">Bronze</th></tr></thead>
    <tbody>${shown
      .map((i) => {
        const r = m[i];
        const you = i === mine;
        const friend = !you && v.friends.has(r.name.toLowerCase());
        return `<tr class="${you ? 'you' : ''}${i > 0 && i === mine && mine >= MEDAL_ROWS ? ' gap' : ''}">
          <td class="tg-lb-pos tg-num">${place(i)}</td>
          <th scope="row"><b>${esc(r.name)}</b><small>${r.gold + r.silver + r.bronze} medal${r.gold + r.silver + r.bronze === 1 ? '' : 's'}</small></th>
          <td class="tg-lb-tag">${you ? '<span class="tg-tag you">You</span>' : friend ? '<span class="tg-tag">Friend</span>' : ''}</td>
          ${medal('g', r.gold, 'gold')}${medal('s', r.silver, 'silver')}${medal('b', r.bronze, 'bronze')}
        </tr>`;
      })
      .join('')}</tbody></table>
    ${m.length > shown.length ? `<p class="tg-muted tg-medals-more">${m.length} racers have medals.</p>` : ''}`;
}

/** "3 hours ago", for a notice. */
function ago(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 90) return 'just now';
  const [n, unit] = s < 5400 ? [Math.round(s / 60), 'minute'] : s < 129600 ? [Math.round(s / 3600), 'hour'] : [Math.round(s / 86400), 'day'];
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/** One notice as a line of text (also the popup's). */
export function noticeText(n: Notice): string {
  const where = n.rank === null ? `you're off the top ${BOARD.size}` : n.rank === n.was ? `you're ${ordinal(n.rank)}` : `you're now ${ordinal(n.rank)} (were ${ordinal(n.was)})`;
  return `${n.by} beat your ${fmtTime(n.yours)} on ${TRACK_DEFS[n.track].name} with ${fmtTime(n.time)}: ${where}.`;
}

/** Your unseen "your time was beaten" notices, with Got it to clear them and each line opening that track's board. */
function noticesCard(notices: Notice[]): string {
  if (!notices.length) return '';
  return `<section class="tg-notices tg-cardbox" aria-label="Your times beaten">
    <header><h2 class="tg-h">Times beaten <small>${notices.length} new</small></h2><button class="tg-pill" data-notices-seen>Got it</button></header>
    <ul>${notices
      .map(
        (n) => `<li><button class="tg-notice" data-lb-track="${n.track}">
          <span class="tg-notice-tag">${n.was === 1 ? 'Record lost' : 'Beaten'}</span>
          <span><b>${esc(n.by)}</b> beat your <span class="tg-num">${fmtTime(n.yours)}</span> on <b>${esc(TRACK_DEFS[n.track].name)}</b> with <span class="tg-num">${fmtTime(n.time)}</span><small>${n.rank === null ? `Off the top ${BOARD.size}` : n.rank === n.was ? `Still ${ordinal(n.rank)}` : `Now ${ordinal(n.rank)}, was ${ordinal(n.was)}`} · ${ago(n.at)}</small></span>
        </button></li>`,
      )
      .join('')}</ul>
  </section>`;
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
        <td class="tg-lb-play">${i === 0 ? `<button class="tg-lb-watch" data-lb-watch="${v.track}" aria-label="Watch the record run">▶ Watch</button>` : ''}</td>
      </tr>`;
    })
    .join('')}</tbody></table>`;
}

/**
 * Watch the record: its run plays back in the race's own scene, the cameras following it (hub.ts `watchRecord` fetches
 * it from `/api/ghost`, racegame.ts `watch` plays it, watchui.ts is the overlay). The record time and the record row's
 * Watch do the same.
 */
function watchButton(track: TrackId): string {
  return `<button class="tg-go small tg-lb-watch-go" data-lb-watch="${track}">▶ Watch the record</button>`;
}

/** How many of the board's rows the lobby shows (yours is added under them when you're further down). */
const LOBBY_ROWS = 5;

export interface LobbyBoardView {
  /** The lobby's track. */
  track: TrackId;
  /** Its board (null while it loads). */
  rows: BoardRow[] | null;
  failed: boolean;
  /** Signed in as (null: a guest). */
  user: string | null;
  /** Who's in the lobby, lower-cased, for a Here tag on their rows. */
  here: Set<string>;
  /** The lobby's mode sets times on this board (a time trial or a hill climb). */
  counts: boolean;
}

/** The race lobby's leaderboard (2026-11-12, Michael: "show the leaderboard in the hosting lobby"): the picked
 *  track's all-time top few, your row, and who in the lobby is on it, so everyone sees what there is to beat. */
export function lobbyBoard(v: LobbyBoardView): string {
  const d = TRACK_DEFS[v.track];
  const rows = v.rows;
  const me = v.user?.toLowerCase();
  const mine = rows && me ? rows.findIndex((r) => r.name.toLowerCase() === me) : -1;
  const head = `<h2 class="tg-h">Leaderboard <small>${esc(d.name)} · ${d.climb ? 'hill climbs' : 'time trials'} · all-time</small></h2>`;
  const note = v.counts ? '' : `<p class="tg-muted tg-lobby-lb-note">This mode doesn't set times. Switch to ${d.climb ? 'Hill climb' : 'Time trial'} to race for the board.</p>`;
  if (!rows) return `${head}<p class="tg-muted">${v.failed ? 'The board is out of reach right now.' : 'Loading the board…'}</p>`;
  if (!rows.length) return `${head}<p class="tg-muted">No times here yet. The first finish in a ${d.climb ? 'hill climb' : 'time trial'} takes the record.</p>${note}`;
  const top = rows[0].time;
  const shown = rows.map((_, i) => i).filter((i) => i < LOBBY_ROWS || i === mine);
  return `${head}
    <table class="tg-times tg-lb tg-lobby-lb tg-cardbox"><tbody>${shown
      .map((i) => {
        const r = rows[i];
        const you = i === mine;
        const here = !you && v.here.has(r.name.toLowerCase());
        return `<tr class="${you ? 'you' : ''}${i === 0 ? ' p1' : ''}${i === mine && mine >= LOBBY_ROWS ? ' gap' : ''}">
          <td class="tg-lb-pos tg-num">${i + 1}</td>
          <th scope="row"><b>${esc(r.name)}</b><small>${esc(carName(r.car))}</small></th>
          <td class="tg-lb-tag">${you ? '<span class="tg-tag you">You</span>' : here ? '<span class="tg-tag">Here</span>' : ''}</td>
          <td class="tg-num"><b>${fmtTime(r.time)}</b><small>${i === 0 ? 'Record' : `+${(r.time - top).toFixed(3)}`}</small></td>
        </tr>`;
      })
      .join('')}</tbody></table>
    ${rows.length > shown.length ? `<p class="tg-muted tg-lobby-lb-more">${rows.length} racers on the board · Race → Leaderboard for all of it.</p>` : ''}
    ${note}`;
}
