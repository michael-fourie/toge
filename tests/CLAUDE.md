# tests: node:test via tsx

`npm test` runs `tsx --test` over an **explicit list** in package.json's `test` script (development is on Windows,
where npm scripts don't expand globs). A new test file does nothing until you add it to that list by name.

Layout: `tests/kanjo/` for the game, and `tests/` itself for the shell and platform (accounts, security, pad,
graphics, friends, and `boundaries`, which fails if `src/shared` imports the game, the shell or the server, or if
`src/kanjo/shared` imports three.js or browser code).

Before you finish any change: `npm test` and `npm run typecheck` (both tsconfigs). On master both are green
(256 tests as of 2026-11-14, when the repo was split from Gambol's).

## Patterns

- Test pure functions from `src/kanjo/shared/` directly (physics, tracks, rules, economy). That's why the
  rules live there.
- Server logic is tested without Cloudflare: build `Race` with fake sockets (`{ readyState: 1, send }`) and an
  injected clock; see "Testing server code" in `src/server/CLAUDE.md`.
- Randomness: pass a seeded `rand` to the shared functions that take one.
- One area per file (e.g. `drift`, `garage`, `records`), so parallel contributors don't collide.

## What guards what

| File (in `tests/kanjo/` or `tests/`) | Guards |
|---|---|
| drivinglock | KANJO's driving, LOCKED by Michael (2026-11-12): every car's launch, braking, steering, drifts, reverse, sim handling, walls, slipstream, boost pads, damage, specs and pedals against `kanjo/drivinglock.json`. Never regenerate the snapshot (`DRIVING_LOCK=update`) unless Michael asked for that driving change |
| fork (`tests/kanjo/`) | Futamata Parkway (10 km, one way, traffic) and forks in the road: both roads the same length, no step in the ground where they part and meet, cars located on the road they take, the AI's times on the two within 0.4 s, traffic on both |
| downhill (`tests/kanjo/`) | Nadare Drop and Sakamichi Downhill: summit to the bottom, 7+ km, wide; the drop jump's shape (kicker, lip, landing, the road below); obstacles every few hundred metres that never block the whole road; the AI flies every jump and lands on its landing |
| survival (`tests/kanjo/`) | Jigoku Drop and the gap in the road: steep, six big gaps, damage always on, no pads, in Gravity; no road over a hole and a ravine under it; too slow falls in and comes back past it, fast enough clears it; coming down short on the far edge never throws a car up; a reset before a gap can still clear it; a clean AI run is dented, never wrecked |
| fubuki (`tests/kanjo/`) | Fubuki Pass: steep, snowy, ramps, four gaps, three shortcuts, in Gravity; each river crossed by a gap or bridge, in a channel that meets no other road; rockfall that never closes the road, off tight bends, gaps and the fork's ends; the fork before the drops, meeting the main road at its height; the AI down either road in every car, never falling in, dented not wrecked |
| royale (`tests/kanjo/`) | KANJO battle royale: the elimination rules, the arena's place in the modes, an online royale room with a CPU racer |
| racephysics, garage, raceroom, standings, raceinput, pad, headcam, cosmetics, records | KANJO: every car down every track with the AI, economy, cosmetics and cases, race server, cockpit camera head, best times and friend profiles |
| drivers, hands | KANJO drivers: every GLB has what the game needs; hands hold the wheel from outside the rim, fingers round it |
| friends, clubs | friend lists (one-way adds, "added you", caps, bad names); clubs (owner-only adds from friends, leave / disband, caps) |
| accounts, security | accounts and sessions, password rules, name cleaning, rate limits |
| graphics, pad | the Graphics setting (every WebGL renderer gives its context back), gamepad menu navigation |
| boundaries | the layers: `src/shared` imports no game/shell/server; `src/kanjo/shared` stays free of three.js and the DOM |
