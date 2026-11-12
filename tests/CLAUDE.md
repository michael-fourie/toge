# tests: node:test via tsx

`npm test` runs `tsx --test` over an **explicit list** in package.json's `test` script (development is on Windows,
where npm scripts don't expand globs). A new test file does nothing until you add it to that list by name.

Layout: `tests/gambol/` for Gambol, `tests/toge/` for TŌGE, and `tests/` itself for the site and plug-ins (accounts,
security, pad, party, snap, boys-day, royal-degeneracy-*, beacon, and `boundaries`, which fails if Gambol and TŌGE import each other or
`src/shared` imports a game).
`tests/lobby.smoke.ts` is not in the list: `npm run smoke` runs it against a live server (`BASE=https://…`).

Before you finish any change: `npm test` and `npm run typecheck` (both tsconfigs). On master both are green
(523 tests as of 2026-11-03).

## Patterns

- Test pure functions from each game's `shared/` folder directly (movement, maps, rules, economy). That's why game
  rules live there.
- Server logic is tested without Cloudflare: build `Lobby`, `Race` or `Party` with fake sockets
  (`{ readyState: 1, send }`) and an injected clock; see "Testing server code" in `src/server/CLAUDE.md`.
- Randomness: pass a seeded `rand` to the shared functions that take one (`rollCase`, `planZone`, `thinkBot`, …).
- One area per file (e.g. `movement`, `slide`, `map`, `survival`, `survivalplus`), so parallel contributors don't collide.
  Map-specific tests live only in that map's file (`map.test.ts` for Windward, `rustworks.test.ts`, `summit.test.ts`, …).

## What guards what

| File (in `tests/gambol/`, `tests/toge/` or `tests/`) | Guards |
|---|---|
| movement, slide, grapple | the player sim; the "Momentum" and "Air jumps" blocks must stay green |
| map, rustworks, summit, dunevillage, crown, wildmere | spawns, pad landings, scripted traversal of every route |
| foundry, foundrylevels, zombie, skyline | the Foundry: windows, rooms, zombie reachability, levels, roof surf |
| survival, survivalplus, survivalfun, contraptions | Survival rules, perks, boss, revive, power, scythe, contraptions |
| koth, teams, royale, bot, spawn, weapons, grenade | match modes, bots, guns |
| accounts, security, loot, casino, levels, skin | accounts, server-side economy, input validation, stash rules |
| drivinglock | TŌGE's driving, LOCKED by Michael (2026-11-12): every car's launch, braking, steering, drifts, reverse, sim handling, walls, slipstream, boost pads, damage, specs and pedals against `toge/drivinglock.json`. Never regenerate the snapshot (`DRIVING_LOCK=update`) unless Michael asked for that driving change |
| royale (`tests/toge/`) | TŌGE battle royale: the elimination rules, the arena's place in the modes, an online royale room with a CPU racer |
| racephysics, garage, raceroom, standings, raceinput, pad, headcam, cosmetics, records | TŌGE: every car down every track with the AI, economy, cosmetics and cases, race server, cockpit camera head, best times and friend profiles |
| drivers, hands | TŌGE drivers: every GLB has what the game needs; hands hold the wheel from outside the rim, fingers round it |
| friends | friend lists (one-way adds, "added you", caps, bad names) |
| party, snap, boys-day, royal-degeneracy-*, beacon | plug-in game rooms and the plug-in games (beacon: parkour feel rules, and an autopilot that climbs the whole course) |
| boundaries | the folder split: Gambol and TŌGE never import each other; `src/shared` imports no game |
| achievements, killcam, speedfx, postgame, input, loadout | client-side pure logic (feats, replay timing, HUD maths, key handling, ammo) |
