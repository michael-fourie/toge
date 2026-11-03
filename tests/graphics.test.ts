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

test('releaseRenderer frees the GPU objects, then the context, then the canvas', async () => {
  const { releaseRenderer } = await import('../src/client/graphics.ts');
  const calls: string[] = [];
  releaseRenderer({ dispose: () => calls.push('dispose'), forceContextLoss: () => calls.push('lose'), domElement: { remove: () => calls.push('remove') } });
  assert.deepEqual(calls, ['dispose', 'lose', 'remove']);
  // A context that can't be lost (no extension) still comes off the page.
  const late: string[] = [];
  releaseRenderer({ dispose: () => late.push('dispose'), forceContextLoss: () => { throw new Error('no WEBGL_lose_context'); }, domElement: { remove: () => late.push('remove') } });
  assert.deepEqual(late, ['dispose', 'remove']);
});

// Every race used to leak its WebGL context: renderer.dispose() leaves the context alive, and shared materials keep the
// renderer reachable, so ~250 MB of GPU memory per race piled up until the tab crashed. Any renderer that comes and goes
// must give its context back (releaseRenderer, or forceContextLoss where the canvas stays on the page).
test('every WebGL renderer gives its context back', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  // One small offscreen renderer each, made once and kept for the whole visit: nothing to give back.
  const singletons = new Set(['src/gambol/client/menu/itemIcon.ts', 'src/gambol/client/workshop.ts']);
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) files.push(p.replaceAll('\\', '/'));
    }
  };
  walk('src');
  const makers = files.filter((f) => readFileSync(f, 'utf8').includes('new THREE.WebGLRenderer('));
  assert.ok(makers.includes('src/toge/client/racegame.ts') && makers.includes('src/gambol/client/game.ts'), 'found the game renderers');
  for (const f of makers) {
    if (singletons.has(f)) continue;
    const src = readFileSync(f, 'utf8');
    assert.ok(/releaseRenderer\(|forceContextLoss\(\)/.test(src), `${f} makes a WebGLRenderer but never releases its context`);
  }
});
