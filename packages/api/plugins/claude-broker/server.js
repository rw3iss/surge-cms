'use strict';
/**
 * claude-broker plugin — server actions. The CMS AI module (services/ai/)
 * calls these through the plugin action dispatcher; the admin config page
 * calls them via POST /api/v1/plugins/claude-broker/action/:action.
 *
 * Every action returns `{ ok: true, … }` or `{ ok: false, status, error }` —
 * never a raw throw — so a stopped daemon or a bad token reads as a clear
 * message, not a 500.
 *
 * Broker HTTP API (claude-broker daemon): POST /jobs, GET /jobs, GET /jobs/:id,
 * GET /jobs/:id/wait?timeout=, DELETE /jobs/:id, POST /jobs/:id/comment,
 * GET /sessions, GET /healthz — Bearer token.
 */
const lib = require('./lib.js');

const DEFAULT_URL = 'http://127.0.0.1:4180';
const MAX_POLL_SEC = 60;

/** session_id → when its last job settled (ms). Spaces jobs to one session (see lib/README). */
const lastSettled = new Map();

function cfg(ctx) {
    const c = ctx.config || {};
    const num = (v, d, min, max) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= min ? Math.min(n, max) : d;
    };
    return {
        url: String(c.brokerUrl || DEFAULT_URL).trim().replace(/\/+$/, ''),
        token: String(c.token || '').trim(),
        pools: lib.normalizePools(c.pools),
        defaultPool: String(c.defaultPool || '').trim(),
        ttlSec: num(c.ttlSec, 300, 10, 86400),
        waitSec: num(c.waitSec, 120, 1, 3600),
        frame: c.framePrompts !== false,
        gapMs: num(c.sessionGapMs, 6000, 0, 60000),
    };
}

function fail(status, error) {
    return { ok: false, status: status || 0, error };
}

/** One broker call. Returns the httpJson envelope with a readable `error`. */
async function broker(ctx, method, path, body) {
    const c = cfg(ctx);
    if (!c.token) return fail(0, 'The broker token is not configured');
    const r = await ctx.httpJson(`${c.url}${path}`, {
        method,
        headers: { Authorization: `Bearer ${c.token}` },
        jsonBody: body,
    });
    if (!r.ok) return { ok: false, status: r.status, error: lib.brokerError(r) };
    return r;
}

async function health(ctx) {
    const c = cfg(ctx);
    const r = await ctx.httpJson(`${c.url}/healthz`);
    if (!r.ok) return fail(r.status, `Broker not reachable at ${c.url}: ${lib.brokerError(r)}`);
    return { ok: true, health: r.data || {} };
}

async function listSessions(ctx) {
    const r = await broker(ctx, 'GET', '/sessions');
    if (!r.ok) return r;
    return { ok: true, sessions: (r.data && r.data.items) || [] };
}

async function listActiveJobs(ctx) {
    const r = await broker(ctx, 'GET', `/jobs?status=${lib.ACTIVE.join(',')}&limit=500`);
    if (!r.ok) return r;
    return { ok: true, jobs: (r.data && r.data.items) || [] };
}

function poolOf(pools, label) {
    const p = pools.find((x) => lib.inPool(label, x.name));
    return p ? p.name : null;
}

/** Broker `meta` takes string values under [A-Za-z0-9_] keys only. */
function cleanMeta(meta, extra) {
    const out = {};
    const add = (k, v) => {
        const key = String(k).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
        if (!key || v === undefined || v === null) return;
        out[key] = (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 500);
    };
    for (const [k, v] of Object.entries(meta && typeof meta === 'object' ? meta : {})) add(k, v);
    for (const [k, v] of Object.entries(extra)) add(k, v);
    return out;
}

