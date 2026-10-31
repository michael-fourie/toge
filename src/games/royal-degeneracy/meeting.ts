// The house meeting overlay: who called it and why, the clock, the vote grid (real buttons, so mouse, keyboard
// and pad all work), and the meeting chat for anyone not on voice. Ghosts' chat only reaches other ghosts.

interface Voter {
  id: number;
  name: string;
  img: string;
  /** Still in the house (can vote and be voted for). */
  in: boolean;
  voted: boolean;
  me: boolean;
}

export interface MeetingView {
  phase: 'meeting' | 'vote';
  title: string;
  sub: string;
  voters: Voter[];
  canVote: boolean;
  /** Who I voted for (-1 skip), or null. */
  mine: number | null;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class Meeting {
  readonly root = el('div', 'rd-meeting');
  private head = el('div', 'rd-meethead');
  private time = el('b', 'rd-meettime');
  private grid = el('div', 'rd-votes');
  private log = el('ul', 'rd-chatlog');
  private input = document.createElement('input');
  private last = '';

  constructor(
    parent: HTMLElement,
    private h: { vote(id: number): void; chat(text: string): void },
  ) {
    this.root.dataset.navScope = '';
    const side = el('div', 'rd-chat');
    this.input.maxLength = 160;
    this.input.placeholder = 'Say something (Enter)';
    this.input.setAttribute('aria-label', 'Meeting chat');
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && this.input.value.trim()) {
        this.h.chat(this.input.value.trim());
        this.input.value = '';
      }
    });
    side.append(this.log, this.input);
    const main = el('div', 'rd-meetmain');
    main.append(this.head, this.time, this.grid);
    this.root.append(main, side);
    this.root.style.display = 'none';
    parent.append(this.root);
  }

  show(v: MeetingView) {
    this.root.style.display = '';
    const key = JSON.stringify(v);
    if (key === this.last) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.vote;
    this.last = key;
    this.head.replaceChildren(el('h2', '', v.title), el('p', '', v.sub));
    this.grid.replaceChildren();
    const button = (id: number, label: string, img: string, voter?: Voter) => {
      const b = el('button', 'rd-vote');
      b.dataset.vote = String(id);
      if (img) {
        const i = document.createElement('img');
        i.src = img;
        i.alt = '';
        b.append(i);
      }
      b.append(el('b', '', label));
      if (voter?.voted) b.append(el('small', 'rd-voted', 'voted'));
      if (voter && !voter.in) b.classList.add('out');
      if (v.mine === id) b.classList.add('mine');
      b.disabled = !v.canVote || v.mine !== null || (!!voter && !voter.in);
      b.addEventListener('click', () => this.h.vote(id));
      this.grid.append(b);
      return b;
    };
    for (const p of v.voters) button(p.id, p.name + (p.me ? ' (you)' : ''), p.img, p);
    button(-1, 'Skip vote', '');
    if (this.typing) return;
    const again = focused ? this.grid.querySelector<HTMLElement>(`[data-vote="${focused}"]`) : null;
    (again && !(again as HTMLButtonElement).disabled ? again : this.grid.querySelector<HTMLButtonElement>('button:not([disabled])'))?.focus({ preventScroll: true });
  }

  setTime(text: string) {
    this.time.textContent = text;
  }

  addChat(name: string, text: string, ghost: boolean) {
    const li = el('li', ghost ? 'ghost' : '');
    li.append(el('b', '', `${name}: `), document.createTextNode(text));
    this.log.append(li);
    while (this.log.children.length > 60) this.log.firstElementChild!.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  hide() {
    this.root.style.display = 'none';
    this.last = '';
    if (document.activeElement === this.input) this.input.blur();
  }

  get typing() {
    return document.activeElement === this.input;
  }
}
