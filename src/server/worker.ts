import type { Accounts } from './accounts.ts';
import type { Directory } from './directory.ts';
import type { LobbyRoom } from './room.ts';

export { Accounts } from './accounts.ts';
export { Directory } from './directory.ts';
export { LobbyRoom } from './room.ts';

export interface Env {
  LOBBY: DurableObjectNamespace<LobbyRoom>;
  DIRECTORY: DurableObjectNamespace<Directory>;
  ACCOUNTS: DurableObjectNamespace<Accounts>;
}

const COOKIE = 'gambol_session';
const SESSION_SECONDS = 30 * 24 * 3600;

function readCookie(req: Request): string | undefined {
  return req.headers.get('Cookie')?.split(/;\s*/).find((c) => c.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
}

function sessionCookie(token: string, url: URL, maxAge = SESSION_SECONDS): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`;
}

const sameOrigin = (req: Request, url: URL) => {
  const o = req.headers.get('Origin');
  return !o || new URL(o).host === url.host;
};

/** Sign-up / sign-in / sign-out / who-am-I. POSTs are same-origin JSON only (cookie is SameSite=Lax as well). */
async function accountApi(req: Request, url: URL, accounts: DurableObjectStub<Accounts>): Promise<Response> {
  const token = readCookie(req);
  if (url.pathname === '/api/me') return Response.json({ user: await accounts.me(token) });
  if (req.method !== 'POST' || !sameOrigin(req, url) || !req.headers.get('Content-Type')?.startsWith('application/json')) {
    return new Response('Bad request', { status: 400 });
  }
  if (url.pathname === '/api/logout') {
    await accounts.logout(token);
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie('', url, 0) } });
  }
  let body: { username?: unknown; password?: unknown };
  try {
    const text = await req.text();
    if (text.length > 1024) throw new Error('too big');
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 });
  }
  const username = String(body.username ?? '');
  const password = String(body.password ?? '');
  const result = url.pathname === '/api/register' ? await accounts.register(username, password) : await accounts.login(username, password);
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 401 });
  return Response.json({ ok: true, user: result.name }, { headers: { 'Set-Cookie': sessionCookie(result.token, url) } });
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
    if (['/api/me', '/api/register', '/api/login', '/api/logout'].includes(url.pathname)) return accountApi(req, url, env.ACCOUNTS.getByName('all'));

    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
      const origin = req.headers.get('Origin');
      if (origin && new URL(origin).host !== url.host) return new Response('Bad origin', { status: 403 });

      // Signed in: you play as your username. Guests keep their typed name unless it belongs to an account.
      const { name } = await env.ACCOUNTS.getByName('all').identify(readCookie(req), url.searchParams.get('name') ?? '');
      const mode = url.searchParams.get('mode') ?? '';
      const skin = (url.searchParams.get('skin') ?? '').slice(0, 24);
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
      target.search = new URLSearchParams({ code, name, mode, skin }).toString();
      return room.fetch(new Request(target, req));
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
