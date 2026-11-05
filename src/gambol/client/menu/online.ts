// Gambol's server pill: the host and join screens check the shooter's server before going online.

import type { LobbyInfo } from '../../shared/protocol.ts';
import { $ } from '../../../client/menu/ui.ts';
import type { Net } from '../net.ts';
import { sfx } from '../sfx.ts';

export const SERVER_PILL = `<p class="pill" data-pill role="status" aria-live="polite"></p>`;

/**
 * Checks the server and reflects the state in the screen's pill: connecting → online, or offline with Retry.
 * Resolves the open lobbies, or null when the server can't be reached.
 */
export async function goOnline(root: HTMLElement, net: Net): Promise<LobbyInfo[] | null> {
  const pill = $(root, '[data-pill]');
  const set = (state: string, html: string) => {
    if (!pill) return;
    pill.dataset.state = state;
    pill.innerHTML = html;
  };
  sfx.unlock();
  set('connecting', '<i class="mini-leaf"></i> Reaching the sky server…');
  try {
    const lobbies = await net.lobbies();
    set('online', '<i class="dot"></i> Server online');
    return lobbies;
  } catch {
    const hint = import.meta.env.DEV ? ' Is <code>npm run dev</code> running?' : '';
    set('offline', `Can't reach the sky server.${hint} <button class="link" data-retry>Retry</button>`);
    $(root, '[data-retry]')?.addEventListener('click', () => void goOnline(root, net));
    return null;
  }
}
