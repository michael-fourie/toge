import { DurableObject } from 'cloudflare:workers';
import { NET } from '../shared/constants.ts';
import type { GameMode, LobbyInfo } from '../shared/protocol.ts';
import { HEARTBEAT_SECONDS } from './lobby.ts';

/** Entries older than this are dead lobbies (or reservations nobody connected to). */
const EXPIRE_MS = HEARTBEAT_SECONDS * 3 * 1000;

interface Entry extends LobbyInfo {
  at: number;
}

/**
 * One global registry of open lobbies: hands out codes, answers "list" and "does this code exist".
 * Lobbies are separate Durable Objects (one per match); they report here on join/leave and on a heartbeat.
 */
export class Directory extends DurableObject {
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

  /** Picks an unused code and reserves it so two hosts can't race for the same one. */
  async allocate(): Promise<string> {
    const taken = new Set((await this.live()).map((e) => e.code));
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, easy to read out loud
    let code: string;
    do {
      code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    } while (taken.has(code));
    await this.report(code, 'battle', '?', 0);
    return code;
  }

  async report(code: string, mode: GameMode, host: string, players: number): Promise<void> {
    const entry: Entry = { code, mode, host, players, max: NET.maxPlayersPerLobby, at: Date.now() };
    await this.ctx.storage.put(code, entry);
  }

  async remove(code: string): Promise<void> {
    await this.ctx.storage.delete(code);
  }

  async has(code: string): Promise<boolean> {
    return (await this.live()).some((e) => e.code === code);
  }

  /** Lobbies with someone in them (reservations with zero players stay hidden). */
  async list(): Promise<LobbyInfo[]> {
    return (await this.live()).filter((e) => e.players > 0).map(({ at: _at, ...info }) => info);
  }
}
