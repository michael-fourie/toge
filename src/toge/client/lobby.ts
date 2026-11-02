// The race lobby: the code to share, the host's track pick, who's in and what they drive (and the crew: every
// racer's driver, standing in a row), and Start.
// When the host starts, everyone drops into the race together; the race itself waits for every racer to load.

import { CARS, CLASS_COLORS, PAINTS, carSpec, decodeCar, encodeCar, rating } from '../shared/cars.ts';
import { current } from '../shared/garage.ts';
import { CAR_RULES, RACE, RACE_MODES, type CarRule, type RaceMode, type RaceServerMsg } from '../shared/protocol.ts';
import { TRACK_DEFS, type TrackId } from '../shared/track.ts';
import type { Render } from '../../client/menu/router.ts';
import { $, copy, esc, playerName } from '../../client/menu/ui.ts';
import { garage } from './garageStore.ts';
import { raceNet } from './racenet.ts';
import { ICON, LOGO } from './brand.ts';
import { TRACK_IDS, trackKind, trackMap, trackStyle, trackTile } from './trackart.ts';
import { TRACK_LENGTH_KM } from '../shared/garage.ts';
import { encodeRider } from '../shared/rider.ts';
import { PORTRAIT, releasePortraits, riderPortrait } from './riderportrait.ts';
import './race.css';
import './hub.css';

/** A racer's face for the grid list: their portrait, cropped to the head. */
const face = (rider: string) => {
  const pic = riderPortrait(rider);
  return pic ? `background-image:url(${pic})` : '';
};

