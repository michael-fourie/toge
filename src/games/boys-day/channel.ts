// BOYS DAY: a co-op zombie road trip. Wake up hungover in the paintball arena after the apocalypse started, and
// drive a battered city bus home through Kingston while the boys paint zombies out of the windows. A new map every run.

import type { GameChannel } from '../types.ts';
import { paintBanner } from './banner.ts';
import { mount } from './game.ts';

const channel: GameChannel = {
  id: 'boys-day',
  title: 'BOYS DAY',
  tagline: 'An endless zombie road trip. Every checkpoint is a new world.',
  about:
    'You wake up in the paintball arena after the biggest night of your lives, and the world has ended. Drive the bus from checkpoint to checkpoint, each one a new world: hop off, do the job, unlock shotguns, miniguns and paint grenades, and spend your scrap on the bus. Between stops, rip the bong, crack a cold one and play blackjack or heads-up poker for it. There is no finish line.',
  facts: ['1–8 players online', 'Co-op', 'Controller', 'Endless: thousands of checkpoints'],
  order: 35,
  banner: (canvas) => paintBanner(canvas),
  mount,
};

export default channel;
