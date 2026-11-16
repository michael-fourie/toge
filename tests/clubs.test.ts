import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClubStore } from '../src/server/clubStore.ts';
import { FriendStore } from '../src/server/friendStore.ts';
import { CLUBS_MAX, CLUB_MEMBERS_MAX, clubName } from '../src/shared/clubs.ts';
import type { KV } from '../src/server/accountStore.ts';

function make(...users: string[]) {
  const data = new Map<string, unknown>();
  const kv: KV = {
    get: async <T>(k: string) => data.get(k) as T | undefined,
    put: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (k) => data.delete(k),
  };
  for (const u of users) data.set(`u:${u.toLowerCase()}`, { name: u, salt: '', hash: '', created: 0 });
  const friends = new FriendStore(kv);
  return { clubs: new ClubStore(kv, friends), friends };
}

test('club names follow the rules and squeeze spaces', () => {
  assert.equal(clubName('  Night   Owls '), 'Night Owls');
  for (const bad of ['ab', 'a'.repeat(21), '-lead', '<b>', '', null, 7]) assert.equal(clubName(bad), null, String(bad));
});

test('an owner starts a club and adds friends, who then see it', async () => {
  const { clubs, friends } = make('Mike', 'Ana', 'Kenji');
  const made = await clubs.act('Mike', { a: 'create', club: 'Night Owls' });
  assert.ok(made.ok);
  assert.deepEqual(made.clubs, [{ name: 'Night Owls', owner: 'Mike', members: ['Mike'], mine: true }]);
  // Not a friend yet.
  const no = await clubs.act('Mike', { a: 'add', club: 'night owls', name: 'Ana' });
  assert.ok(!no.ok);
  await friends.act('Mike', { a: 'add', name: 'Ana' });
  const r = await clubs.act('Mike', { a: 'add', club: 'night owls', name: 'ana' });
  assert.ok(r.ok);
  assert.deepEqual(r.clubs[0].members, ['Mike', 'Ana']);
  assert.deepEqual(await clubs.list('Ana'), [{ name: 'Night Owls', owner: 'Mike', members: ['Mike', 'Ana'], mine: false }]);
  assert.deepEqual(await clubs.list('Kenji'), []);
});

test('names are unique, only owners add or disband, members can leave, owners cannot', async () => {
  const { clubs, friends } = make('Mike', 'Ana', 'Kenji');
  await clubs.act('Mike', { a: 'create', club: 'Apex' });
  assert.ok(!(await clubs.act('Ana', { a: 'create', club: 'APEX' })).ok);
  await friends.act('Mike', { a: 'add', name: 'Ana' });
  await friends.act('Ana', { a: 'add', name: 'Kenji' });
  await clubs.act('Mike', { a: 'add', club: 'Apex', name: 'Ana' });
  assert.ok(!(await clubs.act('Ana', { a: 'add', club: 'Apex', name: 'Kenji' })).ok, 'members cannot add');
  assert.ok(!(await clubs.act('Ana', { a: 'disband', club: 'Apex' })).ok);
  assert.ok(!(await clubs.act('Kenji', { a: 'remove', club: 'Apex', name: 'Ana' })).ok, 'outsiders see no club');
  assert.ok(!(await clubs.act('Mike', { a: 'remove', club: 'Apex', name: 'Mike' })).ok, 'the owner cannot leave');
  const left = await clubs.act('Ana', { a: 'remove', club: 'Apex', name: 'Ana' });
  assert.ok(left.ok);
  assert.deepEqual(left.clubs, []);
  assert.deepEqual((await clubs.list('Mike'))[0].members, ['Mike']);
});

test('disbanding clears the club for every member and frees the name', async () => {
  const { clubs, friends } = make('Mike', 'Ana');
  await clubs.act('Mike', { a: 'create', club: 'Apex' });
  await friends.act('Mike', { a: 'add', name: 'Ana' });
  await clubs.act('Mike', { a: 'add', club: 'Apex', name: 'Ana' });
  const r = await clubs.act('Mike', { a: 'disband', club: 'Apex' });
  assert.ok(r.ok);
  assert.deepEqual(await clubs.list('Ana'), []);
  assert.ok((await clubs.act('Ana', { a: 'create', club: 'Apex' })).ok);
});

test('limits: clubs per account and members per club; junk is refused', async () => {
  const names = Array.from({ length: CLUB_MEMBERS_MAX + 1 }, (_, i) => `Racer${i}`);
  const { clubs, friends } = make('Mike', ...names);
  for (let i = 0; i < CLUBS_MAX; i++) assert.ok((await clubs.act('Mike', { a: 'create', club: `Club ${i}` })).ok);
  assert.ok(!(await clubs.act('Mike', { a: 'create', club: 'One more' })).ok);
  for (const n of names) await friends.act('Mike', { a: 'add', name: n });
  let added = 1;
  for (const n of names) if ((await clubs.act('Mike', { a: 'add', club: 'Club 0', name: n })).ok && (await clubs.list(n)).length) added++;
  assert.equal(added, CLUB_MEMBERS_MAX, 'the owner counts as a member');
  for (const bad of [null, 'x', {}, { a: 'nuke', club: 'Club 0' }, { a: 'add', club: 5, name: 'Ana' }]) assert.ok(!(await clubs.act('Mike', bad as never)).ok);
});
