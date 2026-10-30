# Adding a game

The site's home page is a console-style menu of channels. Gambol and TŌGE are channels 1 and 2; every other
channel is a **folder in `src/games/`**. Make a folder, push it, and your game is on the menu.

## Quick start

```bash
git clone https://github.com/michael-fourie/atrous && cd atrous
npm install                               # Node 20+ (22 recommended)
cp -r src/games/_template src/games/my-game
npm run dev                               # open http://localhost:5173
```

Edit `src/games/my-game/channel.ts`: change `id` to `'my-game'` (lowercase, digits, dashes; same as the
folder), set the title and text, and write your game in `mount`. Your channel appears on the menu; open it
to play.

Using Claude Code (or another agent)? Point it at this folder: `src/games/CLAUDE.md` has the rules it should
follow, and Claude Code reads it automatically when it works in `src/games/`.

## How a game plugs in

```ts
// src/games/my-game/channel.ts
import type { GameChannel } from '../types.ts';

const channel: GameChannel = {
  id: 'my-game',
  title: 'MY GAME',
  tagline: 'One line',
  about: 'A paragraph for the channel page.',
  facts: ['1–4 players online', 'Controller'],
  order: 60,                       // position in the grid (Gambol is 1, TŌGE 2)
  banner(canvas) { /* draw an animated tile; stop when !canvas.isConnected */ },
  mount(root, api) {
    // build your game inside `root` (full screen)
    return () => { /* stop everything you started */ };
  },
};
export default channel;
```

`mount` gets an `api`:

| | |
| --- | --- |
| `api.name`, `api.signedIn` | Who's playing |
| `api.exit()` | Back to the menu |
| `api.readPad()` | The controller: sticks `lx ly rx ry`, triggers `lt rt`, buttons `down[]` and `pressed[]` (this frame) |
| `api.rumble(strong, weak, ms)` | Controller rumble |
| `api.setMenuNav(on)` | The site moves focus between buttons with the D-pad and presses with Ⓐ. Turn it off while playing |
| `api.party.host()`, `.join(code)`, `.list()` | Online rooms for your game (below) |

Esc, Ⓑ and the browser's Back button leave your game and run your cleanup.

## Online multiplayer

```ts
const party = await api.party.host();          // or api.party.join('ABCD')
party.code;                                    // tell your friends
party.members;                                 // [{ id, name, user }]
party.send({ type: 'move', x: 3 });            // to everyone else
party.onMessage((from, data) => { /* ... */ });
party.onMembers(() => { /* someone joined or left */ });
```

Rooms have 4-letter codes and up to 12 players. The server just relays your messages (any small JSON); your
game decides what they mean. Making the host the referee keeps things simple. Nothing on the server
needs changing for a new game.

## House rules

- Keep everything in your folder; don't change other games or the site's code without asking.
- No new npm packages. `three` is available for 3D (use the WebGL renderer).
- Scope your CSS under your own class name, so it can't restyle the rest of the site.
- Controllers and keyboard should both work; use real `<button>`s for menus.
- Put other players' names in with `textContent`, never inside an HTML string.
- Clean up everything in the function `mount` returns.
- Run `npm run typecheck` and `npm test` before you push. Pushing to `master` deploys the site.
