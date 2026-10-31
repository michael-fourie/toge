// ROYAL DEGENERACY: a first-person social-deduction party game in 282, our old university house. Housemates do
// chores and vote; the Degenerates take people out and lie about it. Design in DESIGN.md, screens in game.ts.

import type { GameChannel } from '../types.ts';
import { mount } from './game.ts';
import { paintHouse } from './housefront.ts';

const channel: GameChannel = {
  id: 'royal-degeneracy',
  title: 'ROYAL DEGENERACY',
  tagline: 'One of you did this.',
  about:
    'A first-person whodunit in 282, the old house, at real scale. Walk the actual hallways at night, do the chores, ring the pot for a house meeting and vote someone out into the rain. One or two of you are the Degenerates: take people out with a drumstick, act natural, and survive the Last Meeting.',
  facts: ['4–12 players online', 'First person', 'Controller', 'Proximity voice chat'],
  order: 40,

  banner: (canvas) => paintHouse(canvas),

  mount,
};

export default channel;
