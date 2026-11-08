// TŌGE's home: the garage. Seven tabs (DESIGN.md §6): Race (Race, Leaderboard: leaderboardui.ts, Battle pass: passui.ts); Garage (My cars, Dealer); Performance (Upgrades,
// Tuning); Style (Paint, Locker, Cases: cosmeticsui.ts); Driver (your character: riderui.ts); Settings (graphics:
// settingsui.ts); Friends (friendsui.ts: add friends, their garages and best times). LB / RB walk every page in that order. The showroom fills
// the window behind the glass rail, with your car framed in the free space and its card bottom right.

import { CARS, CAR_IDS, CLASS_COLORS, FINISHES, GLOWS, GLOW_NAMES, type Look, MAX_LEVEL, PAINTS, PAINT_NAMES, PARTS, PART_INFO, type Part, HOODS, LIPS, MIRRORS, RIMS, RIM_COLORS, RIM_COLOR_NAMES, ROOFS, SPOILERS, STRIPES, TINTS, TRIMS, type BaseCar, TUNE_RANGE, type Tune, carSpec, isBike, encodeCar, newOwnedCar, peakPower, rating, stats, topSpeed, type OwnedCar } from '../shared/cars.ts';
import { CRATES, type CrateResult, MYSTERY_COST, TRACK_LENGTH_KM, current, payout, tunerCost } from '../shared/garage.ts';
import { type CaseId, type CosSlot, COS_ITEMS, COS_SLOTS, cosById, cosCaseById } from '../shared/cosmetics.ts';
import { casesTab, lockerTab, showCaseReel, wireCases } from './cosmeticsui.ts';
import { type Rider, decodeRider, defaultRider, encodeRider, isRider, riderInfo } from '../shared/rider.ts';
import { driverCard, driverTab } from './riderui.ts';
import { cardData, openPlayerCard } from './playercard.ts';
import { PHYSICS } from '../shared/protocol.ts';
import { settingsTab } from './settingsui.ts';
import { friendCar, friendsApi, friendsTab } from './friendsui.ts';
import { type Leaders, boardApi, leaderboardTab } from './leaderboardui.ts';
import type { FriendList } from '../../shared/friends.ts';
import type { BoardRow, TogeProfile } from '../shared/records.ts';
import { type Graphics, graphics, setGraphics } from '../../client/graphics.ts';
import { TRACK_DEFS, type TrackId } from '../shared/track.ts';
import { account } from '../../client/account.ts';
import type { Ctx, Render, Screen } from '../../client/menu/router.ts';
import { $, esc, playerName } from '../../client/menu/ui.ts';
import { DEFAULT_LOOK, decodeLook, encodeLook, type Look as DriverLook } from '../shared/look.ts';
import { lookAfter } from './creator.ts';
import { passChip, passRibbon, passTab } from './passui.ts';
import { PASS, TIERS, type BgId, type TitleId, tierOf } from '../shared/pass.ts';
import { garage } from './garageStore.ts';
import { money } from './hud.ts';
import { raceNet } from './racenet.ts';
import { Showroom } from './showroom.ts';
import { ICON, LOGO } from './brand.ts';
import { TRACK_IDS, cupCard, trackKind, trackMap, trackStyle, trackTile } from './trackart.ts';
import { CUP_IDS, CUPS, GP_POINTS, type CupId } from '../shared/cups.ts';
import './race.css';
import './hub.css';

type Page = 'race' | 'leaderboard' | 'pass' | 'garage' | 'dealer' | 'upgrades' | 'tuning' | 'paint' | 'locker' | 'cases' | 'driver' | 'friends' | 'settings';
type TabId = 'race' | 'garage' | 'perf' | 'style' | 'driver' | 'friends' | 'settings';
const TABS: { id: TabId; label: string; pages: [Page, string][] }[] = [
  { id: 'race', label: 'Race', pages: [['race', 'Race'], ['leaderboard', 'Leaderboard'], ['pass', 'Battle pass']] },
  { id: 'garage', label: 'Garage', pages: [['garage', 'My cars'], ['dealer', 'Dealer']] },
  { id: 'perf', label: 'Performance', pages: [['upgrades', 'Upgrades'], ['tuning', 'Tuning']] },
  { id: 'style', label: 'Style', pages: [['paint', 'Paint'], ['locker', 'Locker'], ['cases', 'Cases']] },
  { id: 'driver', label: 'Driver', pages: [['driver', 'Driver']] },
  { id: 'friends', label: 'Friends', pages: [['friends', 'Friends']] },
  { id: 'settings', label: 'Settings', pages: [['settings', 'Settings']] },
];
/** Every page in LB / RB order. */
const PAGES: Page[] = TABS.flatMap((t) => t.pages.map(([p]) => p));
const tabOf = (p: Page) => TABS.find((t) => t.pages.some(([q]) => q === p))!;

const TRACK_KEY = 'atrous.track';
const RIVALS_KEY = 'atrous.rivals';
/** Physics mode (crash damage) for solo races, on or off. */
const PHYSICS_KEY = 'atrous.physics';
/** A page's slide-in: the last child starts 0.09 s late and runs 0.24 s (hub.css `.tg-panel.enter`). */
const ENTER_MS = 400;
const read = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
/** "Bike" for two wheels (its RWD is a given), otherwise the driven wheels. */
const driveLabel = (b: BaseCar) => (b.body === 'bike' ? 'Bike' : b.drive);

export function classBadge(car: OwnedCar) {
  const r = rating(carSpec(car));
  return `<span class="tg-class" style="--c:${CLASS_COLORS[r.cls]}"><b>${r.cls}</b>${r.pi}</span>`;
}

/** A 10-segment stat bar. */
const statBar = (label: string, v: number) =>
  `<div class="tg-stat"><span>${label}</span><i style="--v:${v}"></i><em class="tg-num">${v.toFixed(1)}</em></div>`;

/**
 * The garage opened from a race lobby (lobby.ts mounts it over the lobby): only the pages that change your car and
 * driver, Back returns to the lobby (so does Esc / B), and the top bar carries a strip with the lobby's state that
 * lobby.ts fills (`[data-pitbar]`). Edits save as usual and the lobby sends them to the room.
 */
export interface Pit {
  close(): void;
}
/** The tabs the lobby's garage shows. */
const PIT_TABS: TabId[] = ['garage', 'perf', 'style', 'driver'];
/** The page the lobby's garage opens on: the last one used there. */
let pitPage: Page = 'paint';

export const driveHub: Render = (root, ctx, screen) => mountHub(root, ctx, screen, null);
/** The garage over a race lobby. Returns its cleanup. */
export const pitGarage = (root: HTMLElement, ctx: Ctx, pit: Pit) => mountHub(root, ctx, { name: 'drivelobby' }, pit);

