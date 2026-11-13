// The bus's card table: blackjack against the dealer, and Texas Hold'em against the rest of the crew (poker.ts is
// its referee, on the host), both for your own scrap. Plain DOM with real buttons, so the mouse and the pad's menu
// navigation both work; the session frees the pointer while one's open.

import type { Audio } from './audio.ts';
import type { PokerMove, PokerView } from './poker.ts';
import { STAKES } from './poker.ts';
import type { Minigame } from './minigames.ts';
import { BLACKJACK, bjPay, bjTotal, handName, rankOf, shuffled, suitOf } from './rules.ts';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['♠', '♥', '♦', '♣'];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** A playing card (face down when `c` is -1). */
function cardEl(c: number) {
  if (c < 0) return el('span', 'bd-pc back', '🧟');
  const s = suitOf(c);
  return el('span', `bd-pc${s === 1 || s === 2 ? ' red' : ''}`, `${RANKS[rankOf(c)]}${SUITS[s]}`);
}

function shell(title: string, how: string) {
  const root = el('div', 'bd-mini bd-cards');
  root.append(el('h2', '', title), el('p', 'bd-mini-how', how));
  const body = el('div', 'bd-cards-body');
  const out = el('p', 'bd-mini-out', 'Esc / Ⓑ: leave the table');
  root.append(body, out);
  return { root, body };
}

function button(text: string, on: () => void, enabled = true) {
  const b = el('button', 'bd-btn', text);
  b.disabled = !enabled;
  b.onclick = on;
  return b;
}

/** Blackjack: bet, hit, stand or double; the dealer draws to 17; a natural pays 3:2. */
export class Blackjack implements Minigame {
  el: HTMLElement;
  readonly menu = true;
  private body: HTMLElement;
  private deck: number[] = [];
  private mine: number[] = [];
  private dealer: number[] = [];
  private bet = 0;
  private state: 'bet' | 'play' | 'done' = 'bet';
  private result = '';

  constructor(
    private cash: () => number,
    private report: (delta: number) => void,
    private audio: Audio,
  ) {
    const s = shell('BLACKJACK', 'Beat the dealer to 21 without going over. The dealer draws to 17. Blackjack pays 3 to 2.');
    this.el = s.root;
    this.body = s.body;
    this.draw();
  }

  update() {}

  private deal(bet: number) {
    this.bet = bet;
    this.deck = shuffled(Math.random);
    this.mine = [this.deck.pop()!, this.deck.pop()!];
    this.dealer = [this.deck.pop()!, this.deck.pop()!];
    this.state = 'play';
    this.audio.play('reload', 0.6);
    if (bjTotal(this.mine) === 21) this.finish();
    else this.draw();
  }

  private finish() {
    if (bjTotal(this.mine) <= 21) while (bjTotal(this.dealer) < BLACKJACK.dealerStands) this.dealer.push(this.deck.pop()!);
    const delta = bjPay(this.mine, this.dealer, this.bet);
    this.report(delta);
    this.state = 'done';
    this.result = delta > 0 ? `You win ${delta} scrap!` : delta < 0 ? `You lose ${-delta} scrap.` : 'Push. Your scrap back.';
    this.audio.play(delta > 0 ? 'win' : delta < 0 ? 'lose' : 'cash', 0.7);
    this.draw();
  }

