import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCredentials } from '../src/shared/account.ts';
import { AccountStore, type KV } from '../src/server/accountStore.ts';

/** A Map standing in for Durable Object storage, with a controllable clock and few PBKDF2 iterations to stay fast. */
function make() {
  const data = new Map<string, unknown>();
  const kv: KV = {
    get: async <T>(k: string) => data.get(k) as T | undefined,
    put: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (k) => data.delete(k),
  };
  let t = 1_000_000;
  const store = new AccountStore(kv, 1000, () => t);
  return { store, data, advance: (ms: number) => (t += ms) };
}

test('credential rules', () => {
  assert.equal(checkCredentials('mike_99', 'hunter22'), null);
  assert.ok(checkCredentials('ab', 'hunter22'), 'too short');
  assert.ok(checkCredentials('a'.repeat(17), 'hunter22'), 'too long');
  assert.ok(checkCredentials('bad name!', 'hunter22'), 'bad characters');
  assert.ok(checkCredentials('mike', '12345'), 'short password');
  assert.ok(checkCredentials('mike', 'x'.repeat(73)), 'long password');
});

test('register signs you in; usernames are unique ignoring case; the password is never stored', async () => {
  const { store, data } = make();
  const a = await store.register('Mike', 'correct horse');
  assert.ok(a.ok);
  if (!a.ok) return;
  assert.equal(a.name, 'Mike');
  assert.equal(await store.me(a.token), 'Mike');
  const dup = await store.register('mIKE', 'something else');
  assert.deepEqual(dup, { ok: false, error: 'That username is taken.' });
  assert.ok(!JSON.stringify([...data.entries()]).includes('correct horse'));
  assert.ok(![...data.keys()].some((k) => k.includes(a.token)), 'only a hash of the session token is stored');
});

test('same password, different users: different hashes (salted)', async () => {
  const { store, data } = make();
  await store.register('alice', 'samepassword');
  await store.register('bobby', 'samepassword');
  const h = [...data.entries()].filter(([k]) => k.startsWith('u:')).map(([, v]) => (v as { hash: string }).hash);
  assert.equal(h.length, 2);
  assert.notEqual(h[0], h[1]);
});

test('login: right password works (any case of the username), wrong password and unknown users fail the same way', async () => {
  const { store } = make();
  await store.register('Sakura', 'blossoms1');
  const ok = await store.login('sakura', 'blossoms1');
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.name, 'Sakura');
  const bad = await store.login('Sakura', 'wrongpass');
  const ghost = await store.login('nobody', 'wrongpass');
  assert.deepEqual(bad, { ok: false, error: 'Wrong username or password.' });
  assert.deepEqual(ghost, bad);
});

test('five wrong guesses lock that username briefly, even for the right password, then it clears', async () => {
  const { store, advance } = make();
  await store.register('target', 'rightpass1');
  for (let i = 0; i < 5; i++) await store.login('target', 'nope' + i);
  const locked = await store.login('target', 'rightpass1');
  assert.ok(!locked.ok && /Too many/.test(locked.error));
  advance(31_000);
  assert.ok((await store.login('target', 'rightpass1')).ok);
});

test('logout ends the session; sessions expire after 30 days; junk tokens are ignored', async () => {
  const { store, advance } = make();
  const r = await store.register('walker', 'longenough');
  assert.ok(r.ok);
  if (!r.ok) return;
  await store.logout(r.token);
  assert.equal(await store.me(r.token), null);
  const again = await store.login('walker', 'longenough');
  assert.ok(again.ok);
  if (!again.ok) return;
  advance(31 * 24 * 3600 * 1000);
  assert.equal(await store.me(again.token), null, 'expired');
  assert.equal(await store.me('not-a-token'), null);
  assert.equal(await store.me(undefined), null);
});

test('identify: signed in you play as your username; a guest cannot pass as an account', async () => {
  const { store } = make();
  const r = await store.register('Reddit', 'password1');
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(await store.identify(r.token, 'someone else'), { name: 'Reddit', user: true });
  assert.deepEqual(await store.identify(undefined, 'Zed'), { name: 'Zed', user: false });
  const spoof = await store.identify(undefined, 'reddit');
  assert.equal(spoof.user, false);
  assert.match(spoof.name, /\(guest\)$/);
  assert.ok(spoof.name.length <= 16);
  assert.equal((await store.identify(undefined, '   ')).name, 'guest');
});

test('change password: needs the session and the current password, signs out every other session', async () => {
  const { store, advance } = make();
  const a = await store.register('Kenta', 'oldpass1');
  advance(1000);
  const b = await store.login('kenta', 'oldpass1');
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.deepEqual(await store.changePassword(undefined, 'oldpass1', 'newpass1'), { ok: false, error: 'Sign in first.' });
  assert.deepEqual(await store.changePassword(a.token, 'nope', 'newpass1'), { ok: false, error: 'Your current password is wrong.' });
  assert.ok(!(await store.changePassword(a.token, 'oldpass1', '123')).ok, 'new password follows the rules');
  advance(1000);
  const c = await store.changePassword(a.token, 'oldpass1', 'newpass1');
  assert.ok(c.ok);
  if (!c.ok) return;
  assert.equal(c.name, 'Kenta');
  assert.equal(await store.me(c.token), 'Kenta', 'this browser gets a fresh session');
  assert.equal(await store.me(a.token), null);
  assert.equal(await store.me(b.token), null, 'other devices are signed out');
  assert.ok(!(await store.login('kenta', 'oldpass1')).ok);
  assert.ok((await store.login('kenta', 'newpass1')).ok);
});

test('admin reset: a readable temporary password that works, old sessions and the lockout cleared, unknown names refused', async () => {
  const { store, data, advance } = make();
  const a = await store.register('Daichi', 'forgotten');
  assert.ok(a.ok);
  if (!a.ok) return;
  for (let i = 0; i < 5; i++) await store.login('daichi', 'guess' + i);
  advance(1000);
  const r = await store.resetPassword('DAICHI');
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.name, 'Daichi');
  assert.match(r.password, /^[a-hjkmnp-z2-9]{12}$/);
  assert.ok(!JSON.stringify([...data.entries()]).includes(r.password), 'only its hash is stored');
  assert.equal(await store.me(a.token), null, 'signed out everywhere');
  assert.ok((await store.login('daichi', r.password)).ok, 'works straight away, even after the lockout');
  assert.ok(!(await store.login('daichi', 'forgotten')).ok);
  assert.deepEqual(await store.resetPassword('nobody'), { ok: false, error: 'No account with that username.' });
  assert.deepEqual(await store.resetPassword(42), { ok: false, error: 'No account with that username.' });
});
