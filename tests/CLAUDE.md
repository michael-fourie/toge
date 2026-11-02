# tests: node:test via tsx

`npm test` runs `tsx --test` over an **explicit list** in package.json's `test` script (development is on Windows,
where npm scripts don't expand globs). A new `tests/<name>.test.ts` does nothing until you add it to that list by name.
`tests/lobby.smoke.ts` is not in the list: `npm run smoke` runs it against a live server (`BASE=https://…`).

Before you finish any change: `npm test` and `npm run typecheck` (both tsconfigs). On master both are green
(454 tests as of 2026-11-02).

## Patterns

- Test pure functions from `src/shared` directly (movement, maps, rules, economy). That's why game rules live there.
- Server logic is tested without Cloudflare: build `Lobby`, `Race` or `Party` with fake sockets
  (`{ readyState: 1, send }`) and an injected clock; see "Testing server code" in `src/server/CLAUDE.md`.
- Randomness: pass a seeded `rand` to the shared functions that take one (`rollCase`, `planZone`, `thinkBot`, …).
- One area per file (e.g. `movement`, `slide`, `map`, `survival`, `survivalplus`), so parallel contributors don't collide.
  Map-specific tests live only in that map's file (`map.test.ts` for Windward, `rustworks.test.ts`, `summit.test.ts`, …).

## What guards what

| File | Guards |
|---|---|
| movement, slide, grapple | the player sim; the "Momentum" and "Air jumps" blocks must stay green |
| map, rustworks, summit, dunevillage, crown, wildmere | spawns, pad landings, scripted traversal of every route |
| foundry, foundrylevels, zombie, skyline | the Foundry: windows, rooms, zombie reachability, levels, roof surf |
| survival, survivalplus, survivalfun, contraptions | Survival rules, perks, boss, revive, power, scythe, contraptions |
| koth, teams, royale, bot, spawn, weapons, grenade | match modes, bots, guns |
| accounts, security, loot, casino, levels, skin | accounts, server-side economy, input validation, stash rules |
| racephysics, garage, cosmetics, raceroom, standings, raceinput, pad | TŌGE: every car down every track with the AI, economy, cosmetics and cases, race server |
| party, snap, royal-degeneracy-* | plug-in game rooms and the plug-in games |
| achievements, killcam, speedfx, postgame, input, loadout | client-side pure logic (feats, replay timing, HUD maths, key handling, ammo) |
