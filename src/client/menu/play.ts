// Runs a plug-in game (a folder in src/games/) full screen. The game gets a GameApi; Esc / Ⓑ / browser
// Back leave it (its cleanup runs), unless the game handles Escape itself.

import { CHANNELS } from '../../games/registry.ts';
import { listParties, openParty } from '../../games/party.ts';
import type { GameApi } from '../../games/types.ts';
import { account } from '../account.ts';
import { readPad, rumble, setMenuNav } from '../pad.ts';
import type { Render } from './router.ts';
import { esc, playerName } from './ui.ts';

export const play: Render = (root, ctx, screen) => {
  const channel = CHANNELS.find((c) => c.id === screen.gameId);
  if (!channel?.mount) {
    ctx.replace({ name: 'games' });
    return;
  }
  root.innerHTML = `<main class="game-host" aria-label="${esc(channel.title)}"></main>`;
  const host = root.querySelector<HTMLElement>('.game-host')!;
  const parties = new Set<{ leave(): void }>();
  const api: GameApi = {
    name: playerName(),
    signedIn: !!account.user,
    exit: () => ctx.back(),
    readPad,
    rumble,
    setMenuNav,
    party: {
      host: async () => {
        const p = await openParty(channel.id, playerName());
        parties.add(p);
        return p;
      },
      join: async (code) => {
        const p = await openParty(channel.id, playerName(), code);
        parties.add(p);
        return p;
      },
      list: () => listParties(channel.id),
    },
  };
  let cleanup: (() => void) | void;
  try {
    cleanup = channel.mount(host, api);
  } catch (e) {
    console.error(`[games] ${channel.id} failed to start`, e);
    host.innerHTML = `<p class="game-host-error">${esc(channel.title)} hit an error starting up. Press Esc to go back.</p>`;
  }
  return () => {
    try {
      cleanup?.();
    } catch (e) {
      console.error(`[games] ${channel.id} cleanup failed`, e);
    }
    for (const p of parties) p.leave();
    setMenuNav(true);
  };
};
