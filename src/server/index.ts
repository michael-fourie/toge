import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { NET } from '../shared/constants.ts';
import type { ClientMsg } from '../shared/protocol.ts';
import { type Client, Lobby, send } from './lobby.ts';

const PORT = Number(process.env.PORT ?? 3001);
const DIST = resolve('dist');
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

// In production the game server also serves the built client. In dev, Vite does that and proxies /ws here.
const http = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('Client not built. Run `npm run build`, or use `npm run dev`.');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server: http, path: '/ws' });
const lobbies = new Map<string, Lobby>();
let nextId = 1;

function newCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, easy to read out loud
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (lobbies.has(code));
  return code;
}

const listLobbies = () =>
  [...lobbies.values()].map((l) => ({
    code: l.code,
    host: l.members.get(l.hostId)?.info.name ?? '?',
    players: l.members.size,
    max: NET.maxPlayersPerLobby,
  }));

wss.on('connection', (ws) => {
  const client: Client = { id: nextId++, ws, name: `player${nextId - 1}`, lobby: null };
  send(client, { t: 'welcome', id: client.id });

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.t) {
      case 'hello':
        client.name = String(msg.name).slice(0, 16).trim() || client.name;
        return;
      case 'list':
        send(client, { t: 'lobbies', lobbies: listLobbies() });
        return;
      case 'host': {
        client.lobby?.remove(client);
        const code = newCode();
        lobbies.set(code, new Lobby(code, client, (l) => lobbies.delete(l.code)));
        console.log(`[lobby ${code}] hosted by ${client.name}`);
        return;
      }
      case 'join': {
        const lobby = lobbies.get(String(msg.code).toUpperCase());
        if (!lobby) return send(client, { t: 'error', message: 'No lobby with that code.' });
        if (lobby.full) return send(client, { t: 'error', message: 'Lobby is full.' });
        client.lobby?.remove(client);
        lobby.add(client);
        console.log(`[lobby ${lobby.code}] ${client.name} joined (${lobby.members.size})`);
        return;
      }
      case 'leave':
        client.lobby?.remove(client);
        return;
      default:
        client.lobby?.handle(client, msg);
    }
  });

  ws.on('close', () => client.lobby?.remove(client));
});

http.listen(PORT, () => console.log(`game server on http://localhost:${PORT} (ws at /ws)`));
