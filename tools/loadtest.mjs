#!/usr/bin/env node
/**
 * Browsing load generator.
 *
 * Models ACTIVE USERS, not requests per second. A browsing visitor is mostly
 * idle: they load a page, read it for a while, then move on. Quoting a test as
 * "N concurrent connections" would say nothing about how many people the site
 * can hold, so the unit here is a user with a think time.
 *
 * One page view is NOT one request. Measured against surgemedia.us, a single
 * SPA page view fires ~21 API calls (settings, appearance, header, footer,
 * fonts, navigation, plugins, the page, its components, its entities…), so a
 * user arriving every `think` seconds generates ~21/think requests per second.
 * That multiplier is the whole story of this test, which is why the model
 * replays a real captured call list rather than hammering one URL.
 *
 * Usage:
 *   node loadtest.mjs --users 500 --duration 60 --think 12 \
 *        --host 216.158.233.15 --sni surgemedia.us
 *
 *   --users      concurrent simulated visitors
 *   --duration   seconds to hold that level
 *   --think      mean seconds a user spends reading a page (jittered ±50%)
 *   --ramp       seconds to bring users in over (default 10) — arriving all at
 *                once produces a thundering herd that measures the herd, not
 *                the steady state
 *   --host       IP to connect to (bypasses DNS/CDN so this measures the
 *                ORIGIN; a test through the CDN measures the CDN)
 *   --warm       fraction of views that are a returning visitor with warm
 *                caches (default 0.8) — a cold visitor also pulls the HTML
 *                shell, which is what a CDN would normally absorb
 */
import https from 'node:https';
import { performance, } from 'node:perf_hooks';

function args(argv,) {
    const o = {};
    for (let i = 0; i < argv.length; i++) {
        const m = /^--(.+)$/.exec(argv[i],);
        if (m) o[m[1]] = argv[i + 1];
    }
    return o;
}
const A = args(process.argv.slice(2,),);

const USERS = Number(A.users ?? 100);
const DURATION = Number(A.duration ?? 60) * 1000;
const THINK = Number(A.think ?? 12) * 1000;
const RAMP = Number(A.ramp ?? 10) * 1000;
const HOST = A.host ?? '216.158.233.15';
const SNI = A.sni ?? 'surgemedia.us';
const WARM = Number(A.warm ?? 0.8);

/**
 * The API calls one page view actually makes, captured from a real browser
 * session. Split by whether the SPA re-fetches them on an in-app navigation:
 * `BOOT` is fetched once when the shell loads, `VIEW` on every page.
 *
 * Keeping the distinction matters — treating every call as per-view would
 * overstate the load by roughly 3x and make the server look worse than it is.
 */
const BOOT = [
    '/api/v1/auth/me',
    '/api/v1/pages/navigation',
    '/api/v1/settings/public',
    '/api/v1/settings/site-header',
    '/api/v1/settings/appearance',
    '/api/v1/settings/site-footer',
    '/api/v1/settings/site-colors',
    '/api/v1/fonts',
    '/api/v1/plugins/enabled',
    '/api/v1/shop/settings',
];

/** Pages a browsing visitor moves between, with the calls each one triggers. */
const PAGES = [
    { html: '/', calls: [
        '/api/v1/pages/homepage',
        '/api/v1/components/templates/72d2a452-c497-4ad3-8d7f-47a28753f513',
        '/api/v1/components/templates/507f69e8-c5f3-419e-8b49-50484edb1686',
        '/api/v1/components/templates/8989a813-dc94-4893-9666-a5e49327142b',
        '/api/v1/social/posts/youtube?limit=50&sort=date&sortDir=desc&kind=short',
        '/api/v1/entities/post/templates/b3c1da62-fa28-4490-a171-9d5dcabad4f4',
        '/api/v1/entities/post?limit=20&filter=%7B%22status%22%3A%7B%22op%22%3A%22eq%22%2C%22value%22%3A%22published%22%7D%7D',
        '/api/v1/forms/slug/newsletter',
        '/api/v1/forms/slug/submit-a-tip',
        '/api/v1/lists/newsletter/subscription',
    ], weight: 40, },
    { html: '/posts', calls: ['/api/v1/posts?limit=12&sort=date&sortDir=desc',], weight: 25, },
    { html: '/posts/khameneis-demise', calls: ['/api/v1/posts/slug/khameneis-demise',], weight: 25, },
    { html: '/shop', calls: ['/api/v1/shop/products?limit=24', '/api/v1/shop/categories',], weight: 10, },
];
const TOTAL_WEIGHT = PAGES.reduce((s, p,) => s + p.weight, 0,);
function pickPage() {
    let r = Math.random() * TOTAL_WEIGHT;
    for (const p of PAGES) { r -= p.weight; if (r <= 0) return p; }
    return PAGES[0];
}

