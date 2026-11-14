// Hardening shared by every screen: typed names and rate limits. (TŌGE's own server-side checks, garage payouts and
// race money, are in tests/toge/garage.test.ts, cosmetics.test.ts and raceroom.test.ts.)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Limiter } from '../src/server/limiter.ts';
import { cleanName } from '../src/shared/account.ts';

// --- Names and rate limits -------------------------------------------------------------------------------------

test('names: markup, control and invisible characters are stripped from typed names', () => {
  assert.equal(cleanName('<img src=x onerror=alert(1)>'), 'img src=x onerro');
  assert.equal(cleanName('  Mi​ke‮  '), 'Mike');
  assert.equal(cleanName('a&b"c\'d`e\\f'), 'abcdef');
  assert.equal(cleanName(null), '');
  assert.equal(cleanName('Zoë 🌸'), 'Zoë 🌸');
});

test('limiter: a burst, then a steady rate, per key', () => {
  let t = 0;
  const l = new Limiter(3, 1, () => t);
  assert.deepEqual([1, 2, 3, 4].map(() => l.take('a')), [true, true, true, false]);
  assert.ok(l.take('b'), 'keys are separate');
  t += 1000;
  assert.ok(l.take('a'));
  assert.ok(!l.take('a'));
  const small = new Limiter(1, 1, () => t, 4);
  for (let i = 0; i < 100; i++) small.take(`k${i}`);
  assert.ok((small as unknown as { buckets: Map<string, unknown> }).buckets.size <= 4, 'random keys cannot grow it forever');
});
