import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Party, type PartyClient } from '../src/server/party.ts';
import { PARTY, type PartyServerMsg, isGameId } from '../src/shared/party.ts';

function room() {
  let now = 1_000_000;
  const inbox = new Map<number, PartyServerMsg[]>();
  let empty = false;
  const party = new Party('ABCD', 'demo', () => {}, () => (empty = true), () => now);
  const join = (id: number) => {
    inbox.set(id, []);
    const c: PartyClient = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: `p${id}`, user: false };
    party.add(c);
    return c;
  };
  const send = (c: PartyClient, data: unknown, to?: number) => party.handle(c, { t: 'send', data, to }, JSON.stringify({ t: 'send', data, to }));
  return { party, join, send, inbox, advance: (ms: number) => (now += ms), isEmpty: () => empty };
}

test('game ids are simple', () => {
  assert.ok(isGameId('demo') && isGameId('my-game-2'));
  for (const bad of ['', 'Mash', 'a b', '../x', 'x'.repeat(25), 3]) assert.ok(!isGameId(bad));
});

test('first in hosts; everyone gets the roster; the host moves on when they leave', () => {
  const r = room();
  const a = r.join(1);
  r.join(2);
  assert.equal(r.party.hostId, 1);
  const roster = r.inbox.get(2)!.filter((m) => m.t === 'members').at(-1);
  assert.ok(roster && roster.t === 'members' && roster.members.length === 2 && roster.hostId === 1);
  r.party.remove(a);
  assert.equal(r.party.hostId, 2);
});

test('messages go to everyone else, or to one player; the server never looks inside', () => {
  const r = room();
  const a = r.join(1);
  r.join(2);
  r.join(3);
  r.send(a, { anything: [1, 'two'] });
  for (const id of [2, 3]) assert.deepEqual(r.inbox.get(id)!.at(-1), { t: 'msg', from: 1, data: { anything: [1, 'two'] } });
  assert.ok(!r.inbox.get(1)!.some((m) => m.t === 'msg'), 'not echoed to the sender');
  r.send(a, 'psst', 3);
  assert.deepEqual(r.inbox.get(3)!.at(-1), { t: 'msg', from: 1, data: 'psst' });
  assert.notDeepEqual(r.inbox.get(2)!.at(-1), { t: 'msg', from: 1, data: 'psst' });
});

test('oversized messages and floods are dropped', () => {
  const r = room();
  const a = r.join(1);
  r.join(2);
  r.send(a, 'x'.repeat(PARTY.maxBytes));
  assert.ok(!r.inbox.get(2)!.some((m) => m.t === 'msg'));
  for (let i = 0; i < PARTY.perSecond * 3; i++) r.send(a, i);
  const got = r.inbox.get(2)!.filter((m) => m.t === 'msg').length;
  assert.ok(got <= PARTY.perSecond, `relayed ${got}`);
  r.advance(1000);
  r.send(a, 'later');
  assert.deepEqual(r.inbox.get(2)!.at(-1), { t: 'msg', from: 1, data: 'later' }, 'the allowance refills');
});

test('only the host opens and closes the room; a closed or full room refuses joiners', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  r.party.handle(b, { t: 'open', open: false }, '');
  assert.equal(r.party.refuse(), null);
  r.party.handle(a, { t: 'open', open: false }, '');
  assert.ok(r.party.refuse());
  r.party.handle(a, { t: 'open', open: true }, '');
  for (let i = 3; i <= PARTY.maxPlayers; i++) r.join(i);
  assert.ok(r.party.refuse(), 'full');
});

test('the room closes when the last player leaves', () => {
  const r = room();
  const a = r.join(1);
  r.party.remove(a);
  assert.ok(r.isEmpty());
});
