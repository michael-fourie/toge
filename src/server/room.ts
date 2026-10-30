import { DurableObject } from 'cloudflare:workers';
import { isBattleMap } from '../shared/maps.ts';
import type { BattleMap, ClientMsg, GameMode } from '../shared/protocol.ts';
import { decodeGear } from '../shared/items.ts';
import { decodeSkin } from '../shared/skin.ts';
import { Limiter } from './limiter.ts';
import { type Client, Lobby, send } from './lobby.ts';
import type { Env } from './worker.ts';

const MAX_MESSAGE_BYTES = 4096;
/** Messages a client may send per second (with a burst of twice that). A real one sends well under half of this. */
const MAX_MESSAGES_PER_SECOND = 100;

/** One match. The Durable Object lives (and ticks) while anyone is connected and vanishes when the room empties. */
export class LobbyRoom extends DurableObject<Env> {
  private lobby: Lobby | null = null;
  private nextId = 1;
  private flood = new Limiter(MAX_MESSAGES_PER_SECOND * 2, MAX_MESSAGES_PER_SECOND);

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const code = url.searchParams.get('code')!;
    const mode = url.searchParams.get('mode') === 'survival' ? 'survival' : 'battle';
    const koth = mode === 'battle' && url.searchParams.get('koth') === '1';
    const br = mode === 'battle' && !koth && url.searchParams.get('br') === '1';
    const teams = koth || (mode === 'battle' && !br && url.searchParams.get('teams') === '1'); // the hill is always a team fight; Royale is every player for themselves
    const mapParam = url.searchParams.get('map');
    const map = mode === 'battle' && isBattleMap(mapParam) ? mapParam : 'windward';
    const name = url.searchParams.get('name') ?? '';
    const { 0: peer, 1: ws } = new WebSocketPair();
    ws.accept();

    const id = this.nextId++;
    const skin = decodeSkin(url.searchParams.get('skin')) ?? undefined; // anything malformed just means the seeded default
    const gear = decodeGear(url.searchParams.get('gear')) ?? undefined; // forged ids just mean nothing worn
    const client: Client = { id, ws, name: name.slice(0, 16).trim() || `player${id}`, user: url.searchParams.get('user') === '1', skin, gear, lobby: null };
    send(client, { t: 'welcome', id });
    const lobby = this.open(code, mode, teams, map, koth, br);
    if (lobby.full) {
      send(client, { t: 'error', message: 'Lobby is full.' });
      ws.close(1000, 'full');
    } else {
      lobby.add(client);
      ws.addEventListener('message', (e) => {
        if (typeof e.data !== 'string' || e.data.length > MAX_MESSAGE_BYTES || !this.flood.take(String(id))) return;
        try {
          client.lobby?.handle(client, JSON.parse(e.data) as ClientMsg);
        } catch {
          // malformed JSON: ignore
        }
      });
      const leave = () => {
        client.lobby?.remove(client);
        this.flood.forget(String(id));
      };
      ws.addEventListener('close', leave);
      ws.addEventListener('error', leave);
    }
    return new Response(null, { status: 101, webSocket: peer });
  }

  private open(code: string, mode: GameMode, teams: boolean, map: BattleMap, koth: boolean, br: boolean): Lobby {
    const dir = this.env.DIRECTORY.getByName('all');
    if (this.lobby) return this.lobby;
    this.lobby = new Lobby(
      code,
      mode,
      teams,
      map,
      (l) => this.ctx.waitUntil(dir.report(l.code, l.mode, l.teams, l.koth || l.br ? undefined : l.map, l.hostName, l.members.size, l.koth, l.br)),
      (l) => {
        this.lobby = null;
        this.ctx.waitUntil(dir.remove(l.code));
      },
      koth,
      br,
    );
    // Signed-in players' coins and XP live in their account: the server pays (and charges) them, not their browser.
    const accounts = this.env.ACCOUNTS.getByName('all');
    this.lobby.bank = {
      pay: (name, coins, xp) => this.ctx.waitUntil(accounts.reward(name, coins, xp)),
      spend: (name, coins) => accounts.spend(name, coins),
    };
    return this.lobby;
  }
}
