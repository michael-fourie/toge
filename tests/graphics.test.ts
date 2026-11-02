// The site's graphics setting (src/client/graphics.ts): High by default, Low once picked, and Low's frame cap.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameGate, graphics, lowGraphics, setGraphics } from '../src/client/graphics.ts';

test('High by default, never skips a frame', () => {
  assert.equal(graphics(), 'high');
  const gate = frameGate(60);
  for (let t = 0; t < 100; t += 4) assert.equal(gate(t), true);
});

test('Low is remembered and caps the frame rate', () => {
  setGraphics('low');
  assert.equal(lowGraphics(), true);
  const gate = frameGate(60);
  // A 144 Hz screen: about 60 of 144 frames drawn.
  let drawn = 0;
  for (let i = 0; i < 144; i++) if (gate((i * 1000) / 144)) drawn++;
  assert.ok(drawn >= 57 && drawn <= 63, `drew ${drawn}`);
  // A 60 Hz screen keeps every frame, even with jitter.
  const g60 = frameGate(60);
  let kept = 0;
  for (let i = 0; i < 60; i++) if (g60(i * 16.67 + (i % 2 ? 0.8 : -0.8))) kept++;
  assert.equal(kept, 60);
  setGraphics('high');
  assert.equal(graphics(), 'high');
});
