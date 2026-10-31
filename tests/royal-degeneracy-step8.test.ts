import assert from 'node:assert/strict';
import test from 'node:test';
import { CASES } from '../src/games/royal-degeneracy/cases.ts';
import { ROOMS } from '../src/games/royal-degeneracy/house.ts';
import { readVoice } from '../src/games/royal-degeneracy/net.ts';
import { DEFAULT_SETTINGS, newNight } from '../src/games/royal-degeneracy/rules.ts';
import { voiceGain } from '../src/games/royal-degeneracy/voice.ts';

test('royal step 8: every case has a real room, texts in order and a night that deals', () => {
  assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length);
  assert.ok(CASES.length >= 8);
  for (const c of CASES) {
    assert.ok(ROOMS.some((r) => r.id === c.scene.room), `${c.id}: room ${c.scene.room}`);
    let last = 0;
    for (const [frac] of c.texts) {
      assert.ok(frac >= last && frac <= 1, `${c.id}: texts in order`);
      last = frac;
    }
    const n = newNight(
      [1, 2, 3, 4, 5].map((id, i) => ({ id, name: `p${id}`, char: (['dev', 'xang', 'selby', 'will', 'jung'] as const)[i] })),
      { ...DEFAULT_SETTINGS, caseId: c.id },
      7,
    );
    assert.equal(n.caseId, c.id);
  }
});

test('royal step 8: voices fade with distance and through walls and floors', () => {
  assert.equal(voiceGain(1, 0), 1);
  assert.ok(voiceGain(8, 0) < 1 && voiceGain(8, 0) > 0);
  assert.equal(voiceGain(20, 0), 0);
  assert.ok(voiceGain(3, 1) < voiceGain(3, 0));
  assert.ok(voiceGain(3, 2) < voiceGain(3, 1));
});

test('royal step 8: voice signalling messages are shape-checked', () => {
  assert.deepEqual(readVoice({ t: 'vc', k: 'hi', d: '' }), { t: 'vc', k: 'hi', d: '' });
  assert.equal(readVoice({ t: 'vc', k: 'nope', d: '' }), null);
  assert.equal(readVoice({ t: 'vc', k: 'offer', d: 'x'.repeat(8000) }), null);
  assert.equal(readVoice({ t: 'vc', k: 'ice', d: 5 }), null);
  assert.equal(readVoice({ t: 'p' }), null);
});

test('royal: the raccoon has to be herded out, from any floor-2 room, and leaves once it is outside', async () => {
  const { escapeTarget, newCoon, stepCoon, coonOut } = await import('../src/games/royal-degeneracy/coon.ts');
  const { FLOOR_Y, SOLIDS, roomAt } = await import('../src/games/royal-degeneracy/house.ts');
  for (const start of [{ x: 2, z: 17 }, { x: 6.8, z: 17 }, { x: 6, z: 3 }, { x: 2.2, z: 3.4 }, { x: 5.5, z: 9 }]) {
    const c = newCoon({ x: start.x, y: FLOOR_Y[1], z: start.z }, start);
    let t = 0;
    // The herder walks (at a person's pace) to stay 1.8 m behind it, on the far side from its way out.
    const herder = { x: start.x, y: FLOOR_Y[1], z: start.z + 1 };
    for (; t < 60 && !coonOut(c); t += 1 / 60) {
      const p = c.w.pos;
      const e = escapeTarget(p, { wp: c.wp }) ?? p;
      const l = Math.hypot(e.x - p.x, e.z - p.z) || 1;
      const want = { x: p.x - ((e.x - p.x) / l) * 1.8, z: p.z - ((e.z - p.z) / l) * 1.8 };
      const m = Math.hypot(want.x - herder.x, want.z - herder.z);
      const k = Math.min(1, (3.2 / 60) / (m || 1));
      herder.x += (want.x - herder.x) * k;
      herder.z += (want.z - herder.z) * k;
      herder.y = p.y;
      stepCoon(c, [{ id: 1, pos: herder }], t, 1 / 60, SOLIDS);
    }
    assert.ok(coonOut(c), `stuck at ${JSON.stringify(c.w.pos)} (${roomAt({ ...c.w.pos, y: c.w.pos.y + 0.1 })?.name}) from ${JSON.stringify(start)}`);
  }
  // Left alone, nobody near: it just wanders and never leaves by itself here.
  const c = newCoon({ x: 2, y: FLOOR_Y[1], z: 17 }, { x: 1.5, z: 15 });
  for (let t = 0; t < 5; t += 1 / 60) stepCoon(c, [], t, 1 / 60, SOLIDS);
  assert.ok(!coonOut(c));
});
