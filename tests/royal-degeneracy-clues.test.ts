import assert from 'node:assert/strict';
import test from 'node:test';
import { CHAR_IDS, type CharId } from '../src/games/royal-degeneracy/cast.ts';
import { CATS, chooseCats, fits, hint, inspect, plant, post, search, traceable, traitsFor, valueOf, wipe, type Cat } from '../src/games/royal-degeneracy/clues.ts';
import { SPOTS } from '../src/games/royal-degeneracy/house.ts';
import { readMsg } from '../src/games/royal-degeneracy/net.ts';
import { DEFAULT_SETTINGS, TIMES, newNight, privateView, publicView, step, takeOut, type Night } from '../src/games/royal-degeneracy/rules.ts';

const MAIN = CHAR_IDS.filter((c) => c !== 'guest');
const who = (char: CharId, name: string = char) => ({ char, name });
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, char: CHAR_IDS[i % 10] as CharId }));
const degs = (n: Night) => n.players.filter((p) => p.role === 'degenerate');
const mates = (n: Night) => n.players.filter((p) => p.role === 'housemate');
/** A seeded 0..1 generator for chooseCats. */
const dice = (seed: number) => {
  let a = seed;
  return () => (a = (a * 16807) % 2147483647) / 2147483647;
};
/** A night past its cold open and the no-takeout grace. */
function rolling(count: number, seed = 4) {
  const n = newNight(people(count), DEFAULT_SETTINGS, seed);
  for (let i = 0; i < (TIMES.intro + TIMES.firstKill + 0.5) * 20; i++) step(n, 0.05);
  return n;
}

test('royal clues: a full set of real clues always singles out the culprit, and no two categories split the cast alike', () => {
  for (const c of MAIN) {
    const shows = CATS.filter((cat) => cat !== 'belonging' && traceable(cat, valueOf(who(c), cat)));
    const suspects = MAIN.filter((o) => shows.every((cat) => fits(who(o), cat, valueOf(who(c), cat))));
    assert.deepEqual(suspects, [c], `${c}'s clues also fit ${suspects.join(', ')}`);
  }
  const split = (cat: Cat) => JSON.stringify(MAIN.map((a) => MAIN.filter((b) => valueOf(who(a), cat) === valueOf(who(b), cat)).join()));
  const cats = CATS.filter((c) => c !== 'belonging');
  for (let i = 0; i < cats.length; i++)
    for (let j = i + 1; j < cats.length; j++) assert.notEqual(split(cats[i]), split(cats[j]), `${cats[i]} and ${cats[j]} split the cast the same way`);
});

test('royal clues: guests get a trait card from their name; the referee never draws a silent value', () => {
  assert.deepEqual(traitsFor('guest', 'Priya'), traitsFor('guest', 'Priya'));
  assert.equal(traitsFor('guest', 'Priya').room, 'the couch');
  const cast = MAIN.map((c) => who(c));
  for (let seed = 1; seed < 200; seed++) {
    const r = dice(seed);
    for (const c of cast) for (const cat of chooseCats(cast, c, 3, seed / 200, r)) assert.ok(traceable(cat, valueOf(c, cat)), `${c.char}: ${cat}`);
  }
});

test('royal clues: early clues narrow a little, late ones a lot', () => {
  const cast = MAIN.map((c) => who(c));
  const share = (stage: number) => {
    const r = dice(7);
    let total = 0;
    let n = 0;
    for (let k = 0; k < 300; k++)
      for (const c of cast) {
        const [cat] = chooseCats(cast, c, 1, stage, r);
        total += cast.filter((p) => valueOf(p, cat) === valueOf(c, cat)).length;
        n++;
      }
    return total / n;
  };
  assert.ok(share(0) > share(1) + 1, `early ${share(0).toFixed(2)} vs late ${share(1).toFixed(2)}`);
});

test('royal clues: the case leaves clues at the scene (one hidden), takeouts leave one by the body; all of them true', () => {
  const n = rolling(6);
  const [d] = degs(n);
  const m = n.mystery;
  assert.equal(m.crimes[0].kind, 'case');
  const caseClues = m.clues.filter((c) => c.crime === 0);
  assert.equal(caseClues.length, 3);
  assert.equal(caseClues.filter((c) => c.state === 'hidden').length, 1);
  for (const c of caseClues) assert.ok(fits(d, c.cat, c.value) && !c.planted);
  const hidden = caseClues.find((c) => c.state === 'hidden')!;
  assert.ok(!publicView(n).clues.some((c) => c[0] === hidden.id), 'a hidden clue shows in the public view');
  takeOut(n, d.id, mates(n)[0].id, { x: 6.2, y: 0, z: 10.4 });
  const fresh = m.clues.filter((c) => c.crime === 1);
  const onView = fresh.find((c) => c.state === 'view')!;
  assert.ok(onView, 'a clue by the body');
  assert.ok(Math.hypot(onView.pos.x - 6.2, onView.pos.z - 10.4) <= 1.01, 'the clue lies by the body');
  assert.ok(fits(d, onView.cat, onView.value));
  assert.ok(m.log.some(([, t]) => t.includes('took out')));
});

