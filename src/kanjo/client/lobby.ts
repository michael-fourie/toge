// The race lobby: the code to share, the host's track pick, who's in and what they drive (and the crew: every
// racer's driver, standing in a row), the picked track's leaderboard (leaderboardui.ts lobbyBoard), your car
// (switch between your cars), and Start. Cars are always your own and the record ghost is always on.
// When the host starts, everyone drops into the race together (even from the garage); the race itself waits for
// every racer to load.

import { CARS, CLASS_COLORS, PAINTS, PAINT_NAMES, carSpec, decodeCar, encodeCar, isBike, peakPower, rating } from '../shared/cars.ts';
import { current } from '../shared/garage.ts';
import { lapsLabel, raceKm } from './loadingcopy.ts';
import { ENDURANCE, PHYSICS, RACE, RACE_MODES, TEAMS, cleanLaps, isGp, modeTracks, recordMode, type RaceMode, type RaceServerMsg, type Team } from '../shared/protocol.ts';
import { TRACK_DEFS, type TrackId } from '../shared/track.ts';
import type { Render } from '../../client/menu/router.ts';
import { copy, esc, playerName } from '../../client/menu/ui.ts';
import { garage } from './garageStore.ts';
import { raceNet, roomRace } from './racenet.ts';
import { fmtTime } from './hud.ts';
import { ICON, LOGO } from './brand.ts';
import { boardApi, lobbyBoard } from './leaderboardui.ts';
import type { BoardRow } from '../shared/records.ts';
import { account } from '../../client/account.ts';
import { cupCard, trackClimb, trackKind, trackMap, trackStyle, trackTile } from './trackart.ts';
import { CUP_IDS, CUPS, roundsOf, type CupId } from '../shared/cups.ts';
import { TRACK_LENGTH_KM } from '../shared/garage.ts';
import { encodeRider } from '../shared/rider.ts';
import { CREW_PORTRAIT, racerPortrait, releasePortraits, riderPortrait } from './riderportrait.ts';
import './race.css';
import './hub.css';

const START: Record<RaceMode, string> = { race: 'Start race', trial: 'Start time trial', climb: 'Start hill climb', gp: 'Start Grand Prix', team: 'Start Team Grand Prix', roam: 'Start free roam', royale: 'Start battle royale', endurance: 'Start endurance race' };

/** Endurance's quick picks under the lap counter. */
const LAP_PICKS = [1, 5, 10, 25, 50, 100];

/** A racer's face for the grid list: their portrait, cropped to the head (`ready`: redraw once it's drawn). */
const face = (rider: string, ready: () => void) => {
  const pic = riderPortrait(rider, ready);
  return pic ? `background-image:url(${pic})` : '';
};

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** How long a fetched board stays fresh in the lobby before the next redraw asks again (a lobby can sit a while). */
const BOARD_FRESH_MS = 60_000;

