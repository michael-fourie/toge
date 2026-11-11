// The race lobby: the code to share, the host's track pick, who's in and what they drive (and the crew: every
// racer's driver, standing in a row), your car (switch it, or open the garage over the lobby to edit it), and Start.
// When the host starts, everyone drops into the race together (even from the garage); the race itself waits for
// every racer to load.

import { CARS, CLASS_COLORS, PAINTS, PAINT_NAMES, carSpec, decodeCar, encodeCar, isBike, peakPower, rating } from '../shared/cars.ts';
import { current } from '../shared/garage.ts';
import { CAR_RULES, PHYSICS, RACE, RECORD_GHOST, RACE_MODES, TEAMS, cleanMode, isGp, modeTracks, type CarRule, type RaceMode, type RaceServerMsg, type Team } from '../shared/protocol.ts';
import { TRACK_DEFS, type TrackId } from '../shared/track.ts';
import type { Render } from '../../client/menu/router.ts';
import { copy, esc, playerName } from '../../client/menu/ui.ts';
import { garage } from './garageStore.ts';
import { raceNet, roomRace } from './racenet.ts';
import { fmtTime } from './hud.ts';
import { ICON, LOGO } from './brand.ts';
import { pitGarage } from './hub.ts';
import { cupCard, trackClimb, trackKind, trackMap, trackStyle, trackTile } from './trackart.ts';
import { CUP_IDS, CUPS, ROUNDS, type CupId } from '../shared/cups.ts';
import { TRACK_LENGTH_KM } from '../shared/garage.ts';
import { encodeRider } from '../shared/rider.ts';
import { PORTRAIT, releasePortraits, riderPortrait } from './riderportrait.ts';
import './race.css';
import './hub.css';

const START: Record<RaceMode, string> = { race: 'Start race', trial: 'Start time trial', climb: 'Start hill climb', gp: 'Start Grand Prix', team: 'Start Team Grand Prix', roam: 'Start free roam' };

/** A racer's face for the grid list: their portrait, cropped to the head (`ready`: redraw once it's drawn). */
const face = (rider: string, ready: () => void) => {
  const pic = riderPortrait(rider, ready);
  return pic ? `background-image:url(${pic})` : '';
};

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

