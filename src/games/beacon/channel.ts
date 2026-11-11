// BEACON: a first-person parkour climb up Skerry, a sea stack with a dead lighthouse on top. Climb with friends
// (each on your own, no ropes), race to light the beacon. See CLAUDE.md in this folder.

import type { GameChannel } from '../types.ts';
import { paintBanner } from './banner.ts';
import { mount } from './game.ts';

const channel: GameChannel = {
  id: 'beacon',
  title: 'BEACON',
  tagline: 'Climb the sea stack. Light the lamp.',
  about:
    'A first-person parkour climb up Skerry, a sea stack off a cold coast with a lighthouse that has been dark for forty years. Sprint, slide, wall-run, climb walls and grab ledges from the tide line to the lantern, 165 metres up. Climb with up to 12 friends and see each other on the rock. Fall, and the rock keeps what you lost.',
  facts: ['1–12 players online', 'First person', 'Mouse & keyboard or controller', 'Golden hour'],
  order: 20,
  banner: (canvas) => paintBanner(canvas),
  mount,
};

export default channel;
