import { DurableObject } from 'cloudflare:workers';
import { CAR_CODE_MAX } from '../shared/cars.ts';
import { RACE, type RaceClientMsg, type RecordRow } from '../shared/protocol.ts';
import { Limiter } from '../../server/limiter.ts';
import { Race, type RaceClient, sendTo } from './race.ts';
import type { Env } from '../../server/worker.ts';

/** Room for the host's `cpus` message (up to seven CPU racers' poses at once). */
const MAX_MESSAGE_BYTES = 4096;
/** Messages a client may send per second (with a burst of twice that); a car sends 20 poses a second. Poses are relayed at once, so a flood would be everyone's problem. */
const MAX_MESSAGES_PER_SECOND = 60;

/** One race lobby (the driving game). Lives while anyone is connected, like LobbyRoom. */
export class RaceRoom extends DurableObject<Env> {
  private race: Race | null = null;
  private nextId = 1;
  private flood = new Limiter(MAX_MESSAGES_PER_SECOND * 2, MAX_MESSAGES_PER_SECOND);

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
      rider: url.searchParams.get('rider') ?? '',
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
      if (typeof e.data !== 'string' || e.data.length > MAX_MESSAGE_BYTES || !this.flood.take(String(client.id))) return;
      try {
        const msg = JSON.parse(e.data) as RaceClientMsg;
        // A signed-in racer's new car is checked against their garage first (cosmetics they don't own come off).
        if (client.user && msg && msg.t === 'car' && typeof msg.car === 'string') {
          const accounts = this.env.ACCOUNTS.getByName('all');
          void accounts
            .raceCar(client.name, msg.car.slice(0, CAR_CODE_MAX))
            .then((car) => this.race?.handle(client, { t: 'car', car }))
            .catch(() => {}); // the accounts store was busy: keep the old car rather than throw in the room
          return;
        }
        this.race?.handle(client, msg);
      } catch {
        // malformed JSON: ignore
      }
    });
    const leave = () => {
      this.race?.remove(client);
      this.flood.forget(String(client.id));
    };
    ws.addEventListener('close', leave);
    ws.addEventListener('error', leave);
    return new Response(null, { status: 101, webSocket: peer });
  }

  private open(code: string): Race {
    const dir = this.env.DIRECTORY.getByName('race');
    const accounts = this.env.ACCOUNTS.getByName('all');
    this.race ??= new Race(
      code,
      (r) => this.ctx.waitUntil(dir.reportRace({ code: r.code, host: r.hostName, track: r.track, mode: r.mode, physics: r.physics, phase: r.phase, players: r.humans, max: RACE.maxPlayers })),
      (r) => {
        this.race = null;
        this.ctx.waitUntil(dir.remove(r.code));
      },
      (rows, users, track) => {
        // One prize per account per race, its best finish (rows are in finishing order): a second tab can't double it.
        const paid = new Set<string>();
        // A win counts against other people, not just CPU racers.
        const people = rows.filter((r) => !r.cpu).length;
        // Best times are kept one after another, quickest first, so a record two racers both beat goes to the quicker.
        const timed: (() => Promise<RecordRow | null>)[] = [];
        for (const row of rows) {
          if (!users.has(row.id) || paid.has(row.name.toLowerCase())) continue;
          paid.add(row.name.toLowerCase());
          this.ctx.waitUntil(accounts.raceReward(row.name, row.prize, row.place === 1 && people > 1));
          // The room timed this finish itself, so it can count as a best time.
          const time = row.time;
          if (time !== null) timed.push(() => accounts.raceTime(row.name, track, time, row.car).then((b) => (b ? { id: row.id, time: b.time, prev: b.prev, rank: b.rank ?? null, beat: b.beat ?? null } : null)));
        }
        if (timed.length) {
          this.ctx.waitUntil(
            (async () => {
              const news: RecordRow[] = [];
              for (const keep of timed) {
                const r = await keep();
                if (r) news.push(r);
              }
              if (news.length) this.race?.announce({ t: 'records', rows: news });
            })(),
          );
        }
      },
    );
    return this.race;
  }
}
