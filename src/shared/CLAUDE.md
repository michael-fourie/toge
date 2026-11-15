# src/shared: pure code the shell and the Worker share

Code here runs on the client and in the Worker. **No three.js, no DOM, no `cloudflare:workers`.** Both
`tsconfig.json` and `tsconfig.worker.json` compile it. It must not import the game (`src/kanjo`), the browser shell
(`src/client`) or the server (`src/server`); `tests/boundaries.test.ts` checks that.

```
  account.ts  checkCredentials (username/password rules shared by the sign-up form and the server)
  friends.ts  friend lists (FriendAction, FriendList, FRIENDS_MAX, friendName); kept by src/server/friendStore.ts
```

The game's own rules live in `src/kanjo/shared/` (guide: `src/kanjo/CLAUDE.md`).
