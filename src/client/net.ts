import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';

type Listener = (msg: ServerMsg) => void;

/** Thin typed wrapper around the game server websocket. */
export class Net {
  id = 0;
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  onClose?: () => void;

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(name: string): Promise<void> {
    if (this.connected) {
      this.send({ t: 'hello', name });
      return Promise.resolve();
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out connecting to server')), 5000);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMsg;
        if (msg.t === 'welcome') {
          this.id = msg.id;
          clearTimeout(timeout);
          this.send({ t: 'hello', name });
          resolve();
        }
        this.listeners.forEach((l) => l(msg));
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Could not reach the game server'));
      };
      ws.onclose = () => {
        this.ws = null;
        this.onClose?.();
      };
    });
  }

  send(msg: ClientMsg) {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
