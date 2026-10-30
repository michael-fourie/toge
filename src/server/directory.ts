import { DurableObject } from 'cloudflare:workers';
import { NET } from '../shared/constants.ts';
import type { BattleMap, GameMode, LobbyInfo } from '../shared/protocol.ts';
import type { RaceLobbyInfo } from '../shared/race/protocol.ts';
import type { PartyInfo } from '../shared/party.ts';
import { HEARTBEAT_SECONDS } from './lobby.ts';

/** Entries older than this are dead lobbies (or reservations nobody connected to). */
const EXPIRE_MS = HEARTBEAT_SECONDS * 3 * 1000;

interface Entry extends LobbyInfo {
  at: number;
}

interface RaceEntry extends RaceLobbyInfo {
  at: number;
}

/**
 * One global registry of open lobbies: hands out codes, answers "list" and "does this code exist".
 * Lobbies are separate Durable Objects (one per match); they report here on join/leave and on a heartbeat.
 * The shooter's lobbies use the instance named 'all'; race lobbies their own instance, 'race'.
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
    await this.report(code, 'battle', false, undefined, '?', 0);
    return code;
  }

  async report(code: string, mode: GameMode, teams: boolean, map: BattleMap | undefined, host: string, players: number, koth = false, br = false): Promise<void> {
    const entry: Entry = { code, mode, teams: teams || undefined, map: mode === 'battle' ? map : undefined, koth: koth || undefined, br: br || undefined, host, players, max: NET.maxPlayersPerLobby, at: Date.now() };
    await this.ctx.storage.put(code, entry);
  }

  async reportRace(info: RaceLobbyInfo): Promise<void> {
    await this.ctx.storage.put(info.code, { ...info, at: Date.now() } satisfies RaceEntry);
  }

  /** Plug-in games' rooms: each game has its own instance ('party:<game id>'). */
  async reportParty(info: PartyInfo): Promise<void> {
    await this.ctx.storage.put(info.code, { ...info, at: Date.now() });
  }

  async listParties(): Promise<PartyInfo[]> {
    return ((await this.live()) as unknown as (PartyInfo & { at: number })[]).filter((e) => e.players > 0 && e.game).map(({ at: _at, ...info }) => info);
  }

  /** The race directory's lobbies (same storage shape, a different instance). */
  async listRaces(): Promise<RaceLobbyInfo[]> {
    return ((await this.live()) as unknown as RaceEntry[]).filter((e) => e.players > 0).map(({ at: _at, ...info }) => info);
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
