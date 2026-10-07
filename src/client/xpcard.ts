// Level progress after a game: your level, a bar that fills from where you started to where you are now, the XP
// earned and what it came from. Used on the Survival post-game board and the Battle match-over card.

import { levelOf } from '../shared/levels.ts';

export interface XpLine {
  label: string;
  count: number;
  xp: number;
}

/** The card's HTML. `start` and `end` are total XP before and after the game. */
function xpCard(start: number, end: number, lines: readonly XpLine[]): string {
  const a = levelOf(start);
  const b = levelOf(end);
  const up = b.level > a.level;
  const from = up ? 0 : (a.into / a.need) * 100;
  const to = (b.into / b.need) * 100;
  const rows = lines
    .filter((l) => l.xp > 0)
    .map((l) => `<li><span>${l.label}${l.count > 1 ? ` ×${l.count}` : ''}</span><b>+${l.xp}</b></li>`)
    .join('');
  return `
    <div class="xpcard${up ? ' up' : ''}">
      <div class="xp-head">
        <span class="xp-badge">LV <b>${b.level}</b></span>
        ${up ? `<span class="xp-up">LEVEL UP!</span>` : ''}
        <span class="xp-gain">+${end - start} XP</span>
      </div>
      <div class="xp-bar"><i style="width:${from}%" data-to="${to}"></i></div>
      <div class="xp-num">${b.into} / ${b.need} XP to level ${b.level + 1}</div>
      ${rows ? `<ul class="xp-lines">${rows}</ul>` : ''}
    </div>`;
}

/** Puts the card in `el` and lets the bar fill up. */
export function showXp(el: HTMLElement, start: number, end: number, lines: readonly XpLine[]) {
  el.innerHTML = xpCard(start, end, lines);
  const bar = el.querySelector<HTMLElement>('.xp-bar i');
  if (bar) requestAnimationFrame(() => requestAnimationFrame(() => (bar.style.width = `${bar.dataset.to}%`)));
}

/** A small level badge with a thin progress bar, for the home screen. */
export function levelBadge(total: number): string {
  const l = levelOf(total);
  return `<span class="lvl-badge" title="${l.into} / ${l.need} XP to level ${l.level + 1}"><em>LV <b>${l.level}</b></em><i><s style="width:${(l.into / l.need) * 100}%"></s></i></span>`;
}
