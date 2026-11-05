# src/games: plug-in games (agent instructions)

Each folder here is one game on the console menu (the channel grid at `/`). A folder with a `channel.ts`
whose default export is a `GameChannel` (`types.ts`) appears on the menu automatically: `registry.ts` finds it
with `import.meta.glob` at build time. Nothing outside the folder needs editing to add a game.

The human guide (same rules, more explanation) is `docs/ADDING_A_GAME.md`.

## Adding a game

1. Copy `_template/` to `src/games/<id>/`. The id: lowercase letters, digits and dashes, ≤ 24 chars, unique,
   the same as the folder name. Folders starting with `_` are never loaded.
2. In `channel.ts` set `id`, `title`, `tagline`, `about`, `facts`, `order` (the built-ins are 1 and 2;
   leave gaps) and write `banner(canvas)` (an animated 2D-canvas tile; stop when `!canvas.isConnected`).
3. Write the game in `mount(root, api)`. Render inside `root` only (it's a full-screen, position:fixed box).
   Return a cleanup that stops every loop, timer and listener you started.
4. Check it: `npm run typecheck`, then `npm run dev` and open the channel from the menu (Esc / Ⓑ / Back must
   return to the menu with nothing left running).

`_template/channel.ts` shows the shape: a banner, a mount that renders a button, and a cleanup.

## Rules (keep them; your game ships on a site your friends share)

- **Stay in your folder.** Don't edit other games, `registry.ts`, `types.ts`, `party.ts` or anything under
  `src/client`, `src/server`, `src/shared`, `src/gambol` or `src/toge` unless the person you're working for asks for
  that specifically.
  If the GameApi is missing something you need, say so rather than reaching around it.
- **No new npm dependencies.** `three` (3D, WebGL: `new THREE.WebGLRenderer`, never WebGPU) is available.
  Otherwise plain TypeScript, DOM, 2D canvas, WebAudio.
- **Scope your CSS** under a class unique to your game (e.g. `.my-game …`). Import your CSS from your own files.
  Never style bare elements (`button { … }`): it would restyle the whole site.
- **Controllers must work.** Menus: use real `<button>`s (and `<input>`s); the site's pad navigation moves
  focus with the D-pad and presses with Ⓐ, and `data-autofocus` marks the starting control. In play, call
  `api.setMenuNav(false)` and read the pad yourself with `api.readPad()` (standard mapping: `pressed[0]` is Ⓐ,
  `lt`/`rt` triggers, `lx`/`ly` left stick; `BTN` names in `src/client/pad.ts`). Keyboard too.
- **Esc / Ⓑ / browser Back leave the game** (the host calls your cleanup). If you want Esc for a pause menu,
  listen in the capture phase and call `e.stopImmediatePropagation()` while you handle it; still let the
  player get out (e.g. a "Quit" button calling `api.exit()`).
- **Never put names or anything from other players into HTML strings.** Use `textContent`, or escape it.
- **Clean up.** After cleanup: no `requestAnimationFrame` loop, no interval, no window listener, no WebGL
  renderer (call `renderer.dispose()`), no open party. (`api.party` rooms are closed for you too.)
- Keep it light: it runs next to the other games on friends' laptops and phones.

## The GameApi (`types.ts`)

- `api.name`, `api.signedIn`: who's playing.
- `api.exit()`: back to the menu.
- `api.readPad()`, `api.rumble(strong, weak, ms)`, `api.setMenuNav(on)`: controllers.
- `api.party.host()` / `api.party.join(code)` / `api.party.list()`: online rooms (below).

## Multiplayer (`party.ts`)

A `Party` is a room of your game with a 4-letter code, up to 12 players. The server only keeps the roster and
relays messages; your game decides everything else.

- `party.id`, `party.code`, `party.members` (`{id, name, user}`), `party.hostId`, `party.isHost`.
- `party.send(data)` to everyone else, `party.send(data, toId)` to one player. `data` is any small JSON
  (≤ 8 KB, ≤ 60 messages/s per player; more is dropped).
- `party.onMessage((fromId, data) => …)`, `party.onMembers(() => …)`, `party.onClose((why) => …)`.
- `party.setOpen(false)` (host): stop new players joining, e.g. during a round.
- Treat incoming `data` as untrusted: check its shape before using it.
- A simple pattern: the host is the referee (starts rounds, decides who won); everyone sends their own state.

The server side is `src/server/party.ts` + `partyroom.ts` (the `PartyRoom` Durable Object); you never need to
change it for a game.

## Tests

Put pure logic (rules, scoring, physics) in plain functions that don't touch the DOM and test them with
`node:test` in `tests/<id>.test.ts`; add the file by name to the `test` script in package.json (Windows: the
script doesn't expand globs). Run `npm test` and `npm run typecheck` before you finish.
