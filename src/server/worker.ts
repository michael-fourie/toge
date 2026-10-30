import type { Accounts } from './accounts.ts';
import type { Directory } from './directory.ts';
import type { RaceRoom } from './raceroom.ts';
import type { PartyRoom } from './partyroom.ts';
import { isGameId } from '../shared/party.ts';
import type { LobbyRoom } from './room.ts';
import type { GarageAction } from '../shared/race/garage.ts';
import type { StashAction } from '../shared/stash.ts';

export { Accounts } from './accounts.ts';
export { Directory } from './directory.ts';
export { RaceRoom } from './raceroom.ts';
export { PartyRoom } from './partyroom.ts';
export { LobbyRoom } from './room.ts';

export interface Env {
  LOBBY: DurableObjectNamespace<LobbyRoom>;
  RACE: DurableObjectNamespace<RaceRoom>;
  PARTY: DurableObjectNamespace<PartyRoom>;
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
  if (!o) return true;
  try {
    return new URL(o).host === url.host;
  } catch {
    return false; // "null" (a sandboxed frame, a file) or garbage
  }
};

/** Who's asking, for per-address rate limits (Cloudflare sets this header; locally there is none). */
const clientIp = (req: Request) => req.headers.get('CF-Connecting-IP') ?? '';

/** A same-origin JSON POST's body, parsed, or null if it isn't one (or is bigger than `max` bytes). */
async function jsonBody<T>(req: Request, url: URL, max: number): Promise<T | null> {
  if (req.method !== 'POST' || !sameOrigin(req, url) || !req.headers.get('Content-Type')?.startsWith('application/json')) return null;
  try {
    const text = await req.text();
    if (text.length > max) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Sign-up / sign-in / sign-out / who-am-I. POSTs are same-origin JSON only (cookie is SameSite=Lax as well). */
async function accountApi(req: Request, url: URL, accounts: DurableObjectStub<Accounts>): Promise<Response> {
  const token = readCookie(req);
  if (url.pathname === '/api/me') return Response.json({ user: await accounts.me(token) });
  const body = await jsonBody<{ username?: unknown; password?: unknown }>(req, url, 1024);
  if (!body || typeof body !== 'object') return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 });
  if (url.pathname === '/api/logout') {
    await accounts.logout(token);
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie('', url, 0) } });
  }
  const username = String(body.username ?? '');
  const password = String(body.password ?? '');
  const result = url.pathname === '/api/register' ? await accounts.register(username, password, clientIp(req)) : await accounts.login(username, password, clientIp(req));
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 401 });
  return Response.json({ ok: true, user: result.name }, { headers: { 'Set-Cookie': sessionCookie(result.token, url) } });
}

/** The driving game's garage: GET reads it, POST applies one action (crate, buy, paint...). Signed-in only. */
async function garageApi(req: Request, url: URL, accounts: DurableObjectStub<Accounts>): Promise<Response> {
  const token = readCookie(req);
  if (req.method === 'GET') return Response.json({ garage: await accounts.garage(token) });
  const action = await jsonBody<GarageAction>(req, url, 2048);
  if (!action) return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 });
  return Response.json(await accounts.garageAct(token, action));
}

/**
 * The shooter's stash (coins, items, XP) and the Casino: GET reads it, POST applies one action (open a case, sell,
 * equip, a bet...) with the server's dice, or `{adopt}` brings a browser's old stash over once. Signed-in only.
 */
async function stashApi(req: Request, url: URL, accounts: DurableObjectStub<Accounts>): Promise<Response> {
  const token = readCookie(req);
  if (req.method === 'GET') return Response.json({ stash: await accounts.stash(token) });
  const body = await jsonBody<StashAction | { adopt: unknown }>(req, url, 64 * 1024);
  if (!body || typeof body !== 'object') return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 });
  if ('adopt' in body) return Response.json({ stash: await accounts.stash(token, body.adopt ?? null) });
  if (JSON.stringify(body).length > 512) return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 });
  return Response.json(await accounts.stashAct(token, body));
}

