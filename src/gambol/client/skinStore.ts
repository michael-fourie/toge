// The player's chosen skin, saved per browser. No saved skin = look seeded from name + colour.

import { type Skin, decodeSkin, encodeSkin } from '../shared/skin.ts';

const KEY = 'atrous.skin';

/** The saved skin code, or '' for the seeded default. Always well-formed (re-validated on read). */
export function storedSkinCode(): string {
  try {
    const skin = decodeSkin(localStorage.getItem(KEY));
    return skin ? encodeSkin(skin) : '';
  } catch {
    return '';
  }
}

export const storedSkin = (): Skin | null => decodeSkin(storedSkinCode());

export function saveSkin(skin: Skin | null) {
  try {
    if (skin) localStorage.setItem(KEY, encodeSkin(skin));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}
