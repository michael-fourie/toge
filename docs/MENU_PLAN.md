# Menu plan

Each choice gets its own page, so the title screen has three big doors and nothing else. Everything stays on the painted sky, with cream paper sheets, Kaisei Decol headings, Zen Maru body text, and meadow-green primary actions.

## Screens

| Screen | Shows | Primary action |
| --- | --- | --- |
| **Title** | The "Atrous" logo. A "Playing as ‹name› ✎" chip, which edits the name inline and saves it. Three stacked buttons, each just an icon and a word: Practice / Host / Join. Footer: How to play · prototype. Behind it, `menu/skirmish.ts` draws bobbing islands with faded shadow-players bhopping, leaping and sniping each other at random. | Pick a button |
| **Practice** | A short blurb (dummies, routes, the tuning panel tip), plus settings the game actually honours: mouse sensitivity and auto-bhop, both saved. | Start practice |
| **Host** | What hosting means (4-letter code, up to 12 players, the match is always live), a **game type** picker (two cards: Battle / Survival, Battle preselected), and a server status pill (connecting / online / offline + retry). | Create lobby |
| **Join** | Four big letter boxes: auto-advance, backspace goes back, paste fills all four, Enter submits. Below them, a live list of open lobbies with the code, host + game type tag, players and a Join button, or "Full". | Join |
| **Lobby room** | Shown after a create or join. A game type tag, a big code with *Copy code* / *Copy invite link* (`/?join=CODE`), and a live player list (colour dot, name, host badge, "you", K/D). | Enter match |
| **How to play** | The controls table and the movement basics. | Back |

## Navigation

- A tiny router: each screen is `render(ctx, params) → cleanup`.
- Every move is `history.pushState`, so **browser Back, the ← Back button and Esc all do the same thing.**
- Back from the lobby room leaves the lobby.
- Back while in a match leaves the match.
- `/?join=CODE` lands on Join with the code filled in.
- Leaving a match (or a disconnect) returns to Title, with a notice explaining why.

## Lobby room (client-side only, no protocol change)

The server keeps its model: joining puts you in the always-running match. The lobby room is a client-side pre-roll. It keeps the `joined` snapshot fresh by listening to messages the server already sends:
- `playerJoined` / `playerLeft` (including host migration through `hostId`)
- `kill` (scores, alive)
- `respawn` (alive, and your own spawn point)

**Enter match** hands that snapshot to `Game`, exactly as before.

Known limitation: while you sit in the room, your bean stands idle at its spawn in the match. A server "ready" flag can fix this later if it matters.

## States and copy

- **Connecting:** a pill with a twirling leaf.
- **Offline:** "Can't reach the sky server" with a Retry button. In dev, it adds a hint to run `npm run dev`.
- **Lobby errors:**
  - Unknown code: the boxes shake, and the message reads "No lobby with that code."
  - Full lobby: the row's button is disabled and reads "Full".
- **Empty list:** "No open skies yet. Host one!"
- **Copy:** a small toast confirms "Copied!".

## Accessibility and feel

- Real `<button>`s and labelled inputs.
- On every screen change, focus moves to the heading or primary control, and focus outlines are visible.
- The lobby list refreshes every 3 s, but only while Join is open.
- Cards lift on hover/focus. Pages rise in.
- `prefers-reduced-motion` turns off drifting clouds, bobbing and page transitions.
- Layout works down to 360px wide: the cards stack and the sheets go full width.

## Code

`src/client/main.ts` holds the boot, the game start (with the loading veil) and the router wiring. `src/client/menu/` contains:

| File | Contents |
| --- | --- |
| `ui.ts` | backdrop, page shell, escaping, name storage |
| `skirmish.ts` | the animated backdrop: bobbing islands and faded shadow-players bhopping and sniping (2D canvas) |
| `router.ts` | the history-backed screen router |
| `title.ts`, `practice.ts`, `host.ts`, `join.ts`, `lobby.ts`, `help.ts` | one file per screen |

Settings live in `src/client/settings.ts`, and `Input` reads the sensitivity from there.
