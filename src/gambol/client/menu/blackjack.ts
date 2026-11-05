import { type Card, type Round, canDouble, handValue } from '../../shared/casino.ts';
import type { StashAction } from '../../shared/stash.ts';
import { stash } from '../inventoryStore.ts';
import { sfx } from '../sfx.ts';
import { coinText } from './lootui.ts';
import { $, toast } from '../../../client/menu/ui.ts';

const RESULT: Record<NonNullable<Round['outcome']>, string> = {
  blackjack: 'Blackjack! Pays 2 to 1',
  win: 'You win',
  push: 'Push: your bet comes back',
  lose: 'Dealer wins',
  bust: 'Bust',
};

const cardHtml = (c: Card | null, i: number) =>
  c
    ? `<div class="bj-card ${c.suit === '♥' || c.suit === '♦' ? 'red' : ''}" style="--i:${i}"><b>${c.rank}</b><span>${c.suit}</span></div>`
    : `<div class="bj-card back" style="--i:${i}"></div>`;

/** The Blackjack tab: bet coins against the house. Dealer stands on 17, blackjack pays 2:1, double on any first two cards. */
export function mountBlackjack(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="bj">
      <div class="bj-table">
        <div class="bj-row"><h4>Dealer <em id="bj-dv"></em></h4><div class="bj-hand" id="bj-dealer"></div></div>
        <p class="bj-msg" id="bj-msg" role="status">Place your bet and deal.</p>
        <div class="bj-row"><h4>You <em id="bj-pv"></em></h4><div class="bj-hand" id="bj-player"></div></div>
      </div>
      <div class="bj-controls">
        <div class="bj-bet" id="bj-betbox">
          <label class="bet-field">Bet <input id="bj-bet" type="number" min="1" step="1" value="10" inputmode="numeric" /></label>
          <div class="bet-quick"><button class="pick" data-bet="min">Min</button><button class="pick" data-bet="half">½</button><button class="pick" data-bet="double">2×</button><button class="pick" data-bet="max">Max</button></div>
          <button class="primary big" id="bj-deal">Deal</button>
        </div>
        <div class="bj-actions" id="bj-actions" hidden>
          <button class="primary" id="bj-hit">Hit</button>
          <button id="bj-stand">Stand</button>
          <button id="bj-double">Double</button>
        </div>
        <p class="notice" id="bj-note" role="status"></p>
        <p class="bj-rules">Six decks. Dealer stands on all 17s. Blackjack pays 2:1. Double on your first two cards. Chips are coins.</p>
      </div>
    </div>`;
  const bet = $<HTMLInputElement>(root, '#bj-bet');
  const dealBtn = $<HTMLButtonElement>(root, '#bj-deal');
  const note = $(root, '#bj-note');
  let round: Round | null = null;
  /** Waiting on the dealer (the server, for an account): one move at a time. */
  let busy = false;

  const amount = () => Math.floor(Number(bet.value));
  const sync = () => {
    const n = amount();
    dealBtn.disabled = busy || !(n >= 1 && n <= stash.inv.coins);
    if (!round) note.textContent = n > stash.inv.coins ? 'Not enough coins' : n < 1 || !Number.isFinite(n) ? 'Bet at least 1 coin' : '';
    const dbl = $<HTMLButtonElement>(root, '#bj-double');
    dbl.disabled = busy || !round || !canDouble(round) || stash.inv.coins < round.bet;
  };
  bet.addEventListener('input', sync);
  const offStash = stash.onChange(sync);

  const show = () => {
    const r = round;
    const playing = !!r && !r.done;
    // While it's played the dealer's hole card stays face down (an account's hand doesn't even send it).
    $(root, '#bj-dealer').innerHTML = r ? [...r.dealer.slice(0, playing ? 1 : undefined), ...(playing ? [null] : [])].map((c, i) => cardHtml(c, i)).join('') : '';
    $(root, '#bj-player').innerHTML = r ? r.player.map((c, i) => cardHtml(c, i)).join('') : '';
    $(root, '#bj-dv').textContent = r ? (playing ? `${handValue([r.dealer[0]]).total}` : `${handValue(r.dealer).total}`) : '';
    $(root, '#bj-pv').textContent = r ? `${handValue(r.player).total}` : '';
    $(root, '#bj-betbox').hidden = playing;
    $(root, '#bj-actions').hidden = !playing;
    if (r?.done) {
      const delta = r.payout - r.bet;
      $(root, '#bj-msg').innerHTML = `${RESULT[r.outcome!]}: ${delta > 0 ? `+${coinText(delta)}` : delta < 0 ? `−${coinText(-delta)}` : 'even'}`;
    } else if (playing) $(root, '#bj-msg').textContent = 'Hit, stand or double?';
    sync();
  };

  /** One move at the table; the winnings are paid as the hand ends. */
  const play = async (op: Extract<StashAction, { a: 'bj' }>['op'], stake?: number) => {
    if (busy) return;
    busy = true;
    sync();
    const r = await stash.act({ a: 'bj', op, bet: stake });
    busy = false;
    if (!r.ok || !r.round) {
      sync();
      return toast(r.ok ? 'Something went wrong.' : r.error);
    }
    round = r.round;
    if (op !== 'stand') sfx.caseTick();
    if (round.done && round.payout > round.bet) sfx.coin();
    show();
  };

  dealBtn.addEventListener('click', () => {
    sfx.unlock();
    const n = amount();
    if (n > stash.inv.coins) return toast('Not enough coins');
    void play('deal', n);
  });
  $(root, '#bj-hit').addEventListener('click', () => {
    if (round && !round.done) void play('hit');
  });
  $(root, '#bj-stand').addEventListener('click', () => {
    if (round && !round.done) void play('stand');
  });
  $(root, '#bj-double').addEventListener('click', () => {
    if (!round || !canDouble(round)) return;
    if (stash.inv.coins < round.bet) return toast('Not enough coins to double');
    void play('double');
  });
  root.querySelector('.bet-quick')!.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-bet]')?.dataset.bet;
    const n = Math.max(1, amount() || 1);
    const next = k === 'min' ? 1 : k === 'half' ? Math.max(1, Math.floor(n / 2)) : k === 'double' ? n * 2 : stash.inv.coins;
    bet.value = String(Math.max(1, Math.min(next, Math.max(1, stash.inv.coins))));
    sync();
  });

  show();
  return () => {
    offStash();
    // Walking away mid-hand stands for you, so the stake is never lost to a half-played round.
    if (round && !round.done) void stash.act({ a: 'bj', op: 'stand' });
  };
}
