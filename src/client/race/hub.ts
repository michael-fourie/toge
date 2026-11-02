// TŌGE's home: the garage. Tabs (LB / RB on a controller): Race (solo, host, join), Garage (your cars),
// Upgrades (crates: the gamble), Paint & Tune, Locker and Cases (cosmetics, cosmeticsui.ts), Dealer. The showroom and a Forza-style car card stay
// beside whichever tab is open.

import { CARS, CAR_IDS, CLASS_COLORS, FINISHES, GLOWS, GLOW_NAMES, type Look, MAX_LEVEL, PAINTS, PAINT_NAMES, PARTS, PART_INFO, type Part, RIMS, RIM_COLORS, RIM_COLOR_NAMES, SPOILERS, STRIPES, TUNE_RANGE, type Tune, carSpec, encodeCar, newOwnedCar, peakPower, rating, stats, topSpeed, type OwnedCar } from '../../shared/race/cars.ts';
import { CRATES, type CrateResult, MYSTERY_COST, TRACK_LENGTH_KM, current, tunerCost } from '../../shared/race/garage.ts';
import { type CaseId, type CosSlot, COS_SLOTS, cosById, cosCaseById } from '../../shared/race/cosmetics.ts';
import { casesTab, lockerTab, showCaseReel, wireCases } from './cosmeticsui.ts';
import { TRACK_DEFS, type TrackId } from '../../shared/race/track.ts';
import { account } from '../account.ts';
import type { Render } from '../menu/router.ts';
import { $, esc, playerName } from '../menu/ui.ts';
import { garage } from './garageStore.ts';
import { money } from './hud.ts';
import { raceNet } from './racenet.ts';
import { Showroom } from './showroom.ts';
import './race.css';

type Tab = 'race' | 'garage' | 'upgrades' | 'paint' | 'locker' | 'cases' | 'dealer';
const TABS: [Tab, string][] = [
  ['race', 'Race'],
  ['garage', 'Garage'],
  ['upgrades', 'Upgrades'],
  ['paint', 'Paint & Tune'],
  ['locker', 'Locker'],
  ['cases', 'Cases'],
  ['dealer', 'Dealer'],
];

const TRACK_KEY = 'atrous.track';
const RIVALS_KEY = 'atrous.rivals';
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

function classBadge(car: OwnedCar) {
  const r = rating(carSpec(car));
  return `<span class="tg-class" style="--c:${CLASS_COLORS[r.cls]}"><b>${r.cls}</b>${r.pi}</span>`;
}