export const driveLobby: Render = (root, ctx, screen) => {
  let starting = false;
  // A deep link (/?race=CODE) or a reload: connect first.
  if (!raceNet.connected) {
    if (screen.code) raceNet.join(playerName(), encodeCar(current(garage.g)), encodeRider(garage.g.rider), screen.code);
    else {
      ctx.replace({ name: 'drive' });
      return;
    }
  }

  const draw = () => {
    const room = raceNet.room;
    if (!room) {
      root.innerHTML = `<main class="tg tg-lobby"><p class="tg-status">Connecting…</p></main>`;
      return;
    }
    const isHost = room.hostId === raceNet.id;
    const focus = (document.activeElement as HTMLElement | null)?.dataset;
    const focusKey = focus?.pick ? `[data-pick="${focus.pick}"]` : focus?.mode ? `[data-mode="${focus.mode}"]` : focus?.rule ? `[data-rule="${focus.rule}"]` : focus?.start !== undefined ? '[data-start]' : null;
    const max = RACE.maxPlayers;
    const racers =
      room.racers
        .map((r, i) => {
          const c = decodeCar(r.car);
          const cls = c ? rating(carSpec(c)) : null;
          return `<li class="${r.id === raceNet.id ? 'me' : ''}">
          <span class="tg-slot">${i + 1}</span>
          <div class="tg-racer"><i class="tg-face" aria-hidden="true" style="--paint:${c ? '#' + PAINTS[c.look.paint].toString(16).padStart(6, '0') : '#888'};${face(r.rider)}"></i><b>${esc(r.name)}</b>${r.id === room.hostId ? '<span class="tg-tag">Host</span>' : ''}${r.id === raceNet.id ? '<span class="tg-tag you">You</span>' : ''}</div>
          <span class="car">${c ? esc(CARS[c.model].name) : ''}</span>
          ${cls ? `<span class="tg-class" style="--c:${CLASS_COLORS[cls.cls]}"><b>${cls.cls}</b>${cls.pi}</span>` : '<span></span>'}
        </li>`;
        })
        .join('') + Array.from({ length: Math.max(0, max - room.racers.length) }, (_, i) => `<li class="open"><span class="tg-slot">${room.racers.length + i + 1}</span><span>Open slot</span></li>`).join('');
    // The crew: everyone's driver side by side, you in the middle of the light.
    const crew = room.racers
      .map((r) => {
        const pic = riderPortrait(r.rider);
        const c = decodeCar(r.car);
        return `<figure class="tg-crew-m ${r.id === raceNet.id ? 'me' : ''}">
          ${pic ? `<img src="${pic}" alt="" width="${PORTRAIT.w}" height="${PORTRAIT.h}" />` : '<span class="tg-crew-none"></span>'}
          <figcaption><b>${esc(r.name)}</b><small>${c ? esc(CARS[c.model].name) : ''}</small></figcaption>
        </figure>`;
      })
      .join('');
    const canPick = isHost && room.phase === 'lobby';
    const tracks = TRACK_IDS.map((id) => trackTile(id, `data-pick="${id}" aria-pressed="${id === room.track}" aria-label="${esc(TRACK_DEFS[id].name)}" ${canPick ? '' : 'disabled'}`)).join('');
    const modes = (Object.keys(RACE_MODES) as RaceMode[])
      .map((id) => `<button class="tg-mode" data-mode="${id}" aria-pressed="${id === room.mode}" ${canPick ? '' : 'disabled'}><b>${esc(RACE_MODES[id].name)}</b><small>${esc(RACE_MODES[id].blurb)}</small></button>`)
      .join('');
    // A time trial's car rule: own cars, one spec car for everyone, or everyone's car maxed out.
    const rules =
      room.mode === 'trial'
        ? `<h2 class="tg-h">Cars</h2><div class="tg-modes">${(Object.keys(CAR_RULES) as CarRule[])
            .map((id) => `<button class="tg-mode" data-rule="${id}" aria-pressed="${id === room.cars}" ${canPick ? '' : 'disabled'}><b>${esc(CAR_RULES[id].name)}</b><small>${esc(CAR_RULES[id].blurb)}</small></button>`)
            .join('')}</div>`
        : '';
    const state =
      room.phase === 'lobby'
        ? isHost
          ? `<button class="tg-go" data-start data-autofocus>${ICON.flag}${room.mode === 'trial' ? 'Start time trial' : 'Start race'}</button><span class="tg-muted">${room.racers.length < 2 ? 'Share the code, or start now and race the clock.' : `${room.racers.length} racers on the grid.`}</span>`
          : `<span class="tg-muted">Waiting for the host to start…</span>`
        : `<span class="tg-muted">A race is under way. You'll line up for the next one.</span>`;
    const d = TRACK_DEFS[room.track];
    root.innerHTML = `
      <main class="tg tg-lobby" aria-label="Race lobby">
        <header class="tg-top">
          <button class="tg-home" data-back aria-label="Leave the lobby">${ICON.back}</button>
          ${LOGO}
          <div class="tg-lobby-title">${room.mode === 'trial' ? 'Time trial' : 'Race'} lobby</div>
          <div class="tg-roomcode"><small>Race<br />code</small><b class="tg-bigcode">${esc(room.code)}</b></div>
        </header>
        <section class="tg-lobby-body">
          <div class="tg-lobby-col">
            <section class="tg-hero" style="${trackStyle(room.track)}">
              <span class="tg-hero-art" aria-hidden="true"></span>
              <div class="tg-hero-map">${trackMap(room.track)}</div>
              <div class="tg-hero-copy">
                <small class="tg-eyebrow">${esc(trackKind(room.track))}</small>
                <h1 class="tg-display">${esc(d.name)}</h1>
                <p>${esc(d.tag)}</p>
              </div>
              <dl class="tg-hero-facts"><div><dt>Distance</dt><dd class="tg-num">${TRACK_LENGTH_KM[room.track]}<small>km</small></dd></div></dl>
            </section>
            <h2 class="tg-h">Mode ${canPick ? '<small>you pick</small>' : ''}</h2>
            <div class="tg-modes">${modes}</div>
            ${rules}
            <h2 class="tg-h">Track ${canPick ? '<small>you pick</small>' : ''}</h2>
            <div class="tg-tracks">${tracks}</div>
          </div>
          <div class="tg-lobby-col">
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
        </section>
      </main>`;
    root.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => b.addEventListener('click', () => raceNet.send({ t: 'track', track: b.dataset.pick as TrackId })));
    root.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => raceNet.send({ t: 'mode', mode: b.dataset.mode as RaceMode })));
    root.querySelectorAll<HTMLElement>('[data-rule]').forEach((b) => b.addEventListener('click', () => raceNet.send({ t: 'cars', cars: b.dataset.rule as CarRule })));
    root.querySelector('[data-start]')?.addEventListener('click', () => raceNet.send({ t: 'start' }));
    root.querySelector('[data-copy]')?.addEventListener('click', () => void copy(room.code, 'Code'));
    root.querySelector('[data-link]')?.addEventListener('click', () => void copy(`${location.origin}/?race=${room.code}`, 'Invite link'));
    (root.querySelector<HTMLElement>(focusKey ?? '[data-autofocus]') ?? root.querySelector<HTMLElement>('[data-copy]'))?.focus({ preventScroll: true });
  };

  const off = raceNet.on((m: RaceServerMsg) => {
    if (m.t === 'room') draw();
    else if (m.t === 'load') {
      starting = true;
      const room = raceNet.room!;
      ctx.drive({ track: m.track, online: { net: raceNet, mode: m.mode, grid: m.grid, racers: room.racers, rule: m.rule, cars: m.cars } });
    } else if (m.t === 'error') {
      starting = true; // the socket is gone anyway
      ctx.replace({ name: 'drive', notice: m.message });
    }
  });
  // Your car in the lobby follows your garage (if you switch cars before the start).
  const offGarage = garage.onChange(() => {
    raceNet.send({ t: 'car', car: encodeCar(current(garage.g)) });
    raceNet.send({ t: 'rider', rider: encodeRider(garage.g.rider) });
  });
  const quick = () => root.querySelector<HTMLButtonElement>('[data-start]')?.click();
  addEventListener('padstart', quick);
  draw();
  $(root, 'main')?.setAttribute('tabindex', '-1');
  return () => {
    off();
    offGarage();
    removeEventListener('padstart', quick);
    releasePortraits();
    if (!starting) raceNet.leave();
  };
};
