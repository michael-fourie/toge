import { DurableObject } from 'cloudflare:workers';
import { RACE, type RaceClientMsg } from '../shared/race/protocol.ts';
import { Race, type RaceClient, sendTo } from './race.ts';
import type { Env } from './worker.ts';

const MAX_MESSAGE_BYTES = 2048;

/** One race lobby (the driving game). Lives while anyone is connected, like LobbyRoom. */
export class RaceRoom extends DurableObject<Env> {
  private race: Race | null = null;
  private nextId = 1;

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const code = url.searchParams.get('code')!;
    const { 0: peer, 1: ws } = new WebSocketPair();
    ws.accept();
    const client: RaceClient = {
      id: this.nextId++,
      ws,
      name: (url.searchParams.get('name') ?? '').slice(0, 16).trim() || 'driver',
      car: url.searchParams.get('car') ?? '',
      user: url.searchParams.get('user') === '1',
    };
    const race = this.open(code);
    if (race.full) {
      sendTo(client, { t: 'error', message: 'That race is full.' });
      ws.close(1000, 'full');
      return new Response(null, { status: 101, webSocket: peer });
    }
    race.add(client);
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string' || e.data.length > MAX_MESSAGE_BYTES) return;
      try {
        this.race?.handle(client, JSON.parse(e.data) as RaceClientMsg);
      } catch {
        // malformed JSON: ignore
      }
    });
    const leave = () => this.race?.remove(client);
    ws.addEventListener('close', leave);
    ws.addEventListener('error', leave);
    return new Response(null, { status: 101, webSocket: peer });
  }

  private open(code: string): Race {
    const dir = this.env.DIRECTORY.getByName('race');
    const accounts = this.env.ACCOUNTS.getByName('all');
    this.race ??= new Race(
      code,
      (r) => this.ctx.waitUntil(dir.reportRace({ code: r.code, host: r.hostName, track: r.track, phase: r.phase, players: r.members.size, max: RACE.maxPlayers })),
      (r) => {
        this.race = null;
        this.ctx.waitUntil(dir.remove(r.code));
      },
      (rows, users) => {
        for (const row of rows) if (users.has(row.id)) this.ctx.waitUntil(accounts.raceReward(row.name, row.prize, row.place === 1 && rows.length > 1));
      },
    );
    return this.race;
  }
}
