import { DurableObject } from 'cloudflare:workers';
import { PARTY, type PartyClientMsg } from '../shared/party.ts';
import { Party, type PartyClient, sendTo } from './party.ts';
import type { Env } from './worker.ts';

/** How often a live room re-announces itself to the directory (it expires silent rooms). */
const HEARTBEAT_MS = 30_000;

/** One room of a plug-in game (src/games/<id>): roster + message relay. Lives while anyone's connected. */
export class PartyRoom extends DurableObject<Env> {
  private party: Party | null = null;
  private nextId = 1;
  private beat: ReturnType<typeof setInterval> | null = null;

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const { 0: peer, 1: ws } = new WebSocketPair();
    ws.accept();
    const client: PartyClient = { id: this.nextId++, ws, name: (url.searchParams.get('name') ?? '').slice(0, 16).trim() || 'player', user: url.searchParams.get('user') === '1' };
    const party = this.open(url.searchParams.get('code')!, url.searchParams.get('kind')!);
    const no = party.refuse();
    if (no) {
      sendTo(client, { t: 'error', message: no });
      ws.close(1000, 'refused');
      return new Response(null, { status: 101, webSocket: peer });
    }
    party.add(client);
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string' || e.data.length > PARTY.maxBytes + 64) return;
      try {
        this.party?.handle(client, JSON.parse(e.data) as PartyClientMsg, e.data);
      } catch {
        // malformed JSON: ignore
      }
    });
    const leave = () => this.party?.remove(client);
    ws.addEventListener('close', leave);
    ws.addEventListener('error', leave);
    return new Response(null, { status: 101, webSocket: peer });
  }

  private open(code: string, game: string): Party {
    const dir = this.env.DIRECTORY.getByName(`party:${game}`);
    const report = (p: Party) => this.ctx.waitUntil(dir.reportParty({ code: p.code, game: p.game, host: p.hostName, players: p.members.size, max: PARTY.maxPlayers, open: p.open }));
    if (!this.party) {
      this.party = new Party(code, game, report, (p) => {
        this.party = null;
        if (this.beat) clearInterval(this.beat);
        this.ctx.waitUntil(dir.remove(p.code));
      });
      this.beat = setInterval(() => this.party && report(this.party), HEARTBEAT_MS);
    }
    return this.party;
  }
}
