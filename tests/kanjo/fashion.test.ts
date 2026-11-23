import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FASHION, FASHION_COVERS, FASHION_IDS, FASHION_PRICES, FASHION_SLOTS, isFashionId, wearing } from '../../src/kanjo/shared/fashion.ts';
import { DEFAULT_LOOK, KIT, decodeLook, encodeLook, isFull, lookProblem, TOP_IDS, withFashion, withTop } from '../../src/kanjo/shared/look.ts';
import { applyAction, cleanGarage, newGarage, ownedRider } from '../../src/kanjo/shared/garage.ts';

const rich = () => ({ ...newGarage(), money: 5_000_000 });
const buy = (g: ReturnType<typeof newGarage>, id: (typeof FASHION_IDS)[number]) => applyAction(g, { a: 'fashion', id }, Math.random, 0);

test('the catalogue: every slot stocked, prices in the range Michael asked for (50k to 1M)', () => {
  for (const slot of FASHION_SLOTS) assert.ok(FASHION_IDS.some((id) => FASHION[id].slot === slot), slot);
  const prices = FASHION_IDS.map((id) => FASHION[id].price);
  assert.equal(Math.min(...prices), FASHION_PRICES.min);
  assert.equal(Math.max(...prices), FASHION_PRICES.max);
  assert.ok(FASHION_PRICES.min >= 50_000 && FASHION_PRICES.max <= 1_000_000);
  assert.equal(new Set(FASHION_IDS.map((id) => FASHION[id].name)).size, FASHION_IDS.length, 'names are unique');
  assert.ok(isFashionId('emperor_fur') && !isFashionId('toString') && !isFashionId(3));
  // A covered kit slot is a real one.
  const slots = new Set<string>(Object.values(KIT));
  for (const s of Object.values(FASHION_COVERS).flat()) assert.ok(slots.has(s), s);
});

test('one piece per slot, in catalogue order', () => {
  let list = wearing([], 'iced_pendant', true);
  list = wearing(list, 'varsity', true);
  assert.deepEqual(list, ['varsity', 'iced_pendant']);
  list = wearing(list, 'chrome_bomber', true);
  assert.deepEqual(list, ['chrome_bomber', 'iced_pendant'], 'a second jacket replaces the first');
  assert.deepEqual(wearing(list, 'chrome_bomber', false), ['iced_pendant']);
});

test('fashion rides in the look code and comes back out', () => {
  const plain = encodeLook(DEFAULT_LOOK);
  const l = withFashion(withFashion(DEFAULT_LOOK, 'cuban_link', true), 'pit_cap', true);
  assert.equal(lookProblem(l), null);
  const code = encodeLook(l);
  assert.notEqual(code, plain);
  assert.deepEqual(decodeLook(code), l);
  // With battle pass gear too, and with fashion only (an empty gear field).
  const geared = { ...l, gear: ['halo' as const] };
  assert.deepEqual(decodeLook(encodeLook(geared)), geared);
  assert.equal(encodeLook(withFashion(l, 'cuban_link', false)).split('.').length, code.split('.').length);
  // Taking everything off gives back the same code as never wearing any.
  assert.equal(encodeLook(withFashion(withFashion(l, 'cuban_link', false), 'pit_cap', false)), plain);
});

test('bad fashion in a look is refused', () => {
  assert.equal(lookProblem({ ...DEFAULT_LOOK, fashion: ['iced_pendant', 'varsity'] }), 'fashion', 'out of order');
  assert.notEqual(lookProblem({ ...DEFAULT_LOOK, fashion: ['varsity', 'chrome_bomber'] }), null, 'two jackets');
  const full = TOP_IDS.find(isFull)!;
  assert.notEqual(lookProblem({ ...withTop(DEFAULT_LOOK, full), fashion: ['varsity'] }), null, 'a jacket over a one-piece');
});

test('a one-piece takes the jacket and trousers off; a jacket over a one-piece brings separates back', () => {
  const full = TOP_IDS.find(isFull)!;
  const l = withFashion(withFashion(withFashion(DEFAULT_LOOK, 'varsity', true), 'tech_cargo', true), 'rib_beanie', true);
  const one = withTop(l, full);
  assert.deepEqual(one.fashion, ['rib_beanie']);
  assert.equal(lookProblem(one), null);
  const back = withFashion(one, 'apex_leather', true);
  assert.equal(lookProblem(back), null);
  assert.ok(!isFull(back.top));
  assert.deepEqual(back.fashion, ['apex_leather', 'rib_beanie']);
});

test('buying a piece: costs its price, once, and only with the money for it', () => {
  const r = buy(rich(), 'emperor_fur');
  assert.ok(r.ok);
  assert.equal(r.g.money, 5_000_000 - 1_000_000);
  assert.deepEqual(r.g.fash, ['emperor_fur']);
  const again = buy(r.g, 'emperor_fur');
  assert.ok(!again.ok);
  const poor = buy({ ...newGarage(), money: 49_999 }, 'rib_beanie');
  assert.ok(!poor.ok && /money/i.test(poor.error));
  assert.ok(!applyAction(rich(), { a: 'fashion', id: 'nope' as never }, Math.random, 0).ok);
  // Kept in catalogue order whatever order they're bought in.
  const one = buy(rich(), 'iced_pendant');
  assert.ok(one.ok);
  const two = buy(one.g, 'varsity');
  assert.ok(two.ok);
  assert.deepEqual(two.g.fash, ['varsity', 'iced_pendant']);
});

test("you can't wear a piece you haven't bought, and a forged garage keeps only real pieces", () => {
  const code = encodeLook(withFashion(DEFAULT_LOOK, 'gold_rounds', true));
  const r = applyAction(rich(), { a: 'rider', rider: code, look: code }, Math.random, 0);
  assert.ok(!r.ok && /Fashion/.test(r.error));
  const bought = buy(rich(), 'gold_rounds');
  assert.ok(bought.ok);
  const worn = applyAction(bought.g, { a: 'rider', rider: code, look: code }, Math.random, 0);
  assert.ok(worn.ok);
  assert.equal(worn.g.rider, code);
  // Racing with a code that shows pieces you don't own: they're taken off.
  assert.deepEqual(decodeLook(ownedRider(newGarage(), code))!.fashion, []);
  assert.equal(ownedRider(bought.g, code), code);
  const forged = cleanGarage({ ...rich(), fash: ['emperor_fur', 'emperor_fur', 'fake', 7, 'varsity'] });
  assert.deepEqual(forged.fash, ['varsity', 'emperor_fur']);
});