test('royal clues: inspecting, searching and posting', () => {
  const n = rolling(6);
  const [a, b] = mates(n);
  const view = n.mystery.clues.find((c) => c.state === 'view')!;
  assert.equal(inspect(n, a.id, view.id, { x: view.pos.x + 9, y: view.pos.y, z: view.pos.z }), null, 'too far');
  assert.equal(post(n, a.id, view.id), null, 'can’t post what you haven’t picked up');
  assert.ok(inspect(n, a.id, view.id, view.pos));
  assert.deepEqual(privateView(n, a.id)!.seen, [[view.id, view.cat, view.value, view.crime]]);
  assert.ok(!publicView(n).posted.length, 'what it says stays private until posted');
  assert.ok(post(n, a.id, view.id));
  assert.equal(post(n, a.id, view.id), null, 'once');
  assert.deepEqual(publicView(n).posted, [[view.id, view.cat, view.value, view.crime, a.id]]);
  // Searching: the hidden clue is only in its spot.
  const hidden = n.mystery.clues.find((c) => c.state === 'hidden')!;
  const spot = SPOTS.find((s) => s.id === hidden.spot)!;
  const other = SPOTS.find((s) => s.kind === 'search' && s.id !== hidden.spot)!;
  assert.equal(search(n, b.id, other.id, other.pos), null, 'nothing there');
  assert.equal(search(n, b.id, spot.id, { x: spot.pos.x + 9, y: spot.pos.y, z: spot.pos.z }), false, 'too far');
  const found = search(n, b.id, spot.id, spot.pos);
  assert.ok(found && found.id === hidden.id && found.state === 'view');
  assert.ok(privateView(n, b.id)!.seen.some(([id]) => id === hidden.id), 'the finder has looked at it');
  assert.ok(publicView(n).clues.some((c) => c[0] === hidden.id));
});

test('royal clues: plants (three, Degenerates only, look exactly like real clues) and wipes', () => {
  const n = rolling(6);
  const [d] = degs(n);
  const [a] = mates(n);
  const at = { x: 6.2, y: 0, z: 10.4 };
  assert.equal(plant(n, a.id, 'smoke', 'cigarettes', at), null, 'housemates can’t plant');
  assert.equal(plant(n, d.id, 'smoke', 'none', at), null, 'nothing to plant');
  assert.equal(plant(n, d.id, 'belonging', 'donal', at), null, 'not someone in the house');
  const p = plant(n, d.id, 'smoke', 'cigarettes', at)!;
  assert.ok(p.planted && p.crime === 0);
  assert.ok(plant(n, d.id, 'hairColour', 'red', at));
  assert.ok(plant(n, d.id, 'notes', 'teaching', at));
  assert.equal(plant(n, d.id, 'notes', 'science', at), null, 'three a night');
  assert.equal(privateView(n, d.id)!.plants, 0);
  const pub = JSON.stringify(publicView(n));
  assert.ok(!pub.includes('planted') && !pub.includes('true'), 'nothing public says it’s a plant');
  const real = n.mystery.clues.find((c) => !c.planted && c.state === 'view')!;
  assert.ok(!wipe(n, a.id, real.id, real.pos), 'housemates can’t wipe');
  assert.ok(wipe(n, d.id, real.id, real.pos));
  assert.ok(!publicView(n).clues.some((c) => c[0] === real.id));
  assert.ok(n.mystery.log.some(([, t]) => t.includes('planted')) && n.mystery.log.some(([, t]) => t.includes('wiped')));
});

test('royal clues: the case’s texts hint at a true trait no clue has shown', () => {
  for (let seed = 1; seed < 30; seed++) {
    const n = newNight(people(6), { ...DEFAULT_SETTINGS, caseId: 'drumset' }, seed);
    const culprit = n.players.find((p) => p.id === n.mystery.crimes[0].by)!;
    const text = n.mystery.texts.find(([, , t]) => t.includes('ring cam'))![2];
    const shown = new Set(n.mystery.clues.map((c) => c.cat));
    const ok = CATS.some((cat) => !shown.has(cat) && traceable(cat, valueOf(culprit, cat)) && text.includes(hint(cat, valueOf(culprit, cat))));
    assert.ok(ok, `seed ${seed}: "${text}"`);
  }
});

test('royal clues: the new messages are shape-checked, and the reveal (with its timeline) fits', () => {
  assert.deepEqual(readMsg({ t: 'plant', cat: 'smoke', value: 'cigarettes' }), { t: 'plant', cat: 'smoke', value: 'cigarettes' });
  assert.deepEqual(readMsg({ t: 'search', spot: 's-sofa' }), { t: 'search', spot: 's-sofa' });
  assert.equal(readMsg({ t: 'plant', cat: 'shoes', value: 'big' }), null);
  assert.equal(readMsg({ t: 'search', spot: 'narnia' }), null);
  assert.equal(readMsg({ t: 'inspect', id: -1 }), null);
  assert.equal(readMsg({ t: 'feed', from: 'Donal', text: 'x'.repeat(400), clue: -1 }), null);
  const n = rolling(6);
  for (const p of mates(n)) takeOut(n, degs(n)[0].id, p.id, { x: 6.2, y: 0, z: 10.4 });
  const msg = JSON.stringify({ t: 'st', v: publicView(n) });
  assert.ok(msg.length < 8000, `the reveal is ${msg.length} bytes`);
  assert.equal(readMsg(JSON.parse(msg))?.t, 'st');
});
