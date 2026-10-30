// The client side of party rooms (multiplayer for any game). Get one through `api.party.host()` /
// `api.party.join(code)`; it resolves once you're in, with the roster.

import { type PartyClientMsg, type PartyInfo, type PartyMember, type PartyServerMsg } from '../shared/party.ts';

export type { PartyInfo, PartyMember };

export class Party {
  id = 0;
  code = '';
  hostId = 0;
  members: PartyMember[] = [];
  /** Accepting new joiners (the host decides). */
  open = true;
  private msgFns = new Set<(from: number, data: unknown) => void>();
  private memberFns = new Set<() => void>();
  private closeFns = new Set<(why: string) => void>();

  constructor(private ws: WebSocket) {}

  get isHost() {
    return this.id === this.hostId;
  }

  /** Sends `data` (anything JSON) to everyone else, or just to player `to`. */
  send(data: unknown, to?: number) {
    this.raw({ t: 'send', data, to });
  }

  /** Host only: close (or reopen) the room to new players. */
  setOpen(open: boolean) {
    this.raw({ t: 'open', open });
  }

  onMessage(fn: (from: number, data: unknown) => void): () => void {
    this.msgFns.add(fn);
    return () => this.msgFns.delete(fn);
  }

  /** The roster changed (someone joined or left, or the host moved on). */
  onMembers(fn: () => void): () => void {
    this.memberFns.add(fn);
    return () => this.memberFns.delete(fn);
  }

  /** The connection is gone (with a reason to show). */
  onClose(fn: (why: string) => void): () => void {
    this.closeFns.add(fn);
    return () => this.closeFns.delete(fn);
  }

  leave() {
    this.ws.onclose = null;
    this.ws.close();
  }

  private raw(msg: PartyClientMsg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** @internal */
  handle(msg: PartyServerMsg) {
    if (msg.t === 'welcome') {
      this.id = msg.id;
      this.code = msg.code;
    } else if (msg.t === 'members') {
      this.hostId = msg.hostId;
      this.members = msg.members;
      this.open = msg.open;
      this.memberFns.forEach((f) => f());
    } else if (msg.t === 'msg') this.msgFns.forEach((f) => f(msg.from, msg.data));
  }

  /** @internal */
  closed(why: string) {
    this.closeFns.forEach((f) => f(why));
  }
}

/** Hosts (no code) or joins a room of `game`; resolves when you're in, rejects with a message. */
export function openParty(game: string, name: string, code?: string): Promise<Party> {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const params = new URLSearchParams({ game: 'party', kind: game, name, ...(code ? { code: code.toUpperCase() } : {}) });
  const ws = new WebSocket(`${proto}://${location.host}/ws?${params}`);
  const party = new Party(ws);
  return new Promise((resolve, reject) => {
    let inside = false;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as PartyServerMsg;
      if (msg.t === 'error') {
        if (!inside) reject(new Error(msg.message));
        return;
      }
      party.handle(msg);
      if (msg.t === 'members' && !inside) {
        inside = true;
        resolve(party);
      }
    };
    ws.onclose = () => {
      if (inside) party.closed('Disconnected.');
      else reject(new Error('Could not reach the game server.'));
    };
  });
}

/** Open rooms for `game`. */
export async function listParties(game: string): Promise<PartyInfo[]> {
  const res = await fetch(`/api/parties?game=${encodeURIComponent(game)}`);
  if (!res.ok) throw new Error('Could not reach the game server');
  return res.json();
}
