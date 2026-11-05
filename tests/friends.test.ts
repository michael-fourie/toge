import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FriendStore } from '../src/server/friendStore.ts';
import { FRIENDS_MAX, friendName } from '../src/shared/friends.ts';
import type { KV } from '../src/server/accountStore.ts';

/** Accounts as the Accounts DO stores them (`u:<lower>` with the display name), in a Map. */
function make(...users: string[]) {
  const data = new Map<string, unknown>();
  const kv: KV = {
    get: async <T>(k: string) => data.get(k) as T | undefined,
    put: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (k) => data.delete(k),
  };
  for (const u of users) data.set(`u:${u.toLowerCase()}`, { name: u, salt: '', hash: '', created: 0 });
  return { f: new FriendStore(kv), data };
}

test('usernames in the add box follow the sign-up rules', () => {
  assert.equal(friendName(' Mike_99 '), 'Mike_99');
  for (const bad of ['ab', 'a'.repeat(17), 'bad name', '<b>', '', null, 7, {}]) assert.equal(friendName(bad), null, String(bad));
});

test('adding is one way; the other side sees you under "added you" until they add back', async () => {
  const { f } = make('Mike', 'Ana', 'Kenji');
  const r = await f.act('Mike', { a: 'add', name: 'ana' });
  assert.ok(r.ok);
  assert.deepEqual(r.list, { friends: ['Ana'], mutual: [], fans: [] }, 'display names, as signed up');
  assert.deepEqual(await f.list('Ana'), { friends: [], mutual: [], fans: ['Mike'] });
  assert.ok(await f.has('mike', 'ANA'));
  assert.ok(!(await f.has('Ana', 'Mike')));
  await f.act('Ana', { a: 'add', name: 'Mike' });
  assert.deepEqual(await f.list('Ana'), { friends: ['Mike'], mutual: ['Mike'], fans: [] });
  assert.deepEqual(await f.list('Mike'), { friends: ['Ana'], mutual: ['Ana'], fans: [] });
  // Adding twice changes nothing.
  await f.act('Mike', { a: 'add', name: 'Ana' });
  assert.deepEqual((await f.list('Mike')).friends, ['Ana']);
});

test('removing takes you off their "added you" list too', async () => {
  const { f } = make('Mike', 'Ana');
  await f.act('Mike', { a: 'add', name: 'Ana' });
  const r = await f.act('Mike', { a: 'remove', name: 'ana' });
  assert.ok(r.ok);
  assert.deepEqual(r.list.friends, []);
  assert.deepEqual((await f.list('Ana')).fans, []);
  assert.ok(!(await f.has('Mike', 'Ana')));
});

test("you can't add yourself, someone who doesn't exist, junk, or more than the cap", async () => {
  const names = Array.from({ length: FRIENDS_MAX + 1 }, (_, i) => `d${i}xx`);
  const { f } = make('Mike', ...names);
  assert.deepEqual(await f.act('Mike', { a: 'add', name: 'mike' }), { ok: false, error: "That's you." });
  assert.deepEqual(await f.act('Mike', { a: 'add', name: 'ghost' }), { ok: false, error: 'No driver called ghost.' });
  assert.equal((await f.act('Mike', { a: 'add', name: '<script>' })).ok, false);
  assert.equal((await f.act('Mike', { a: 'poke', name: 'd0xx' } as never)).ok, false);
  assert.equal((await f.act('Mike', null as never)).ok, false);
  for (const n of names.slice(0, FRIENDS_MAX)) assert.ok((await f.act('Mike', { a: 'add', name: n })).ok);
  assert.deepEqual(await f.act('Mike', { a: 'add', name: names[FRIENDS_MAX] }), { ok: false, error: `You can have up to ${FRIENDS_MAX} friends.` });
});

test('a deleted account drops out of the lists', async () => {
  const { f, data } = make('Mike', 'Ana');
  await f.act('Mike', { a: 'add', name: 'Ana' });
  data.delete('u:ana');
  assert.deepEqual((await f.list('Mike')).friends, []);
});
