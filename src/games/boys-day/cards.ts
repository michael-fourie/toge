// The bus's card table: blackjack against the dealer, and heads-up five-card draw against a friend (duel.ts is its
// referee, on the host), both for your own scrap. Plain DOM with real buttons, so the mouse and the pad's menu
// navigation both work; the session frees the pointer while one's open.

import type { Audio } from './audio.ts';
import type { DuelMove, DuelView } from './duel.ts';
import type { Minigame } from './minigames.ts';
import { BLACKJACK, DUEL, bjPay, bjTotal, handName, rankOf, shuffled, suitOf } from './rules.ts';

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

/** Heads-up five-card draw: sit down with an ante, swap cards once, then check, raise, call or fold. */
export class DuelTable implements Minigame {
  el: HTMLElement;
  readonly menu = true;
  private body: HTMLElement;
  private view: DuelView | null = null;
  private hand: number[] = [];
  /** The cards I'm throwing away (a bit each). */
  private toss = 0;
  private key = '';

  constructor(
    /** My place in the crew. */
    private me: number,
    private name: (place: number) => string,
    private cash: () => number,
    private send: (m: DuelMove, n: number) => void,
    private audio: Audio,
  ) {
    const s = shell('HEADS-UP POKER', 'Five-card draw against a friend, for your own scrap. Ante up, swap the cards you don’t want once, then bet.');
    this.el = s.root;
    this.body = s.body;
    this.draw();
  }

  update() {}

  /** The table as the host tells it. */
  setView(v: DuelView) {
    const was = this.view?.phase;
    this.view = v;
    if (v.phase === 'draw' && was !== 'draw') this.toss = 0;
    if (v.phase === 'show' && was !== 'show') this.audio.play(v.winner >= 0 && v.seats[v.winner] === this.me ? 'win' : 'cash', 0.7);
    this.draw();
  }

  /** My own cards (only I'm sent them). */
  setHand(cards: number[]) {
    this.hand = cards;
    this.draw();
  }

  private draw() {
    const v = this.view;
    // The same picture again: leave the buttons (and the pad's focus) alone.
    const key = JSON.stringify([v, this.hand, this.toss, this.cash()]);
    if (key === this.key) return;
    this.key = key;
    const b = this.body;
    b.replaceChildren();
    const line = (t: string) => b.append(el('p', 'bd-cards-line', t));
    const row = el('div', 'bd-cards-row');
    if (!v) {
      line('Pulling up a chair…');
      return;
    }
    const seat = v.seats.indexOf(this.me);
    const who = (s: number) => (v.seats[s] === this.me ? 'You' : v.seats[s] >= 0 ? this.name(v.seats[s]) : 'An empty chair');
    const seats = el('p', 'bd-cards-seats');
    seats.append(el('b', '', who(0)), el('span', '', ' vs '), el('b', '', who(1)), el('span', '', v.pot ? ` · pot ${v.pot}` : ` · ante ${v.ante}`));
    b.append(seats);
    const cash = this.cash();
    if (v.phase === 'wait' || (v.phase === 'show' && seat < 0)) {
      if (v.phase === 'show') this.showdown(v);
      if (seat >= 0) {
        line('Waiting for someone to sit down across from you…');
        row.append(button('Get up', () => this.send('leave', 0)));
      } else if (v.phase === 'show' || v.seats[0] < 0) {
        line(`Your scrap: ${cash}. Sit down and name the ante (you need double it, for a raise).`);
        DUEL.antes.forEach((a, i) => {
          const btn = button(`Sit: ante ${a}`, () => this.send('sit', i), cash >= a * 2);
          if (i === 0) btn.dataset.autofocus = '';
          row.append(btn);
        });
      } else if (v.seats[1] < 0) {
        const btn = button(`Sit down (ante ${v.ante})`, () => this.send('sit', 0), cash >= v.ante * 2);
        btn.dataset.autofocus = '';
        row.append(btn);
        if (cash < v.ante * 2) line(`You need ${v.ante * 2} scrap to sit at this table.`);
      }
    } else if (seat < 0) {
      line(v.phase === 'draw' ? 'They’re swapping cards…' : 'They’re betting…');
    } else if (v.phase === 'draw') {
      if (v.drew[seat]) {
        this.cards(this.hand);
        line('Waiting for them to draw…');
      } else {
        const hand = el('div', 'bd-cards-hand');
        this.hand.forEach((c, i) => {
          const btn = el('button', `bd-pcb${(this.toss >> i) & 1 ? ' toss' : ''}`);
          btn.append(cardEl(c));
          btn.onclick = () => {
            this.toss ^= 1 << i;
            this.draw();
          };
          hand.append(btn);
        });
        b.append(hand);
        line(`${handName(this.hand)}. Pick the cards to throw away, then draw.`);
        const n = this.hand.filter((_, i) => (this.toss >> i) & 1).length;
        const go = button(n ? `Draw ${n}` : 'Stand pat', () => this.send('draw', ~this.toss & 31));
        go.dataset.autofocus = '';
        row.append(go);
      }
    } else if (v.phase === 'bet') {
      this.cards(this.hand);
      line(`${handName(this.hand)}.`);
      if (v.turn !== seat) line(v.raised ? 'You raised. Will they call?' : 'Their move…');
      else if (v.raised) {
        const call = button(`Call ${v.ante}`, () => this.send('call', 0), cash >= v.ante);
        call.dataset.autofocus = '';
        row.append(call, button('Fold', () => this.send('fold', 0)));
      } else {
        const check = button('Check', () => this.send('check', 0));
        check.dataset.autofocus = '';
        row.append(check, button(`Raise ${v.ante}`, () => this.send('raise', 0), cash >= v.ante));
      }
    } else {
      this.showdown(v);
      const again = button(`Again (ante ${v.ante})`, () => this.send('sit', Math.max(0, DUEL.antes.indexOf(v.ante as 10))), cash >= v.ante * 2);
      again.dataset.autofocus = '';
      row.append(again);
    }
    b.append(row);
    (b.querySelector('[data-autofocus]:not(:disabled)') as HTMLElement | null)?.focus();
  }

  private cards(hand: readonly number[]) {
    const h = el('div', 'bd-cards-hand');
    h.append(...hand.map(cardEl));
    this.body.append(h);
  }

  private showdown(v: DuelView) {
    v.shown.forEach((hand, s) => {
      if (!hand.length) return;
      const h = el('div', 'bd-cards-hand');
      const label = el('b');
      label.textContent = `${v.seats[s] === this.me ? 'You' : this.name(v.seats[s])}: ${handName(hand)}`;
      h.append(label, ...hand.map(cardEl));
      this.body.append(h);
    });
    const w = v.winner;
    const p = el('p', 'bd-cards-line big');
    p.textContent = w < 0 ? 'Split pot.' : v.seats[w] === this.me ? `You take the pot: ${v.pot} scrap!` : `${this.name(v.seats[w])} takes the pot (${v.pot} scrap).${v.shown[0].length ? '' : ' A fold.'}`;
    this.body.append(p);
  }
}
