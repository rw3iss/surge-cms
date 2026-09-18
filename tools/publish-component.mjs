#!/usr/bin/env node
/**
 * Push a Component from `docs/components/` to a running site.
 *
 * Components live in the database, so the files in `docs/components/` change
 * nothing on their own — they are the reviewable source of record. This is the
 * other half of that arrangement: the step that makes the files true.
 *
 *   node tools/publish-component.mjs \
 *     --site https://surgemedia.us \
 *     --name "Newsletter Signup Modal" \
 *     --html docs/components/newsletter-signup-modal.html \
 *     --js   docs/components/newsletter-signup-modal.js
 *
 * Credentials come from the environment, never the command line — an argument
 * is visible in `ps` and lands in shell history:
 *
 *   CMS_EMAIL=...  CMS_PASSWORD=...
 *
 * Idempotent: matches an existing component by exact name and updates it,
 * otherwise creates one. `--dry-run` prints what it would do and exits.
 *
 * Goes through the REST API rather than SQL on purpose. The API validates the
 * payload and enforces the `components:script` permission, which is separate
 * from "is an admin" precisely because a component script is arbitrary code in
 * every visitor's browser. A direct UPDATE would bypass both.
 */
import { readFileSync, } from 'node:fs';
import { basename, } from 'node:path';

function parseArgs(argv,) {
    const out = { dryRun: false, };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry-run') { out.dryRun = true; continue; }
        const m = /^--([a-zA-Z-]+)$/.exec(a,);
        if (!m) continue;
        out[m[1]] = argv[++i];
    }
    return out;
}

const args = parseArgs(process.argv.slice(2,),);
const site = (args.site || '').replace(/\/$/, '',);
const name = args.name;
const htmlPath = args.html;
const jsPath = args.js;

if (!site || !name || !htmlPath) {
    console.error('usage: publish-component.mjs --site URL --name NAME --html FILE [--js FILE] [--dry-run]',);
    process.exit(2,);
}

const email = process.env.CMS_EMAIL;
const password = process.env.CMS_PASSWORD;
// CMS_TOKEN is an already-issued admin access token, for when a password is not
// to hand. An `ssk_` API KEY will NOT work here: key auth attaches no role, and
// writing a component's script is gated on `components:script` — deliberately,
// since it is arbitrary code in every visitor's browser. It has to be a person.
const preIssued = process.env.CMS_TOKEN;

const html = readFileSync(htmlPath, 'utf8',);
const script = jsPath ? readFileSync(jsPath, 'utf8',) : undefined;

let token = null;

/**
 * Minimal cookie jar.
 *
 * Needed only for the login call. CSRF is a double-submit cookie: the server
 * sets `csrf-token` and the request has to echo the same value in the
 * `x-csrf-token` header. Every call AFTER login carries a Bearer token, which
 * skips CSRF entirely — but login itself is a public route with no bearer yet,
 * so it has to play along.
 */
const cookies = new Map();

function absorbCookies(res,) {
    // `getSetCookie` keeps multiple Set-Cookie headers separate; joining the
    // raw header and splitting on commas corrupts any cookie with a date in it.
    const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const line of raw) {
        const [pair,] = line.split(';',);
        const idx = pair.indexOf('=',);
        if (idx > 0) cookies.set(pair.slice(0, idx,).trim(), pair.slice(idx + 1,).trim(),);
    }
}

const cookieHeader = () => [...cookies,].map(([k, v,],) => `${k}=${v}`).join('; ',);

async function api(method, path, body,) {
    // A GET first, if we have no cookie yet, purely to be issued one.
    if (!cookies.has('csrf-token',) && !token) {
        const seed = await fetch(`${site}/api/v1/health`,);
        absorbCookies(seed,);
    }

    const res = await fetch(`${site}/api/v1${path}`, {
        method,
        headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}`, } : {}),
            ...(cookies.size ? { cookie: cookieHeader(), } : {}),
            ...(cookies.has('csrf-token',) ? { 'x-csrf-token': cookies.get('csrf-token',), } : {}),
        },
        ...(body ? { body: JSON.stringify(body,), } : {}),
    },);
    absorbCookies(res,);
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text,) : null; } catch { json = null; }
    if (!res.ok) {
        throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 400,)}`,);
    }
    // The API answers in an envelope on some routes and bare on others; callers
    // here only ever want the payload.
    return json && typeof json === 'object' && 'data' in json ? json.data : json;
}

const summary = {
    site, name,
    html: `${basename(htmlPath,)} (${html.length} bytes)`,
    js: script ? `${basename(jsPath,)} (${script.length} bytes)` : '(none)',
};

// Checked BEFORE credentials: a dry run makes no requests, so demanding a
// password to be told what would happen is just an obstacle.
if (args.dryRun) {
    console.log('DRY RUN — would publish:', summary,);
    process.exit(0,);
}

if (!preIssued && (!email || !password)) {
    console.error('Set CMS_EMAIL and CMS_PASSWORD, or CMS_TOKEN, in the environment.',);
    process.exit(2,);
}

if (preIssued) {
    token = preIssued;
    // `/auth/me` answers `{ user }` inside the envelope, so this is data.user —
    // not data itself, which is what the login route returns.
    const me = (await api('GET', '/auth/me',))?.user;
    if (!me) throw new Error('CMS_TOKEN did not authenticate.',);
    console.log(`Using supplied token: ${me.email} (${me.role})`,);
} else {
    const auth = await api('POST', '/auth/login', { email, password, },);
    token = auth?.accessToken || auth?.token;
    if (!token) throw new Error('Login succeeded but returned no access token.',);
    console.log(`Signed in as ${auth?.user?.email ?? email} (${auth?.user?.role ?? '?'})`,);
}

const existing = (await api('GET', '/components/templates',) ?? []).find(t => t.name === name,);

const payload = {
    name,
    ...(script !== undefined ? { script, scriptEnabled: true, } : {}),
};

let id;
if (existing) {
    id = existing.id;
    await api('PUT', `/components/templates/${id}`, payload,);
    console.log(`Updated component ${name} (${id})`,);
} else {
    const created = await api('POST', '/components/templates', payload,);
    id = created.id;
    console.log(`Created component ${name} (${id})`,);
}

// One html block carrying the markup. Reusing the existing block's id keeps the
// row stable across publishes — a fresh id each time would orphan anything that
// ever referenced it and churn the table for no reason.
const currentBlocks = await api('GET', `/components/templates/${id}/blocks`,) ?? [];
const blockId = currentBlocks[0]?.id;

await api('PUT', `/components/templates/${id}/blocks`, {
    blocks: [{
        ...(blockId ? { id: blockId, } : {}),
        blockType: 'html',
        position: 0,
        settings: { content: html, },
        style: {},
    },],
},);
console.log(`Wrote 1 html block (${html.length} bytes)${blockId ? ` reusing ${blockId}` : ''}`,);
console.log(`Done: ${site}/admin/components/${id}`,);