async function sleep(ms) {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

/** Long-poll a job until it settles or `timeoutSec` runs out. */
async function waitJob(ctx, id, timeoutSec, pool) {
    const deadline = Date.now() + timeoutSec * 1000;
    let last = null;
    for (;;) {
        const left = Math.ceil((deadline - Date.now()) / 1000);
        if (left <= 0) break;
        const r = await broker(ctx, 'GET', `/jobs/${encodeURIComponent(id)}/wait?timeout=${Math.min(left, MAX_POLL_SEC)}`);
        if (!r.ok) return r;
        last = lib.normalizeJob(r.data, { pool });
        if (lib.TERMINAL.has(last.status)) {
            if (last.sessionId) lastSettled.set(last.sessionId, Date.now());
            return { ok: true, job: last };
        }
    }
    if (!last) {
        const r = await broker(ctx, 'GET', `/jobs/${encodeURIComponent(id)}`);
        if (!r.ok) return r;
        last = lib.normalizeJob(r.data, { pool });
    }
    return { ok: true, job: { ...last, timedOut: !lib.TERMINAL.has(last.status) } };
}

/** Choose the session: an explicit id, else the least-busy member of the pool. */
async function resolveTarget(ctx, payload) {
    const c = cfg(ctx);
    if (payload.session) {
        const s = await listSessions(ctx);
        if (!s.ok) return s;
        const want = String(payload.session);
        const hit = s.sessions.find((x) => x.status === 'attached' && (x.id === want || x.label === want));
        if (!hit) return fail(404, `No attached session "${want}"`);
        return { ok: true, session: hit, pool: poolOf(c.pools, hit.label) };
    }
    const pool = String(payload.pool || c.defaultPool || (c.pools[0] && c.pools[0].name) || '').trim();
    if (!pool) return fail(400, 'No pool given and no default pool is configured');
    const [s, j] = await Promise.all([listSessions(ctx), listActiveJobs(ctx)]);
    if (!s.ok) return s;
    const session = lib.pickSession(pool, s.sessions, j.ok ? j.jobs : [], lastSettled);
    if (!session) return fail(503, `No session is attached in pool "${pool}"`);
    return { ok: true, session, pool };
}

async function submit(ctx, payload) {
    const c = cfg(ctx);
    const prompt = String(payload.prompt || '').trim();
    if (!prompt) return fail(400, 'A prompt is required');
    const target = await resolveTarget(ctx, payload);
    if (!target.ok) return target;
    const { session, pool } = target;
    const wait = payload.wait === true;
    const timeoutSec = Math.max(1, Math.min(Number(payload.timeoutSec) || c.waitSec, 3600));
    const content = lib.framePrompt({
        prompt,
        system: payload.system,
        kind: payload.kind || 'CMS',
        subject: payload.subject,
        format: payload.format,
        frame: payload.frame === undefined ? c.frame : payload.frame !== false,
    });
    const body = {
        session_id: session.id,
        content,
        meta: cleanMeta(payload.meta, { source: 'cms', pool: pool || undefined, format: payload.format || undefined }),
        ttl_sec: Math.max(10, Math.min(Number(payload.ttlSec) || c.ttlSec, 86400)),
        priority: ['high', 'normal', 'low'].includes(payload.priority) ? payload.priority : 'normal',
        ...(payload.clientRef ? { client_ref: String(payload.clientRef).slice(0, 255) } : {}),
    };

    // One retry when a session answers with a repetition loop (waiting only).
    const attempts = wait ? 2 : 1;
    let out = null;
    for (let i = 0; i < attempts; i++) {
        // A job sent while the session's previous turn is still open arrives inside a
        // tool result and is refused — leave a short gap after its last job settled.
        await sleep((lastSettled.get(session.id) || 0) + c.gapMs - Date.now());
        const r = await broker(ctx, 'POST', '/jobs', body);
        if (!r.ok) return r;
        const job = lib.normalizeJob(r.data && r.data.job ? r.data.job : { id: r.data && r.data.job_id, status: r.data && r.data.status }, { pool });
        job.pool = pool;
        if (!wait) {
            lastSettled.set(session.id, Date.now());
            return { ok: true, job: { ...job, sessionLabel: session.label } };
        }
        out = await waitJob(ctx, job.id, timeoutSec, pool);
        if (!out.ok || !out.job.degenerate) break;
        ctx.logger.warn(`degenerate output from ${session.label} (attempt ${i + 1}/${attempts})`);
    }
    return out.ok ? { ok: true, job: { ...out.job, pool, sessionLabel: session.label } } : out;
}

module.exports = {
    async install(ctx) { ctx.logger.info('claude-broker plugin installed.'); },
    async onEnable(ctx) { ctx.logger.info('claude-broker enabled.'); },
    async onDisable(ctx) { ctx.logger.info('claude-broker disabled.'); },
    async update(ctx) {
        return { fromVersion: ctx.installedVersion || ctx.version, toVersion: ctx.version, migrated: false, notes: 'No migration for this version.' };
    },

    validateConfig(config) {
        const errors = {};
        if (config.brokerUrl !== undefined && config.brokerUrl !== '' && !/^https?:\/\/[^\s]+$/i.test(String(config.brokerUrl))) {
            errors.brokerUrl = 'Must be an http(s) URL';
        }
        if (config.pools !== undefined && !Array.isArray(config.pools)) errors.pools = 'Pools must be a list';
        if (Array.isArray(config.pools)) {
            const bad = config.pools.find((p) => p && p.name && !/^[A-Za-z0-9_.-]{1,64}$/.test(String(p.name)));
            if (bad) errors.pools = `Pool name "${bad.name}": letters, digits, - _ . only`;
        }
        return { ok: Object.keys(errors).length === 0, errors };
    },

    actions: {
        /** Reachable + token accepted? */
        async testConnection(ctx) {
            const h = await health(ctx);
            if (!h.ok) return h;
            const s = await listSessions(ctx);
            if (!s.ok) return s;
            return {
                ok: true,
                version: h.health.version || null,
                sessionCount: s.sessions.filter((x) => x.status === 'attached').length,
            };
        },

        /** Broker health + every pool's attached/expected/busy counts. */
        async status(ctx) {
            const c = cfg(ctx);
            const h = await health(ctx);
            if (!h.ok) return { ...h, pools: c.pools, defaultPool: c.defaultPool };
            const [s, j] = await Promise.all([listSessions(ctx), listActiveJobs(ctx)]);
            if (!s.ok) return { ...s, pools: c.pools, defaultPool: c.defaultPool };
            const attached = s.sessions.filter((x) => x.status === 'attached');
            return {
                ok: true,
                broker: { version: h.health.version || null, uptimeSec: h.health.uptimeSec ?? null, sessionCount: attached.length },
                defaultPool: c.defaultPool || (c.pools[0] && c.pools[0].name) || null,
                pools: lib.poolStatus(c.pools, s.sessions, j.ok ? j.jobs : []),
                unpooled: attached.filter((x) => !poolOf(c.pools, x.label)).map((x) => ({ id: x.id, label: x.label })),
            };
        },

        async pools(ctx) {
            const c = cfg(ctx);
            return { ok: true, pools: c.pools, defaultPool: c.defaultPool || (c.pools[0] && c.pools[0].name) || null };
        },

        /** Sessions (attached by default), optionally one pool's. */
        async sessions(ctx, payload) {
            const c = cfg(ctx);
            const [s, j] = await Promise.all([listSessions(ctx), listActiveJobs(ctx)]);
            if (!s.ok) return s;
            const busy = lib.busyCounts(j.ok ? j.jobs : []);
            const pool = payload.pool ? String(payload.pool) : '';
            const all = payload.all === true;
            return {
                ok: true,
                sessions: s.sessions
                    .filter((x) => (all || x.status === 'attached') && (!pool || lib.inPool(x.label, pool)))
                    .map((x) => ({
                        id: x.id,
                        label: x.label,
                        status: x.status,
                        pool: poolOf(c.pools, x.label),
                        busy: busy.get(x.id) || 0,
                        pid: x.pid ?? null,
                        registeredAt: x.registered_at || null,
                        lastHeartbeatAt: x.last_heartbeat_at || null,
                    })),
            };
        },

        /** Send a prompt to a pool (least-busy member) or one session; `wait` long-polls the answer. */
        submit,

        async job(ctx, payload) {
            if (!payload.id) return fail(400, 'Job id required');
            const r = await broker(ctx, 'GET', `/jobs/${encodeURIComponent(String(payload.id))}`);
            if (!r.ok) return r;
            const job = lib.normalizeJob(r.data);
            if (job.sessionId && lib.TERMINAL.has(job.status) && !lastSettled.has(job.sessionId)) lastSettled.set(job.sessionId, Date.now());
            return { ok: true, job };
        },

        async wait(ctx, payload) {
            if (!payload.id) return fail(400, 'Job id required');
            const t = Math.max(1, Math.min(Number(payload.timeoutSec) || cfg(ctx).waitSec, 3600));
            return waitJob(ctx, String(payload.id), t, null);
        },

        async cancel(ctx, payload) {
            if (!payload.id) return fail(400, 'Job id required');
            const r = await broker(ctx, 'DELETE', `/jobs/${encodeURIComponent(String(payload.id))}`);
            return r.ok ? { ok: true, job: lib.normalizeJob(r.data) } : r;
        },

        async comment(ctx, payload) {
            if (!payload.id || !String(payload.note || '').trim()) return fail(400, 'Job id and note required');
            const r = await broker(ctx, 'POST', `/jobs/${encodeURIComponent(String(payload.id))}/comment`, { note: String(payload.note).trim() });
            return r.ok ? { ok: true, job: lib.normalizeJob(r.data) } : r;
        },

        /** Recent jobs — CMS jobs only unless `all`; filter by status / session / pool. */
        async jobs(ctx, payload) {
            const qs = new URLSearchParams();
            if (payload.status) qs.set('status', String(payload.status));
            if (payload.sessionId) qs.set('session_id', String(payload.sessionId));
            qs.set('limit', String(Math.max(1, Math.min(Number(payload.limit) || 50, 500))));
            const r = await broker(ctx, 'GET', `/jobs?${qs}`);
            if (!r.ok) return r;
            const pool = payload.pool ? String(payload.pool) : '';
            const jobs = ((r.data && r.data.items) || [])
                .map((j) => lib.normalizeJob(j))
                .filter((j) => (payload.all === true || j.meta.source === 'cms') && (!pool || j.pool === pool));
            return { ok: true, jobs, total: (r.data && r.data.total) ?? jobs.length };
        },
    },
};
