import {
  ACCESSORIES,
  HAIR,
  JACKETS,
  MOUTHS,
  PRESETS,
  SCARF,
  STYLES,
  type Skin,
  randomSkin,
  sameSkin,
  seededSkin,
} from '../../shared/skin.ts';
import { saveSkin, storedSkin } from '../skinStore.ts';
import type { Render } from './router.ts';
import { $, esc, hex, sheet, storedName } from './ui.ts';
import './skin.css';
import { DEFAULT_JACKET, mountSkinPreview } from './skinPreview.ts';

/** Short label for the home-screen chip: the preset's name, "Custom", or "Default". */
export function skinLabel(skin: Skin | null): string {
  if (!skin) return 'Default';
  const { jacket, ...look } = skin;
  return PRESETS.find((p) => sameSkin(p.skin, look))?.name ?? 'Custom';
}

const chip = (act: string, val: string | number, label: string, on: boolean) =>
  `<button class="pick" data-act="${act}" data-val="${val}" aria-pressed="${on}">${esc(label)}</button>`;
const swatch = (act: string, val: string | number, color: number | null, label: string, on: boolean) =>
  `<button class="swatch${color === null ? ' auto' : ''}" data-act="${act}" data-val="${val}" aria-pressed="${on}" aria-label="${esc(label)}" title="${esc(label)}"${color === null ? '' : ` style="--c:${hex(color)}"`}>${color === null ? 'A' : ''}</button>`;

export const skin: Render = (root) => {
  // null = the seeded default. Editing a piece first materialises the default so you tweak what you see.
  let cur: Skin | null = storedSkin();
  const name = storedName().trim();
  const effective = (): Skin => cur ?? seededSkin(JACKETS[0], name);

  root.innerHTML = sheet(
    'Skin',
    `<div class="skin-layout">
      <div class="skin-stage"><canvas class="skin-preview" aria-label="Preview of your character"></canvas><p class="skin-name" id="skin-name"></p></div>
      <div class="skin-opts" id="opts"></div>
    </div>
    <div class="cta"><button class="primary big" data-back>Done</button></div>`,
  );
  const preview = mountSkinPreview($<HTMLCanvasElement>(root, '.skin-preview'));

  const apply = () => {
    const s = effective();
    saveSkin(cur);
    preview.show(cur, s.jacket === undefined ? DEFAULT_JACKET : JACKETS[s.jacket], name);
    $(root, '#skin-name').textContent = skinLabel(cur);
  };

  const render = () => {
    const s = effective();
    const group = (title: string, body: string) => `<section class="skin-group"><h3>${title}</h3><div class="skin-row">${body}</div></section>`;
    $(root, '#opts').innerHTML = `
      <section class="skin-group"><h3>Looks</h3><div class="skin-row">
        ${PRESETS.map((p, i) => chip('preset', i, p.name, !!cur && sameSkin({ ...s, jacket: undefined }, p.skin))).join('')}
      </div></section>
      <div class="skin-row skin-actions">
        <button class="pick" data-act="random">Surprise me</button>
        <button class="pick" data-act="default" aria-pressed="${!cur}">Default (from my name)</button>
      </div>
      ${group('Hair style', STYLES.map((v) => chip('style', v, v, s.style === v)).join(''))}
      ${group('Hair colour', HAIR.map((c, i) => swatch('hair', i, c, `Hair colour ${i + 1}`, s.hair === i)).join(''))}
      ${group('Face', MOUTHS.map((v) => chip('mouth', v, v, s.mouth === v)).join(''))}
      ${group('Accessory', ACCESSORIES.map((v) => chip('accessory', v, v === 'none' ? 'nothing' : v, s.accessory === v)).join('') + chip('ahoge', 'toggle', 'ahoge (hair tuft)', s.ahoge))}
      ${group('Scarf', SCARF.map((c, i) => swatch('scarf', i, c, `Scarf colour ${i + 1}`, s.scarf === i)).join(''))}
      ${group(
        'Jacket <small>online, you get it if no one else has it</small>',
        swatch('jacket', 'x', null, 'Auto: the server picks', s.jacket === undefined) + JACKETS.map((c, i) => swatch('jacket', i, c, `Jacket colour ${i + 1}`, s.jacket === i)).join(''),
      )}`;
  };

  $(root, '#opts').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
    if (!b) return;
    const { act, val } = b.dataset as { act: string; val: string };
    const s = { ...effective() };
    if (act === 'default') cur = null;
    else if (act === 'random') cur = { ...randomSkin(), jacket: s.jacket };
    else if (act === 'preset') cur = { ...PRESETS[Number(val)].skin, jacket: s.jacket };
    else {
      if (act === 'style') s.style = val as Skin['style'];
      else if (act === 'mouth') s.mouth = val as Skin['mouth'];
      else if (act === 'accessory') s.accessory = val as Skin['accessory'];
      else if (act === 'ahoge') s.ahoge = !s.ahoge;
      else if (act === 'hair') s.hair = Number(val);
      else if (act === 'scarf') s.scarf = Number(val);
      else if (act === 'jacket') {
        if (val === 'x') delete s.jacket;
        else s.jacket = Number(val);
      }
      cur = s;
    }
    render();
    root.querySelector<HTMLElement>(`[data-act="${act}"][data-val="${val}"]`)?.focus();
    apply();
  });

  render();
  apply();
  return () => preview.dispose();
};
