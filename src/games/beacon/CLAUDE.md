# BEACON (src/games/beacon)

A first-person parkour climb up **Skerry**, a sea stack with a dead lighthouse on top. Climb from the tide line to the
lantern (about 180 m up, 13 checkpoints), alone or with up to 11 friends in a party room. Nobody is roped to anybody:
everyone climbs their own run and sees the others live. First to the gallery lights the beacon; the results card
lists everyone's times.

It's a plug-in game, so the rules in `src/games/CLAUDE.md` apply: stay in this folder, CSS under `.beacon`, names only
through `textContent`, full cleanup.

## Files

| File | What |
|---|---|
| `move.ts` | The movement sim, pure (no three.js, no DOM). `MOVE` holds every tunable. 120 Hz fixed step, AABB player vs AABB solids and ramps, a grid (`World`) for lookups |
| `course.ts` | Builds Skerry Light, pure and deterministic: an inward square spiral of pieces in five themed laps, the rock carved round them per 5 m band, the lighthouse ring climb, checkpoints, a route (`legs`) for the test autopilot, `progress()` for checkpoints/drowning/finish |
| `textures.ts` | Procedural PBR textures (fbm/Worley, DataTextures) per material and the triplanar material patch |
| `world.ts` | `Scenery`: sky, sun + following shadows, sea shader, the sculpted stack mesh, pieces merged per material, decor, islands, lighthouse and beam, gulls. `LOOK` holds the look's tunables |
| `avatar.ts` | Other climbers: a jointed figure with poses per `ANIM`, interpolated 120 ms behind, name tag |
| `session.ts` | One climb: input → sim → camera (bob, roll, FOV), checkpoints, respawn, finish, the pause menu, sending state |
| `game.ts` | `mount()`: menus (solo / host / join), the lobby, starting a climb, cleanup |
| `net.ts` | Wire messages and their validation (`readMsg`), `clock()` |
| `input.ts`, `audio.ts`, `hud.ts`, `banner.ts`, `beacon.css` | Keys + pad, synthesized WebAudio, the HUD, the channel tile, styles |

## Feel rules (tests in `tests/beacon.test.ts`)

- Momentum is kept: landing never costs speed, the air has no friction, carried speed over a sprint bleeds slowly.
- Forgiving inputs: coyote time and a jump buffer; letting go of jump early cuts the jump.
- Slides boost once per cooldown (no spam) and gain speed down ramps; a slide jump keeps the speed.
- Wall runs start only when jumping side-on, fast, with a real drop below and no floor just ahead (so a hop beside a
  wall stays a hop). Running into a wall head-on runs up it once per jump. Mantles reach ledges up to about 3.2 m
  from a standing jump; 4 m needs a wall run-up.

## The course

`buildCourse()` must stay deterministic (the test checks), and **the autopilot in `tests/beacon-pilot.ts` must finish
it** with the real movement through every checkpoint. If you change `MOVE` or a piece, run the test; when the pilot
fails, `pilot(c, limit, trace)` tells you the leg and why. Pieces are added with the builder (`hops`, `ledge`,
`wallrun`, `slideUnder`, …), which also writes the pilot's legs, so new pieces stay climbable.

## Netcode

The PartyRoom only relays. Each browser simulates its own climber and sends `st` (position, yaw, anim) at 15 Hz. The
host is the referee for starts: it numbers climbs (`go`), and answers a late joiner's `hi`. `cp` and `fin` feed the
toasts and results. Nothing pays out, so nothing is checked server-side.

## Graphics

Follows the site's High/Low setting (`src/client/graphics.ts`). High: shadows, MSAA + bloom post chain, 512 px
textures. Low: no shadows or post, 256 px textures, 60 fps gate. The pause menu toggles it live (rebuilds `Scenery`).
In dev, `window.__beacon` is the running session and `window.__beaconApp` the app, for poking from the console.