function mountHub(root: HTMLElement, ctx: Ctx, screen: Screen, pit: Pit | null): () => void {
  const tabs = pit ? TABS.filter((t) => PIT_TABS.includes(t.id)) : TABS;
  const pages: Page[] = tabs.flatMap((t) => t.pages.map(([p]) => p));
  let page: Page = pit ? pitPage : (PAGES.find((p) => p === screen.dtab) ?? 'race');
  /** The page each tab opens on (the last one you looked at). */
  const lastPage: Record<TabId, Page> = { race: 'race', garage: 'garage', perf: 'upgrades', style: 'paint', driver: 'driver', friends: 'friends', settings: 'settings' };
  lastPage[tabOf(page).id] = page;
  let track = (read(TRACK_KEY, 'koripass') in TRACK_DEFS ? read(TRACK_KEY, 'koripass') : 'koripass') as TrackId;
  let rivals = Number(read(RIVALS_KEY, '5'));
  let physics = read(PHYSICS_KEY, '0') === '1';
  let status = screen.notice ?? '';
  let draft: { look: Look; tune: Tune } | null = null;
  /** A dealer car being looked at (shown in the showroom and on the card until you leave the page). */
  let preview: OwnedCar | null = null;
  /** Locker: the slot being browsed, and a not-yet-owned item being tried on in the showroom. */
  let lockerSlot: CosSlot = 'paint';
  let trying: string | null = null;
  /** A driver pick not saved yet (it saves a moment after the last change, like paint). */
  let riderDraft: Rider | null = null;
  let riderTimer = 0;
  /** Your own driver while it's being made (saved with the rider, a moment after the last change). */
  let lookDraft: DriverLook | null = null;
  let lookShow = 0;
  const ownLook = (): DriverLook => lookDraft ?? decodeLook(garage.g.look) ?? DEFAULT_LOOK;
  let saveTimer = 0;
  let listTimer = 0;
  let busy = false;
  /** Friends: the list (null until loaded), the friend whose garage is open and which of their cars is shown. */
  let friendList: FriendList | null = null;
  let friendsLoading = false;
  let friendOpen: TogeProfile | null = null;
  let friendCarI = 0;
  const friendsView = () => ({ user: account.user, list: friendList, open: friendOpen, openCar: friendCarI, bests: garage.bests, status });
  const visiting = () => (page === 'friends' ? friendOpen : null);
  /** Leaderboard: the track whose board is open, every track's record, and the boards loaded so far. */
  let lbTrack: TrackId = track;
  let leaders: Leaders | null = null;
  const boards = new Map<TrackId, BoardRow[]>();
  let lbFailed = false;
  /** Battle pass: the tier open in its detail card (previewed in the showroom while the page is up): the next to reach. */
  let passSel = Math.min(PASS.tiers, tierOf(garage.g.xp) + 1);
  const passReward = () => (page === 'pass' ? TIERS[passSel - 1] : null);

  root.innerHTML = `
    <main class="tg${pit ? ' tg-pit' : ''}" aria-label="${pit ? 'Your car, from the race lobby' : 'TŌGE garage'}" ${pit ? 'data-nav-scope' : ''}>
      <canvas class="tg-showroom" aria-label="Your car. Drag to spin it."></canvas>
      <header class="tg-top">
        <button class="tg-home" data-home aria-label="${pit ? 'Back to the lobby' : 'Back to the game menu'}">${ICON.back}</button>
        ${LOGO}
        <nav class="tg-tabs" role="tablist" aria-label="Garage sections">
          <span class="tg-bumper" aria-hidden="true">LB</span>
          ${tabs.map((t) => `<button role="tab" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}
          <span class="tg-bumper" aria-hidden="true">RB</span>
        </nav>
        <div class="tg-wallet">${pit ? '<div class="tg-pitbar" data-pitbar></div>' : '<button class="tg-passchip" data-passchip aria-label="Battle pass"></button>'}<b class="tg-num" data-money></b>${pit ? '' : '<button class="tg-who" data-who></button>'}</div>
      </header>
      <section class="tg-body">
        <div class="tg-rail">
          <nav class="tg-subtabs" role="tablist" aria-label="Pages" data-subtabs></nav>
          <div class="tg-panel" data-panel></div>
        </div>
        <div class="tg-stage">
          <div class="tg-stage-name" aria-hidden="true" data-stage-name></div>
          <div class="tg-card" data-card></div>
        </div>
      </section>
      <div class="tg-modal" data-modal hidden></div>
    </main>`;
  let showroom = new Showroom($<HTMLCanvasElement>(root, '.tg-showroom'));
  let shown = '';

  /** Frame the car in the space right of the rail (or under the top bar on a phone). */
  const frameCar = () => {
    const rail = root.querySelector<HTMLElement>('.tg-rail');
    const stage = root.querySelector<HTMLElement>('.tg-stage');
    if (!rail || !stage) return;
    const r = rail.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const W = innerWidth;
    const H = innerHeight;
    if (W > 900) showroom.place((r.right + W) / 2 / W, (s.top + s.bottom * 0.84) / 2 / H);
    else showroom.place(0.5, (s.top + s.bottom) / 2 / H, Math.min(1, ((s.bottom - s.top) / H) * 1.6));
  };
  const ro = new ResizeObserver(frameCar);
  ro.observe(root.querySelector('.tg')!);

  /** A new showroom on a fresh canvas (the renderer's options, like anti-aliasing, are fixed when it's made). */
  const rebuildShowroom = () => {
    const old = $<HTMLCanvasElement>(root, '.tg-showroom');
    const fresh = old.cloneNode() as HTMLCanvasElement;
    showroom.dispose();
    old.replaceWith(fresh);
    showroom = new Showroom(fresh);
    shown = '';
    frameCar();
  };

  const car = () => current(garage.g);
  /** The car as shown: the saved one with any unsaved paint/tune edits. */
  const viewed = (): OwnedCar => {
    if (preview) return preview;
    const theirs = visiting() && friendCar(friendsView());
    if (theirs) return theirs;
    const c = draft ? { ...car(), look: draft.look, tune: draft.tune } : car();
    const pr = passReward();
    const pc = pr?.kind === 'cos' ? cosById(pr.id) : undefined;
    if (pc) return { ...c, cos: { ...c.cos, [pc.slot]: pc.id } };
    return trying ? { ...c, cos: { ...c.cos, [lockerSlot]: trying } } : c;
  };
  /** Your own driver wearing a pass metal or gear piece (the Battle pass page's preview, or Wear it). */
  const lookWith = (kind: 'metal' | 'gear', id: string): DriverLook => {
    const l = ownLook();
    return kind === 'metal' ? { ...l, metal: id as DriverLook['metal'] } : { ...l, gear: l.gear.includes(id as DriverLook['gear'][number]) ? l.gear : [...l.gear, id as DriverLook['gear'][number]] };
  };
  const viewedRider = (): Rider => {
    const f = visiting();
    if (f) return decodeRider(f.rider) ?? defaultRider();
    const pr = passReward();
    if (pr?.kind === 'metal' || pr?.kind === 'gear') return encodeLook(lookWith(pr.kind, pr.id));
    return riderDraft ?? garage.g.rider;
  };
  /** The showroom's stage: your home background, or the one being previewed. */
  const viewedStage = (): BgId | '' => {
    const pr = passReward();
    return pr?.kind === 'bg' ? pr.id : garage.g.bg;
  };

  const drawTop = () => {
    $(root, '[data-money]').textContent = money(garage.g.money);
    const chip = root.querySelector<HTMLElement>('[data-passchip]');
    if (chip) {
      chip.innerHTML = passChip(garage.g);
      chip.setAttribute('aria-label', `Battle pass, tier ${tierOf(garage.g.xp)} of ${PASS.tiers}`);
      chip.classList.toggle('on', page === 'pass');
    }
    const who = root.querySelector<HTMLElement>('[data-who]');
    if (who) who.innerHTML = account.user
      ? `${ICON.user}<span>${esc(account.user)}</span><small>${garage.g.wins} wins · Player card</small>`
      : `${ICON.user}<span>Guest</span><small>Your player card</small>`;
    who?.setAttribute('aria-label', 'Open your player card');
    const tab = tabOf(page);
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab.id));
      b.classList.toggle('on', b.dataset.tab === tab.id);
    });
    const sub = $(root, '[data-subtabs]');
    sub.hidden = tab.pages.length < 2;
    sub.innerHTML = tab.pages.map(([p, label]) => `<button role="tab" data-page="${p}" aria-selected="${p === page}" class="${p === page ? 'on' : ''}">${esc(label)}</button>`).join('');
    sub.querySelectorAll<HTMLElement>('[data-page]').forEach((b) => b.addEventListener('click', () => switchPage(b.dataset.page as Page)));
  };

  const drawCard = () => {
    const c = viewed();
    const sp = carSpec(c);
    const b = CARS[c.model];
    const st = stats(sp);
    const ribbon = preview
      ? `<p class="tg-card-ribbon">Dealer · ${b.price ? money(b.price) : 'Free'}</p>`
      : visiting()
        ? `<p class="tg-card-ribbon cyan">${esc(visiting()!.name)}'s garage</p>`
        : passReward()
          ? passRibbon(passSel)
          : trying
            ? `<p class="tg-card-ribbon cyan">Trying on · ${esc(cosById(trying)?.name ?? '')}</p>`
            : '';
    $(root, '[data-card]').innerHTML = `
      ${ribbon}
      <div class="tg-card-head"><div><small>${esc(b.maker)} · ${driveLabel(b)}</small><h2 class="tg-title">${esc(b.name)}</h2></div>${classBadge(c)}</div>
      ${statBar('Speed', st.speed)}${statBar('Handling', st.handling)}${statBar('Acceleration', st.acceleration)}${statBar('Launch', st.launch)}${statBar('Braking', st.braking)}
      <dl class="tg-specs">
        <div><dt>Power</dt><dd class="tg-num">${Math.round(peakPower(sp).kw * 1.341)}<small>hp</small></dd></div>
        <div><dt>Weight</dt><dd class="tg-num">${Math.round(sp.mass)}<small>kg</small></dd></div>
        <div><dt>Top speed</dt><dd class="tg-num">${Math.round(topSpeed(sp) * 3.6)}<small>km/h</small></dd></div>
      </dl>
      <p class="tg-card-hint">${ICON.spin} Drag or right stick to spin</p>`;
    $(root, '[data-stage-name]').innerHTML = `<small>${esc(b.maker)}</small>${esc(b.name)}`;
    showroom.showRider(viewedRider());
    const pr = passReward();
    const onRider = page === 'driver' || pr?.kind === 'metal' || pr?.kind === 'gear';
    showroom.focus(onRider ? 'rider' : 'car');
    showroom.stage(viewedStage());
    if (onRider) {
      $(root, '[data-card]').innerHTML = driverCard(viewedRider());
      $(root, '[data-stage-name]').innerHTML = `<small>Driver</small>${esc(riderInfo(viewedRider()).name)}`;
    }
    const key = JSON.stringify([c.model, c.look, c.cos, c.plate]);
    if (key !== shown) {
      shown = key;
      showroom.show(c);
    }
  };

  // --- page bodies -------------------------------------------------------------------------------

  const statusLine = () => `<p class="tg-status" role="status" data-status>${esc(status)}</p>`;

  const racePage = () => {
    const d = TRACK_DEFS[track];
    const prize = payout(1, rivals + 1, track, true);
    return `
    <section class="tg-hero" style="${trackStyle(track)}">
      <span class="tg-hero-art" aria-hidden="true"></span>
      <div class="tg-hero-map">${trackMap(track)}</div>
      <div class="tg-hero-copy">
        <small class="tg-eyebrow">${esc(trackKind(track))}</small>
        <h1 class="tg-display">${esc(d.name)}</h1>
        <p>${esc(d.tag)}</p>
      </div>
      <dl class="tg-hero-facts">
        <div><dt>Distance</dt><dd class="tg-num">${TRACK_LENGTH_KM[track]}<small>km</small></dd></div>
        <div><dt>Win pays</dt><dd class="tg-num gold">${money(prize)}</dd></div>
      </dl>
    </section>
    <div class="tg-launch">
      <div class="tg-seg" role="group" aria-label="Rivals">
        <span class="tg-label">Rivals</span>
        ${[0, 3, 5, 7].map((n) => `<button class="tg-pill" data-rivals="${n}" aria-pressed="${n === rivals}">${n}</button>`).join('')}
      </div>
      <div class="tg-seg" role="group" aria-label="${esc(PHYSICS.name)}" title="${esc(PHYSICS.on.blurb)}">
        <span class="tg-label">${esc(PHYSICS.name)}</span>
        ${[false, true].map((on) => `<button class="tg-pill" data-physics="${on ? 1 : 0}" aria-pressed="${on === physics}">${on ? 'On' : 'Off'}</button>`).join('')}
      </div>
      <button class="tg-go" data-solo data-autofocus>${ICON.flag}Race solo</button>
    </div>
    <p class="tg-blurb">${esc(d.blurb)}</p>
    <h2 class="tg-h">Tracks <small>${TRACK_IDS.length}</small></h2>
    <div class="tg-tracks">
      ${TRACK_IDS.map((id) => trackTile(id, `data-track="${id}" aria-pressed="${id === track}" aria-label="${esc(TRACK_DEFS[id].name)}"`)).join('')}
    </div>
    <h2 class="tg-h">Grand Prix <small>4 tracks back to back · ${GP_POINTS.slice(0, 3).join('-')}… points · pick a cup to start</small></h2>
    <div class="tg-cups">
      ${CUP_IDS.map((id) => cupCard(id, `data-gp="${id}" aria-label="Race the ${esc(CUPS[id].name)}"`)).join('')}
    </div>
    <h2 class="tg-h">Online <small>up to 8 racers</small></h2>
    <div class="tg-online tg-cardbox">
      <div class="tg-online-row">
        <button class="tg-go alt" data-host>Host a race</button>
        <span class="tg-or">or</span>
        <label class="tg-code"><span class="sr-only">Race code</span><input data-code maxlength="4" placeholder="CODE" autocomplete="off" spellcheck="false" /></label>
        <button class="tg-pill" data-join>Join</button>
      </div>
      <ul class="tg-lobbies" data-lobbies><li class="muted">Looking for open races…</li></ul>
    </div>
    ${statusLine()}`;
  };

  const garagePage = () => {
    const g = garage.g;
    const rate = g.races ? Math.round((g.wins / g.races) * 100) : 0;
    return `
    <dl class="tg-profile">
      <div><dt>Races</dt><dd class="tg-num">${g.races}</dd></div>
      <div><dt>Wins</dt><dd class="tg-num">${g.wins}</dd></div>
      <div><dt>Win rate</dt><dd class="tg-num">${rate}<small>%</small></dd></div>
      <div><dt>Cosmetics</dt><dd class="tg-num">${g.cos.length}<small>/${COS_ITEMS.length}</small></dd></div>
    </dl>
    <h2 class="tg-h">Your cars <small>${g.cars.length} owned</small></h2>
    <div class="tg-cars">
      ${g.cars
        .map((c, i) => {
          const b = CARS[c.model];
          const levels = PARTS.reduce((a, p) => a + c.up[p], 0);
          const sel = i === g.sel;
          return `<div class="tg-owned tg-cardbox ${sel ? 'on' : ''}" style="--paint:${hex(PAINTS[c.look.paint])}">
            <div class="tg-owned-name"><small>${esc(b.maker)}</small><b>${esc(b.name)}</b></div>
            ${classBadge(c)}
            <div class="tg-owned-meta"><span>${driveLabel(b)}</span><span class="tg-up" style="--v:${levels / (PARTS.length * MAX_LEVEL)}"><i></i>${levels}/${PARTS.length * MAX_LEVEL} upgrades</span></div>
            <div class="tg-owned-act">
              ${sel ? '<span class="tg-tag">Driving</span>' : `<button class="tg-pill" data-select="${i}" ${i === 0 && !sel ? 'data-autofocus' : ''}>Drive</button>`}
              ${g.cars.length > 1 ? `<button class="tg-pill danger" data-sell="${i}">Sell ${money(b.price * 0.5)}</button>` : ''}
            </div>
          </div>`;
        })
        .join('')}
    </div>
    <p class="tg-muted">Want more? Buy cars in the <button class="tg-link" data-goto="dealer">Dealer</button>.</p>
    ${statusLine()}`;
  };

  const dealerPage = () => `
    <p class="tg-lede">New cars come stock. Win upgrade crates to build them up.</p>
    <div class="tg-dealer">
      ${CAR_IDS.map((id, n) => {
        const b = CARS[id];
        const stock = newOwnedCar(id);
        const st = stats(carSpec(stock));
        const owned = garage.g.cars.filter((c) => c.model === id).length;
        const looking = preview?.model === id;
        return `<div class="tg-deal tg-cardbox ${looking ? 'on' : ''}">
          <div class="tg-deal-head"><div><small>${esc(b.maker)} · ${driveLabel(b)}</small><b class="tg-title">${esc(b.name)}</b></div>${classBadge(stock)}</div>
          <p>${esc(b.blurb)}</p>
          <div class="tg-deal-stats">${statBar('Speed', st.speed)}${statBar('Handling', st.handling)}${statBar('Accel', st.acceleration)}</div>
          <div class="tg-deal-foot">
            <span class="tg-price tg-num">${b.price ? money(b.price) : 'Free'}</span>
            ${owned ? `<span class="tg-tag">Owned ×${owned}</span>` : ''}
            <button class="tg-pill" data-preview="${id}" aria-pressed="${looking}" ${n === 0 ? 'data-autofocus' : ''}>View</button>
            <button class="tg-go small" data-buy="${id}" ${garage.g.money < b.price ? 'disabled' : ''}>Buy</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    ${statusLine()}`;

  const upgradesPage = () => {
    const c = car();
    const total = PARTS.reduce((a, p) => a + c.up[p], 0);
    return `
      <p class="tg-lede">Upgrading your <b>${esc(CARS[c.model].name)}</b> · ${total}/${PARTS.length * MAX_LEVEL} levels</p>
      <button class="tg-crate tg-cardbox" data-crate="mystery" data-autofocus ${garage.g.money < MYSTERY_COST ? 'disabled' : ''}>
        <span class="tg-crate-box" aria-hidden="true">?</span>
        <span class="tg-crate-copy"><small class="tg-eyebrow">The gamble</small><b class="tg-title">${esc(CRATES.mystery.name)}</b><small>${esc(CRATES.mystery.blurb)}</small></span>
        <span class="tg-crate-price tg-num">${money(MYSTERY_COST)}</span>
      </button>
      <h2 class="tg-h">Parts <small>${esc(CRATES.tuner.blurb)}</small></h2>
      <div class="tg-parts">
        ${PARTS.map((p) => {
          const lvl = c.up[p];
          const cost = tunerCost(lvl);
          const maxed = lvl >= MAX_LEVEL;
          return `<div class="tg-part">
            <span class="tg-part-icon" aria-hidden="true">${PART_INFO[p].icon}</span>
            <div><b>${PART_INFO[p].name}</b><small>${esc(PART_INFO[p].effect)}</small></div>
            <span class="tg-pips" aria-label="Level ${lvl} of ${MAX_LEVEL}">${Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</span>
            <button class="tg-pill" data-crate="tuner" data-part="${p}" ${maxed || garage.g.money < cost ? 'disabled' : ''}>${maxed ? 'Maxed' : money(cost)}</button>
          </div>`;
        }).join('')}
      </div>
      ${statusLine()}`;
  };

  const tuneText = (k: keyof Tune, val: number) => (k === 'ride' ? `${val > 0 ? '+' : ''}${Math.round(val * 100)} cm` : k === 'bias' ? `${Math.round(val * 100)}% front` : k === 'diff' ? `${Math.round(val * 100)}%` : `×${val.toFixed(2)}`);

  const tuningPage = () => {
    const v = viewed();
    const sliders = (Object.keys(TUNE_RANGE) as (keyof Tune)[])
      .map((k, i) => {
        const r = TUNE_RANGE[k];
        const val = v.tune[k];
        return `<label class="tg-slider"><span>${esc(r.label)}</span><input type="range" data-tune="${k}" min="${r.min}" max="${r.max}" step="${r.step}" value="${val}" ${i === 0 ? 'data-autofocus' : ''} /><output class="tg-num">${tuneText(k, val)}</output></label>`;
      })
      .join('');
    return `
      <p class="tg-lede">Set up your <b>${esc(CARS[car().model].name)}</b>. Changes save as you go; the card shows the effect.</p>
      <div class="tg-sliders tg-cardbox">${sliders}</div>
      <p class="tg-muted">A wing (Style → Paint → Spoiler) adds downforce, and drag.</p>
      ${statusLine()}`;
  };

  const paintPage = () => {
    const L = viewed().look;
    const swatches = (key: keyof Look, colors: number[], names: string[]) =>
      colors.map((col, i) => `<button class="tg-sw" data-look="${key}" data-v="${i}" aria-pressed="${L[key] === i}" title="${esc(names[i])}" aria-label="${esc(names[i])}" style="--sw:${hex(col)}"></button>`).join('');
    const pills = (key: keyof Look, labels: readonly string[]) => `<div class="tg-seg">${labels.map((l, i) => `<button class="tg-pill" data-look="${key}" data-v="${i}" aria-pressed="${L[key] === i}">${esc(l)}</button>`).join('')}</div>`;
    return `
      <p class="tg-lede">Free to change, any time. Rarer looks live in the <button class="tg-link" data-goto="locker">Locker</button>.</p>
      <div class="tg-group tg-cardbox">
        <h2 class="tg-h">Paint <small>${esc(PAINT_NAMES[L.paint])}</small></h2>
        <div class="tg-swatches">${swatches('paint', PAINTS, PAINT_NAMES)}</div>
        ${pills('finish', FINISHES)}
      </div>
      <div class="tg-group tg-cardbox">
        <h2 class="tg-h">Wheels</h2>
        ${pills('rims', RIMS)}
        <div class="tg-swatches">${swatches('rimColor', RIM_COLORS, RIM_COLOR_NAMES)}</div>
      </div>
      <div class="tg-group tg-cardbox">
        <h2 class="tg-h">Body</h2>
        ${isBike(viewed().model) ? '' : `<div class="tg-field"><span class="tg-label">Spoiler</span>${pills('spoiler', SPOILERS)}</div>
        <div class="tg-field"><span class="tg-label">Front lip</span>${pills('lip', LIPS)}</div>
        <div class="tg-field"><span class="tg-label">Hood</span>${pills('hood', HOODS)}</div>
        <div class="tg-field"><span class="tg-label">Roof</span>${pills('roof', ROOFS)}</div>`}
        <div class="tg-field"><span class="tg-label">Stripes</span>${pills('stripe', STRIPES)}</div>
        ${L.stripe ? `<div class="tg-swatches">${swatches('stripeColor', PAINTS, PAINT_NAMES)}</div>` : ''}
        <div class="tg-field"><span class="tg-label">Underglow</span></div>
        <div class="tg-swatches">${swatches('glow', GLOWS, GLOW_NAMES)}</div>
      </div>
      ${isBike(viewed().model) ? '' : `<div class="tg-group tg-cardbox">
        <h2 class="tg-h">Glass and trim</h2>
        <div class="tg-field"><span class="tg-label">Window tint</span>${pills('tint', TINTS)}</div>
        <div class="tg-field"><span class="tg-label">Trim</span>${pills('trim', TRIMS)}</div>
        <div class="tg-field"><span class="tg-label">Mirrors</span>${pills('mirrors', MIRRORS)}</div>
      </div>`}
      ${statusLine()}`;
  };

  const lockerPage = () => lockerTab(garage.g, car(), CARS[car().model].name, lockerSlot, trying, status);
  const casesPage = () => casesTab(garage.g, status);
  const driverPage = () => driverTab(viewedRider(), ownLook(), garage.g, status);
  const passPage = () => passTab({ g: garage.g, sel: passSel, car: CARS[car().model].name, status });
  const settingsPage = () => settingsTab(graphics(), status);
  const leaderboardPage = () => {
    if (account.user && !friendList) void loadFriends();
    return leaderboardTab({
      track: lbTrack,
      leaders,
      rows: boards.get(lbTrack) ?? null,
      user: account.user,
      friends: new Set(friendList?.friends.map((n) => n.toLowerCase())),
      mine: garage.bests[lbTrack],
      failed: lbFailed,
      status,
    });
  };
  const friendsPage = () => {
    if (account.user && !friendList) void loadFriends();
    return friendsTab(friendsView(), classBadge);
  };
  const BODIES: Record<Page, () => string> = { race: racePage, leaderboard: leaderboardPage, pass: passPage, garage: garagePage, dealer: dealerPage, upgrades: upgradesPage, tuning: tuningPage, paint: paintPage, locker: lockerPage, cases: casesPage, driver: driverPage, friends: friendsPage, settings: settingsPage };

  // --- drawing and wiring ----------------------------------------------------------------------

  const draw = (keepFocus = true) => {
    const focusKey = keepFocus ? focusId(document.activeElement) : null;
    drawTop();
    const panel = $(root, '[data-panel]');
    panel.dataset.page = page;
    panel.innerHTML = BODIES[page]();
    wire(panel);
    drawCard();
    const again = focusKey && panel.querySelector<HTMLElement>(focusKey);
    if (again) again.focus({ preventScroll: true });
    if (page === 'race') void refreshLobbies();
  };

  /** Fetches every track's record and `t`'s board (fresh each time the page opens or the track changes). */
  const loadBoard = async (t: TrackId) => {
    const [l, rows] = await Promise.all([boardApi.leaders(), boardApi.board(t)]);
    lbFailed = !l || !rows;
    if (l) leaders = l;
    if (rows) boards.set(t, rows);
    if (page === 'leaderboard') draw();
  };

  const setStatus = (text: string) => {
    status = text;
    const el = root.querySelector('[data-status]');
    if (el) el.textContent = text;
  };

  let enterTimer = 0;
  const switchPage = (p: Page) => {
    if (p === page) return;
    flushDraft();
    preview = null;
    trying = null;
    page = p;
    lastPage[tabOf(p).id] = p;
    status = '';
    if (pit) pitPage = p;
    else history.replaceState({ ...(history.state ?? {}), dtab: p }, '');
    if (p === 'leaderboard') void loadBoard(lbTrack);
    const panel = $(root, '[data-panel]');
    draw(false);
    panel.scrollTop = 0;
    panel.classList.remove('enter');
    void panel.offsetWidth; // restart the slide-in
    panel.classList.add('enter');
    // Only the page switch slides in: left on, the class replayed it on every redraw (a garage change, a save).
    clearTimeout(enterTimer);
    enterTimer = window.setTimeout(() => panel.classList.remove('enter'), ENTER_MS);
    root.querySelector<HTMLElement>('[data-panel] [data-autofocus], [data-panel] button:not([disabled]), [data-panel] input')?.focus({ preventScroll: true });
  };

  const wire = (panel: HTMLElement) => {
    panel.querySelectorAll<HTMLElement>('[data-goto]').forEach((b) => b.addEventListener('click', () => switchPage(b.dataset.goto as Page)));
    panel.querySelectorAll<HTMLElement>('[data-track]').forEach((b) =>
      b.addEventListener('click', () => {
        track = b.dataset.track as TrackId;
        write(TRACK_KEY, track);
        draw();
      }),
    );
    panel.querySelectorAll<HTMLElement>('[data-rivals]').forEach((b) =>
      b.addEventListener('click', () => {
        rivals = Number(b.dataset.rivals);
        write(RIVALS_KEY, String(rivals));
        draw();
      }),
    );
    panel.querySelectorAll<HTMLElement>('[data-physics]').forEach((b) =>
      b.addEventListener('click', () => {
        physics = b.dataset.physics === '1';
        write(PHYSICS_KEY, physics ? '1' : '0');
        draw();
      }),
    );
    panel.querySelector('[data-solo]')?.addEventListener('click', () => ctx.drive({ track, rivals, physics }));
    // A solo Grand Prix: the cup's first round, against your rivals (at least three: a cup needs a field).
    panel.querySelectorAll<HTMLElement>('[data-gp]').forEach((b) =>
      b.addEventListener('click', () => {
        const cup = b.dataset.gp as CupId;
        ctx.drive({ track: CUPS[cup].tracks[0], rivals: Math.max(3, rivals), physics, gp: { cup, round: 0, table: [] } });
      }),
    );
    panel.querySelectorAll<HTMLElement>('[data-lb-track]').forEach((b) =>
      b.addEventListener('click', () => {
        lbTrack = b.dataset.lbTrack as TrackId;
        draw();
        void loadBoard(lbTrack);
      }),
    );
    panel.querySelector<HTMLElement>('[data-lb-race]')?.addEventListener('click', (e) => {
      track = (e.currentTarget as HTMLElement).dataset.lbRace as TrackId;
      write(TRACK_KEY, track);
      switchPage('race');
    });
    panel.querySelector('[data-host]')?.addEventListener('click', () => connect(null));
    const code = panel.querySelector<HTMLInputElement>('[data-code]');
    code?.addEventListener('input', () => (code.value = code.value.toUpperCase().replace(/[^A-Z]/g, '')));
    code?.addEventListener('keydown', (e) => e.key === 'Enter' && connect(code.value));
    panel.querySelector('[data-join]')?.addEventListener('click', () => connect(code?.value ?? ''));
    panel.querySelectorAll<HTMLElement>('[data-select]').forEach((b) => b.addEventListener('click', () => void act({ a: 'select', i: Number(b.dataset.select) })));
    panel.querySelectorAll<HTMLButtonElement>('[data-sell]').forEach((b) =>
      b.addEventListener('click', () => {
        // Two presses: the first asks.
        if (!b.dataset.sure) {
          b.dataset.sure = '1';
          b.textContent = 'Sure? Press again';
          return;
        }
        void act({ a: 'sell', i: Number(b.dataset.sell) }).then((r) => r && setStatus(`Sold for ${money(r)}`));
      }),
    );
    panel.querySelectorAll<HTMLElement>('[data-crate]').forEach((b) => b.addEventListener('click', () => void crate(b.dataset.crate as 'mystery' | 'tuner', b.dataset.part as Part | undefined)));
    panel.querySelectorAll<HTMLElement>('[data-look]').forEach((b) =>
      b.addEventListener('click', () => {
        const d = (draft ??= { look: { ...car().look }, tune: { ...car().tune } });
        d.look[b.dataset.look as keyof Look] = Number(b.dataset.v);
        scheduleSave();
        draw();
      }),
    );
    panel.querySelectorAll<HTMLInputElement>('[data-tune]').forEach((inp) =>
      inp.addEventListener('input', () => {
        const d = (draft ??= { look: { ...car().look }, tune: { ...car().tune } });
        const k = inp.dataset.tune as keyof Tune;
        d.tune[k] = Number(inp.value);
        scheduleSave();
        // Just the readout and the card; redrawing the slider would drop the drag.
        (inp.nextElementSibling as HTMLOutputElement).textContent = tuneText(k, Number(inp.value));
        drawCard();
      }),
    );
    panel.querySelectorAll<HTMLElement>('[data-preview]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.preview as (typeof CAR_IDS)[number];
        preview = preview?.model === id ? null : newOwnedCar(id, 0);
        draw();
      }),
    );
    panel.querySelectorAll<HTMLElement>('[data-graphics]').forEach((b) =>
      b.addEventListener('click', () => {
        const g = b.dataset.graphics as Graphics;
        if (g === graphics()) return;
        setGraphics(g);
        rebuildShowroom();
        status = g === 'low' ? 'Low graphics on. Your next race uses it too.' : 'High graphics on. Your next race uses it too.';
        draw();
      }),
    );
    // Your driver: a pick shows at once and saves a moment later.
    const setRider = (r: Rider) => {
      riderDraft = r;
      clearTimeout(riderTimer);
      riderTimer = window.setTimeout(flushRider, 700);
      draw();
    };
    panel.querySelectorAll<HTMLElement>('[data-rider]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = b.dataset.rider === 'own' ? encodeLook(ownLook()) : b.dataset.rider;
        if (isRider(r)) setRider(r);
      }),
    );
    // The creator: buttons redraw the page; a colour picker shows on the platform while it's dragged (no redraw, so
    // it stays open) and redraws when closed.
    const wear = (l: DriverLook, redraw: boolean) => {
      lookDraft = l;
      if (redraw) return setRider(encodeLook(l));
      riderDraft = encodeLook(l);
      clearTimeout(riderTimer);
      riderTimer = window.setTimeout(flushRider, 700);
      clearTimeout(lookShow);
      lookShow = window.setTimeout(() => showroom.showRider(viewedRider()), 150);
    };
    panel.querySelectorAll<HTMLElement>('button[data-dl], [data-dl-random]').forEach((b) =>
      b.addEventListener('click', () => {
        const l = lookAfter(ownLook(), b);
        if (l) wear(l, true);
      }),
    );
    panel.querySelectorAll<HTMLInputElement>('input[data-dl]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const l = lookAfter(ownLook(), inp);
        if (!l) return;
        inp.parentElement!.style.setProperty('--sw', inp.value);
        wear(l, false);
      });
      inp.addEventListener('change', () => draw());
    });
    // Cosmetics: cases and the locker.
    if (page === 'cases') wireCases(panel, garage.g);
    panel.querySelectorAll<HTMLElement>('[data-case-open]').forEach((b) => b.addEventListener('click', () => void openCase(b.dataset.caseOpen as CaseId)));
    panel.querySelectorAll<HTMLElement>('[data-slot]').forEach((b) =>
      b.addEventListener('click', () => {
        lockerSlot = COS_SLOTS.includes(b.dataset.slot as CosSlot) ? (b.dataset.slot as CosSlot) : 'paint';
        trying = null;
        status = '';
        draw();
      }),
    );
    panel.querySelectorAll<HTMLElement>('[data-cos]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.cos!;
        if (!garage.g.cos.includes(id)) {
          // Not owned: try it on in the showroom (click again to take it off).
          trying = trying === id ? null : id;
          draw();
          return;
        }
        trying = null;
        void act({ a: 'equip', i: garage.g.sel, slot: lockerSlot, id }).then((r) => r !== null && setStatus(`Equipped ${cosById(id)?.name ?? ''}.`));
      }),
    );
    panel.querySelector('[data-unequip]')?.addEventListener('click', () => void act({ a: 'equip', i: garage.g.sel, slot: lockerSlot, id: null }));
    const plateIn = panel.querySelector<HTMLInputElement>('[data-plate-text]');
    if (plateIn) {
      plateIn.value = car().plate;
      plateIn.addEventListener('input', () => (plateIn.value = plateIn.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '')));
      const save = () => void act({ a: 'plate', i: garage.g.sel, text: plateIn.value }).then((r) => r !== null && setStatus(car().plate ? `Plate: ${car().plate}` : 'Stock plate.'));
      plateIn.addEventListener('keydown', (e) => e.key === 'Enter' && save());
      panel.querySelector('[data-plate-save]')?.addEventListener('click', save);
    }
    // Friends: add (the form, or "Add back"), remove (two presses), open a garage, pick one of their cars.
    panel.querySelector('[data-friends-signin]')?.addEventListener('click', () => ctx.go({ name: 'account' }));
    panel.querySelector<HTMLFormElement>('[data-friend-form]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = panel.querySelector<HTMLInputElement>('[data-friend-name]')!.value.trim();
      if (name) void friendAct('add', name);
    });
    panel.querySelectorAll<HTMLElement>('[data-friend-add]').forEach((b) => b.addEventListener('click', () => void friendAct('add', b.dataset.friendAdd!)));
    panel.querySelectorAll<HTMLButtonElement>('[data-friend-remove]').forEach((b) =>
      b.addEventListener('click', () => {
        if (!b.dataset.sure) {
          b.dataset.sure = '1';
          b.textContent = 'Sure? Press again';
          return;
        }
        void friendAct('remove', b.dataset.friendRemove!);
      }),
    );
    panel.querySelectorAll<HTMLElement>('[data-friend-open]').forEach((b) => b.addEventListener('click', () => void openFriend(b.dataset.friendOpen!)));
    panel.querySelectorAll<HTMLElement>('[data-friend-car]').forEach((b) =>
      b.addEventListener('click', () => {
        friendCarI = Number(b.dataset.friendCar);
        draw();
      }),
    );
    panel.querySelector('[data-friend-close]')?.addEventListener('click', () => {
      friendOpen = null;
      status = '';
      draw(false);
      root.querySelector<HTMLElement>('[data-panel] [data-autofocus]')?.focus({ preventScroll: true });
    });
    // Battle pass: pick a tier (previews it), buy the pass, use what it's unlocked.
    panel.querySelectorAll<HTMLElement>('[data-pass-tier]').forEach((b) =>
      b.addEventListener('click', () => {
        passSel = Number(b.dataset.passTier);
        status = '';
        draw();
      }),
    );
    panel.querySelector('[data-pass-buy]')?.addEventListener('click', () => {
      const reached = tierOf(garage.g.xp);
      void act({ a: 'pass' }).then((r) => r !== null && setStatus(reached ? `The pass is yours. Tiers 1-${reached} unlocked.` : 'The pass is yours. Race to unlock tier 1.'));
    });
    panel.querySelectorAll<HTMLElement>('[data-pass-equip]').forEach((b) =>
      b.addEventListener('click', () => {
        const it = cosById(b.dataset.passEquip);
        if (it) void act({ a: 'equip', i: garage.g.sel, slot: it.slot, id: it.id }).then((r) => r !== null && setStatus(`Equipped ${it.name}.`));
      }),
    );
    panel.querySelectorAll<HTMLElement>('[data-pass-bg]').forEach((b) =>
      b.addEventListener('click', () => void act({ a: 'bg', id: (b.dataset.passBg ?? '') as BgId | '' }).then((r) => r !== null && setStatus(garage.g.bg ? 'Home background set.' : 'Back in the garage bay.'))),
    );
    panel.querySelectorAll<HTMLElement>('[data-pass-title]').forEach((b) =>
      b.addEventListener('click', () => void act({ a: 'title', id: (b.dataset.passTitle ?? '') as TitleId | '' }).then((r) => r !== null && setStatus(garage.g.title ? 'Title on your player card.' : 'Title taken off.'))),
    );
    panel.querySelectorAll<HTMLElement>('[data-pass-wear]').forEach((b) =>
      b.addEventListener('click', () => {
        const [kind, id] = (b.dataset.passWear ?? '').split(':') as ['metal' | 'gear', string];
        const code = encodeLook(lookWith(kind, id));
        void act({ a: 'rider', rider: code, look: code }).then((r) => r !== null && setStatus('Your driver is wearing it.'));
      }),
    );
    panel.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.buy as (typeof CAR_IDS)[number];
        void act({ a: 'buy', model: id, paint: Math.floor(Math.random() * PAINTS.length) }).then((r) => r !== null && setStatus(`The ${CARS[id].name} is yours. It's in My cars.`));
      }),
    );
  };

  const act = async (action: Parameters<typeof garage.act>[0]): Promise<number | null> => {
    if (busy) return null;
    busy = true;
    flushDraft();
    const r = await garage.act(action);
    busy = false;
    if (!r.ok) setStatus(r.error);
    return r.ok ? (r.paid ?? 0) : null;
  };

  const loadFriends = async () => {
    if (friendsLoading) return;
    friendsLoading = true;
    const list = await friendsApi.list();
    friendsLoading = false;
    friendList = list ?? { friends: [], mutual: [], fans: [] };
    if (!list) status = 'Could not load your friends.';
    if (page === 'friends' || page === 'leaderboard') draw();
  };
  const friendAct = async (a: 'add' | 'remove', name: string) => {
    if (busy) return;
    busy = true;
    const r = await friendsApi.act(a, name);
    busy = false;
    if (!r.ok) return setStatus(r.error);
    friendList = r.list;
    const added = r.list.friends.find((n) => n.toLowerCase() === name.toLowerCase());
    status = a === 'add' ? `${added ?? name} is on your list.` : `Removed ${name}.`;
    if (page === 'friends') draw(false);
  };
  const openFriend = async (name: string) => {
    if (busy) return;
    busy = true;
    setStatus(`Opening ${name}'s garage…`);
    const p = await friendsApi.profile(name);
    busy = false;
    if (!p) return setStatus(`Could not open ${name}'s garage.`);
    friendOpen = p;
    friendCarI = p.sel;
    status = '';
    if (page !== 'friends') return;
    draw(false);
    $(root, '[data-panel]').scrollTop = 0;
    root.querySelector<HTMLElement>('[data-panel] [data-autofocus]')?.focus({ preventScroll: true });
  };

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flushDraft, 700);
  };
  const flushRider = () => {
    clearTimeout(riderTimer);
    if (!riderDraft) return;
    const r = riderDraft;
    const l = lookDraft;
    void garage.act({ a: 'rider', rider: r, ...(l ? { look: encodeLook(l) } : {}) }).then(() => {
      if (riderDraft === r) riderDraft = null;
      if (lookDraft === l) lookDraft = null;
    });
  };
  const flushDraft = () => {
    flushRider();
    clearTimeout(saveTimer);
    if (!draft) return;
    const d = draft;
    draft = null;
    void garage.act({ a: 'style', i: garage.g.sel, look: d.look, tune: d.tune });
  };

  // --- the crate reel ----------------------------------------------------------------------------

  const crate = async (kind: 'mystery' | 'tuner', part?: Part) => {
    if (busy) return;
    busy = true;
    flushDraft();
    const r = await garage.act({ a: 'crate', kind, part });
    busy = false;
    if (!r.ok) return setStatus(r.error);
    showReel(r.crate!);
  };

  const label = (res: CrateResult) =>
    res.kind === 'up' ? { icon: PART_INFO[res.part].icon, text: `${PART_INFO[res.part].name} +${res.levels}`, tone: res.levels > 1 ? 'gold' : 'blue' } : { icon: '★', text: 'JACKPOT: +1 everything', tone: 'gold' };

  const showReel = (res: CrateResult) => {
    const modal = $(root, '[data-modal]');
    const filler: CrateResult[] = [];
    for (let i = 0; i < 46; i++) {
      const r = Math.random();
      filler.push(r < 0.94 ? { kind: 'up', part: PARTS[Math.floor(Math.random() * PARTS.length)], levels: Math.random() < 0.2 ? 2 : 1 } : { kind: 'jackpot', parts: [] });
    }
    const WIN = 40;
    filler[WIN] = res;
    const tiles = filler.map((f) => {
      const l = label(f);
      return `<div class="tg-reel-tile ${l.tone}"><span>${l.icon}</span><small>${esc(l.text)}</small></div>`;
    });
    const won = label(res);
    modal.innerHTML = `<div class="tg-reel-card" data-nav-scope>
      <h2>Opening crate…</h2>
      <div class="tg-reel"><div class="tg-reel-strip">${tiles.join('')}</div><i class="tg-reel-mark"></i></div>
      <p class="tg-reel-result" aria-live="polite"></p>
      <button class="tg-go" data-ok hidden>OK</button></div>`;
    modal.hidden = false;
    const strip = $(modal, '.tg-reel-strip');
    const reel = $(modal, '.tg-reel');
    const tileW = 132;
    const target = WIN * tileW + tileW / 2 - reel.clientWidth / 2 + (Math.random() - 0.5) * (tileW * 0.6);
    strip.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-target}px)` }], { duration: 4200, easing: 'cubic-bezier(0.12, 0.7, 0.12, 1)', fill: 'forwards' }).finished.then(() => {
      $(modal, '.tg-reel-result').innerHTML = `<b class="${won.tone}">${won.icon} ${esc(won.text)}</b>`;
      $(modal, 'h2').textContent = res.kind === 'jackpot' ? 'JACKPOT!' : 'Upgrade';
      const ok = $<HTMLButtonElement>(modal, '[data-ok]');
      ok.hidden = false;
      ok.focus();
      ok.addEventListener('click', closeReel);
    });
  };
  // --- cosmetic cases ----------------------------------------------------------------------------

  /** Pays and rolls (the server's roll for an account), then spins the reel to the drop. */
  const openCase = async (id: CaseId) => {
    const box = cosCaseById(id);
    if (busy || !box) return;
    busy = true;
    flushDraft();
    const r = await garage.act({ a: 'case', id });
    busy = false;
    if (!r.ok) return setStatus(r.error);
    if (!r.drop) return;
    const drop = r.drop;
    showCaseReel($(root, '[data-modal]'), box, drop, garage.g.money >= box.price, (what) => {
      if (what === 'again') return void openCase(id);
      if (what === 'equip') {
        const item = cosById(drop.id);
        if (item) {
          lockerSlot = item.slot;
          void garage.act({ a: 'equip', i: garage.g.sel, slot: item.slot, id: item.id });
        }
      }
      closeReel();
    });
  };

  const closeModal = () => {
    const modal = $(root, '[data-modal]');
    modal.hidden = true;
    modal.innerHTML = '';
    draw(false);
  };
  const closeReel = () => {
    closeModal();
    root.querySelector<HTMLElement>('[data-crate="mystery"], [data-case-open]')?.focus();
  };

  // --- online ------------------------------------------------------------------------------------

  let offNet: (() => void) | null = null;
  const connect = (code: string | null) => {
    if (code !== null && !/^[A-Z]{4}$/.test(code)) return setStatus('Codes are four letters.');
    flushDraft();
    setStatus(code ? `Joining ${code}…` : 'Opening a race…');
    offNet?.();
    offNet = raceNet.on((m) => {
      if (m.t === 'room') {
        offNet?.();
        offNet = null;
        ctx.go({ name: 'drivelobby' });
      } else if (m.t === 'error') {
        offNet?.();
        offNet = null;
        setStatus(m.message);
      }
    });
    const enc = encodeCar(car());
    const rider = encodeRider(viewedRider());
    if (code) raceNet.join(playerName(), enc, rider, code);
    else raceNet.host(playerName(), enc, rider);
  };

  const refreshLobbies = async () => {
    clearTimeout(listTimer);
    const list = root.querySelector('[data-lobbies]');
    if (!list || page !== 'race') return;
    try {
      const lobbies = await raceNet.lobbies();
      if (!root.querySelector('[data-lobbies]')) return;
      list.innerHTML = lobbies.length
        ? lobbies
            .map((l) => `<li><b>${esc(l.code)}</b><span>${esc(l.host)}'s ${l.mode === 'trial' ? 'time trial' : l.mode === 'climb' ? 'hill climb' : l.mode === 'roam' ? 'free roam' : l.mode === 'gp' ? `Grand Prix (${esc(CUPS[l.cup ?? 'torii']?.name ?? 'cup')})` : 'race'}${l.physics ? ' · physics' : ''} · ${esc(TRACK_DEFS[l.track]?.name ?? '')} · ${l.players}/${l.max}${l.phase === 'lobby' ? '' : l.mode === 'roam' ? ' · driving, drop in' : ' · racing'}</span><button class="tg-pill" data-joincode="${esc(l.code)}" ${l.players >= l.max ? 'disabled' : ''}>${l.players >= l.max ? 'Full' : 'Join'}</button></li>`)
            .join('')
        : `<li class="muted">No open races right now. Host one and share the code.</li>`;
      list.querySelectorAll<HTMLElement>('[data-joincode]').forEach((b) => b.addEventListener('click', () => connect(b.dataset.joincode!)));
    } catch {
      list.innerHTML = `<li class="muted">Can't reach the game server${import.meta.env.DEV ? ' (is <code>npm run dev</code> running?)' : ''}. Solo races still work.</li>`;
    }
    listTimer = window.setTimeout(() => void refreshLobbies(), 3000);
  };

  // --- events ------------------------------------------------------------------------------------

  root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => switchPage(lastPage[b.dataset.tab as TabId])));
  $(root, '[data-home]').addEventListener('click', () => (pit ? pit.close() : ctx.go({ name: 'games' })));
  // Your name top right: your player card (Account is a button on it).
  const showCard = () => {
    if (busy) return;
    flushDraft();
    const name = account.user ?? playerName();
    openPlayerCard($(root, '[data-modal]'), cardData(garage.g, garage.bests, name, !account.user, viewedRider()), {
      close: () => {
        closeModal();
        root.querySelector<HTMLElement>('[data-who]')?.focus();
      },
      account: () => ctx.go({ name: 'account' }),
    });
  };
  root.querySelector('[data-who]')?.addEventListener('click', showCard);
  root.querySelector('[data-passchip]')?.addEventListener('click', () => switchPage('pass'));
  const onPadTab = (e: Event) => {
    if (!root.querySelector<HTMLElement>('[data-modal]')!.hidden) return;
    const i = pages.indexOf(page);
    switchPage(pages[(i + (e as CustomEvent<number>).detail + pages.length) % pages.length]);
  };
  addEventListener('padtab', onPadTab);
  // Start: the Race page's main action.
  const onPadStart = () => {
    if (root.querySelector<HTMLElement>('[data-modal]')!.hidden && page === 'race') root.querySelector<HTMLElement>('[data-solo]')?.click();
  };
  addEventListener('padstart', onPadStart);
  // Esc / B closes the crate reel before it backs out of the screen.
  const onKey = (e: KeyboardEvent) => {
    const modal = root.querySelector<HTMLElement>('[data-modal]')!;
    if (e.key === 'Escape' && !modal.hidden) {
      e.stopImmediatePropagation();
      if (modal.querySelector<HTMLElement>('[data-ok]:not([hidden])')) closeReel();
      else modal.querySelector<HTMLElement>('[data-pcard-close]')?.click();
    } else if (e.key === 'Escape' && pit) {
      // In the lobby's garage Back returns to the lobby, not out of it.
      e.stopImmediatePropagation();
      pit.close();
    }
  };
  addEventListener('keydown', onKey, true);
  const offGarage = garage.onChange(() => {
    if (root.querySelector<HTMLElement>('[data-modal]')!.hidden) draw();
    else drawTop();
  });
  const offAccount = account.onChange(() => {
    friendList = null;
    friendOpen = null;
    if (page === 'friends' || page === 'leaderboard') draw();
    else drawTop();
  });
  void garage.refresh();
  if (page === 'leaderboard') void loadBoard(lbTrack);
  draw(false);
  frameCar();
  root.querySelector<HTMLElement>('[data-panel] [data-autofocus]')?.focus({ preventScroll: true });

  return () => {
    flushDraft();
    clearTimeout(listTimer);
    clearTimeout(enterTimer);
    offNet?.();
    offGarage();
    offAccount();
    ro.disconnect();
    removeEventListener('padtab', onPadTab);
    removeEventListener('padstart', onPadStart);
    removeEventListener('keydown', onKey, true);
    showroom.dispose();
  };
}