  private draw() {
    const b = this.body;
    b.replaceChildren();
    const cash = this.cash();
    if (this.state === 'bet') {
      b.append(el('p', 'bd-cards-line', `Your scrap: ${cash}. What's the bet?`));
      const row = el('div', 'bd-cards-row');
      BLACKJACK.bets.forEach((bet, i) => {
        const btn = button(`Bet ${bet}`, () => this.deal(bet), cash >= bet);
        if (i === 0) btn.dataset.autofocus = '';
        row.append(btn);
      });
      b.append(row);
      if (cash < BLACKJACK.bets[0]) b.append(el('p', 'bd-cards-line', 'You’re broke. Go paint some zombies.'));
    } else {
      const hide = this.state === 'play';
      const d = el('div', 'bd-cards-hand');
      d.append(el('b', '', `Dealer${hide ? '' : `: ${bjTotal(this.dealer)}`}`), ...this.dealer.map((c, i) => cardEl(hide && i === 1 ? -1 : c)));
      const m = el('div', 'bd-cards-hand');
      m.append(el('b', '', `You: ${bjTotal(this.mine)}`), ...this.mine.map(cardEl));
      b.append(d, m, el('p', 'bd-cards-line', this.state === 'done' ? this.result : `Bet: ${this.bet} scrap`));
      const row = el('div', 'bd-cards-row');
      if (this.state === 'play') {
        const hit = button('Hit', () => {
          this.mine.push(this.deck.pop()!);
          this.audio.play('reload', 0.4);
          if (bjTotal(this.mine) >= 21) this.finish();
          else this.draw();
        });
        hit.dataset.autofocus = '';
        row.append(
          hit,
          button('Stand', () => this.finish()),
          button(
            `Double (${this.bet * 2})`,
            () => {
              this.bet *= 2;
              this.mine.push(this.deck.pop()!);
              this.finish();
            },
            this.mine.length === 2 && cash >= this.bet * 2,
          ),
        );
      } else {
        const again = button('Deal again', () => {
          this.state = 'bet';
          this.draw();
        });
        again.dataset.autofocus = '';
        row.append(again);
      }
      b.append(row);
    }
    (b.querySelector('[data-autofocus]:not(:disabled)') as HTMLElement | null)?.focus();
  }
}

/** Texas Hold'em: sit down, and the host deals. Your two cards are yours; the five in the middle are everyone's. */
export class PokerTable implements Minigame {
  el: HTMLElement;
  readonly menu = true;
  private body: HTMLElement;
  private view: PokerView | null = null;
  private hole: number[] = [];
  private key = '';

  constructor(
    /** My place in the crew. */
    private me: number,
    private name: (place: number) => string,
    private cash: () => number,
    private send: (m: PokerMove, n: number) => void,
    private audio: Audio,
  ) {
    const s = shell('TEXAS HOLD’EM', 'Two cards each, five in the middle, four rounds of betting. Fixed limit, and your own scrap on the line.');
    this.el = s.root;
    this.body = s.body;
    this.draw();
  }

  update() {}

  /** The table as the host tells it. */
  setView(v: PokerView) {
    const was = this.view;
    this.view = v;
    if (v.phase === 'show' && was?.phase !== 'show') {
      const mine = v.seats.indexOf(this.me);
      this.audio.play(mine >= 0 && v.won[mine] > 0 ? 'win' : 'cash', 0.7);
    } else if (was && v.board.length > was.board.length) this.audio.play('reload', 0.5);
    this.draw();
  }

  /** My own two cards (only I'm sent them). */
  setHand(cards: number[]) {
    this.hole = cards;
    this.draw();
  }

  private get seat() {
    return this.view ? this.view.seats.indexOf(this.me) : -1;
  }

