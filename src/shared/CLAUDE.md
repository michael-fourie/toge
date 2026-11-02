# src/shared: pure code used by more than one game

Code here runs on the client and in the Worker. **No three.js, no DOM, no `cloudflare:workers`.** Both
`tsconfig.json` and `tsconfig.worker.json` compile it. It must not import any game (`src/gambol`, `src/toge`,
`src/games`); `tests/boundaries.test.ts` checks that.

```
  math.ts     tiny {x,y,z} helpers (yaw 0 looks down -Z, three.js convention); Gambol and Royal Degeneracy use them
  account.ts  checkCredentials (username/password rules shared by the sign-up form and the server)
  party.ts    wire types + PARTY limits for plug-in game rooms (src/games, src/server/party.ts)
```

A game's own rules live in its folder: Gambol's in `src/gambol/shared/` (guide: `src/gambol/shared/CLAUDE.md`),
TŌGE's in `src/toge/shared/` (guide: `src/toge/CLAUDE.md`). Move something here only when a second game needs it,
and keep it free of game-specific constants.
