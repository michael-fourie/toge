import type { Accounts } from './accounts.ts';
import type { Directory } from './directory.ts';
import type { RaceRoom } from '../kanjo/server/raceroom.ts';
import type { GarageAction } from '../kanjo/shared/garage.ts';
import { CAR_CODE_MAX } from '../kanjo/shared/cars.ts';
import { RIDER_CODE_MAX } from '../kanjo/shared/rider.ts';
import type { FriendAction } from '../shared/friends.ts';
import type { ClubAction } from '../shared/clubs.ts';

export { Accounts } from './accounts.ts';
export { Directory } from './directory.ts';
export { RaceRoom } from '../kanjo/server/raceroom.ts';

export interface Env {
  RACE: DurableObjectNamespace<RaceRoom>;
  DIRECTORY: DurableObjectNamespace<Directory>;
  ACCOUNTS: DurableObjectNamespace<Accounts>;
  /** Secret (`wrangler secret put ADMIN_KEY`) for `/api/admin/reset-password` and `/api/admin/clear-race-records`. Unset or short: those routes don't exist. */
  ADMIN_KEY?: string;
}

const COOKIE = 'kanjo_session';
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

/** Shortest admin key we accept, so it can't be guessed (`openssl rand -hex 32` gives 64). */
const ADMIN_KEY_MIN = 32;

/** Compares two secrets without leaking where they differ (both hashed first, so lengths don't matter either). */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([a, b].map(async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))));
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

/**
 * Michael's password reset for a friend who forgot theirs: `POST /api/admin/reset-password` with
 * `Authorization: Bearer <ADMIN_KEY>` and `{"username": "..."}` returns a temporary password (docs/DEPLOYMENT.md).
 * Not same-origin only (it's meant for curl), so the key is the whole lock.
 */
