// Keeps the layers apart: the common code (src/shared) imports neither the game (src/kanjo) nor the browser shell
// (src/client), so the Worker can use it. KANJO's own shared code (src/kanjo/shared) stays free of three.js and the DOM.

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

/** Every import in `area`: relative ones resolved to a path under src/ (e.g. "kanjo/shared/track.ts"), packages as written. */
function importsOf(area: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const file of filesIn(join(SRC, area))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const to = m[1].startsWith('.') ? relative(SRC, resolve(dirname(file), m[1])).replaceAll('\\', '/') : m[1];
      out.push({ from: relative(SRC, file).replaceAll('\\', '/'), to });
    }
  }
  return out;
}

const crossing = (area: string, banned: string[]) =>
  importsOf(area)
    .filter((i) => banned.some((b) => i.to === b || i.to.startsWith(b + '/')))
    .map((i) => `${i.from} -> ${i.to}`);

test('the common shared code imports neither the game nor the browser shell', () => {
  assert.deepEqual(crossing('shared', ['kanjo', 'client', 'server']), []);
});

test("KANJO's shared rules stay pure: no three.js, no browser code", () => {
  assert.deepEqual(crossing('kanjo/shared', ['three', 'client', 'kanjo/client']), []);
});
