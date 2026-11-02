# src/client: the site shell in the browser

The page every game runs inside: boot, the screen router, the game chooser, the account screen, controllers and touch
setup, and the small menu kit the games' screens use. The games themselves are elsewhere:

- Gambol (the shooter): `src/gambol/client/` (guide: `src/gambol/client/CLAUDE.md`, incl. "Verifying in the browser").
- TŌGE (racing): `src/toge/client/` (guide: `src/toge/CLAUDE.md`).
- Plug-in games: `src/games/<id>/` (guide: `src/games/CLAUDE.md`), mounted by `menu/play.ts`.

The shell may import the games (it wires them in); the games import the shell, never each other
(`tests/boundaries.test.ts`). Put code here only when more than one game uses it, or it is the site's own.

## Files

```
  main.ts         boots the site: touch + pad setup, account.refresh(), the menu router (SCREENS: the shell's screens plus
                  Gambol's and TŌGE's; default screen `games`, the channel grid), ?join= / ?race= deep links, the loading
                  veil; ctx.play starts a Gambol Game, ctx.drive a TŌGE RaceGame
  menu/router.ts  the history-backed screen router (ScreenName, Screen, Ctx); browser Back, ← Back and Esc all match
  menu/ui.ts      the menu kit: backdrops (SKY_BACKDROP, FIELD_BACKDROP), sheet(), $(), esc() for HTML, playerName(),
                  toast(), copy(), replay()
  menu/games.ts   the console-style channel grid (built-ins + src/games plug-ins; games.css)
  menu/play.ts    hosts a plug-in game (GameApi, parties)
  menu/banners.ts the animated Gambol / TŌGE tiles; menu/skirmish.ts the animated island scene (Gambol's tile and the
                  loading veil)
  menu/account.ts the sign-in / create-account screen (account.css)
  account.ts      who's signed in (asks `/api/me`; the session cookie is HttpOnly)
  pad.ts          gamepads for every menu (spatial focus, A/B/LB/RB) and for driving (readPad, padAxis, rumble)
  touch.ts        phones/tablets: IS_TOUCH, html.touch, the rotate-your-phone card, fullscreen; touch.css holds every
                  mobile style, all under html.touch, so desktop never changes
  styles.css      global styles (loaded by index.html)
  env.d.ts        Vite client types
```

## Rules

- Never put player names or anything from the network into HTML strings: use `textContent` or `esc()` (menu/ui.ts).
- Mobile styles and input live under `html.touch` / `IS_TOUCH` only; desktop paths never change for mobile.
- The client is not trusted for anything that matters (see `src/server/CLAUDE.md`).