async function adminReset(req: Request, env: Env): Promise<Response> {
  const key = env.ADMIN_KEY ?? '';
  if (key.length < ADMIN_KEY_MIN) return new Response('Not found', { status: 404 });
  const auth = req.headers.get('Authorization') ?? '';
  if (req.method !== 'POST' || !auth.startsWith('Bearer ') || !(await sameSecret(auth.slice(7), key))) return Response.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
  let body: { username?: unknown } | null = null;
  try {
    body = JSON.parse((await req.text()).slice(0, 256));
  } catch {
    /* falls through */
  }
  if (!body || typeof body !== 'object') return Response.json({ ok: false, error: 'Send {"username": "..."}.' }, { status: 400 });
  const result = await env.ACCOUNTS.getByName('all').resetPassword(body.username);
  return Response.json(result, { status: result.ok ? 200 : 404, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Michael's one-off KANJO cleanup: `POST /api/admin/clear-race-records` with `Authorization: Bearer <ADMIN_KEY>`.
 * With no body (or `{"apply": false}`) it only reports which best times, board rows and record ghosts would go; with
 * `{"apply": true}` it wipes them (Accounts.clearRaceRecords). Same lock as the password reset.
 */
async function adminClearRecords(req: Request, env: Env): Promise<Response> {
  const key = env.ADMIN_KEY ?? '';
  if (key.length < ADMIN_KEY_MIN) return new Response('Not found', { status: 404 });
  const auth = req.headers.get('Authorization') ?? '';
  if (req.method !== 'POST' || !auth.startsWith('Bearer ') || !(await sameSecret(auth.slice(7), key))) return Response.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
  let body: { apply?: unknown } | null = null;
  try {
    body = JSON.parse((await req.text()).slice(0, 256) || '{}');
  } catch {
    /* falls through */
  }
  if (!body || typeof body !== 'object') return Response.json({ ok: false, error: 'Send {"apply": true} to wipe, or nothing to preview.' }, { status: 400 });
  const report = await env.ACCOUNTS.getByName('all').clearRaceRecords(body.apply === true);
  return Response.json({ ok: true, ...report }, { headers: { 'Cache-Control': 'no-store' } });
}

/** The admin routes' lock: a Bearer token equal to ADMIN_KEY. Null when it opens, else the reply to send. */
async function adminLock(req: Request, env: Env): Promise<Response | null> {
  const key = env.ADMIN_KEY ?? '';
  if (key.length < ADMIN_KEY_MIN) return new Response('Not found', { status: 404 });
  const auth = req.headers.get('Authorization') ?? '';
  if (req.method !== 'POST' || !auth.startsWith('Bearer ') || !(await sameSecret(auth.slice(7), key))) return Response.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
  return null;
}

/**
 * Backup / copy check: `POST /api/admin/export` with `{"after": <key or null>}` returns one page of the Accounts
 * object's storage and the key to ask after next (null: last page). Read only. Gambol's site has the same route.
 */
async function adminExport(req: Request, env: Env): Promise<Response> {
  const locked = await adminLock(req, env);
  if (locked) return locked;
  let body: { after?: unknown; limit?: unknown } | null = null;
  try {
    body = JSON.parse((await req.text()).slice(0, 1024) || '{}');
  } catch {
    /* falls through */
  }
  if (!body || typeof body !== 'object') return Response.json({ ok: false, error: 'Send {"after": null} for the first page.' }, { status: 400 });
  const page = await env.ACCOUNTS.getByName('all').exportPage(typeof body.after === 'string' ? body.after : null, Number(body.limit) || 0);
  return new Response(page, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

/** Biggest import page we take (50 keys; a record ghost is the largest value, well under 1 MB). */
const IMPORT_MAX_BYTES = 24 * 1024 * 1024;

/**
 * The copy from Gambol's site (tools/copy-accounts.mjs): `POST /api/admin/import` with
 * `{"entries": [[key, value], ...], "wipe": bool}` writes one exported page as it is; `wipe` (the first page) empties
 * the accounts here first. Same lock as the other admin routes.
 */
async function adminImport(req: Request, env: Env): Promise<Response> {
  const locked = await adminLock(req, env);
  if (locked) return locked;
  let body: { entries?: unknown; wipe?: unknown } | null = null;
  try {
    const text = await req.text();
    if (text.length <= IMPORT_MAX_BYTES) body = JSON.parse(text);
  } catch {
    /* falls through */
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.entries)) return Response.json({ ok: false, error: 'Send {"entries": [[key, value], ...], "wipe": false}.' }, { status: 400 });
  const wrote = await env.ACCOUNTS.getByName('all').importPage(JSON.stringify(body.entries), body.wipe === true);
  if (wrote === null) return Response.json({ ok: false, error: 'entries must be [key, value] pairs.' }, { status: 400 });
  return Response.json({ ok: true, wrote }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Sign-up / sign-in / sign-out / who-am-I / change password. POSTs are same-origin JSON only (cookie is SameSite=Lax as well). */
async function accountApi(req: Request, url: URL, accounts: DurableObjectStub<Accounts>): Promise<Response> {
  const token = readCookie(req);
  if (url.pathname === '/api/me') return Response.json({ user: await accounts.me(token) });
  const body = await jsonBody<{ username?: unknown; password?: unknown; current?: unknown }>(req, url, 1024);
  if (!body || typeof body !== 'object') return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 });
  if (url.pathname === '/api/logout') {
    await accounts.logout(token);
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie('', url, 0) } });
  }
  if (url.pathname === '/api/password') {
    const changed = await accounts.changePassword(token, body.current, body.password, clientIp(req));
    if (!changed.ok) return Response.json({ ok: false, error: changed.error }, { status: 400 });
    return Response.json({ ok: true, user: changed.name }, { headers: { 'Set-Cookie': sessionCookie(changed.token, url) } });
  }
  const username = String(body.username ?? '');
  const password = String(body.password ?? '');
  const result = url.pathname === '/api/register' ? await accounts.register(username, password, clientIp(req)) : await accounts.login(username, password, clientIp(req));
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 401 });
  return Response.json({ ok: true, user: result.name }, { headers: { 'Set-Cookie': sessionCookie(result.token, url) } });
}

/**
 * The driving game's garage: GET reads yours and your best times (`?u=<name>`: a friend's profile instead), POST applies
 * one action (crate, buy, paint...). Signed-in only.
 */
async function garageApi(req: Request, url: URL, accounts: DurableObjectStub<Accounts>): Promise<Response> {
  const token = readCookie(req);
  if (req.method === 'GET') {
    const u = url.searchParams.get('u');
    if (u !== null) return Response.json({ profile: await accounts.profile(token, u.slice(0, 16)) });
    const own = await accounts.garage(token);
    return Response.json({ garage: own?.garage ?? null, bests: own?.bests ?? null });
  }
  const action = await jsonBody<GarageAction>(req, url, 160 * 1024);
  if (!action) return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 });
  return Response.json(await accounts.garageAct(token, action));
}