// One shared agent. Real browsers keep connections alive; opening a fresh
// socket per request would measure TLS handshakes rather than the application.
const agent = new https.Agent({
    keepAlive: true,
    // A page view fires ~10 calls at once, so socket demand is roughly
    // users x 10 — NOT users. Sizing this to USERS made the generator itself
    // the queue: a 500-user run showed p90 2.2s while the server sat at 83%
    // CPU with an idle database. The pool has to be bigger than peak demand or
    // the test measures the test.
    maxSockets: Number(A.sockets ?? Math.max(1024, USERS * 12,)),
    rejectUnauthorized: false, // origin presents a CDN origin cert
});

const stats = {
    ok: 0, err: 0, by: new Map(), latencies: [], pageViews: 0, bytes: 0,
    statuses: new Map(), errors: new Map(),
};

function get(path,) {
    return new Promise((resolve,) => {
        const started = performance.now();
        const req = https.request({
            host: HOST, servername: SNI, port: 443, path, method: 'GET', agent,
            headers: { host: SNI, 'accept-encoding': 'gzip', 'user-agent': 'surge-loadtest/1.0', },
            timeout: 30000,
        }, (res,) => {
            let n = 0;
            res.on('data', (c,) => { n += c.length; },);
            res.on('end', () => {
                const ms = performance.now() - started;
                stats.latencies.push(ms,);
                stats.bytes += n;
                stats.statuses.set(res.statusCode, (stats.statuses.get(res.statusCode,) ?? 0) + 1,);
                if (res.statusCode >= 200 && res.statusCode < 400) stats.ok++;
                else stats.err++;
                resolve();
            },);
        },);
        req.on('timeout', () => { req.destroy(new Error('timeout',),); },);
        req.on('error', (e,) => {
            stats.err++;
            const k = e.code || e.message;
            stats.errors.set(k, (stats.errors.get(k,) ?? 0) + 1,);
            resolve();
        },);
        req.end();
    },);
}

const sleep = (ms,) => new Promise((r,) => setTimeout(r, ms,));
let running = true;

async function user() {
    // A cold visitor loads the HTML shell + the boot calls; a warm one is
    // already in the SPA and only makes the per-view calls.
    let booted = Math.random() < WARM;
    while (running) {
        const page = pickPage();
        const batch = [];
        if (!booted) {
            batch.push(get(page.html,),);
            for (const c of BOOT) batch.push(get(c,),);
            booted = true;
        }
        for (const c of page.calls) batch.push(get(c,),);
        // A browser fires a page's calls concurrently, not one after another.
        await Promise.all(batch,);
        stats.pageViews++;
        if (!running) break;
        // Jitter, or every user marches in lockstep and the server sees a
        // spike every `think` seconds instead of a smooth arrival rate.
        await sleep(THINK * (0.5 + Math.random()),);
    }
}

function pct(sorted, p,) {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p),)];
}

const startedAt = Date.now();
console.log(JSON.stringify({ event: 'start', users: USERS, durationS: DURATION / 1000, thinkS: THINK / 1000, host: HOST, },),);

(async () => {
    const tasks = [];
    for (let i = 0; i < USERS; i++) {
        // Stagger arrivals across the ramp window.
        tasks.push((async () => { await sleep((RAMP / USERS) * i,); if (running) await user(); })(),);
    }
    await sleep(RAMP + DURATION,);
    running = false;
    await Promise.allSettled(tasks,);

    const elapsed = (Date.now() - startedAt) / 1000;
    const sorted = stats.latencies.slice().sort((a, b,) => a - b);
    const total = stats.ok + stats.err;
    console.log(JSON.stringify({
        event: 'result',
        users: USERS,
        elapsedS: Number(elapsed.toFixed(1),),
        requests: total,
        reqPerSec: Number((total / elapsed).toFixed(1),),
        pageViews: stats.pageViews,
        pageViewsPerSec: Number((stats.pageViews / elapsed).toFixed(1),),
        ok: stats.ok,
        errors: stats.err,
        errorPct: Number(((stats.err / Math.max(1, total,)) * 100).toFixed(2),),
        latencyMs: {
            p50: Math.round(pct(sorted, 0.5,),),
            p90: Math.round(pct(sorted, 0.9,),),
            p95: Math.round(pct(sorted, 0.95,),),
            p99: Math.round(pct(sorted, 0.99,),),
            max: Math.round(sorted.at(-1,) ?? 0,),
        },
        statuses: Object.fromEntries(stats.statuses,),
        transportErrors: Object.fromEntries(stats.errors,),
        mbTransferred: Number((stats.bytes / 1048576).toFixed(1),),
    },),);
    process.exit(0,);
})();