export const driveHub: Render = (root, ctx, screen) => {
  let tab: Tab = (TABS.find(([t]) => t === screen.dtab)?.[0] as Tab) ?? 'race';
  let track = (read(TRACK_KEY, 'koripass') in TRACK_DEFS ? read(TRACK_KEY, 'koripass') : 'koripass') as TrackId;
  let rivals = Number(read(RIVALS_KEY, '5'));
  let status = screen.notice ?? '';
  let draft: { look: Look; tune: Tune } | null = null;
  /** A dealer car being looked at (shown in the showroom and on the card until you leave the tab). */
  let preview: OwnedCar | null = null;
  /** Locker: the slot being browsed, and a not-yet-owned item being tried on in the showroom. */
  let lockerSlot: CosSlot = 'paint';
  let trying: string | null = null;
  let saveTimer = 0;
  let listTimer = 0;
  let busy = false;

  root.innerHTML = `
    <main class="tg" aria-label="TŌGE garage">
      <header class="tg-top">
        <button class="tg-home" data-home aria-label="Back to the game menu">◀ Menu</button>
        <div class="tg-logo" aria-hidden="true">TŌGE</div>
        <nav class="tg-tabs" role="tablist" aria-label="Garage sections">
          <span class="tg-bumper" aria-hidden="true">LB</span>
          ${TABS.map(([t, label]) => `<button role="tab" data-tab="${t}">${esc(label)}</button>`).join('')}
          <span class="tg-bumper" aria-hidden="true">RB</span>
        </nav>
        <div class="tg-wallet"><b data-money></b><small data-who></small></div>
      </header>
      <section class="tg-body">
        <div class="tg-panel" data-panel></div>
        <div class="tg-stage">
          <canvas class="tg-showroom" aria-label="Your car"></canvas>
          <div class="tg-card" data-card></div>
        </div>
      </section>
      <div class="tg-modal" data-modal hidden></div>
    </main>`;
  const showroom = new Showroom($<HTMLCanvasElement>(root, '.tg-showroom'));
  let shown = '';

  const car = () => current(garage.g);
  /** The car as shown: the saved one with any unsaved paint/tune edits. */
  const viewed = (): OwnedCar => {
    if (preview) return preview;
    const c = draft ? { ...car(), look: draft.look, tune: draft.tune } : car();
    return trying ? { ...c, cos: { ...c.cos, [lockerSlot]: trying } } : c;
  };

  const drawTop = () => {
    $(root, '[data-money]').textContent = money(garage.g.money);
    $(root, '[data-who]').textContent = account.user ? `${account.user} · ${garage.g.wins} wins` : 'Guest · sign in to keep your garage';
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
      b.classList.toggle('on', b.dataset.tab === tab);
    });
  };

  const drawCard = () => {
    const c = viewed();
    const sp = carSpec(c);
    const b = CARS[c.model];
    const st = stats(sp);
    const bar = (label: string, v: number) => `<div class="tg-stat"><span>${label}</span><i><b style="width:${v * 10}%"></b></i><em>${v.toFixed(1)}</em></div>`;
    $(root, '[data-card]').innerHTML = `
      <div class="tg-card-head"><div><small>${esc(b.maker)}</small><h2>${esc(b.name)}</h2></div>${classBadge(c)}</div>
      ${bar('Speed', st.speed)}${bar('Handling', st.handling)}${bar('Acceleration', st.acceleration)}${bar('Launch', st.launch)}${bar('Braking', st.braking)}
      <dl class="tg-specs">
        <div><dt>Power</dt><dd>${Math.round(peakPower(sp).kw * 1.341)} hp</dd></div>
        <div><dt>Weight</dt><dd>${Math.round(sp.mass)} kg</dd></div>
        <div><dt>Drive</dt><dd>${b.drive}</dd></div>
        <div><dt>Top speed</dt><dd>${Math.round(topSpeed(sp) * 3.6)} km/h</dd></div>
      </dl>`;
    const key = JSON.stringify([c.model, c.look, c.cos, c.plate]);
    if (key !== shown) {
      shown = key;
      showroom.show(c);
    }
  };

  // --- tab bodies --------------------------------------------------------------------------------

  const raceTab = () => `
    <h2 class="tg-h">Choose a track</h2>
    <div class="tg-tracks">
      ${(Object.keys(TRACK_DEFS) as TrackId[])
        .map((id) => {
          const d = TRACK_DEFS[id];
          return `<button class="tg-track ${id}" data-track="${id}" aria-pressed="${id === track}">
            <b>${esc(d.name)}</b><small>${esc(d.tag)} · ${TRACK_LENGTH_KM[id]} km</small><p>${esc(d.blurb)}</p></button>`;
        })
        .join('')}
    </div>
    <h2 class="tg-h">Solo</h2>
    <div class="tg-row">
      <span class="tg-label">Rivals</span>
      ${[0, 3, 5, 7].map((n) => `<button class="tg-pill" data-rivals="${n}" aria-pressed="${n === rivals}">${n}</button>`).join('')}
      <button class="tg-go" data-solo data-autofocus>Race solo ▸</button>
    </div>
    <h2 class="tg-h">Online</h2>
    <div class="tg-row">
      <button class="tg-go alt" data-host>Host a race</button>
      <label class="tg-code"><span class="sr-only">Race code</span><input data-code maxlength="4" placeholder="CODE" autocomplete="off" spellcheck="false" /></label>
      <button class="tg-go alt" data-join>Join</button>
    </div>
    <ul class="tg-lobbies" data-lobbies><li class="muted">Looking for open races…</li></ul>
    <p class="tg-status" role="status" data-status>${esc(status)}</p>`;

  const garageTab = () => `
    <h2 class="tg-h">Your cars <small>${garage.g.cars.length} owned</small></h2>
    <div class="tg-cars">
      ${garage.g.cars
        .map((c, i) => {
          const b = CARS[c.model];
          const levels = PARTS.reduce((a, p) => a + c.up[p], 0);
          const sel = i === garage.g.sel;
          return `<div class="tg-owned ${sel ? 'on' : ''}">
            <i class="tg-swatch" style="background:${hex(PAINTS[c.look.paint])}"></i>
            <div><b>${esc(b.name)}</b><small>${levels} upgrade levels · ${b.drive}</small></div>
            ${classBadge(c)}
            ${sel ? '<span class="tg-tag">Driving</span>' : `<button class="tg-pill" data-select="${i}">Drive</button>`}
            ${garage.g.cars.length > 1 ? `<button class="tg-pill danger" data-sell="${i}">Sell ${money(b.price * 0.5)}</button>` : ''}
          </div>`;
        })
        .join('')}
    </div>
    <p class="tg-muted">Races: ${garage.g.races} · Wins: ${garage.g.wins}</p>
    <p class="tg-status" role="status" data-status>${esc(status)}</p>`;

  const upgradesTab = () => {
    const c = car();
    return `
      <h2 class="tg-h">Upgrade crates <small>for your ${esc(CARS[c.model].name)}</small></h2>
      <button class="tg-crate" data-crate="mystery" data-autofocus ${garage.g.money < MYSTERY_COST ? 'disabled' : ''}>
        <span class="tg-crate-box" aria-hidden="true">?</span>
        <span><b>${CRATES.mystery.name} · ${money(MYSTERY_COST)}</b><small>${esc(CRATES.mystery.blurb)}</small></span>
      </button>
      <p class="tg-muted">${esc(CRATES.tuner.blurb)}</p>
      <div class="tg-parts">
        ${PARTS.map((p) => {
          const lvl = c.up[p];
          const cost = tunerCost(lvl);
          const maxed = lvl >= MAX_LEVEL;
          return `<div class="tg-part">
            <span class="tg-part-icon" aria-hidden="true">${PART_INFO[p].icon}</span>
            <div><b>${PART_INFO[p].name}</b><small>${esc(PART_INFO[p].effect)}</small></div>
            <span class="tg-pips" aria-label="Level ${lvl} of ${MAX_LEVEL}">${Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</span>
            <button class="tg-pill" data-crate="tuner" data-part="${p}" ${maxed || garage.g.money < cost ? 'disabled' : ''}>${maxed ? 'Maxed' : `Tuner crate ${money(cost)}`}</button>
          </div>`;
        }).join('')}
      </div>
      <p class="tg-status" role="status" data-status>${esc(status)}</p>`;
  };

  const paintTab = () => {
    const v = viewed();
    const L = v.look;
    const swatches = (key: keyof Look, colors: number[], names: string[]) =>
      colors.map((col, i) => `<button class="tg-sw" data-look="${key}" data-v="${i}" aria-pressed="${L[key] === i}" title="${esc(names[i])}" aria-label="${esc(names[i])}" style="--sw:${hex(col)}"></button>`).join('');
    const pills = (key: keyof Look, labels: readonly string[]) => labels.map((l, i) => `<button class="tg-pill" data-look="${key}" data-v="${i}" aria-pressed="${L[key] === i}">${esc(l)}</button>`).join('');
    const sliders = (Object.keys(TUNE_RANGE) as (keyof Tune)[])
      .map((k) => {
        const r = TUNE_RANGE[k];
        const val = v.tune[k];
        const shown = k === 'ride' ? `${val > 0 ? '+' : ''}${Math.round(val * 100)} cm` : k === 'bias' ? `${Math.round(val * 100)}% front` : k === 'diff' ? `${Math.round(val * 100)}%` : `×${val.toFixed(2)}`;
        return `<label class="tg-slider"><span>${esc(r.label)}</span><input type="range" data-tune="${k}" min="${r.min}" max="${r.max}" step="${r.step}" value="${val}" /><output>${shown}</output></label>`;
      })
      .join('');
    return `
      <h2 class="tg-h">Paint</h2>
      <div class="tg-swatches">${swatches('paint', PAINTS, PAINT_NAMES)}</div>
      <div class="tg-row">${pills('finish', FINISHES)}</div>
      <h2 class="tg-h">Wheels</h2>
      <div class="tg-row">${pills('rims', RIMS)}</div>
      <div class="tg-swatches">${swatches('rimColor', RIM_COLORS, RIM_COLOR_NAMES)}</div>
      <h2 class="tg-h">Body</h2>
      <div class="tg-row"><span class="tg-label">Spoiler</span>${pills('spoiler', SPOILERS)}</div>
      <div class="tg-row"><span class="tg-label">Stripes</span>${pills('stripe', STRIPES)}</div>
      ${L.stripe ? `<div class="tg-swatches">${swatches('stripeColor', PAINTS, PAINT_NAMES)}</div>` : ''}
      <div class="tg-row"><span class="tg-label">Underglow</span></div>
      <div class="tg-swatches">${swatches('glow', GLOWS, GLOW_NAMES)}</div>
      <h2 class="tg-h">Tuning <small>a wing adds downforce (and drag)</small></h2>
      <div class="tg-sliders">${sliders}</div>
      <p class="tg-status" role="status" data-status>${esc(status)}</p>`;
  };

  const dealerTab = () => `
    <h2 class="tg-h">Dealer <small>new cars come stock; win crates to upgrade them</small></h2>
    <div class="tg-dealer">
      ${CAR_IDS.map((id) => {
        const b = CARS[id];
        const stock = newOwnedCar(id);
        const owned = garage.g.cars.filter((c) => c.model === id).length;
        return `<div class="tg-deal">
          <div class="tg-deal-head"><div><small>${esc(b.maker)}</small><b>${esc(b.name)}</b></div>${classBadge(stock)}</div>
          <p>${esc(b.blurb)}</p>
          <div class="tg-row"><span class="tg-price">${b.price ? money(b.price) : 'Free'}</span>${owned ? `<span class="tg-tag">Owned ×${owned}</span>` : ''}
          <button class="tg-pill" data-preview="${id}">Look</button>
          <button class="tg-go small" data-buy="${id}" ${garage.g.money < b.price ? 'disabled' : ''}>Buy</button></div>
        </div>`;
      }).join('')}
    </div>
    <p class="tg-status" role="status" data-status>${esc(status)}</p>`;

  const lockerBody = () => lockerTab(garage.g, car(), CARS[car().model].name, lockerSlot, trying, status);
  const casesBody = () => casesTab(garage.g, status);
  const BODIES: Record<Tab, () => string> = { race: raceTab, garage: garageTab, upgrades: upgradesTab, paint: paintTab, locker: lockerBody, cases: casesBody, dealer: dealerTab };

  // --- drawing and wiring ----------------------------------------------------------------------

  const draw = (keepFocus = true) => {
    const focusKey = keepFocus ? focusId(document.activeElement) : null;
    drawTop();
    const panel = $(root, '[data-panel]');
    panel.innerHTML = BODIES[tab]();
    wire(panel);
    drawCard();
    const again = focusKey && panel.querySelector<HTMLElement>(focusKey);
    if (again) again.focus({ preventScroll: true });
    if (tab === 'race') void refreshLobbies();
  };

  const setStatus = (text: string) => {
    status = text;
    const el = root.querySelector('[data-status]');
    if (el) el.textContent = text;
  };

  const switchTab = (t: Tab) => {
    if (t === tab) return;
    flushDraft();
    preview = null;
    trying = null;
    tab = t;
    status = '';
    history.replaceState({ ...(history.state ?? {}), dtab: t }, '');
    draw(false);
    $(root, '[data-panel]').scrollTop = 0;
    root.querySelector<HTMLElement>('[data-panel] [data-autofocus], [data-panel] button:not([disabled]), [data-panel] input')?.focus({ preventScroll: true });
  };

  const wire = (panel: HTMLElement) => {
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
    panel.querySelector('[data-solo]')?.addEventListener('click', () => ctx.drive({ track, rivals }));
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
        d.tune[inp.dataset.tune as keyof Tune] = Number(inp.value);
        scheduleSave();
        // Just the readout and the card; redrawing the slider would drop the drag.
        const out = inp.nextElementSibling as HTMLOutputElement;
        const k = inp.dataset.tune as keyof Tune;
        const v = Number(inp.value);
        out.textContent = k === 'ride' ? `${v > 0 ? '+' : ''}${Math.round(v * 100)} cm` : k === 'bias' ? `${Math.round(v * 100)}% front` : k === 'diff' ? `${Math.round(v * 100)}%` : `×${v.toFixed(2)}`;
        drawCard();
      }),
    );
    panel.querySelectorAll<HTMLElement>('[data-preview]').forEach((b) =>
      b.addEventListener('click', () => {
        preview = newOwnedCar(b.dataset.preview as (typeof CAR_IDS)[number], 0);
        drawCard();
      }),
    );
    // Cosmetics: cases and the locker.
    if (tab === 'cases') wireCases(panel, garage.g);
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
    panel.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.buy as (typeof CAR_IDS)[number];
        void act({ a: 'buy', model: id, paint: Math.floor(Math.random() * PAINTS.length) }).then(() => setStatus(`The ${CARS[id].name} is yours. It's in your garage.`));
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

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flushDraft, 700);
  };
  const flushDraft = () => {
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
      $(modal, 'h2').textContent = res.kind === 'jackpot' ? 'JACKPOT!' : 'Upgrade!';
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

  const closeReel = () => {
    const modal = $(root, '[data-modal]');
    modal.hidden = true;
    modal.innerHTML = '';
    draw(false);
    root.querySelector<HTMLElement>('[data-crate="mystery"]')?.focus();
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
    if (code) raceNet.join(playerName(), enc, code);
    else raceNet.host(playerName(), enc);
  };

  const refreshLobbies = async () => {
    clearTimeout(listTimer);
    const list = root.querySelector('[data-lobbies]');
    if (!list || tab !== 'race') return;
    try {
      const lobbies = await raceNet.lobbies();
      if (!root.querySelector('[data-lobbies]')) return;
      list.innerHTML = lobbies.length
        ? lobbies
            .map((l) => `<li><b>${esc(l.code)}</b><span>${esc(l.host)}'s ${l.mode === 'trial' ? 'time trial' : 'race'} · ${esc(TRACK_DEFS[l.track]?.name ?? '')} · ${l.players}/${l.max}${l.phase === 'lobby' ? '' : ' · racing'}</span><button class="tg-pill" data-joincode="${esc(l.code)}" ${l.players >= l.max ? 'disabled' : ''}>${l.players >= l.max ? 'Full' : 'Join'}</button></li>`)
            .join('')
        : `<li class="muted">No open races. Host one!</li>`;
      list.querySelectorAll<HTMLElement>('[data-joincode]').forEach((b) => b.addEventListener('click', () => connect(b.dataset.joincode!)));
    } catch {
      list.innerHTML = `<li class="muted">Can't reach the game server${import.meta.env.DEV ? ' (is <code>npm run dev</code> running?)' : ''}. Solo races still work.</li>`;
    }
    listTimer = window.setTimeout(() => void refreshLobbies(), 3000);
  };

  // --- events ------------------------------------------------------------------------------------

  root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab as Tab)));
  $(root, '[data-home]').addEventListener('click', () => ctx.go({ name: 'games' }));
  const onPadTab = (e: Event) => {
    if (!root.querySelector<HTMLElement>('[data-modal]')!.hidden) return;
    const i = TABS.findIndex(([t]) => t === tab);
    switchTab(TABS[(i + (e as CustomEvent<number>).detail + TABS.length) % TABS.length][0]);
  };
  addEventListener('padtab', onPadTab);
  // Esc / B closes the crate reel before it backs out of the screen.
  const onKey = (e: KeyboardEvent) => {
    const modal = root.querySelector<HTMLElement>('[data-modal]')!;
    if (e.key === 'Escape' && !modal.hidden) {
      e.stopImmediatePropagation();
      if (modal.querySelector<HTMLElement>('[data-ok]:not([hidden])')) closeReel();
    }
  };
  addEventListener('keydown', onKey, true);
  const offGarage = garage.onChange(() => {
    if (root.querySelector<HTMLElement>('[data-modal]')!.hidden) draw();
    else drawTop();
  });
  const offAccount = account.onChange(() => drawTop());
  void garage.refresh();
  draw(false);
  root.querySelector<HTMLElement>('[data-panel] [data-autofocus]')?.focus({ preventScroll: true });

  return () => {
    flushDraft();
    clearTimeout(listTimer);
    offNet?.();
    offGarage();
    offAccount();
    removeEventListener('padtab', onPadTab);
    removeEventListener('keydown', onKey, true);
    showroom.dispose();
  };
};

/** A selector that finds "the same control" after a redraw, so focus survives it. */
function focusId(el: Element | null): string | null {
  if (!(el instanceof HTMLElement) || !el.closest('[data-panel]')) return null;
  for (const attr of ['data-track', 'data-rivals', 'data-select', 'data-sell', 'data-part', 'data-crate', 'data-tune', 'data-preview', 'data-buy', 'data-case-open', 'data-slot', 'data-cos']) {
    const v = el.getAttribute(attr);
    if (v !== null) {
      const look = el.getAttribute('data-look');
      return look ? `[data-look="${look}"][data-v="${el.getAttribute('data-v')}"]` : `[${attr}="${v}"]`;
    }
  }
  const look = el.getAttribute('data-look');
  if (look) return `[data-look="${look}"][data-v="${el.getAttribute('data-v')}"]`;
  for (const attr of ['data-solo', 'data-host', 'data-join', 'data-code']) if (el.hasAttribute(attr)) return `[${attr}]`;
  return null;
}
