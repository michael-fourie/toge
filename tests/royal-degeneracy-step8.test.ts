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
