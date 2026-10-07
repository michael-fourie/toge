import { storedSkinCode } from './skinStore.ts';
import type { ClientMsg, GameMode, LobbyInfo, ServerMsg } from '../shared/protocol.ts';

type Listener = (msg: ServerMsg) => void;

/**
 * Typed wrapper around the game server. Each lobby is its own server-side room, so the websocket
 * only exists while you're in one: `host()` / `join()` open it, `leave()` closes it. The lobby list is a plain fetch.
 */
export class Net {
  id = 0;
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  onClose?: () => void;

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Open lobbies; also serves as the "is the server reachable" check. */
  async lobbies(): Promise<LobbyInfo[]> {
    const res = await fetch('/api/lobbies');
    if (!res.ok) throw new Error('Could not reach the game server');
    return res.json();
  }

  /** Replies arrive as `joined` or `error` messages through `on()`. */
  host(name: string, mode: GameMode, teams = false) {
    this.open(teams ? { name, mode, teams: '1' } : { name, mode });
  }

  join(name: string, code: string) {
    this.open({ name, code });
  }

  leave() {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  private open(params: Record<string, string>) {
    this.leave();
    const skin = storedSkinCode();
    if (skin) params.skin = skin;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?${new URLSearchParams(params)}`);
    this.ws = ws;
    let opened = false;
    ws.onopen = () => (opened = true);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMsg;
      if (msg.t === 'welcome') this.id = msg.id;
      this.emit(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // we closed it ourselves
      this.ws = null;
      if (opened) this.onClose?.();
      else this.emit({ t: 'error', message: 'Could not reach the game server.' });
    };
  }

  private emit(msg: ServerMsg) {
    this.listeners.forEach((l) => l(msg));
  }

  send(msg: ClientMsg) {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
