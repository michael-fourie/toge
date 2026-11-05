// TŌGE's logo and UI icons for the menus (hub.ts, lobby.ts). See src/toge/DESIGN.md §1 and §10.

/** Small line icons (DESIGN.md: no emoji for UI). */
export const ICON = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4h11l-1.5 4L16 12H5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  wrench: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L4 16.7 7.3 20l5.3-5.3a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.4-.6-.6-2.4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  spin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 3v4h-4M6 21v-4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/** The logo: the 峠 hanko and the wordmark. */
export const LOGO = `<div class="tg-logo" aria-label="TŌGE"><span class="tg-hanko" aria-hidden="true">峠</span><span class="tg-word" aria-hidden="true">TŌGE</span></div>`;