  private draw() {
    const v = this.view;
    const cash = this.cash();
    // The same picture again: leave the buttons (and the pad's focus) alone.
    const key = JSON.stringify([v, this.hole, cash]);
    if (key === this.key) return;
    this.key = key;
    const b = this.body;
    b.replaceChildren();
    const line = (t: string, cls = '') => b.append(el('p', `bd-cards-line${cls ? ' ' + cls : ''}`, t));
    const row = el('div', 'bd-cards-row');
    if (!v) {
      line('Pulling up a chair…');
      return;
    }
    const seat = this.seat;
    const playing = seat >= 0 && v.live[seat] && !v.folded[seat];

    // Everyone at the table: their scrap, what they've pushed in, and their cards.
    const seats = el('div', 'bd-seats');
    v.seats.forEach((who, s) => {
      if (who < 0) return;
      const r = el('div', `bd-seat${v.turn === s ? ' turn' : ''}${v.folded[s] && v.live[s] ? ' out' : ''}`);
      const top = el('div', 'bd-seat-top');
      top.append(el('b', '', who === this.me ? 'You' : this.name(who)));
      if (v.button === s) top.append(el('span', 'bd-chip', 'D'));
      if (v.allIn[s] && v.live[s] && !v.folded[s]) top.append(el('span', 'bd-chip red', 'ALL IN'));
      top.append(el('span', 'bd-seat-cash', `🔩 ${v.stack[s]}`));
      r.append(top);
      const hand = el('div', 'bd-cards-hand small');
      const shown = v.shown[s];
      if (shown.length) hand.append(...shown.map(cardEl));
      else if (who === this.me && this.hole.length) hand.append(...this.hole.map(cardEl));
      else if (v.live[s] && !v.folded[s]) hand.append(cardEl(-1), cardEl(-1));
      else if (!v.live[s]) hand.append(el('span', 'bd-seat-note', 'next hand'));
      if (v.folded[s] && v.live[s]) hand.append(el('span', 'bd-seat-note', 'folded'));
      r.append(hand);
      if (v.phase === 'show' && shown.length) r.append(el('p', 'bd-seat-note', handName(v.best[s])));
      if (v.bet[s] > 0) r.append(el('p', 'bd-seat-note', `bet ${v.bet[s]}`));
      if (v.phase === 'show' && v.won[s] > 0) r.append(el('p', 'bd-seat-won', `+${v.won[s]} 🔩`));
      seats.append(r);
    });
    b.append(seats);

    if (v.phase !== 'wait') {
      const board = el('div', 'bd-cards-hand');
      board.append(...v.board.map(cardEl));
      for (let i = v.board.length; i < 5; i++) board.append(el('span', 'bd-pc slot'));
      b.append(board);
      const inFront = v.bet.reduce((a, c) => a + c, 0);
      line(`Pot: ${v.pot + inFront} 🔩`, 'big');
    }

    if (v.phase === 'wait' || v.phase === 'show') {
      // Between hands: sit down, deal, or get up.
      if (seat < 0) {
        const open = v.seats.every((w) => w < 0);
        line(`Your scrap: ${cash}.`);
        if (open) {
          STAKES.forEach((st, i) => {
            const btn = button(`Sit: blinds ${Math.round(st / 2)}/${st}`, () => this.send('sit', i), cash >= st);
            if (i === 0) btn.dataset.autofocus = '';
            row.append(btn);
          });
        } else {
          const btn = button(`Sit down (blinds ${Math.round(v.stake / 2)}/${v.stake})`, () => this.send('sit', 0), cash >= v.stake);
          btn.dataset.autofocus = '';
          row.append(btn);
          if (cash < v.stake) line(`You need ${v.stake} scrap for this table.`);
        }
      } else {
        const ready = v.seats.filter((w) => w >= 0).length;
        const deal = button(ready >= 2 ? (v.phase === 'show' ? 'Next hand' : 'Deal') : 'Waiting for a friend…', () => this.send('deal', 0), ready >= 2 && cash >= v.stake);
        deal.dataset.autofocus = '';
        row.append(deal, button('Get up', () => this.send('leave', 0)));
        if (ready >= 2 && cash < v.stake) line(`You’re short of the ${v.stake} blind. Go and paint some zombies.`);
      }
    } else if (!playing) {
      line(seat < 0 ? 'Watching the hand…' : v.live[seat] ? 'You folded. Sit tight.' : 'You’re in on the next hand.');
      if (seat >= 0) row.append(button('Get up', () => this.send('leave', 0)));
    } else if (v.turn !== seat) {
      line(`Waiting on ${this.name(v.seats[v.turn]) || 'them'}…`);
    } else {
      // My move.
      line(`${handName([...this.hole, ...v.board].slice(0, 5))}${v.board.length ? '' : ' in the hole'}`);
      const first = (btn: HTMLButtonElement) => {
        btn.dataset.autofocus = '';
        return btn;
      };
      if (v.toCall > 0) {
        row.append(first(button(`Call ${v.toCall}`, () => this.send('call', 0))), button('Fold', () => this.send('fold', 0)));
      } else {
        row.append(first(button('Check', () => this.send('check', 0))));
      }
      if (v.raise > 0) row.append(button(v.toCall > 0 ? `Raise to ${v.raise}` : `Bet ${v.raise}`, () => this.send('raise', 0)));
    }
    b.append(row);
    (b.querySelector('[data-autofocus]:not(:disabled)') as HTMLElement | null)?.focus();
  }
}
