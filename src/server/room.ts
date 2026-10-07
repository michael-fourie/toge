import { DurableObject } from 'cloudflare:workers';
import type { ClientMsg, GameMode } from '../shared/protocol.ts';
import { decodeGear } from '../shared/items.ts';
import { decodeSkin } from '../shared/skin.ts';
import { type Client, Lobby, send } from './lobby.ts';
import type { Env } from './worker.ts';

const MAX_MESSAGE_BYTES = 4096;

/** One match. The Durable Object lives (and ticks) while anyone is connected and vanishes when the room empties. */
export class LobbyRoom extends DurableObject<Env> {
  private lobby: Lobby | null = null;
  private nextId = 1;

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const code = url.searchParams.get('code')!;
    const mode = url.searchParams.get('mode') === 'survival' ? 'survival' : 'battle';
    const teams = mode === 'battle' && url.searchParams.get('teams') === '1';
    const name = url.searchParams.get('name') ?? '';
    const { 0: peer, 1: ws } = new WebSocketPair();
    ws.accept();

    const id = this.nextId++;
    const skin = decodeSkin(url.searchParams.get('skin')) ?? undefined; // anything malformed just means the seeded default
    const gear = decodeGear(url.searchParams.get('gear')) ?? undefined; // forged ids just mean nothing worn
    const client: Client = { id, ws, name: name.slice(0, 16).trim() || `player${id}`, skin, gear, lobby: null };
    send(client, { t: 'welcome', id });
    const lobby = this.open(code, mode, teams);
    if (lobby.full) {
      send(client, { t: 'error', message: 'Lobby is full.' });
      ws.close(1000, 'full');
    } else {
      lobby.add(client);
      ws.addEventListener('message', (e) => {
        if (typeof e.data !== 'string' || e.data.length > MAX_MESSAGE_BYTES) return;
        try {
          client.lobby?.handle(client, JSON.parse(e.data) as ClientMsg);
        } catch {
          // malformed JSON: ignore
        }
      });
      const leave = () => client.lobby?.remove(client);
      ws.addEventListener('close', leave);
      ws.addEventListener('error', leave);
    }
    return new Response(null, { status: 101, webSocket: peer });
  }

  private open(code: string, mode: GameMode, teams: boolean): Lobby {
    const dir = this.env.DIRECTORY.getByName('all');
    this.lobby ??= new Lobby(
      code,
      mode,
      teams,
      (l) => this.ctx.waitUntil(dir.report(l.code, l.mode, l.teams, l.hostName, l.members.size)),
      (l) => {
        this.lobby = null;
        this.ctx.waitUntil(dir.remove(l.code));
      },
    );
    return this.lobby;
  }
}
