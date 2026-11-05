import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestBuild, cardBests, cleanHighs, newHighs, noteHighs, winRate } from '../../src/toge/shared/cardstats.ts';
import { carSpec, encodeCar, newOwnedCar, rating } from '../../src/toge/shared/cars.ts';

test('highs keep the best drift race and top speed, and ignore junk', () => {
  let h = newHighs();
  h = noteHighs(h, { drift: 5000.7, topKmh: 180 });
  h = noteHighs(h, { drift: 1000, topKmh: 250 });
  assert.deepEqual(h, { drift: 5000, topKmh: 250 });
  h = noteHighs(h, { drift: -5, topKmh: Infinity });
  assert.deepEqual(h, { drift: 5000, topKmh: 250 });
  assert.deepEqual(cleanHighs({ drift: 'lots', topKmh: 9999 }), newHighs());
  assert.deepEqual(cleanHighs(null), newHighs());
  assert.deepEqual(cleanHighs({ drift: 42, topKmh: 301.5 }), { drift: 42, topKmh: 301.5 });
});

test('the card shows the newest best times with their car names', () => {
  const vanta = encodeCar(newOwnedCar('vanta', 0));
  const shown = cardBests({ spa: { time: 150, car: vanta, at: 1 }, monza: { time: 120, car: '', at: 5 }, koripass: { time: 190, car: vanta, at: 3 } }, 2);
  assert.deepEqual(
    shown.map((b) => [b.track, b.car]),
    [
      ['monza', ''],
      ['koripass', 'Vanta V10'],
    ],
  );
  assert.equal(shown[1].name, 'Kōri Pass');
  assert.deepEqual(cardBests({}, 4), []);
});

test('best build is the highest PI car; win rate rounds and never passes 100', () => {
  const cars = [newOwnedCar('pebble', 0), newOwnedCar('vanta', 0)];
  assert.equal(bestBuild(cars)!.car.model, 'vanta');
  assert.equal(bestBuild(cars)!.pi, rating(carSpec(cars[1])).pi);
  assert.equal(bestBuild([]), null);
  assert.equal(winRate(0, 0), 0);
  assert.equal(winRate(3, 1), 33);
  assert.equal(winRate(2, 5), 100);
});
