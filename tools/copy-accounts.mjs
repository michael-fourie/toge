#!/usr/bin/env node
// Copies every account from Gambol's site to this one, exactly: users and password hashes, sessions, garages, race
// money, cars, cosmetics, the battle pass, best times, boards, record ghosts, notices and friends. It reads the old
// site's Accounts object page by page (`/api/admin/export`), empties this site's Accounts object and writes each page
// as it is (`/api/admin/import`), then reads the new site back and checks that every key and value matches.
//
//   FROM=https://gambol.lol FROM_KEY=<atrous ADMIN_KEY> TO=https://<this site> TO_KEY=<this site's ADMIN_KEY> \
//     node tools/copy-accounts.mjs
//
// DRY_RUN=1 only reads the old site and counts. Run it again any time before launch: each run starts from empty, so
// the last run wins. Players' sign-ins carry over (same usernames and passwords); they sign in once on the new domain,
// since cookies belong to a domain. Guests' garages live in their browsers and can't be copied.

const { FROM, FROM_KEY, TO, TO_KEY, DRY_RUN } = process.env;
const dry = DRY_RUN === '1' || DRY_RUN === 'true';
if (!FROM || !FROM_KEY || (!dry && (!TO || !TO_KEY))) {
  console.error('Set FROM, FROM_KEY, TO and TO_KEY (see the top of tools/copy-accounts.mjs).');
  process.exit(2);
}

const base = (u) => u.replace(/\/+$/, '');

async function post(site, key, path, body) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${base(site)}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (res.status === 404) throw Object.assign(new Error(`${site}${path} is 404: ${await why404(site)}`), { fatal: true });
      if (res.status === 403) throw Object.assign(new Error(`${site}${path} said 403: wrong admin key.`), { fatal: true });
      if (!res.ok) throw new Error(`${site}${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
      const json = JSON.parse(text);
      if (!json.ok) throw new Error(`${site}${path}: ${json.error ?? text.slice(0, 200)}`);
      return json;
    } catch (e) {
      if (e.fatal || attempt >= 4) throw e;
      console.warn(`  retrying (${e.message})`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

/**
 * Why an admin route 404s. The password reset has been on both sites for a long time and answers 403 to a wrong key
 * once ADMIN_KEY is set, 404 while it isn't: so it tells "key missing" apart from "export not deployed".
 */
async function why404(site) {
  await probe(site);
  try {
    const res = await fetch(`${base(site)}/api/admin/reset-password`, { method: 'POST', headers: { Authorization: 'Bearer not-the-key', 'Content-Type': 'application/json' }, body: '{}' });
    if (res.status === 403) return "the site's ADMIN_KEY is set, but this build doesn't have the export route yet: deploy the latest master to production there.";
    if (res.status === 404) return "the Worker behind this site can't see an ADMIN_KEY. In Cloudflare: Workers & Pages > that Worker > Settings > Variables and Secrets (the runtime ones, not Build > Variables), add ADMIN_KEY as type Secret, 32+ characters, and Deploy. It takes effect at once.";
    return `couldn't tell why (the password reset answered ${res.status}).`;
  } catch (e) {
    return `couldn't tell why (${e.message}).`;
  }
}

/** Prints what a site answers on a few routes (status, final URL, server headers, body start), for debugging a 404. */
async function probe(site) {
  const show = async (label, url, init) => {
    try {
      const res = await fetch(url, init);
      const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 120);
      const h = ['server', 'cf-ray', 'content-type', 'x-frame-options'].map((k) => `${k}=${res.headers.get(k)}`).join(' ');
      console.log(`  probe ${label}: ${res.status}${res.redirected ? ` (redirected to ${res.url})` : ''} ${h} body="${body}"`);
    } catch (e) {
      console.log(`  probe ${label}: ${e.message}`);
    }
  };
  const wrong = { method: 'POST', headers: { Authorization: 'Bearer not-the-key', 'Content-Type': 'application/json' }, body: '{}' };
  console.log(`Probing ${base(site)}:`);
  await show('GET /api/races', `${base(site)}/api/races`);
  await show('GET /api/me', `${base(site)}/api/me`);
  await show('POST /api/admin/reset-password (wrong key)', `${base(site)}/api/admin/reset-password`, wrong);
  await show('POST /api/admin/export (wrong key)', `${base(site)}/api/admin/export`, wrong);
  await show('POST /api/admin/nonexistent', `${base(site)}/api/admin/nonexistent`, wrong);
}

/** Every [key, value] of a site's Accounts object, a page at a time. */
async function* pages(site, key) {
  let after = null;
  do {
    const page = await post(site, key, '/api/admin/export', { after });
    yield page.entries;
    after = page.next;
  } while (after);
}

/** What kind of record each key prefix is, for the summary. */
const KINDS = { u: 'accounts', s: 'sessions', g: 'garages', b: 'best times', lb: 'track boards', gh: 'record ghosts', nt: 'notices', f: 'friend lists', fi: 'friend-of lists', i: 'Gambol stashes', t: 'Gambol casino tables' };
const kindOf = (k) => KINDS[k.split(':')[0]] ?? 'other';

const source = new Map();
const counts = {};
let first = true;
let wrote = 0;
console.log(`Reading ${base(FROM)}${dry ? ' (dry run)' : ` and writing ${base(TO)}`}...`);
for await (const entries of pages(FROM, FROM_KEY)) {
  for (const [k, v] of entries) {
    source.set(k, JSON.stringify(v));
    counts[kindOf(k)] = (counts[kindOf(k)] ?? 0) + 1;
  }
  if (!dry) {
    // The first page also empties the new site, so the copy is exact even when run again.
    wrote += (await post(TO, TO_KEY, '/api/admin/import', { entries, wipe: first })).wrote;
    first = false;
  }
  process.stdout.write(`  ${source.size} keys\r`);
}
console.log(`Read ${source.size} keys:`, counts);
if (dry) process.exit(0);
if (first) await post(TO, TO_KEY, '/api/admin/import', { entries: [], wipe: true }); // the old site was empty
console.log(`Wrote ${wrote} keys. Checking the copy...`);

const copy = new Map();
for await (const entries of pages(TO, TO_KEY)) for (const [k, v] of entries) copy.set(k, JSON.stringify(v));
const missing = [...source.keys()].filter((k) => !copy.has(k));
const extra = [...copy.keys()].filter((k) => !source.has(k));
const changed = [...source.keys()].filter((k) => copy.has(k) && copy.get(k) !== source.get(k));
if (missing.length || extra.length || changed.length) {
  console.error('The copy does NOT match:', { missing: missing.slice(0, 20), extra: extra.slice(0, 20), changed: changed.slice(0, 20), counts: { missing: missing.length, extra: extra.length, changed: changed.length } });
  process.exit(1);
}
console.log(`Copy matches exactly: ${copy.size} keys, every value identical.`);