/** Joins or hosts a race lobby (the driving game): same code scheme as the shooter, its own directory. */
async function raceSocket(req: Request<unknown, IncomingRequestCfProperties>, url: URL, env: Env, name: string, user: boolean): Promise<Response> {
  const dir = env.DIRECTORY.getByName('race');
  const join = url.searchParams.get('code')?.toUpperCase();
  let code: string;
  let room: DurableObjectStub<RaceRoom>;
  if (join) {
    if (!(await dir.has(join))) return refuse('No race with that code.');
    code = join;
    room = env.RACE.getByName(code);
  } else {
    const fresh = await dir.allocate(clientIp(req));
    if (!fresh) return refuse('Too many new rooms from here. Wait a minute and try again.');
    code = fresh;
    room = env.RACE.getByName(code, { locationHint: regionHint(req.cf) });
  }
  const target = new URL(req.url);
  target.search = new URLSearchParams({ code, name, user: user ? '1' : '', car: (url.searchParams.get('car') ?? '').slice(0, 64) }).toString();
  return room.fetch(new Request(target, req));
}

/** A room of a plug-in game (src/games/<kind>): each game has its own directory of codes. */
async function partySocket(req: Request<unknown, IncomingRequestCfProperties>, url: URL, env: Env, name: string, user: boolean): Promise<Response> {
  const kind = url.searchParams.get('kind');
  if (!isGameId(kind)) return refuse('Unknown game.');
  const dir = env.DIRECTORY.getByName(`party:${kind}`);
  const join = url.searchParams.get('code')?.toUpperCase();
  let code: string;
  let room: DurableObjectStub<PartyRoom>;
  if (join) {
    if (!(await dir.has(join))) return refuse('No room with that code.');
    code = join;
    room = env.PARTY.getByName(`${kind}:${code}`);
  } else {
    const fresh = await dir.allocate(clientIp(req));
    if (!fresh) return refuse('Too many new rooms from here. Wait a minute and try again.');
    code = fresh;
    room = env.PARTY.getByName(`${kind}:${code}`, { locationHint: regionHint(req.cf) });
  }
  const target = new URL(req.url);
  target.search = new URLSearchParams({ code, kind, name, user: user ? '1' : '' }).toString();
  return room.fetch(new Request(target, req));
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
    if (url.pathname === '/api/races') return Response.json(await env.DIRECTORY.getByName('race').listRaces());
    if (url.pathname === '/api/garage') return garageApi(req, url, env.ACCOUNTS.getByName('all'));
    if (url.pathname === '/api/stash') return stashApi(req, url, env.ACCOUNTS.getByName('all'));
    if (url.pathname === '/api/parties') {
      const game = url.searchParams.get('game');
      return isGameId(game) ? Response.json(await env.DIRECTORY.getByName(`party:${game}`).listParties()) : Response.json([]);
    }
    if (['/api/me', '/api/register', '/api/login', '/api/logout'].includes(url.pathname)) return accountApi(req, url, env.ACCOUNTS.getByName('all'));

    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
      if (!sameOrigin(req, url)) return new Response('Bad origin', { status: 403 });

      // Signed in: you play as your username. Guests keep their typed name unless it belongs to an account.
      const { name, user } = await env.ACCOUNTS.getByName('all').identify(readCookie(req), url.searchParams.get('name') ?? '');
      if (url.searchParams.get('game') === 'race') return raceSocket(req, url, env, name, user);
      if (url.searchParams.get('game') === 'party') return partySocket(req, url, env, name, user);
      const mode = url.searchParams.get('mode') ?? '';
      const teams = url.searchParams.get('teams') === '1' ? '1' : '';
      const map = url.searchParams.get('map') ?? '';
      const koth = url.searchParams.get('koth') === '1' ? '1' : '';
      const br = url.searchParams.get('br') === '1' ? '1' : '';
      const skin = (url.searchParams.get('skin') ?? '').slice(0, 24);
      const gear = (url.searchParams.get('gear') ?? '').slice(0, 120);
      const join = url.searchParams.get('code')?.toUpperCase();
      let room: DurableObjectStub<LobbyRoom>;
      let code: string;
      if (join) {
        if (!(await dir.has(join))) return refuse('No lobby with that code.');
        code = join;
        room = env.LOBBY.getByName(code);
      } else {
        const fresh = await dir.allocate(clientIp(req));
    if (!fresh) return refuse('Too many new rooms from here. Wait a minute and try again.');
    code = fresh;
        room = env.LOBBY.getByName(code, { locationHint: regionHint(req.cf) });
      }
      const target = new URL(req.url);
      target.search = new URLSearchParams({ code, name, user: user ? '1' : '', mode, teams, map, koth, br, skin, gear }).toString();
      return room.fetch(new Request(target, req));
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