export const driveLobby: Render = (root, ctx, screen) => {
  let starting = false;
  // The screen's shell (`.tg`, which fades in) is made once; every room update only redraws what's inside it.
  // Rebuilding the shell replayed that fade from transparent, so each join or car change flashed the whole screen.
  root.innerHTML = '<div data-lobby-view><main class="tg tg-lobby" aria-label="Race lobby" tabindex="-1"></main></div>';
  const view = root.querySelector<HTMLElement>('.tg-lobby')!;
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

  // The leaderboard of the picked track, fetched when the track changes and again when it's gone stale or the lobby
  // comes back from a race (a time trial there may have moved it).
  const boards = new Map<TrackId, { rows: BoardRow[] | null; at: number }>();
  const fetching = new Set<TrackId>();
  let lastPhase = '';
  const boardFor = (track: TrackId) => {
    const have = boards.get(track);
    if (!fetching.has(track) && (!have || Date.now() - have.at > BOARD_FRESH_MS)) {
      fetching.add(track);
      void boardApi.board(track).then((rows) => {
        fetching.delete(track);
        boards.set(track, { rows, at: Date.now() });
        if (raceNet.room?.track === track) redraw();
      });
    }
    return have;
  };
  const draw = () => {
    const room = raceNet.room;
    if (!room) {
      view.innerHTML = `<p class="tg-status">Connecting…</p>`;
      return;
    }
    const scroll = view.querySelector('.tg-lobby-body')?.scrollTop ?? 0;
    const isHost = room.hostId === raceNet.id;
    const focus = (document.activeElement as HTMLElement | null)?.dataset;
    const focusKey = focus?.pick ? `[data-pick="${focus.pick}"]` : focus?.random !== undefined ? '[data-random]' : focus?.cup ? `[data-cup="${focus.cup}"]` : focus?.mode ? `[data-mode="${focus.mode}"]` : focus?.physics ? `[data-physics="${focus.physics}"]` : focus?.start !== undefined ? '[data-start]' : focus?.addcpu !== undefined ? '[data-addcpu]' : focus?.swap ? `[data-swap="${focus.swap}"]` : focus?.team ? `[data-team="${focus.team}"]` : focus?.lapstep ? `[data-lapstep="${focus.lapstep}"]` : focus?.lapset ? `[data-lapset="${focus.lapset}"]` : focus?.lapin !== undefined ? '[data-lapin]' : null;
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
          <div class="tg-racer"><i class="tg-face" aria-hidden="true" style="--paint:${c ? hex(PAINTS[c.look.paint]) : '#888'};${face(r.rider, redraw)}"></i><b>${esc(r.name)}</b>${teamChip(r)}${r.id === room.hostId ? '<span class="tg-tag">Host</span>' : ''}${r.id === raceNet.id ? '<span class="tg-tag you">You</span>' : ''}${r.cpu ? '<span class="tg-tag cpu">CPU</span>' : ''}${r.cpu && canPick ? `<button class="tg-kick" data-kick="${r.id}" aria-label="Remove ${esc(r.name)}" title="Remove">×</button>` : ''}</div>
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
        const pic = racerPortrait(r.car, r.rider, redraw);
        const c = decodeCar(r.car);
        return `<figure class="tg-crew-m ${r.id === raceNet.id ? 'me' : ''} ${crewShown.has(r.id) ? '' : 'new'}">
          ${pic ? `<img src="${pic}" alt="" width="${CREW_PORTRAIT.w}" height="${CREW_PORTRAIT.h}" />` : '<span class="tg-crew-none"></span>'}
          <figcaption><b>${esc(r.name)}</b><small>${c ? esc(CARS[c.model].name) : ''}</small></figcaption>
        </figure>`;
      })
      .join('');
    // A Grand Prix (or a Team Grand Prix): the host picks a cup (its four tracks, in order) instead of a track.
    const gp = isGp(room.mode);
    const cups = CUP_IDS.map((id) => cupCard(id, `data-cup="${id}" aria-pressed="${id === room.cup}" aria-label="${esc(CUPS[id].name)}" ${canPick ? '' : 'disabled'}`, room.gp && room.gp.cup === id ? room.gp.round : -1)).join('');
    // First tile: Random, which rolls one of the mode's other tracks (the host can keep rolling).
    const pool = modeTracks(room.mode);
    const random =
      pool.length > 1
        ? `<button class="tg-track tg-track-random" data-random aria-label="Random track" title="Pick a random track" ${canPick ? '' : 'disabled'}><span class="tg-random-die">${ICON.dice}</span><b>Random</b><small>Roll a track</small></button>`
        : '';
    const tracks = random + pool.map((id) => trackTile(id, `data-pick="${id}" aria-pressed="${id === room.track}" aria-label="${esc(TRACK_DEFS[id].name)}" ${canPick ? '' : 'disabled'}`)).join('');
    const modes = (Object.keys(RACE_MODES) as RaceMode[])
      .map((id) => `<button class="tg-mode" data-mode="${id}" aria-pressed="${id === room.mode}" ${canPick ? '' : 'disabled'}><b>${esc(RACE_MODES[id].name)}</b><small>${esc(RACE_MODES[id].blurb)}</small></button>`)
      .join('');
    // Physics mode: crash damage, for either mode. A survival road (track.ts `survival`) always has it: the switch shows
    // On and can't be turned off there.
    const survival = !!TRACK_DEFS[room.track]?.survival;
    const crashOn = room.physics || survival;
    const physics = (['off', 'on'] as const)
      .map((k) => `<button class="tg-mode" data-physics="${k}" aria-pressed="${(k === 'on') === crashOn}" ${canPick && !survival ? '' : 'disabled'}><b>${esc(PHYSICS[k].name)}</b><small>${esc(k === 'on' && survival ? 'Always on for this track' : PHYSICS[k].blurb)}</small></button>`)
      .join('');
    // The record ghost: the track record's run rides along (the host's pick); say whose it'd be.
    // (Not in a battle royale: a ghost can't be knocked out.)
    const royale = room.mode === 'royale';
    // Endurance: the host sets the distance, 1 to 100 laps (−/+, type a number, or a quick pick). No record ghost:
    // the record is the circuit's own distance.
    const endurance = room.mode === 'endurance';
    const laps = room.laps ?? ENDURANCE.start;
    const off = canPick ? '' : 'disabled';
    const lapPicker = endurance
      ? `<h2 class="tg-h">Laps ${canPick ? '<small>you pick</small>' : ''}</h2>
            <div class="tg-laps">
              <div class="tg-laps-count">
                <button class="tg-pill tg-laps-step" data-lapstep="-1" aria-label="One lap fewer" ${canPick && laps > ENDURANCE.min ? '' : 'disabled'}>−</button>
                <label class="tg-laps-num"><input type="number" class="tg-num" data-lapin min="${ENDURANCE.min}" max="${ENDURANCE.max}" step="1" value="${laps}" aria-label="Laps" ${off} /><small>${laps === 1 ? 'lap' : 'laps'}</small></label>
                <button class="tg-pill tg-laps-step" data-lapstep="1" aria-label="One lap more" ${canPick && laps < ENDURANCE.max ? '' : 'disabled'}>+</button>
                <span class="tg-muted tg-laps-km"><span class="tg-num">${raceKm(room.track, laps)}</span> km</span>
              </div>
              <div class="tg-row tg-laps-picks">${LAP_PICKS.map((n) => `<button class="tg-pill" data-lapset="${n}" aria-pressed="${n === laps}" ${off}>${lapsLabel(n)}</button>`).join('')}</div>
            </div>`
      : '';
    const ghostNote = gp || roam || royale || endurance || !room.ghost ? '' : room.record ? `<p class="tg-muted tg-ghost-note">Ghost: <b>${esc(room.record.name)}</b> · <span class="tg-num">${fmtTime(room.record.time)}</span>, the record on ${esc(TRACK_DEFS[room.track].name)}.</p>` : `<p class="tg-muted tg-ghost-note">No ghost on ${esc(TRACK_DEFS[room.track].name)} yet: the next record set here leaves one.</p>`;
    const state =
      room.phase === 'lobby'
        ? isHost
          ? `<button class="tg-go" data-start data-autofocus>${ICON.flag}${START[room.mode]}</button><span class="tg-muted">${roam ? 'Share the code: friends can drive in any time while it’s on.' : room.racers.length < 2 ? (royale ? 'Share the code or add CPU racers: a battle royale needs someone to outlast.' : 'Share the code, add CPU racers, or start now and race the clock.') : `${room.racers.length} racers on the grid.`}</span>`
          : `<span class="tg-muted">Waiting for the host to start…</span>`
        : roam
          ? `<span class="tg-muted">Free roam is on. Driving in…</span>`
          : room.gp
          ? `<span class="tg-muted">The ${esc(CUPS[room.gp.cup].name)} is under way (round ${room.gp.round + 1} of ${roundsOf(room.gp.cup)}). You'll line up for the next round.</span>`
          : `<span class="tg-muted">A race is under way. You'll line up for the next one.</span>`;
    const d = TRACK_DEFS[room.track];
    if (room.phase === 'lobby' && lastPhase && lastPhase !== 'lobby') boards.delete(room.track);
    lastPhase = room.phase;
    // Free roam's open world keeps no times, so it has no board.
    const board = d.world ? null : boardFor(room.track);
    const leaderboard = d.world
      ? ''
      : lobbyBoard({
          track: room.track,
          rows: board?.rows ?? null,
          failed: !!board && !board.rows,
          user: account.user,
          here: new Set(room.racers.filter((r) => !r.cpu).map((r) => r.name.toLowerCase())),
          counts: recordMode(room.mode),
        });
    crewShown = new Set(room.racers.map((r) => r.id));
    view.innerHTML = `
        <header class="tg-top">
          <button class="tg-home" data-back aria-label="Leave the lobby">${ICON.back}</button>
          ${LOGO}
          <div class="tg-lobby-title">${gp ? `${teamMode ? 'Team Grand Prix · ' : ''}${esc(CUPS[room.cup].name)}` : endurance ? `Endurance · ${lapsLabel(laps)}` : `${RACE_MODES[room.mode].name} lobby`}${crashOn ? (survival ? ' · Survival' : ' · Physics') : ''}${room.ghost && !gp && !roam && !royale && !endurance ? ' · Record ghost' : ''}</div>
          <div class="tg-roomcode"><small>Race<br />code</small><b class="tg-bigcode">${esc(room.code)}</b></div>
        </header>
        <section class="tg-lobby-body${isHost ? '' : ' guest'}">
          <div class="tg-lobby-col">
            <section class="tg-hero" style="${trackStyle(room.track)}">
              <span class="tg-hero-art" aria-hidden="true"></span>
              <div class="tg-hero-map">${trackMap(room.track)}</div>
              <div class="tg-hero-copy">
                <small class="tg-eyebrow">${gp ? esc(`${CUPS[room.cup].name} · round ${(room.gp?.cup === room.cup ? room.gp.round : 0) + 1} of ${roundsOf(room.cup)}`) : esc(trackKind(room.track, endurance ? laps : undefined))}</small>
                <h1 class="tg-display">${esc(d.name)}</h1>
                <p>${esc(d.tag)}</p>
              </div>
              <dl class="tg-hero-facts"><div><dt>${d.world ? 'Roads' : 'Distance'}</dt><dd class="tg-num">${endurance ? raceKm(room.track, laps) : TRACK_LENGTH_KM[room.track]}<small>km</small></dd></div>${endurance ? `<div><dt>Laps</dt><dd class="tg-num">${laps}</dd></div>` : ''}${d.climb ? `<div><dt>Climb</dt><dd class="tg-num">${trackClimb(room.track)}<small>m</small></dd></div>` : ''}</dl>
            </section>
            ${leaderboard}
            <h2 class="tg-h">Mode ${canPick ? '<small>you pick</small>' : ''}</h2>
            <div class="tg-modes">${modes}</div>
            ${lapPicker}
            <h2 class="tg-h">${esc(PHYSICS.name)} ${canPick ? '<small>you pick</small>' : ''}</h2>
            <div class="tg-modes">${physics}</div>
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
            ${myCar()}
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
    view.querySelector('[data-random]')?.addEventListener('click', () => {
      const others = pool.filter((id) => id !== room.track);
      raceNet.send({ t: 'track', track: others[Math.floor(Math.random() * others.length)] });
    });
    view.querySelectorAll<HTMLElement>('[data-cup]').forEach((b) => b.addEventListener('click', () => raceNet.send({ t: 'cup', cup: b.dataset.cup as CupId })));
    view.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => raceNet.send({ t: 'mode', mode: b.dataset.mode as RaceMode })));
    view.querySelectorAll<HTMLElement>('[data-physics]').forEach((b) => b.addEventListener('click', () => raceNet.send({ t: 'physics', on: b.dataset.physics === 'on' })));
    const setLaps = (n: number) => {
      const next = cleanLaps(n);
      if (next !== null && next !== laps) raceNet.send({ t: 'laps', laps: next });
    };
    view.querySelectorAll<HTMLElement>('[data-lapstep]').forEach((b) => b.addEventListener('click', () => setLaps(laps + Number(b.dataset.lapstep))));
    view.querySelectorAll<HTMLElement>('[data-lapset]').forEach((b) => b.addEventListener('click', () => setLaps(Number(b.dataset.lapset))));
    const lapIn = view.querySelector<HTMLInputElement>('[data-lapin]');
    lapIn?.addEventListener('change', () => {
      setLaps(lapIn.valueAsNumber);
      // A number out of range (or nothing) snaps back to what the room has, or to the clamped one it's sending.
      lapIn.value = String(cleanLaps(lapIn.valueAsNumber) ?? laps);
    });
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
    view.querySelectorAll<HTMLElement>('[data-swap]').forEach((b) => b.addEventListener('click', () => void swap(Number(b.dataset.swap))));
    (view.querySelector<HTMLElement>(focusKey ?? '[data-autofocus]') ?? view.querySelector<HTMLElement>('[data-copy]'))?.focus({ preventScroll: true });
  };

  /** Your car's card: what you'll line up in, and the arrows to switch to another of your cars. */
  const myCar = () => {
    const g = garage.g;
    const c = current(g);
    const b = CARS[c.model];
    const sp = carSpec(c);
    const r = rating(sp);
    const cos = Object.values(c.cos ?? {}).filter(Boolean).length;
    const many = g.cars.length > 1;
    return `<div class="tg-mycar tg-cardbox" style="--paint:${hex(PAINTS[c.look.paint])}">
      <i class="tg-mycar-paint" aria-hidden="true"></i>
      <div class="tg-mycar-head">
        <div><small>${esc(b.maker)} · ${isBike(c.model) ? 'Bike' : b.drive}</small><b class="tg-title">${esc(b.name)}</b></div>
        <span class="tg-class" style="--c:${CLASS_COLORS[r.cls]}"><b>${r.cls}</b>${r.pi}</span>
      </div>
      <p class="tg-mycar-meta tg-num">${Math.round(peakPower(sp).kw * 1.341)} hp · ${Math.round(sp.mass)} kg · ${esc(PAINT_NAMES[c.look.paint])}${cos ? ` · ${cos} cosmetic${cos === 1 ? '' : 's'}` : ''}</p>
      <div class="tg-mycar-act">
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
    draw();
  });
  const quick = () => view.querySelector<HTMLButtonElement>('[data-start]')?.click();
  addEventListener('padstart', quick);
  draw();
  driveIn();
  return () => {
    off();
    offGarage();
    removeEventListener('padstart', quick);
    releasePortraits();
    if (!starting) raceNet.leave();
  };
};
