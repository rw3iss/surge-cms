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

/**
 * The broker's own token when the config has none: same-server installs share
 * it through CLAUDE_BROKER_TOKEN or the setup script's env file
 * (~/.config/claude-broker/claude-broker.env, readable by the CMS user). So a
 * missing or blanked token field still works on the box the script set up.
 * Read per call (cheap) so a rotated token is picked up without a restart.
 */
function localBrokerToken() {
    if (process.env.CLAUDE_BROKER_TOKEN) return String(process.env.CLAUDE_BROKER_TOKEN).trim();
    try {
        const file = require('node:path').join(require('node:os').homedir(), '.config', 'claude-broker', 'claude-broker.env');
        const m = /^CLAUDE_BROKER_TOKEN=(.+)$/m.exec(require('node:fs').readFileSync(file, 'utf8'));
        return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
    } catch {
        return '';
    }
}

function cfg(ctx) {
    const c = ctx.config || {};
    const num = (v, d, min, max) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= min ? Math.min(n, max) : d;
    };
    return {
        url: String(c.brokerUrl || DEFAULT_URL).trim().replace(/\/+$/, ''),
        token: String(c.token || '').trim() || localBrokerToken(),
        pools: lib.normalizePools(c.pools),
        defaultPool: String(c.defaultPool || '').trim(),
        ttlSec: num(c.ttlSec, 300, 10, 86400),
        waitSec: num(c.waitSec, 120, 1, 3600),
        frame: c.framePrompts !== false,
        gapMs: num(c.sessionGapMs, 6000, 0, 60000),
        model: String(c.model || '').trim(),
        effort: String(c.effort || '').trim(),
    };
}

function fail(status, error) {
    return { ok: false, status: status || 0, error };
}

/** One broker call. Returns the httpJson envelope with a readable `error`. */
async function broker(ctx, method, path, body) {
    const c = cfg(ctx);
    if (!c.token) return fail(0, 'The broker token is not configured — paste it under Broker connection, or run the setup script on this server (the token is then read from ~/.config/claude-broker/claude-broker.env).');
    const r = await ctx.httpJson(`${c.url}${path}`, {
        method,
        headers: { Authorization: `Bearer ${c.token}` },
        jsonBody: body,
    });
    if (!r.ok) return { ok: false, status: r.status, error: lib.brokerError(r), details: r.details };
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
    // Broker ≥ 0.6 reports each session's TUI state; skip ones that cannot work (usage limit, signed out…).
    const session = lib.pickSession(pool, s.sessions.filter(lib.isHealthy), j.ok ? j.jobs : [], lastSettled);
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

        // ── Setup: delegated to the broker (claude-broker ≥ 0.6 owns sign-in + sessions) ──

        /**
         * One checklist for the config page: broker reachable + its version and
         * capabilities, Claude Code installed, the workers' sign-in token, the
         * fleet's sessions per pool. An older broker (no `fleet`/`auth`
         * capability) still reports reachability and attached sessions.
         */
        async setupStatus(ctx) {
            const c = cfg(ctx);
            const h = await health(ctx);
            const base = { ok: true, broker: { url: c.url, reachable: false, version: null, capabilities: [], error: null } };
            if (!h.ok) return { ...base, broker: { ...base.broker, error: h.error } };
            const caps = Array.isArray(h.health.capabilities) ? h.health.capabilities : [];
            const brokerInfo = { url: c.url, reachable: true, version: h.health.version || null, capabilities: caps, error: null };
            const s = await listSessions(ctx);
            if (!s.ok) return { ...base, broker: { ...brokerInfo, reachable: false, error: s.error } };
            const attached = s.sessions.filter((x) => x.status === 'attached');
            const out = { ok: true, broker: brokerInfo, managed: lib.supportsFleet(caps), attached: attached.map(lib.sessionView) };
            if (!out.managed) {
                out.pools = lib.poolStatus(c.pools, s.sessions, []);
                return out;
            }
            const [auth, fleet] = await Promise.all([broker(ctx, 'GET', '/auth'), broker(ctx, 'GET', '/fleet')]);
            if (auth.ok) out.auth = auth.data;
            else out.authError = auth.error;
            if (fleet.ok) out.fleet = lib.fleetView(fleet.data, c.pools);
            else out.fleetError = fleet.error;
            return out;
        },

        /** Start `claude setup-token` on the server (in the broker) → the sign-in link to open. */
        async loginStart(ctx) {
            const r = await broker(ctx, 'POST', '/auth/login', {});
            return r.ok ? { ok: true, url: r.data && r.data.url } : r;
        },

        /** The code from the sign-in page → the broker saves the long-lived token for every session. */
        async loginSubmit(ctx, payload) {
            const code = String(payload.code || '').trim();
            if (!code || code.length > 1024 || /[\r\n\0]/.test(code)) return fail(400, 'Paste the code shown after signing in.');
            const r = await broker(ctx, 'POST', '/auth/login/code', { code });
            if (r.ok) return { ok: true, token: r.data && r.data.token };
            // Broker errors are { error: { code, message, details: { retry, url } } }; a bad code
            // comes with a FRESH sign-in link (the old one is used up).
            const d = (r.details && r.details.error && r.details.error.details) || {};
            return { ...r, retry: Boolean(d.retry), url: d.url || null };
        },

        async loginCancel(ctx) {
            const r = await broker(ctx, 'DELETE', '/auth/login');
            return r.ok ? { ok: true } : r;
        },

        /** Forget the saved worker token (sessions keep running until restarted). */
        async logout(ctx) {
            const r = await broker(ctx, 'DELETE', '/auth/token');
            return r.ok ? { ok: true } : r;
        },

        /**
         * Push the configured pools (+ model/effort) to the broker's fleet spec and
         * apply it: the broker starts the missing sessions and stops the ones no
         * longer wanted, then keeps them alive (restarts, prompts, nudges).
         */
        async startSessions(ctx) {
            const c = cfg(ctx);
            if (!c.pools.length) return fail(400, 'Add a pool first.');
            const spec = lib.fleetSpec(c);
            const put = await broker(ctx, 'PUT', '/fleet', spec);
            if (!put.ok) return put;
            const r = await broker(ctx, 'POST', '/fleet/apply', {});
            return r.ok ? { ok: true, ...(r.data || {}) } : r;
        },

        /** Stop every fleet session (the pools stay configured). */
        async stopSessions(ctx) {
            const r = await broker(ctx, 'POST', '/fleet/stop', {});
            return r.ok ? { ok: true, ...(r.data || {}) } : r;
        },

        async restartSession(ctx, payload) {
            const label = String(payload.label || '');
            if (!/^[A-Za-z0-9_.-]{1,64}$/.test(label)) return fail(400, 'A session label is required');
            const r = await broker(ctx, 'POST', `/fleet/sessions/${encodeURIComponent(label)}/restart`, {});
            return r.ok ? { ok: true, ...(r.data || {}) } : r;
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
