// The race lobby: the code to share, the host's track pick, who's in and what they drive, and Start.
// When the host starts, everyone drops into the race together; the race itself waits for every racer to load.

import { CARS, CLASS_COLORS, PAINTS, carSpec, decodeCar, encodeCar, rating } from '../../shared/race/cars.ts';
import { current } from '../../shared/race/garage.ts';
import { CAR_RULES, RACE_MODES, type CarRule, type RaceMode, type RaceServerMsg } from '../../shared/race/protocol.ts';
import { TRACK_DEFS, type TrackId } from '../../shared/race/track.ts';
import type { Render } from '../menu/router.ts';
import { $, copy, esc, playerName } from '../menu/ui.ts';
import { garage } from './garageStore.ts';
import { raceNet } from './racenet.ts';
import './race.css';

export const driveLobby: Render = (root, ctx, screen) => {
  let starting = false;
  // A deep link (/?race=CODE) or a reload: connect first.
  if (!raceNet.connected) {
    if (screen.code) raceNet.join(playerName(), encodeCar(current(garage.g)), screen.code);
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
    const racers = room.racers
      .map((r) => {
        const c = decodeCar(r.car);
        const cls = c ? rating(carSpec(c)) : null;
        return `<li class="${r.id === raceNet.id ? 'me' : ''}">
          <i class="tg-swatch" style="background:${c ? '#' + PAINTS[c.look.paint].toString(16).padStart(6, '0') : '#888'}"></i>
          <b>${esc(r.name)}</b>${r.id === room.hostId ? '<span class="tg-tag">Host</span>' : ''}${r.id === raceNet.id ? '<span class="tg-tag you">You</span>' : ''}
          <span class="car">${c ? esc(CARS[c.model].name) : ''}</span>
          ${cls ? `<span class="tg-class" style="--c:${CLASS_COLORS[cls.cls]}"><b>${cls.cls}</b>${cls.pi}</span>` : ''}
        </li>`;
      })
      .join('');
    const tracks = (Object.keys(TRACK_DEFS) as TrackId[])
      .map((id) => `<button class="tg-track small ${id}" data-pick="${id}" aria-pressed="${id === room.track}" ${isHost && room.phase === 'lobby' ? '' : 'disabled'}><b>${esc(TRACK_DEFS[id].name)}</b></button>`)
      .join('');
    const canPick = isHost && room.phase === 'lobby';
    const modes = (Object.keys(RACE_MODES) as RaceMode[])
      .map((id) => `<button class="tg-pill" data-mode="${id}" aria-pressed="${id === room.mode}" ${canPick ? '' : 'disabled'}><b>${esc(RACE_MODES[id].name)}</b><small>${esc(RACE_MODES[id].blurb)}</small></button>`)
      .join('');
    // A time trial's car rule: own cars, one spec car for everyone, or everyone's car maxed out.
    const rules =
      room.mode === 'trial'
        ? `<h2 class="tg-h">Cars</h2><div class="tg-modes">${(Object.keys(CAR_RULES) as CarRule[])
            .map((id) => `<button class="tg-pill" data-rule="${id}" aria-pressed="${id === room.cars}" ${canPick ? '' : 'disabled'}><b>${esc(CAR_RULES[id].name)}</b><small>${esc(CAR_RULES[id].blurb)}</small></button>`)
            .join('')}</div>`
        : '';
    const state =
      room.phase === 'lobby'
        ? isHost
          ? `<button class="tg-go" data-start data-autofocus>${room.mode === 'trial' ? 'Start time trial' : 'Start race'} ▸</button>`
          : `<p class="tg-muted">Waiting for the host to start…</p>`
        : `<p class="tg-muted">A race is under way. You'll line up for the next one.</p>`;
    root.innerHTML = `
      <main class="tg tg-lobby" aria-label="Race lobby">
        <header class="tg-top">
          <button class="tg-home" data-back>◀ Leave</button>
          <div class="tg-logo" aria-hidden="true">TŌGE</div>
          <div></div>
          <div class="tg-wallet"><small>Race code</small><b class="tg-bigcode">${esc(room.code)}</b></div>
        </header>
        <section class="tg-lobby-body">
          <div class="tg-lobby-col">
            <h2 class="tg-h">Game ${isHost ? '<small>you pick</small>' : ''}</h2>
            <div class="tg-modes">${modes}</div>
            ${rules}
            <h2 class="tg-h">Pass</h2>
            <div class="tg-tracks">${tracks}</div>
            <div class="tg-row">
              <button class="tg-pill" data-copy>Copy code</button>
              <button class="tg-pill" data-link>Copy invite link</button>
            </div>
            ${state}
          </div>
          <div class="tg-lobby-col">
            <h2 class="tg-h">Racers <small>${room.racers.length} / 8</small></h2>
            <ul class="tg-racers">${racers}</ul>
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
  const offGarage = garage.onChange(() => raceNet.send({ t: 'car', car: encodeCar(current(garage.g)) }));
  const quick = () => root.querySelector<HTMLButtonElement>('[data-start]')?.click();
  addEventListener('padstart', quick);
  draw();
  $(root, 'main')?.setAttribute('tabindex', '-1');
  return () => {
    off();
    offGarage();
    removeEventListener('padstart', quick);
    if (!starting) raceNet.leave();
  };
};
