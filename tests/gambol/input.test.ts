import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyInput } from '../../src/gambol/shared/movement.ts';

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
  const { Input } = await import('../../src/gambol/client/input.ts');
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
  const { Input } = await import('../../src/gambol/client/input.ts');
  const input = new Input(el as unknown as HTMLElement);
  await input.lock();
  key(doc, 'keydown', 'KeyW');
  doc.dispatchEvent(Object.assign(new Event('mousedown'), { button: 2 }));
  doc.exitPointerLock();
  assert.equal(input.locked, false);
  assert.equal(input.scopeHeld, false);
  assert.equal(input.sample(emptyInput()).forward, 0);
});

test('touch mode: "locking" needs no pointer lock, the stick and buttons drive the same input, pausing lets go of it all', async () => {
  const { doc, el, lockCalls } = setup();
  const { Input } = await import('../../src/gambol/client/input.ts');
  const input = new Input(el as unknown as HTMLElement);
  input.touchMode = true;
  const keys: string[] = [];
  input.onKey = (code, down) => keys.push(`${down ? '+' : '-'}${code}`);
  let locks = 0;
  input.onLockChange = () => locks++;
  await input.lock();
  assert.equal(input.locked, true);
  assert.equal(lockCalls(), 0, 'no pointer lock on a phone');
  assert.equal(locks, 1);

  input.stick.x = 0.5;
  input.stick.y = 1;
  input.press(input.keymap.jump);
  input.press(input.keymap.jump); // held: no second edge
  const m = input.sample(emptyInput());
  assert.equal(m.forward, 1);
  assert.equal(m.right, 0.5);
  assert.ok(m.jumpPressed && m.jump);
  assert.deepEqual(keys, ['+Space']);
  input.release(input.keymap.jump);
  assert.deepEqual(keys, ['+Space', '-Space']);

  const yaw = input.yaw;
  input.look(100, 0);
  assert.ok(input.yaw < yaw, 'swiping right turns right');
  input.setFire(true);
  assert.ok(input.takeFire() && input.fireHeld);
  input.setScope(true);
  assert.ok(input.scopeHeld);
  // Mouse events (a phone's emulated ones) are ignored in touch mode.
  doc.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: 500, movementY: 0 }));
  assert.ok(Math.abs(input.yaw - (yaw - 100 * input.sensitivity)) < 1e-9);

  input.unlock();
  assert.equal(input.locked, false);
  assert.equal(locks, 2);
  assert.deepEqual(input.stick, { x: 0, y: 0 });
  assert.ok(!input.scopeHeld && !input.fireHeld);
  input.look(100, 0);
  input.setFire(true);
  assert.ok(!input.takeFire(), 'nothing works while paused');
  input.dispose();
});

test('desktop: the touch stick stays at zero, so keyboard movement is exactly as before', async () => {
  const { doc, el } = setup();
  const { Input } = await import('../../src/gambol/client/input.ts');
  const input = new Input(el as unknown as HTMLElement);
  await input.lock();
  key(doc, 'keydown', 'KeyW');
  key(doc, 'keydown', 'KeyA');
  const m = input.sample(emptyInput());
  assert.equal(m.forward, 1);
  assert.equal(m.right, -1);
  input.dispose();
});
