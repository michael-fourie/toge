// Keeps the games apart: Gambol (src/gambol) and TŌGE (src/toge) never import each other, and the common code
// (src/shared) imports neither. The site shell (src/client) and the Worker (src/server) wire the games together,
// so they may import both.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesIn(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Every relative import in `area`, resolved to a path under src/ (e.g. "gambol/shared/math.ts"). */
function importsOf(area: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const file of filesIn(join(SRC, area))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      out.push({ from: relative(SRC, file).replaceAll('\\', '/'), to: relative(SRC, resolve(dirname(file), m[1])).replaceAll('\\', '/') });
    }
  }
  return out;
}

const crossing = (area: string, banned: string[]) =>
  importsOf(area)
    .filter((i) => banned.some((b) => i.to.startsWith(b + '/')))
    .map((i) => `${i.from} -> ${i.to}`);

test('Gambol never imports TŌGE', () => {
  assert.deepEqual(crossing('gambol', ['toge']), []);
});

test('TŌGE never imports Gambol', () => {
  assert.deepEqual(crossing('toge', ['gambol']), []);
});

test('the common shared code imports no game', () => {
  assert.deepEqual(crossing('shared', ['gambol', 'toge', 'games']), []);
});
