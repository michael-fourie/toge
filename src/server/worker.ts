import type { Directory } from './directory.ts';
import type { LobbyRoom } from './room.ts';

export { Directory } from './directory.ts';
export { LobbyRoom } from './room.ts';

export interface Env {
  LOBBY: DurableObjectNamespace<LobbyRoom>;
  DIRECTORY: DurableObjectNamespace<Directory>;
}

/** Durable Objects are created near whoever first touches them; hint at the host's region so the match is close to them. */
function regionHint(cf: IncomingRequestCfProperties | undefined): DurableObjectLocationHint | undefined {
  switch (cf?.continent) {
    case 'NA':
      return Number(cf.longitude) < -100 ? 'wnam' : 'enam';
    case 'EU':
      return 'weur';
    case 'AS':
      return 'apac';
    case 'OC':
      return 'oc';
    case 'SA':
      return 'sam';
    case 'AF':
      return 'afr';
  }
}

/** Accepts the socket just to tell the client why it can't play, using the game's own `error` message. */
function refuse(message: string): Response {
  const { 0: peer, 1: ws } = new WebSocketPair();
  ws.accept();
  ws.send(JSON.stringify({ t: 'error', message }));
  ws.close(1000, 'refused');
  return new Response(null, { status: 101, webSocket: peer });
}

export default {
  // Static files never reach this (see run_worker_first in wrangler.jsonc); only /ws and /api/* do.
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    const dir = env.DIRECTORY.getByName('all');

    if (url.pathname === '/api/lobbies') return Response.json(await dir.list());

    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
      const origin = req.headers.get('Origin');
      if (origin && new URL(origin).host !== url.host) return new Response('Bad origin', { status: 403 });

      const name = url.searchParams.get('name') ?? '';
      const mode = url.searchParams.get('mode') ?? '';
      const join = url.searchParams.get('code')?.toUpperCase();
      let room: DurableObjectStub<LobbyRoom>;
      let code: string;
      if (join) {
        if (!(await dir.has(join))) return refuse('No lobby with that code.');
        code = join;
        room = env.LOBBY.getByName(code);
      } else {
        code = await dir.allocate();
        room = env.LOBBY.getByName(code, { locationHint: regionHint(req.cf) });
      }
      const target = new URL(req.url);
      target.search = new URLSearchParams({ code, name, mode }).toString();
      return room.fetch(new Request(target, req));
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
