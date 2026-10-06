// Manual smoke test against a running server: `npx tsx tests/lobby.smoke.ts`
import WebSocket from 'ws';
import type { ServerMsg } from '../src/shared/protocol.ts';

const url = process.env.WS ?? 'ws://localhost:3001/ws';
function bot(name: string) {
  const ws = new WebSocket(url);
  const inbox: ServerMsg[] = [];
  ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
  const wait = (t: ServerMsg['t'], ms = 4000) =>
    new Promise<ServerMsg>((res, rej) => {
      const start = Date.now();
      const iv = setInterval(() => {
        const i = inbox.findIndex((m) => m.t === t);
        if (i >= 0) { clearInterval(iv); res(inbox.splice(i, 1)[0]); }
        else if (Date.now() - start > ms) { clearInterval(iv); rej(new Error(`${name}: no ${t}`)); }
      }, 10);
    });
  const send = (m: object) => ws.send(JSON.stringify(m));
  return { ws, wait, send, open: new Promise((r) => ws.on('open', r)), name };
}

const a = bot('alice');
const b = bot('bob');
await Promise.all([a.open, b.open]);
const aId = ((await a.wait('welcome')) as any).id;
const bId = ((await b.wait('welcome')) as any).id;
a.send({ t: 'hello', name: 'alice' });
b.send({ t: 'hello', name: 'bob' });
a.send({ t: 'host', mode: 'battle' });
const joinedA = (await a.wait('joined')) as Extract<ServerMsg, { t: 'joined' }>;
console.log('hosted', joinedA.code);
b.send({ t: 'list' });
console.log('lobbies', JSON.stringify(((await b.wait('lobbies')) as any).lobbies));
b.send({ t: 'join', code: joinedA.code });
const joinedB = (await b.wait('joined')) as any;
console.log('bob joined, players:', joinedB.players.map((p: any) => p.name).join(','));
await a.wait('playerJoined');

b.send({ t: 'state', p: [5, 0, 5], v: [0, 0, 0], yaw: 0, pitch: 0, f: 1 });
await new Promise((r) => setTimeout(r, 150));
let snap: any;
do snap = await a.wait('snapshot'); while (!snap.players.some((p: any) => p.id === bId && p.p[0] === 5));
console.log('alice sees bob at', snap.players.find((p: any) => p.id === bId).p);

a.send({ t: 'shoot', from: [0, 1.6, 0], to: [5, 1.6, 5], victim: bId, headshot: true });
const shot = (await b.wait('shot')) as any;
const kill = (await b.wait('kill')) as any;
console.log('bob saw shot from', shot.id, '| kill', kill.killer === aId, kill.victim === bId, kill.cause);
const resp = (await b.wait('respawn', 4000)) as any;
console.log('bob respawned at', resp.p);
a.ws.close();
const left = (await b.wait('playerLeft')) as any;
console.log('alice left, new host', left.hostId === bId ? 'bob' : left.hostId);
b.ws.close();
console.log('SMOKE OK');
