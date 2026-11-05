// The race lobby socket. Like the shooter's Net, a socket exists only while you're in a lobby; it remembers
// the latest roster so screens can draw it straight away.

import type { RaceClientMsg, RaceLobbyInfo, RaceServerMsg } from '../shared/protocol.ts';

type Room = Extract<RaceServerMsg, { t: 'room' }>;
type Listener = (msg: RaceServerMsg) => void;

export class RaceNet {
  id = 0;
  room: Room | null = null;
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async lobbies(): Promise<RaceLobbyInfo[]> {
    const res = await fetch('/api/races');
    if (!res.ok) throw new Error('Could not reach the game server');
    return res.json();
  }

  host(name: string, car: string, rider: string) {
    this.open({ game: 'race', name, car, rider });
  }

  join(name: string, car: string, rider: string, code: string) {
    this.open({ game: 'race', name, car, rider, code });
  }

  leave() {
    const ws = this.ws;
    this.ws = null;
    this.room = null;
    ws?.close();
  }

  send(msg: RaceClientMsg) {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private open(params: Record<string, string>) {
    this.leave();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?${new URLSearchParams(params)}`);
    this.ws = ws;
    let opened = false;
    ws.onopen = () => (opened = true);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as RaceServerMsg;
      if (msg.t === 'welcome') this.id = msg.id;
      if (msg.t === 'room') this.room = msg;
      this.emit(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.room = null;
      this.emit({ t: 'error', message: opened ? 'Disconnected from the race.' : 'Could not reach the game server.' });
    };
  }

  private emit(msg: RaceServerMsg) {
    this.listeners.forEach((l) => l(msg));
  }
}

export const raceNet = new RaceNet();