/** A selector that finds "the same control" after a redraw, so focus survives it. */
function focusId(el: Element | null): string | null {
  if (!(el instanceof HTMLElement) || !el.closest('[data-panel]')) return null;
  const look = el.getAttribute('data-look');
  if (look) return `[data-look="${look}"][data-v="${el.getAttribute('data-v')}"]`;
  const rider = el.getAttribute('data-rider');
  if (rider) return `[data-rider="${rider}"]`;
  const dl = el.getAttribute('data-dl');
  if (dl) return el.hasAttribute('data-pick') ? `input[data-dl="${dl}"]` : `button[data-dl="${dl}"][data-v="${el.getAttribute('data-v')}"]`;
  if (el.hasAttribute('data-dl-random')) return '[data-dl-random]';
  for (const attr of ['data-pass-tier', 'data-pass-bg', 'data-pass-title', 'data-track', 'data-gp', 'data-rivals', 'data-physics', 'data-select', 'data-sell', 'data-part', 'data-crate', 'data-tune', 'data-preview', 'data-buy', 'data-case-open', 'data-slot', 'data-cos', 'data-friend-car', 'data-friend-open', 'data-friend-add']) {
    const v = el.getAttribute(attr);
    if (v !== null) return `[${attr}="${v}"]`;
  }
  for (const attr of ['data-solo', 'data-host', 'data-join', 'data-code', 'data-friend-name']) if (el.hasAttribute(attr)) return `[${attr}]`;
  return null;
}
