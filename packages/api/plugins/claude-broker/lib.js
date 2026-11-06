'use strict';
/**
 * claude-broker plugin — pure helpers (no I/O), shared by server.js and the
 * CMS tests. Conventions follow the CivicGate broker client:
 *
 *  - A POOL is a session LABEL. Its members are attached sessions labelled
 *    exactly `<pool>` or `<pool>-<n>` (`summary`, `summary-1`, `summary-2`…),
 *    the way the session launcher names pool windows.
 *  - A prompt is framed with a 2-line header (`▶ KIND` / subject) and a closing
 *    footer that tells the session to answer through `complete_job` — without
 *    it a session may answer in chat and the job expires at its TTL.
 *  - A result is text (an object result is JSON-stringified) screened for
 *    degenerate repetition loops; JSON is parsed loosely (code fences,
 *    surrounding prose).
 */

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired', 'orphaned']);
const ACTIVE = ['pending', 'dispatched', 'in_progress'];
/** Most sessions one pool may ask for (the broker's fleet spec caps a pool at 16). */
const MAX_POOL_SIZE = 16;

/** Escape a string for a RegExp. */
function reEscape(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Does `label` belong to `pool`? (`pool` or `pool-<n>`.) */
function inPool(label, pool) {
    if (!label || !pool) return false;
    return new RegExp(`^${reEscape(pool)}(-\\d+)?$`).test(label);
}

/** Clean the configured pools: [{ name, count, description, framing? }]. Drops unnamed + duplicate rows. */
function normalizePools(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const out = [];
    for (const p of list) {
        if (!p || typeof p !== 'object') continue;
        const name = String(p.name || '').trim();
        if (!name || !/^[A-Za-z0-9_.-]{1,64}$/.test(name) || seen.has(name)) continue;
        seen.add(name);
        const count = Math.max(1, Math.min(MAX_POOL_SIZE, Math.round(Number(p.count) || 1)));
        out.push({ name, count, description: String(p.description || '').trim() });
    }
    return out;
}

/**
 * Pool status from the broker's sessions + active jobs.
 * sessions: broker `GET /sessions` items; activeJobs: jobs in an ACTIVE status.
 * `ready` counts attached members that can take a job (not usage-limited,
 * signed out…; see isHealthy); the pool is `healthy` when that meets the
 * expected count — an attached but usage-limited session no longer counts.
 */
function poolStatus(pools, sessions, activeJobs) {
    const busyBy = busyCounts(activeJobs);
    return pools.map((p) => {
        const members = (sessions || []).filter((s) => s.status === 'attached' && inPool(s.label, p.name));
        const busy = members.reduce((n, s) => n + (busyBy.get(s.id) || 0), 0);
        const ready = members.filter(isHealthy).length;
        return {
            name: p.name,
            description: p.description,
            expected: p.count,
            attached: members.length,
            ready,
            busy,
            idle: members.filter((s) => isHealthy(s) && !busyBy.get(s.id)).length,
            healthy: ready >= p.count,
            sessions: members.map((s) => ({
                id: s.id,
                label: s.label,
                busy: busyBy.get(s.id) || 0,
                healthy: isHealthy(s),
                state: s.tui_state || null,
            })),
        };
    });
}

/** Why a pool has no usable session — for the error a pool request returns. */
function noSessionReason(pool, sessions) {
    const members = (sessions || []).filter((s) => s.status === 'attached' && inPool(s.label, pool));
    if (!members.length) return `No session is attached in pool "${pool}"`;
    const states = [...new Set(members.map((s) => TUI_STATE_TEXT[s.tui_state] || s.tui_state || 'unavailable'))];
    return `No session in pool "${pool}" can take a job right now (${states.join('; ')})`;
}

/** session_id → number of active jobs. */
function busyCounts(jobs) {
    const m = new Map();
    for (const j of jobs || []) {
        if (!ACTIVE.includes(j.status)) continue;
        m.set(j.session_id, (m.get(j.session_id) || 0) + 1);
    }
    return m;
}

/**
 * The session a pool request goes to: the attached member with the fewest
 * active jobs; ties → the one that settled longest ago (`lastSettled`
 * session_id → ms), then by label for a stable order. Null when no member
 * is attached.
 */
function pickSession(pool, sessions, activeJobs, lastSettled) {
    const busyBy = busyCounts(activeJobs);
    const settled = lastSettled || new Map();
    const members = (sessions || []).filter((s) => s.status === 'attached' && inPool(s.label, pool));
    if (!members.length) return null;
    members.sort((a, b) =>
        (busyBy.get(a.id) || 0) - (busyBy.get(b.id) || 0)
        || (settled.get(a.id) || 0) - (settled.get(b.id) || 0)
        || String(a.label).localeCompare(String(b.label)));
    return members[0];
}

/** `▶ KIND` + one-line subject, then a blank line. */
function jobHeader(kind, subject) {
    const s = String(subject || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    return `▶ ${String(kind || 'CMS').toUpperCase()}\n${s}\n\n`;
}

/** The closing instruction: answer through complete_job (else the job expires). */
function jobFooter() {
    return (
        '\n\nIMPORTANT — how to return this: call the `complete_job` tool with this job\'s `job_id` and put ' +
        'your answer in `result`. Printing the answer as a chat message does NOT deliver it: the request ' +
        'will time out and the work will be thrown away. If you cannot do the task, call `fail_job` with ' +
        'the `job_id` and a short reason. If `complete_job` is not in your tool list, load it first with ' +
        'ToolSearch query "select:mcp__claude-broker__complete_job,mcp__claude-broker__fail_job" — it is ' +
        'deferred, not missing.'
    );
}

/** The content sent to the session. `system` goes first, the format hint before the footer. */
function framePrompt({ prompt, system, kind, subject, format, frame }) {
    const body = [
        system ? `${String(system).trim()}\n\n` : '',
        String(prompt || ''),
        format === 'json' ? '\n\nReturn ONLY valid JSON in `result` (no prose, no code fences).' : '',
    ].join('');
    if (frame === false) return body;
    return jobHeader(kind, subject || prompt) + body + jobFooter();
}

/** A conservative repetition-loop detector ("court court court…"). Short outputs pass. */
function isDegenerateOutput(text) {
    const t = String(text || '').trim();
    if (t.length < 40) return false;
    const tokens = t.split(/\s+/);
    if (tokens.length >= 20) {
        if (new Set(tokens).size / tokens.length < 0.15) return true;
        let run = 1;
        let maxRun = 1;
        for (let i = 1; i < tokens.length; i++) {
            run = tokens[i] === tokens[i - 1] ? run + 1 : 1;
            if (run > maxRun) maxRun = run;
        }
        if (maxRun >= 10) return true;
    }
    if (t.length > 300 && new Set(t.replace(/\s/g, '')).size <= 5) return true;
    return false;
}

/** Parse JSON from model output: plain, fenced, or embedded in prose. Null when none. */
function parseJsonLoose(raw) {
    if (raw && typeof raw === 'object') return raw;
    const s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    if (!s) return null;
    try { return JSON.parse(s); } catch { /* fall through */ }
    for (const [open, close] of [['{', '}'], ['[', ']']]) {
        const a = s.indexOf(open);
        const b = s.lastIndexOf(close);
        if (a >= 0 && b > a) {
            try { return JSON.parse(s.slice(a, b + 1)); } catch { /* next */ }
        }
    }
    return null;
}

/** A broker result as text: strings as-is, `{ text|answer|content }` unwrapped, else JSON. */
function resultText(result) {
    if (result == null) return '';
    if (typeof result === 'string') return result;
    if (typeof result === 'object') {
        for (const k of ['text', 'answer', 'content', 'message']) {
            if (typeof result[k] === 'string') return result[k];
        }
    }
    try { return JSON.stringify(result); } catch { return String(result); }
}

/** The broker job → the plugin's standard job shape. */
function normalizeJob(job, extra) {
    const j = job && typeof job === 'object' && job.job && !job.id ? job.job : (job || {});
    let status = String(j.status || 'pending');
    if (status === 'dispatched') status = 'pending';
    if (status === 'orphaned') status = 'failed';
    const text = status === 'completed' ? resultText(j.result) : '';
    const degenerate = status === 'completed' && isDegenerateOutput(text);
    const meta = j.meta && typeof j.meta === 'object' ? j.meta : {};
    return {
        id: String(j.id || j.job_id || ''),
        status: degenerate ? 'failed' : status,
        sessionId: j.session_id || null,
        // The plugin records the session label in meta at submit, so a polled job keeps it.
        sessionLabel: meta.session || (extra && extra.sessionLabel) || null,
        pool: meta.pool || (extra && extra.pool) || null,
        text: degenerate ? '' : text,
        result: degenerate ? null : (j.result === undefined ? null : j.result),
        error: degenerate ? 'Degenerate (repeating) output' : (j.error || (status === 'expired' ? 'The session did not answer before the job expired' : null)),
        progress: Array.isArray(j.progress_notes)
            ? j.progress_notes.map((n) => ({ note: String(n.note ?? n.text ?? ''), at: n.at ?? n.created_at ?? null }))
            : [],
        meta,
        createdAt: j.created_at || null,
        dispatchedAt: j.dispatched_at || null,
        completedAt: j.completed_at || null,
        expiresAt: j.expires_at || null,
        timedOut: j.timed_out === true,
        degenerate,
    };
}

/** A broker error body `{ error: { code, message } }` → a message. */
function brokerError(r) {
    if (!r) return 'No response from the broker';
    if (r.status === 401) return 'Unauthorized — check the broker token';
    const d = r.details;
    const e = d && d.error;
    if (e && typeof e === 'object' && e.message) return `${e.message}${e.code ? ` (${e.code})` : ''}`;
    if (typeof r.error === 'string' && r.error && r.error !== '[object Object]') return r.error;
    return `Broker request failed (${r.status || 'network'})`;
}

// ─── Broker ≥ 0.6: fleet, sign-in, session health ───────────────────────────

/** TUI states in which a session cannot do work (claude-broker ≥ 0.6 reports them). */
const UNHEALTHY = new Set(['usage_limited', 'login_required', 'context_wedged', 'channels_unavailable', 'exited']);

/** Usable for a job? A session without a reported state (older broker, no tmux pane) counts as usable. */
function isHealthy(s) {
    return !s || !s.tui_state || !UNHEALTHY.has(s.tui_state);
}

/** Does this broker manage sessions + sign-in itself? */
function supportsFleet(capabilities) {
    const c = Array.isArray(capabilities) ? capabilities : [];
    return c.includes('fleet') && c.includes('auth');
}

/** What each TUI state means, for the admin checklist. */
const TUI_STATE_TEXT = {
    unknown: 'running',
    starting: 'starting',
    prompt: 'answering a first-run question',
    ready: 'ready',
    working: 'working on a job',
    usage_limited: 'stopped: Claude usage limit reached (resumes after the reset)',
    login_required: 'stopped: signed out — sign in again',
    context_wedged: 'stuck (context error) — being restarted',
    channels_unavailable: 'Claude Code refused the broker channel ("Channels are not currently available") — it cannot receive jobs',
    exited: 'exited — being restarted',
};

function sessionView(s) {
    return {
        id: s.id,
        label: s.label,
        status: s.status,
        busy: s.busy || 0,
        managed: Boolean(s.managed),
        tuiState: s.tui_state || null,
        tuiDetail: s.tui_detail || null,
        healthy: isHealthy(s),
    };
}

/**
 * The broker's `GET /auth` reduced to what the config page shows: Claude Code
 * install info, whether a token is saved (+ its dates) and the sign-in state.
 * Never the token itself — it is the Claude credential every session uses.
 */
function authView(a) {
    const src = a && typeof a === 'object' ? a : {};
    const tok = src.token && typeof src.token === 'object' ? src.token : {};
    const login = src.login && typeof src.login === 'object' ? src.login : {};
    const claude = src.claude && typeof src.claude === 'object' ? src.claude : null;
    return {
        claude: claude ? { installed: Boolean(claude.installed), version: claude.version || null, path: claude.path || null } : null,
        token: { set: Boolean(tok.set), created_at: tok.created_at || null, expires_at: tok.expires_at || null },
        login: { pending: Boolean(login.pending), url: login.url || null, error: login.error || null },
    };
}

/** The fleet spec the plugin's pools translate to (PUT /fleet). */
function fleetSpec(c) {
    const spec = { pools: c.pools.map((p) => ({ name: p.name, count: Math.max(1, Math.min(MAX_POOL_SIZE, Number(p.count) || 1)) })), autostart: true, nudge: true };
    if (c.model) spec.model = c.model;
    if (c.effort) spec.effort = c.effort;
    return spec;
}

/** GET /fleet → per-pool rows of sessions with a readable state. */
function fleetView(fleet, pools) {
    const sessions = (fleet && Array.isArray(fleet.sessions)) ? fleet.sessions : [];
    const names = new Set([...(pools || []).map((p) => p.name), ...sessions.map((x) => x.pool).filter(Boolean)]);
    return {
        tmux: fleet && fleet.tmux ? fleet.tmux : null,
        claude: fleet && fleet.claude ? fleet.claude : null,
        specPools: fleet && fleet.spec && Array.isArray(fleet.spec.pools) ? fleet.spec.pools : [],
        pools: [...names].map((name) => ({
            name,
            sessions: sessions.filter((x) => x.pool === name).map((x) => ({
                label: x.label,
                attached: Boolean(x.attached),
                running: Boolean(x.running),
                state: x.tui_state || (x.attached ? 'ready' : x.running ? 'starting' : 'exited'),
                stateText: !x.attached && x.running && (!x.tui_state || ['ready', 'working', 'unknown'].includes(x.tui_state))
                    ? 'running, but not attached to the broker yet (its MCP shim has not connected)'
                    : TUI_STATE_TEXT[x.tui_state] || (x.attached ? 'attached' : x.running ? 'starting' : 'not running'),
                healthy: Boolean(x.attached) && isHealthy(x),
                detail: x.tui_detail || x.note || null,
                restarts: x.restarts || 0,
            })),
        })),
    };
}

module.exports = {
    TERMINAL,
    ACTIVE,
    MAX_POOL_SIZE,
    noSessionReason,
    inPool,
    normalizePools,
    poolStatus,
    busyCounts,
    pickSession,
    jobHeader,
    jobFooter,
    framePrompt,
    isDegenerateOutput,
    parseJsonLoose,
    resultText,
    normalizeJob,
    brokerError,
    UNHEALTHY,
    TUI_STATE_TEXT,
    isHealthy,
    supportsFleet,
    sessionView,
    authView,
    fleetSpec,
    fleetView,
};
