import { PARTY, type PartyClientMsg, type PartyMember, type PartyServerMsg } from '../shared/party.ts';
import type { Socket } from './rooms.ts';

const OPEN = 1;

export interface PartyClient {
  id: number;
  ws: Socket;
  name: string;
  user: boolean;
}

interface Member {
  client: PartyClient;
  /** Rate limit: messages it may still send (refills at PARTY.perSecond). */
  tokens: number;
  at: number;
}

export const sendTo = (c: PartyClient, msg: PartyServerMsg) => {
  if (c.ws.readyState === OPEN) c.ws.send(JSON.stringify(msg));
};

/**
 * One room of a plug-in game: the roster (first in hosts; the host moves on if they leave), whether it's
 * open to joiners, and a relay for the players' messages. It never looks inside them.
 */
export class Party {
  readonly members = new Map<number, Member>();
  hostId = 0;
  open = true;

  constructor(
    readonly code: string,
    readonly game: string,
    private onChange: (p: Party) => void,
    private onEmpty: (p: Party) => void,
    private now: () => number = Date.now,
  ) {}

  get hostName() {
    return this.members.get(this.hostId)?.client.name ?? '?';
  }

  /** Can someone join right now? Null if so, else why not. */
  refuse(): string | null {
    if (this.members.size >= PARTY.maxPlayers) return 'That room is full.';
    if (!this.open) return 'That room is closed for now.';
    return null;
  }

  add(c: PartyClient) {
    this.members.set(c.id, { client: c, tokens: PARTY.perSecond, at: this.now() });
    if (!this.hostId) this.hostId = c.id;
    sendTo(c, { t: 'welcome', id: c.id, code: this.code, game: this.game });
    this.roster();
  }

  remove(c: PartyClient) {
    if (!this.members.delete(c.id)) return;
    if (!this.members.size) return this.onEmpty(this);
    if (this.hostId === c.id) {
      this.hostId = this.members.keys().next().value!;
      this.open = true; // a new host starts with the door open
    }
    this.roster();
  }

  /** `raw` is the message's text (for the size check). */
  handle(c: PartyClient, msg: PartyClientMsg, raw: string) {
    const m = this.members.get(c.id);
    if (!m || !msg || typeof msg !== 'object') return;
    const now = this.now();
    m.tokens = Math.min(PARTY.perSecond, m.tokens + ((now - m.at) / 1000) * PARTY.perSecond);
    m.at = now;
    if (m.tokens < 1) return;
    m.tokens--;
    if (msg.t === 'send') {
      if (raw.length > PARTY.maxBytes) return;
      const text = JSON.stringify({ t: 'msg', from: c.id, data: msg.data } satisfies PartyServerMsg);
      if (typeof msg.to === 'number') {
        const to = this.members.get(msg.to);
        if (to && to.client.ws.readyState === OPEN) to.client.ws.send(text);
      } else for (const o of this.members.values()) if (o !== m && o.client.ws.readyState === OPEN) o.client.ws.send(text);
    } else if (msg.t === 'open' && c.id === this.hostId && typeof msg.open === 'boolean') {
      this.open = msg.open;
      this.roster();
    }
  }

  private roster() {
    const members: PartyMember[] = [...this.members.values()].map((m) => ({ id: m.client.id, name: m.client.name, user: m.client.user }));
    const text = JSON.stringify({ t: 'members', hostId: this.hostId, members, open: this.open } satisfies PartyServerMsg);
    for (const m of this.members.values()) if (m.client.ws.readyState === OPEN) m.client.ws.send(text);
    this.onChange(this);
  }
}