export const driveLobby: Render = (root, ctx, screen) => {
  let starting = false;
  // The lobby draws into `view`; the garage (when it's open) sits over it in `pitHost`.
  // The screen's shell (`.tg`, which fades in) is made once; every room update only redraws what's inside it.
  // Rebuilding the shell replayed that fade from transparent, so each join or car change flashed the whole screen.
  root.innerHTML = '<div data-lobby-view><main class="tg tg-lobby" aria-label="Race lobby" tabindex="-1"></main></div><div data-pit-host></div>';
  const view = root.querySelector<HTMLElement>('.tg-lobby')!;
  const pitHost = root.querySelector<HTMLElement>('[data-pit-host]')!;
  /** The open garage's cleanup (null when it's closed). */
  let pitOff: (() => void) | null = null;
  let pitFade = 0;
  let busy = false;
  // A deep link (/?race=CODE) or a reload: connect first.
  if (!raceNet.connected) {
    if (screen.code) raceNet.join(playerName(), encodeCar(current(garage.g)), encodeRider(garage.g.rider), screen.code);
    else {
      ctx.replace({ name: 'drive' });
      return;
    }
  }

  // Portraits are drawn once each driver's model has loaded: redraw the lobby when one lands.
  const redraw = () => {
    if (root.isConnected) draw();
  };
  /** Racers already in the crew row: only newcomers slide in, not everyone on every update. */
  let crewShown = new Set<number>();
  const draw = () => {
    const room = raceNet.room;
    if (!room) {
      view.innerHTML = `<p class="tg-status">Connecting…</p>`;
      return;
    }
    const scroll = view.querySelector('.tg-lobby-body')?.scrollTop ?? 0;
    const isHost = room.hostId === raceNet.id;
    const focus = (document.activeElement as HTMLElement | null)?.dataset;
    const focusKey = focus?.pick ? `[data-pick="${focus.pick}"]` : focus?.cup ? `[data-cup="${focus.cup}"]` : focus?.mode ? `[data-mode="${focus.mode}"]` : focus?.rule ? `[data-rule="${focus.rule}"]` : focus?.physics ? `[data-physics="${focus.physics}"]` : focus?.ghost ? `[data-ghost="${focus.ghost}"]` : focus?.start !== undefined ? '[data-start]' : focus?.addcpu !== undefined ? '[data-addcpu]' : focus?.edit !== undefined ? '[data-edit]' : focus?.swap ? `[data-swap="${focus.swap}"]` : focus?.team ? `[data-team="${focus.team}"]` : null;
    const max = RACE.maxPlayers;
    // Free roam: the open world, no CPU racers, no record ghost, and friends can drive in while it's on.
    const roam = room.mode === 'roam';
    const canPick = isHost && room.phase === 'lobby';
    // A Team Grand Prix: each racer's team chip. Yours (or, for the host, a CPU racer's) switches sides, between cups.
    const teamMode = room.mode === 'team';
    const canSwitch = (r: (typeof room.racers)[number]) => teamMode && room.phase === 'lobby' && !room.gp && (r.id === raceNet.id || (isHost && !!r.cpu));
    const teamChip = (r: (typeof room.racers)[number]) => {
      if (!teamMode || r.team === undefined) return '';
      const t = TEAMS[r.team];
      const other = TEAMS[1 - r.team];
      return canSwitch(r)
        ? `<button class="tg-team" style="--team:${t.color}" data-team="${r.id}" data-to="${1 - r.team}" title="Switch to ${other.name}" aria-label="${esc(r.name)}: ${t.name} team. Switch to ${other.name}">${t.name}</button>`
        : `<span class="tg-team" style="--team:${t.color}">${t.name}</span>`;
    };
    const racers =
      room.racers
        .map((r, i) => {
          const c = decodeCar(r.car);
          const cls = c ? rating(carSpec(c)) : null;
          return `<li class="${r.id === raceNet.id ? 'me' : ''}"${teamMode && r.team !== undefined ? ` style="--team:${TEAMS[r.team].color}" data-team-row` : ''}>
          <span class="tg-slot">${i + 1}</span>
          <div class="tg-racer"><i class="tg-face" aria-hidden="true" style="--paint:${c ? hex(PAINTS[c.look.paint]) : '#888'};${face(r.rider, redraw)}"></i><b>${esc(r.name)}</b>${teamChip(r)}${r.id === room.hostId ? '<span class="tg-tag">Host</span>' : ''}${r.id === raceNet.id ? '<span class="tg-tag you">You</span>' : ''}${r.cpu ? '<span class="tg-tag cpu">CPU</span>' : ''}${r.pit ? `<span class="tg-tag pit" title="Editing their car">${ICON.wrench}Garage</span>` : ''}${r.cpu && canPick ? `<button class="tg-kick" data-kick="${r.id}" aria-label="Remove ${esc(r.name)}" title="Remove">×</button>` : ''}</div>
          <span class="car">${c ? esc(CARS[c.model].name) : ''}</span>
          ${cls ? `<span class="tg-class" style="--c:${CLASS_COLORS[cls.cls]}"><b>${cls.cls}</b>${cls.pi}</span>` : '<span></span>'}
        </li>`;
        })
        .join('') +
      Array.from(
        { length: Math.max(0, max - room.racers.length) },
        // The host can fill the first open seat with a CPU racer (a person who joins later takes a CPU's seat).
        (_, i) => `<li class="open"><span class="tg-slot">${room.racers.length + i + 1}</span><span>Open slot</span>${i === 0 && canPick && !roam ? `<button class="tg-pill tg-addcpu" data-addcpu>+ Add CPU</button>` : ''}</li>`,
      ).join('');
    // The crew: everyone's driver side by side, you in the middle of the light.
    const crew = room.racers
      .map((r) => {
        const pic = riderPortrait(r.rider, redraw);
        const c = decodeCar(r.car);
        return `<figure class="tg-crew-m ${r.id === raceNet.id ? 'me' : ''} ${crewShown.has(r.id) ? '' : 'new'}">
          ${pic ? `<img src="${pic}" alt="" width="${PORTRAIT.w}" height="${PORTRAIT.h}" />` : '<span class="tg-crew-none"></span>'}
          <figcaption><b>${esc(r.name)}</b><small>${r.pit ? 'In the garage' : c ? esc(CARS[c.model].name) : ''}</small></figcaption>
        </figure>`;
      })
      .join('');
    // A Grand Prix (or a Team Grand Prix): the host picks a cup (its four tracks, in order) instead of a track.
    const gp = isGp(room.mode);
    const cups = CUP_IDS.map((id) => cupCard(id, `data-cup="${id}" aria-pressed="${id === room.cup}" aria-label="${esc(CUPS[id].name)}" ${canPick ? '' : 'disabled'}`, room.gp && room.gp.cup === id ? room.gp.round : -1)).join('');
    const tracks = modeTracks(room.mode).map((id) => trackTile(id, `data-pick="${id}" aria-pressed="${id === room.track}" aria-label="${esc(TRACK_DEFS[id].name)}" ${canPick ? '' : 'disabled'}`)).join('');
    const modes = (Object.keys(RACE_MODES) as RaceMode[])
      .map((id) => `<button class="tg-mode" data-mode="${id}" aria-pressed="${id === room.mode}" ${canPick ? '' : 'disabled'}><b>${esc(RACE_MODES[id].name)}</b><small>${esc(RACE_MODES[id].blurb)}</small></button>`)
      .join('');
    // A time trial's or hill climb's car rule: own cars, everyone in a maxed Vanta, or everyone's car maxed out.
    const rules =
      cleanMode(room.mode)
        ? `<h2 class="tg-h">Cars</h2><div class="tg-modes">${(Object.keys(CAR_RULES) as CarRule[])
            .map((id) => `<button class="tg-mode" data-rule="${id}" aria-pressed="${id === room.cars}" ${canPick ? '' : 'disabled'}><b>${esc(CAR_RULES[id].name)}</b><small>${esc(CAR_RULES[id].blurb)}</small></button>`)
            .join('')}</div>`
        : '';
    // Physics mode: crash damage, for either mode.
    const physics = (['off', 'on'] as const)
      .map((k) => `<button class="tg-mode" data-physics="${k}" aria-pressed="${(k === 'on') === room.physics}" ${canPick ? '' : 'disabled'}><b>${esc(PHYSICS[k].name)}</b><small>${esc(PHYSICS[k].blurb)}</small></button>`)
      .join('');
    // The record ghost: the track record's run rides along (the host's pick); say whose it'd be.
    const ghost = gp || roam ? '' : (['off', 'on'] as const)
      .map((k) => `<button class="tg-mode" data-ghost="${k}" aria-pressed="${(k === 'on') === !!room.ghost}" ${canPick ? '' : 'disabled'}><b>${esc(RECORD_GHOST[k].name)}</b><small>${esc(RECORD_GHOST[k].blurb)}</small></button>`)
      .join('');
    const ghostNote = gp || roam || !room.ghost ? '' : room.record ? `<p class="tg-muted tg-ghost-note">Ghost: <b>${esc(room.record.name)}</b> · <span class="tg-num">${fmtTime(room.record.time)}</span>, the record on ${esc(TRACK_DEFS[room.track].name)}.</p>` : `<p class="tg-muted tg-ghost-note">No ghost on ${esc(TRACK_DEFS[room.track].name)} yet: the next record set here leaves one.</p>`;
    // Who's still in the garage (the host can wait for them, or not).
    const tuning = room.racers.filter((r) => r.pit && r.id !== raceNet.id).map((r) => r.name);
    const tuningLine = tuning.length ? ` ${tuning.length === 1 ? `${esc(tuning[0])} is` : `${tuning.length} racers are`} in the garage.` : '';
    const state =
      room.phase === 'lobby'
        ? isHost
          ? `<button class="tg-go" data-start data-autofocus>${ICON.flag}${START[room.mode]}</button><span class="tg-muted">${roam ? 'Share the code: friends can drive in any time while it’s on.' : room.racers.length < 2 ? 'Share the code, add CPU racers, or start now and race the clock.' : `${room.racers.length} racers on the grid.`}${tuningLine}</span>`
          : `<span class="tg-muted">Waiting for the host to start…</span>`
        : roam
          ? `<span class="tg-muted">Free roam is on. Driving in…</span>`
          : room.gp
          ? `<span class="tg-muted">The ${esc(CUPS[room.gp.cup].name)} is under way (round ${room.gp.round + 1} of ${ROUNDS}). You'll line up for the next round.</span>`
          : `<span class="tg-muted">A race is under way. You'll line up for the next one.</span>`;
    const d = TRACK_DEFS[room.track];
    crewShown = new Set(room.racers.map((r) => r.id));
    view.innerHTML = `
        <header class="tg-top">
          <button class="tg-home" data-back aria-label="Leave the lobby">${ICON.back}</button>
          ${LOGO}
          <div class="tg-lobby-title">${gp ? `${teamMode ? 'Team Grand Prix · ' : ''}${esc(CUPS[room.cup].name)}` : `${RACE_MODES[room.mode].name} lobby`}${room.physics ? ' · Physics' : ''}${room.ghost && !gp && !roam ? ' · Record ghost' : ''}</div>
          <div class="tg-roomcode"><small>Race<br />code</small><b class="tg-bigcode">${esc(room.code)}</b></div>
        </header>
        <section class="tg-lobby-body${isHost ? '' : ' guest'}">
          <div class="tg-lobby-col">
            <section class="tg-hero" style="${trackStyle(room.track)}">
              <span class="tg-hero-art" aria-hidden="true"></span>
              <div class="tg-hero-map">${trackMap(room.track)}</div>
              <div class="tg-hero-copy">
                <small class="tg-eyebrow">${gp ? esc(`${CUPS[room.cup].name} · round ${(room.gp?.cup === room.cup ? room.gp.round : 0) + 1} of ${ROUNDS}`) : esc(trackKind(room.track))}</small>
                <h1 class="tg-display">${esc(d.name)}</h1>
                <p>${esc(d.tag)}</p>
              </div>
              <dl class="tg-hero-facts"><div><dt>${d.world ? 'Roads' : 'Distance'}</dt><dd class="tg-num">${TRACK_LENGTH_KM[room.track]}<small>km</small></dd></div>${d.climb ? `<div><dt>Climb</dt><dd class="tg-num">${trackClimb(room.track)}<small>m</small></dd></div>` : ''}</dl>
            </section>
            <h2 class="tg-h">Mode ${canPick ? '<small>you pick</small>' : ''}</h2>
            <div class="tg-modes">${modes}</div>
            ${rules}
            <h2 class="tg-h">${esc(PHYSICS.name)} ${canPick ? '<small>you pick</small>' : ''}</h2>
            <div class="tg-modes">${physics}</div>
            ${gp || roam ? '' : `<h2 class="tg-h">${esc(RECORD_GHOST.name)} ${canPick ? '<small>you pick</small>' : ''}</h2>
            <div class="tg-modes">${ghost}</div>`}
            ${ghostNote}
            ${
              gp
                ? `<h2 class="tg-h">Cup ${canPick ? '<small>you pick</small>' : ''}</h2>
            <div class="tg-cups">${cups}</div>`
                : `<h2 class="tg-h">Track ${canPick ? '<small>you pick</small>' : ''}</h2>
            <div class="tg-tracks">${tracks}</div>`
            }
          </div>
          <div class="tg-lobby-col">
            <h2 class="tg-h">Your car</h2>
            ${myCar(room.cars)}
            <h2 class="tg-h">Crew</h2>
            <div class="tg-crew" style="--n:${room.racers.length}">${crew}</div>
            <h2 class="tg-h">Grid <small>${room.racers.length} / ${max}</small></h2>
            <ul class="tg-racers">${racers}</ul>
            <div class="tg-row">
              <button class="tg-pill" data-copy>Copy code</button>
              <button class="tg-pill" data-link>Copy invite link</button>
            </div>
            <div class="tg-lobby-start">${state}</div>
          </div>
        </section>`;
    view.querySelector('.tg-lobby-body')!.scrollTop = scroll;
    view.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => b.addEventListener('click', () => raceNet.send({ t: 'track', track: b.dataset.pick as TrackId })));
    view.querySelectorAll<HTMLElement>('[data-cup]').forEach((b) => b.addEventListener('click', () => raceNet.send({ t: 'cup', cup: b.dataset.cup as CupId })));
    view.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => raceNet.send({ t: 'mode', mode: b.dataset.mode as RaceMode })));
    view.querySelectorAll<HTMLElement>('[data-rule]').forEach((b) => b.addEventListener('click', () => raceNet.send({ t: 'cars', cars: b.dataset.rule as CarRule })));
    view.querySelectorAll<HTMLElement>('[data-physics]').forEach((b) => b.addEventListener('click', () => raceNet.send({ t: 'physics', on: b.dataset.physics === 'on' })));
    view.querySelectorAll<HTMLElement>('[data-ghost]').forEach((b) => b.addEventListener('click', () => raceNet.send({ t: 'ghost', on: b.dataset.ghost === 'on' })));
    view.querySelector('[data-start]')?.addEventListener('click', () => raceNet.send({ t: 'start' }));
    view.querySelector('[data-addcpu]')?.addEventListener('click', () => raceNet.send({ t: 'cpu', op: 'add' }));
    view.querySelectorAll<HTMLElement>('[data-kick]').forEach((b) => b.addEventListener('click', () => raceNet.send({ t: 'cpu', op: 'remove', id: Number(b.dataset.kick) })));
    view.querySelectorAll<HTMLElement>('[data-team]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = Number(b.dataset.team);
        const team = Number(b.dataset.to) as Team;
        raceNet.send(id === raceNet.id ? { t: 'team', team } : { t: 'team', team, id });
      }),
    );
    view.querySelector('[data-copy]')?.addEventListener('click', () => void copy(room.code, 'Code'));
    view.querySelector('[data-link]')?.addEventListener('click', () => void copy(`${location.origin}/?race=${room.code}`, 'Invite link'));
    view.querySelector('[data-edit]')?.addEventListener('click', openPit);
    view.querySelectorAll<HTMLElement>('[data-swap]').forEach((b) => b.addEventListener('click', () => void swap(Number(b.dataset.swap))));
    drawPitBar();
    // With the garage open, focus stays in the garage.
    if (pitOff) return;
    (view.querySelector<HTMLElement>(focusKey ?? '[data-autofocus]') ?? view.querySelector<HTMLElement>('[data-copy]'))?.focus({ preventScroll: true });
  };

  /** Your car's card: what you'll line up in, the arrows to switch to another of your cars, and Edit car. */
  const myCar = (rule: CarRule) => {
    const g = garage.g;
    const c = current(g);
    const b = CARS[c.model];
    const sp = carSpec(c);
    const r = rating(sp);
    const cos = Object.values(c.cos ?? {}).filter(Boolean).length;
    const many = g.cars.length > 1;
    const note = rule === 'vanta' && cleanMode(raceNet.room?.mode ?? 'race') ? "Maxed Vanta: you'll race a Vanta V10 with every part at level 5, in your paint." : rule === 'maxed' && cleanMode(raceNet.room?.mode ?? 'race') ? 'Maxed out: every part goes to level 5 for this race.' : '';
    return `<div class="tg-mycar tg-cardbox" style="--paint:${hex(PAINTS[c.look.paint])}">
      <i class="tg-mycar-paint" aria-hidden="true"></i>
      <div class="tg-mycar-head">
        <div><small>${esc(b.maker)} · ${isBike(c.model) ? 'Bike' : b.drive}</small><b class="tg-title">${esc(b.name)}</b></div>
        <span class="tg-class" style="--c:${CLASS_COLORS[r.cls]}"><b>${r.cls}</b>${r.pi}</span>
      </div>
      <p class="tg-mycar-meta tg-num">${Math.round(peakPower(sp).kw * 1.341)} hp · ${Math.round(sp.mass)} kg · ${esc(PAINT_NAMES[c.look.paint])}${cos ? ` · ${cos} cosmetic${cos === 1 ? '' : 's'}` : ''}</p>
      ${note ? `<p class="tg-mycar-note">${note}</p>` : ''}
      <div class="tg-mycar-act">
        <button class="tg-go alt small" data-edit>${ICON.wrench}Edit car</button>
        ${many ? `<div class="tg-mycar-swap" role="group" aria-label="Switch car"><button class="tg-pill" data-swap="-1" aria-label="Previous car">${ICON.back}</button><span class="tg-num">${g.sel + 1} / ${g.cars.length}</span><button class="tg-pill flip" data-swap="1" aria-label="Next car">${ICON.back}</button></div>` : ''}
      </div>
    </div>`;
  };

  /** Switch to the next (or previous) of your cars, right here in the lobby. */
  const swap = async (dir: number) => {
    const n = garage.g.cars.length;
    if (busy || n < 2) return;
    busy = true;
    await garage.act({ a: 'select', i: (garage.g.sel + dir + n) % n });
    busy = false;
  };

  /** The strip in the garage's top bar: the lobby at a glance, and the host's Start. */
  const drawPitBar = () => {
    const bar = pitHost.querySelector<HTMLElement>('[data-pitbar]');
    const room = raceNet.room;
    if (!bar || !room) return;
    const isHost = room.hostId === raceNet.id;
    const others = room.racers.length - 1;
    const line =
      room.phase !== 'lobby'
        ? 'Race under way · you race the next one'
        : isHost
          ? others ? `${others} other racer${others === 1 ? '' : 's'} waiting on you` : 'Just you so far'
          : 'Waiting for the host';
    const had = (document.activeElement as HTMLElement | null)?.dataset;
    bar.innerHTML = `<span class="tg-pitbar-code"><small>Lobby</small><b class="tg-num">${esc(room.code)}</b></span>
      <span class="tg-pitbar-state"><i class="${room.phase === 'lobby' && !isHost ? 'live' : ''}" aria-hidden="true"></i>${esc(TRACK_DEFS[room.track].name)} · ${room.racers.length}/${RACE.maxPlayers}<small>${esc(line)}</small></span>
      <button class="tg-pill" data-pit-done>Done</button>
      ${isHost && room.phase === 'lobby' ? `<button class="tg-go small" data-pit-start>${ICON.flag}Start</button>` : ''}`;
    bar.setAttribute('role', 'status');
    bar.querySelector('[data-pit-start]')?.addEventListener('click', () => raceNet.send({ t: 'start' }));
    bar.querySelector('[data-pit-done]')?.addEventListener('click', closePit);
    if (had?.pitStart !== undefined) bar.querySelector<HTMLElement>('[data-pit-start]')?.focus({ preventScroll: true });
    else if (had?.pitDone !== undefined) bar.querySelector<HTMLElement>('[data-pit-done]')?.focus({ preventScroll: true });
  };

  /** Open the garage over the lobby; the others see a Garage tag on you until you close it. */
  const openPit = () => {
    if (pitOff || !raceNet.room) return;
    clearTimeout(pitFade);
    pitHost.innerHTML = '';
    pitOff = pitGarage(pitHost, ctx, { close: closePit });
    raceNet.send({ t: 'pit', on: true });
    drawPitBar();
  };
  const closePit = () => {
    if (!pitOff) return;
    const off = pitOff;
    pitOff = null;
    off();
    raceNet.send({ t: 'pit', on: false });
    // Slide it away, then focus Edit car again.
    const el = pitHost.firstElementChild as HTMLElement | null;
    el?.classList.add('out');
    pitFade = window.setTimeout(() => (pitHost.innerHTML = ''), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
    draw();
    view.querySelector<HTMLElement>('[data-edit]')?.focus({ preventScroll: true });
  };

  /** Free roam is on and we're not out in it (we just joined): ask to drive in, once per session. */
  let droveIn = false;
  const driveIn = () => {
    const room = raceNet.room;
    if (!room || room.mode !== 'roam' || room.phase === 'lobby') return void (droveIn = false);
    if (droveIn || (room.phase !== 'racing' && room.phase !== 'countdown') || room.racers.some((r) => r.id === raceNet.id && r.roaming)) return;
    droveIn = true;
    raceNet.send({ t: 'joinin' });
  };
  const off = raceNet.on((m: RaceServerMsg) => {
    if (m.t === 'room') {
      sync();
      draw();
      driveIn();
    }
    else if (m.t === 'load') {
      starting = true;
      ctx.drive(roomRace(m));
    } else if (m.t === 'error') {
      starting = true; // the socket is gone anyway
      ctx.replace({ name: 'drive', notice: m.message });
    }
  });
  // Your car in the lobby follows your garage: switch cars, repaint or tune it (here or in the garage) and the room
  // sees it. Sent again whenever the room has an old one (a change made while a race was on is only taken after it).
  const sync = () => {
    const room = raceNet.room;
    const me = room?.racers.find((r) => r.id === raceNet.id);
    if (!room || !me || (room.phase !== 'lobby' && room.phase !== 'results')) return;
    const car = encodeCar(current(garage.g));
    const rider = encodeRider(garage.g.rider);
    if (me.car !== car) raceNet.send({ t: 'car', car });
    if (me.rider !== rider) raceNet.send({ t: 'rider', rider });
  };
  const offGarage = garage.onChange(() => {
    sync();
    if (!pitOff) draw();
  });
  const quick = () => view.querySelector<HTMLButtonElement>('[data-start]')?.click();
  addEventListener('padstart', quick);
  draw();
  driveIn();
  return () => {
    pitOff?.();
    pitOff = null;
    clearTimeout(pitFade);
    off();
    offGarage();
    removeEventListener('padstart', quick);
    releasePortraits();
    if (!starting) raceNet.leave();
  };
};
