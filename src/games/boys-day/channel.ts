// BOYS DAY: a co-op zombie road trip. Wake up hungover in the paintball arena after the apocalypse started, and
// drive a battered city bus home through Kingston while the boys paint zombies out of the windows. A new map every run.

import type { GameChannel } from '../types.ts';
import { paintBanner } from './banner.ts';
import { mount } from './game.ts';

const channel: GameChannel = {
  id: 'boys-day',
  title: 'BOYS DAY',
  tagline: 'Drive the bus home. Paint the zombies. Bong tokes await.',
  about:
    'You wake up in the paintball arena after the biggest night of your lives, and the world has ended. One of you drives the bus; the rest lean out of the windows with paintball markers. Win a golf club at the driving range, the bail money at the casino, spring Gordie from jail, and get home to the boys’ house. Every run is a new map.',
  facts: ['1–8 players online', 'Co-op', 'Controller', 'New map every run'],
  order: 35,
  banner: (canvas) => paintBanner(canvas),
  mount,
};

export default channel;
