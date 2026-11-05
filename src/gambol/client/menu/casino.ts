import { stash } from '../inventoryStore.ts';
import { mountBlackjack } from './blackjack.ts';
import { mountCases } from './cases.ts';
import { mountCrash } from './crash.ts';
import { coinText } from './lootui.ts';
import { mountPlinko } from './plinko.ts';
import type { Render } from '../../../client/menu/router.ts';
import { $, sheet } from '../../../client/menu/ui.ts';
import './casino.css';

const GAMES = [
  { id: 'cases', label: 'Cases', mount: mountCases },
  { id: 'plinko', label: 'Plinko', mount: mountPlinko },
  { id: 'blackjack', label: 'Blackjack', mount: mountBlackjack },
  { id: 'crash', label: 'Crash', mount: mountCrash },
] as const;
type Game = (typeof GAMES)[number]['id'];

/** The Casino: spend coins on cases, drop Plinko balls, play the house at Blackjack, or fly a Crash kite. */
export const casino: Render = (root, _ctx, screen) => {
  root.innerHTML = sheet(
    'Casino',
    `<div class="loot-bar"><span class="coin-total" id="coins"></span>
      <div class="tabs casino-tabs" role="tablist">${GAMES.map((g) => `<button role="tab" data-game="${g.id}">${g.label}</button>`).join('')}</div></div>
    <div id="game-pane"></div>`,
  );
  $(root, '.sheet').classList.add('wide');
  const pane = $(root, '#game-pane');
  let stop: (() => void) | null = null;
  let current: Game | null = null;

  const open = (id: Game) => {
    if (id === current) return;
    stop?.();
    current = id;
    root.querySelectorAll<HTMLElement>('[data-game]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.game === id)));
    pane.className = `game-${id}`;
    stop = GAMES.find((g) => g.id === id)!.mount(pane);
  };
  root.querySelector('.casino-tabs')!.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-game]')?.dataset.game as Game | undefined;
    if (id) open(id);
  });

  const paint = () => ($(root, '#coins').innerHTML = coinText(stash.inv.coins));
  const off = stash.onChange(paint);
  paint();
  open(screen.game ?? 'cases');
  return () => {
    off();
    stop?.();
  };
};
