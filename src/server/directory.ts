import { DurableObject } from 'cloudflare:workers';
import type { RaceLobbyInfo } from '../toge/shared/protocol.ts';
import { Limiter } from './limiter.ts';
import { HEARTBEAT_SECONDS } from './rooms.ts';

/** Entries older than this are dead lobbies (or reservations nobody connected to). */
const EXPIRE_MS = HEARTBEAT_SECONDS * 3 * 1000;

/** A reserved code (players 0, hidden from the list) or a live race lobby. */
type Entry = Pick<RaceLobbyInfo, 'code' | 'players'> & Partial<RaceLobbyInfo> & { at: number };

/**
 * The registry of open race lobbies: hands out codes, answers "list" and "does this code exist". Race rooms are
 * separate Durable Objects (one per race); they report here on join/leave and on a heartbeat. The Worker uses the
 * instance named 'race'.
 */
export class Directory extends DurableObject {
  /** New codes per address: each one reserves a code and wakes a room, so a script can't host thousands. */
  private hosts = new Limiter(10, 1 / 6);

  private async live(): Promise<Entry[]> {
    const all = await this.ctx.storage.list<Entry>();
    const now = Date.now();
    const alive: Entry[] = [];
    for (const [key, e] of all) {
      if (now - e.at > EXPIRE_MS) void this.ctx.storage.delete(key);
      else alive.push(e);
    }
    return alive;
  }

  /** Picks an unused code and reserves it so two hosts can't race for the same one. Null: `ip` is hosting too often. */
  async allocate(ip = ''): Promise<string | null> {
    if (!this.hosts.take(ip)) return null;
    const taken = new Set((await this.live()).map((e) => e.code));
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, easy to read out loud
    let code: string;
    do {
      code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    } while (taken.has(code));
    await this.ctx.storage.put(code, { code, players: 0, at: Date.now() } satisfies Entry);
    return code;
  }

  async reportRace(info: RaceLobbyInfo): Promise<void> {
    await this.ctx.storage.put(info.code, { ...info, at: Date.now() } satisfies Entry);
  }

  /** Lobbies with someone in them (reservations with zero players stay hidden). */
  async listRaces(): Promise<RaceLobbyInfo[]> {
    return ((await this.live()) as (RaceLobbyInfo & { at: number })[]).filter((e) => e.players > 0).map(({ at: _at, ...info }) => info);
  }

  async remove(code: string): Promise<void> {
    await this.ctx.storage.delete(code);
  }

  async has(code: string): Promise<boolean> {
    return (await this.live()).some((e) => e.code === code);
  }
}
