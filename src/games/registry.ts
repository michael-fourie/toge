// Every channel on the console menu: the two built-in games, plus every folder in src/games/ that has a
// channel.ts (found at build time; folders starting with _ are skipped, e.g. _template).

import type { Screen } from '../client/menu/router.ts';
import { gambolBanner, tougeBanner } from '../client/menu/banners.ts';
import type { GameChannel } from './types.ts';

/** A channel: a plug-in game (mount) or a built-in one that has its own screens (screen). */
export type Channel = Omit<GameChannel, 'mount'> & ({ mount: GameChannel['mount']; screen?: undefined } | { mount?: undefined; screen: Screen });

const BUILT_IN: Channel[] = [
  {
    id: 'gambol',
    title: 'GAMBOL',
    tagline: 'Sky-island sniper brawls',
    about: 'Bhop, surf, slide and wallrun across floating islands with an AWP. Battle, King of the Hill, Battle Royale and Survival.',
    facts: ['1–12 players online', 'Practice vs bots', 'Mouse & keyboard'],
    order: 1,
    banner: gambolBanner,
    screen: { name: 'title' },
  },
  {
    id: 'touge',
    title: 'TŌGE',
    tagline: 'Mountain pass racing',
    about: 'Race your lobby down the mountain. Drift for boosts, grab mystery items, take the shortcuts, and spend your winnings on upgrade crates for a garage that follows your account.',
    facts: ['1–8 players online', 'Solo vs rivals', 'Controller recommended'],
    order: 2,
    banner: tougeBanner,
    screen: { name: 'drive' },
  },
];

const found = import.meta.glob<{ default: GameChannel }>(['./*/channel.ts', '!./_*/channel.ts'], { eager: true });

export const CHANNELS: Channel[] = [...BUILT_IN, ...Object.values(found).map((m) => m.default)].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));

if (import.meta.env.DEV) {
  const ids = new Set<string>();
  for (const c of CHANNELS) {
    if (!/^[a-z0-9-]{1,24}$/.test(c.id)) console.error(`[games] channel id "${c.id}" must be lowercase letters, digits and dashes`);
    if (ids.has(c.id)) console.error(`[games] two channels share the id "${c.id}"`);
    ids.add(c.id);
  }
}
