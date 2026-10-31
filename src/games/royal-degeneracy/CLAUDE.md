# Royal Degeneracy (agent instructions)

A first-person 3D social-deduction party game set in 282, our old university house. Steps 1–4 of the build order
are built (channel and lobby, the house, the Among Us core, the mystery, the cast, the house coming alive); step 7
(the art pass from the photos) is next.

Where things are: `game.ts` (screens, the party room, who referees), `lobby.ts`, `night.ts` (one night on this
screen), `referee.ts` (the host's checks), `rules.ts` / `net.ts` (pure rules and wire checks), `house.ts` (the
house as data), `move.ts` (the walker), `world.ts` / `people.ts` / `textures.ts` (three.js), `hud.ts`,
`meeting.ts`, `chores.ts`, `audio.ts`, `input.ts`, `cases.ts`, `cast.ts`, `clues.ts` (the mystery's rules: trait
cards, picking clues per crime, search, post, plant, wipe, the reveal log) and `mystery.ts` (clue props, the clue in
your hands, the phone, the plant menu), `abilities.ts` (each character's ability, pure, plus the referee's side of
it) and `powers.ts` (the ability chip, result cards, Proof menu, emote wheel, buzz arrow, Bongus glows). `sabotage.ts` (sabotages and fixes,
pure), `stats.ts` (your nights, in this browser). The raccoon, Bike Stu's randoms and the reveal's replay frames run
in `referee.ts`. Quirks that
only change your own screen (Rock Hound, Supervisor, Couch Lock, Illogical!, Will's cologne) live in `night.ts`. Tests: `tests/royal-degeneracy.test.ts` (rules, messages, cards),
`tests/royal-degeneracy-clues.test.ts` (the mystery), `tests/royal-degeneracy-cast.test.ts` (abilities, locked
clues, two-person chores), `tests/royal-degeneracy-house-alive.test.ts` (sabotages, sneak routes, Cosy mode, the
Sink, awards, stats) and `tests/royal-degeneracy-house.test.ts` (spawns, doorways,
the square-spiral stairs, a flood fill that reaches every room and spot, shoves, nudges, seats). In dev, `window.__royal` is the app (`__royal.session` the
night, `__royal.referee` the host's referee).

Doorways are 1 m wide, not 0.85 m: Gambol's collider is 0.8 m wide and has no step-up, so a real-width door snags.
The house is 8.4 m wide. The stairs are a square spiral (straight flights, flat 90° landings); a stair well has to
reach about 0.66 m past where a flight starts rising, or the collider's head catches the floor above.

Read these first, in this order:

1. `src/games/CLAUDE.md`: the plug-in rules (stay in this folder, `three` only, scoped CSS, controllers, cleanup).
2. `DESIGN.md`: the whole design, the tech plan, the file layout and the build order.
3. `CAST.md`: the ten main characters (8 housemates + 2 regulars): abilities, quirks, trait cards, stats, lines.

## What's here

| Path | What | In git? |
| --- | --- | --- |
| `DESIGN.md` | the game design and the build plan | yes |
| `CAST.md` | the cast | yes |
| `floorplans/floor1.jpg`, `floor2.jpg`, `floor3.jpg` | hand-drawn plans of the three levels | yes |
| `reference/` | real photos of the house and a sketch of the front and faces: art direction only | no (`.gitignore`) |

Never import anything from `reference/` into the game, and never copy those photos into the build: the site is
public. Recreate what they show with procedural models and canvas textures.

## Start here: v1

Build steps 1 to 3 of "Build order" in DESIGN.md, then stop for a playtest with the group:

1. **Channel and lobby**: `channel.ts` (id `royal-degeneracy`, title `ROYAL DEGENERACY`, order 40), host / join /
   list, character cards, host settings.
2. **Walk the house**: trace the floorplans into `house.ts` (below), a greybox house in first person, walking,
   stairs, doors, torch, positional footsteps, other players online.
3. **The Among Us core**: roles, takeouts, meetings, votes, evictions, ghosts, four chores, the win conditions.

Then the mystery (step 4), the cast's abilities (step 5), and so on. Every step: `npm run typecheck`, `npm test`
(add new test files by name to the `test` script in package.json), and check it in the browser.

## The house, read off the floorplans

The sketches are roughly to scale: take proportions from them and pick the measurements yourself (Dev's call; don't
ask). It's a big house: a deep three-storey brick house about 20 m deep without the yards (Dev's figure) and as
wide as the sketches' proportions make that (roughly 8 m). Standard doors
(0.85 m wide, 2.05 m tall), stairs about 0.9 m wide, and ceilings about 2.6 m (lower under the floor-3 roof slope).
The front faces the street (the bottom of floor 1's sketch).

**Writing the cases is your job** (Dev's call): the stories, the texts, the lines. They can be anything and involve
anyone, whatever makes the game as fun and wonky as possible. The cases in DESIGN.md and CAST.md are only examples,
the Drumset Massacre included (Donal's drumset was just an example): keep, change or drop any of them, including
the ones the worked examples use. Keep it affectionate.

- **Floor 1**: frontyard and front steps → front porch → entrance hall with the stairs up, on the left side. The
  front-right room is **Mikol's room**. Behind them is the open living room: two couches facing the TV on a
  middle wall, with the **dining room** down the left side. The **kitchen** is at the back, with the back door and
  steps down to the **backyard**.
- **Floor 2**: the stairs come up on the left into a central landing. **Selby's room** is back-left, and the
  **covered balcony** (the raccoon's) is behind it. **Dev's room** is back-right, the **bathroom** is middle-right,
  **Xang's room** is front-right. **Will Palmer's room** is front-left (unlabelled on the sketch), and it opens onto
  the **front balcony** above the porch.
- **Floor 3**: the stairs come up on the left. **Jung's room** is at the back, the **bathroom** in the middle on
  the right, and **Wags's room** (with the record player) at the front. The long strip down the left side is
  **eaves storage**: a crawl space with a hatch, and a good sneak route.
- **No basement.**

Settled with Dev:

- **JJ** lived in Mikol's room in a different year. For now it's just "Mikol's room", and JJ wakes up there too.
- **Donal's room was Xang's room.** Donal lived there for one semester before the house kicked him out. If a case
  uses Donal, his stuff is in Xang's room.

## Art direction, from the photos

- **Outside**: red brick, a green shingled front gable with a small attic window, white trim. A white porch with
  square columns, a stone foundation, and wooden stair railings. The upper balcony has a white railing and a purple
  flag. A huge bare tree out front, power lines, the house next door close on each side.
- **Inside**: worn honey hardwood floors everywhere. Cream walls and white panel doors with thick trim on floor 2.
  Dev's room has grey-blue walls, a white bookshelf, a blacklight Jimi Hendrix poster, a shag runner and a plant.
- **Living room**: a black leather couch and a navy couch, a coffee table, a drop ceiling with tiles missing, a
  faux-brick feature wall with a PA speaker, a Coors flag, a "Welcome to Gordon Brockington Hall" sign, a Martin
  Garrix flag, a ceiling projector, and red LED strips.
- **Dining / bar side**: a wooden hutch with liquor bottles lined along its top, a long wooden counter, a "DRINK
  BEER" LED sign, and purple and green party lights. Printed photos of the housemates line the top of the wall
  ("XANGUS!!!", "We'd go to bat for you DEVLIN"): make these in-game posters of the cast.
- The mood is a lived-in student house: warm lamps by day, red and purple party light at night.
