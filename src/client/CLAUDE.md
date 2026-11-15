# src/client: the page shell in the browser

The page KANJO runs inside: boot, the screen router, the account screen, controllers and touch setup, the Graphics
setting and the small menu kit the screens use. The game itself is in `src/kanjo/client/` (guide: `src/kanjo/CLAUDE.md`).
The shell came from the Gambol site this repo was split from; it imports KANJO to wire it in, and KANJO imports these
pieces back.

## Files

```
  main.ts         boots the page: touch + pad setup, account.refresh(), the screen router (SCREENS: `drive` = KANJO's
                  garage, the home page; `drivelobby` = a race lobby; `account`), the ?race=CODE deep link, and
                  ctx.drive, which shows KANJO's loading screen and starts a RaceGame
  menu/router.ts  the history-backed screen router (ScreenName, Screen, Ctx, DriveOpts); browser Back, ← Back and Esc
                  all match; Back at depth 0 goes to the garage
  menu/ui.ts      the menu kit: $(), esc() for HTML, playerName(), toast(), copy(), replay()
  menu/account.ts the sign-in / create-account screen, and Change password when signed in, in KANJO's look
                  (account.css, built on the tg tokens and components from src/kanjo/client/hub.css)
  account.ts      who's signed in (asks `/api/me`; the session cookie is HttpOnly)
  pad.ts          gamepads for every menu (spatial focus, A/B/LB/RB) and for driving (readPad, padAxis, rumble)
  graphics.ts     the Graphics setting, High / Low, saved per device (`atrous.graphics`; picked in the Settings tab):
                  lowGraphics(), frameGate(fps) for Low's frame cap, LOW_PIXEL_RATIO
  touch.ts        phones/tablets: IS_TOUCH, html.touch, the rotate-your-phone card, fullscreen; touch.css holds every
                  mobile style, all under html.touch, so desktop never changes
  styles.css      global styles (loaded by index.html); much of it is the old Gambol shell's and unused now
  env.d.ts        Vite client types
```

## Rules

- Never put player names or anything from the network into HTML strings: use `textContent` or `esc()` (menu/ui.ts).
- Mobile styles and input live under `html.touch` / `IS_TOUCH` only; desktop paths never change for mobile.
- The client is not trusted for anything that matters (see `src/server/CLAUDE.md`).