/** KANJO notices ("your time was beaten"): GET lists yours (null for guests), POST `{seen: <at>}` clears up to that one. */
async function noticesApi(req: Request, url: URL, accounts: DurableObjectStub<Accounts>): Promise<Response> {
  const token = readCookie(req);
  if (req.method === 'GET') return Response.json({ notices: await accounts.notices(token) });
  const body = await jsonBody<{ seen?: unknown }>(req, url, 128);
  if (!body || typeof body !== 'object' || typeof body.seen !== 'number') return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 });
  return Response.json({ ok: await accounts.seenNotices(token, body.seen) });
}

/** Friends (site-wide): GET lists yours and who added you, POST `{a: 'add' | 'remove', name}`. Signed-in only. */
async function friendsApi(req: Request, url: URL, accounts: DurableObjectStub<Accounts>): Promise<Response> {
  const token = readCookie(req);
  if (req.method === 'GET') return Response.json({ friends: await accounts.friends(token) });
  const action = await jsonBody<FriendAction>(req, url, 256);
  if (!action || typeof action !== 'object') return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 });
  return Response.json(await accounts.friendAct(token, action));
}

/** Clubs (site-wide): GET lists the ones you're in, POST a `ClubAction`. Signed-in only. */
async function clubsApi(req: Request, url: URL, accounts: DurableObjectStub<Accounts>): Promise<Response> {
  const token = readCookie(req);
  if (req.method === 'GET') return Response.json({ clubs: await accounts.clubs(token) });
  const action = await jsonBody<ClubAction>(req, url, 256);
  if (!action || typeof action !== 'object') return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 });
  return Response.json(await accounts.clubAct(token, action));
}

/** Joins or hosts a race lobby: a fresh 4-letter code from the 'race' directory, or the room behind a code. */
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
  // An account's car only shows the cosmetics it owns (guests' are only checked to exist, by the room).
  let car = (url.searchParams.get('car') ?? '').slice(0, CAR_CODE_MAX);
  if (user) car = await env.ACCOUNTS.getByName('all').raceCar(name, car);
  const target = new URL(req.url);
  const rider = (url.searchParams.get('rider') ?? '').slice(0, RIDER_CODE_MAX);
  // A solo time trial (`solo=1`) is a fresh private room: never passed on to someone joining a code.
  const solo = !join && url.searchParams.get('solo') === '1';
  target.search = new URLSearchParams({ code, name, user: user ? '1' : '', car, rider, ...(solo ? { solo: '1' } : {}) }).toString();
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
    if (url.pathname === '/api/races') return Response.json(await env.DIRECTORY.getByName('race').listRaces());
    if (url.pathname === '/api/garage') return garageApi(req, url, env.ACCOUNTS.getByName('all'));
    if (url.pathname === '/api/friends') return friendsApi(req, url, env.ACCOUNTS.getByName('all'));
    if (url.pathname === '/api/clubs') return clubsApi(req, url, env.ACCOUNTS.getByName('all'));
    if (url.pathname === '/api/notices') return noticesApi(req, url, env.ACCOUNTS.getByName('all'));
    // A track record's run, to watch it again from the leaderboard (public, like the board it's on; read only).
    if (url.pathname === '/api/ghost' && req.method === 'GET')
      return Response.json({ run: await env.ACCOUNTS.getByName('all').recordGhost(url.searchParams.get('t')?.slice(0, 32) ?? '') }, { headers: { 'Cache-Control': 'public, max-age=60' } });
    if (url.pathname === '/api/leaderboard') return Response.json(await env.ACCOUNTS.getByName('all').leaderboard(url.searchParams.get('t')?.slice(0, 32) ?? null));
    if (url.pathname === '/api/admin/reset-password') return adminReset(req, env);
    if (url.pathname === '/api/admin/clear-race-records') return adminClearRecords(req, env);
    if (url.pathname === '/api/admin/export') return adminExport(req, env);
    if (url.pathname === '/api/admin/import') return adminImport(req, env);
    if (['/api/me', '/api/register', '/api/login', '/api/logout', '/api/password'].includes(url.pathname)) return accountApi(req, url, env.ACCOUNTS.getByName('all'));

    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
      if (!sameOrigin(req, url)) return new Response('Bad origin', { status: 403 });

      // Signed in: you play as your username. Guests keep their typed name unless it belongs to an account.
      const { name, user } = await env.ACCOUNTS.getByName('all').identify(readCookie(req), url.searchParams.get('name') ?? '');
      return raceSocket(req, url, env, name, user);
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
