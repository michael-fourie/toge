import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyInput } from '../src/shared/movement.ts';

/** Just enough DOM for Input: event targets for document/window and an element that can take pointer lock. */
function setup() {
  const doc = new EventTarget() as EventTarget & { pointerLockElement: unknown; exitPointerLock(): void };
  const win = new EventTarget();
  let lockCalls = 0;
  const el = {
    requestPointerLock: async () => {
      lockCalls++;
      doc.pointerLockElement = el;
      doc.dispatchEvent(new Event('pointerlockchange'));
    },
  };
  doc.pointerLockElement = null;
  doc.exitPointerLock = () => {
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));
  };
  Object.assign(globalThis, { document: doc, window: win });
  return { doc, el, lockCalls: () => lockCalls };
}

const key = (doc: EventTarget, type: 'keydown' | 'keyup', code: string, repeat = false) => doc.dispatchEvent(Object.assign(new Event(type), { code, repeat, preventDefault() {} }));

test('shooting (a click that re-requests pointer lock) never releases held movement keys or the scope', async () => {
  const { doc, el, lockCalls } = setup();
  const { Input } = await import('../src/client/input.ts');
  const input = new Input(el as unknown as HTMLElement);
  await input.lock();
  assert.equal(input.locked, true);
  assert.equal(lockCalls(), 1);

  key(doc, 'keydown', 'KeyW');
  key(doc, 'keydown', 'Space');
  doc.dispatchEvent(Object.assign(new Event('mousedown'), { button: 2 })); // hold RMB: scoped
  assert.equal(input.scopeHeld, true);

  // The game calls lock() on every click, and a browser may re-announce an existing lock.
  await input.lock();
  doc.dispatchEvent(new Event('pointerlockchange'));
  assert.equal(lockCalls(), 1, 'no second lock request while already locked');

  const out = input.sample(emptyInput());
  assert.equal(out.forward, 1, 'W still held');
  assert.equal(out.jump, true, 'Space still held');
  assert.equal(input.scopeHeld, true, 'scope button still held');
});

test('actually losing pointer lock still releases everything', async () => {
  const { doc, el } = setup();
  const { Input } = await import('../src/client/input.ts');
  const input = new Input(el as unknown as HTMLElement);
  await input.lock();
  key(doc, 'keydown', 'KeyW');
  doc.dispatchEvent(Object.assign(new Event('mousedown'), { button: 2 }));
  doc.exitPointerLock();
  assert.equal(input.locked, false);
  assert.equal(input.scopeHeld, false);
  assert.equal(input.sample(emptyInput()).forward, 0);
});
