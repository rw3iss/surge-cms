'use strict';
/**
 * claude-broker plugin — the server-side Claude Code helpers behind the
 * config page's Setup section: is Claude Code installed, is it signed in,
 * sign in from the admin, and start/stop the broker sessions in tmux.
 *
 * Everything runs as the CMS server's own OS user, so the CMS must run as the
 * user whose `~/.claude` the broker sessions use (the setup script assumes so).
 *
 * Sign-in from the admin: `claude auth login` works without a terminal — it
 * prints the sign-in link and reads the code from stdin. The login runs
 * DETACHED with its stdin on a FIFO and its output in a file under the
 * plugin's data dir, so the "start" and "submit" requests may land on
 * different cluster workers (CLUSTER_WORKERS > 1) and still meet.
 */
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMUX_SESSION = 'sitesurge-broker';
/**
 * A tmux server of our own (`tmux -L sitesurge-broker`), never the default one.
 * Inside a tmux session $TMUX makes every tmux command target THAT server, so
 * without `-L` (and $TMUX removed) a command here could reach — and a test
 * once killed — the operator's own tmux sessions.
 */
const TMUX_SOCKET = 'sitesurge-broker';
const tmuxArgs = (...args) => ['-L', TMUX_SOCKET, ...args];
const LABEL_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const LOGIN_URL_RE = /https:\/\/[^\s\x07\x1b"'<>]*oauth\/authorize[^\s\x07\x1b"'<>]*/;
/* eslint-disable-next-line no-control-regex */
const ANSI_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][A-Z0-9]/g;

function home() {
    return process.env.HOME || os.homedir();
}

function childEnv(extra) {
    const h = home();
    const extraPath = [path.join(h, '.local', 'bin'), path.join(h, '.claude', 'local'), '/usr/local/bin'];
    const env = { ...process.env, PATH: [...extraPath, process.env.PATH || ''].join(':'), ...(extra || {}) };
    delete env.TMUX;
    delete env.TMUX_PANE;
    return env;
}

function isExecutable(p) {
    try {
        fs.accessSync(p, fs.constants.X_OK);
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

/** First executable among the configured path, the usual install spots, then PATH. */
function findBinary(name, configured) {
    const h = home();
    const candidates = [
        configured,
        path.join(h, '.local', 'bin', name),
        path.join(h, '.claude', 'local', name),
        path.join('/usr/local/bin', name),
        path.join('/usr/bin', name),
        ...String(process.env.PATH || '').split(':').filter(Boolean).map((d) => path.join(d, name)),
    ].filter(Boolean);
    for (const c of candidates) if (path.isAbsolute(c) && isExecutable(c)) return c;
    return null;
}

/** execFile as a promise that never rejects: { code, stdout, stderr }. */
function run(file, args, opts) {
    return new Promise((resolve) => {
        execFile(file, args, { env: childEnv(), timeout: 15000, maxBuffer: 1 << 20, ...(opts || {}) }, (err, stdout, stderr) => {
            resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err && !stdout ? err.message : null });
        });
    });
}

function stripAnsi(s) {
    return String(s || '').replace(ANSI_RE, '');
}

/** The sign-in link in `claude auth login` output (OSC-8 hyperlink escapes removed). */
function extractLoginUrl(output) {
    const m = LOGIN_URL_RE.exec(stripAnsi(output));
    return m ? m[0] : null;
}

// ─── Status ───────────────────────────────────────────────────────────────

/** Claude Code installed? signed in? (+ tmux, claude-broker CLI). */
async function claudeStatus(cfg) {
    const claude = findBinary('claude', cfg.claudePath);
    const out = {
        claude: { installed: Boolean(claude), path: claude, version: null },
        auth: { loggedIn: false, method: null, email: null, subscription: null },
        tmux: { installed: Boolean(findBinary('tmux')) },
        brokerCli: { installed: Boolean(findBinary('claude-broker', cfg.brokerCliPath)) },
        login: loginState(cfg),
    };
    if (!claude) return out;
    const v = await run(claude, ['--version']);
    out.claude.version = (v.stdout.trim().split('\n')[0] || null);
    const s = await run(claude, ['auth', 'status', '--json']);
    try {
        const j = JSON.parse(s.stdout);
        out.auth = { loggedIn: Boolean(j.loggedIn), method: j.authMethod || null, email: j.email || null, subscription: j.subscriptionType || null };
    } catch {
        out.auth.error = stripAnsi(s.stderr || s.error || s.stdout).trim().slice(0, 300) || 'Could not read the sign-in status';
    }
    return out;
}

// ─── Sign-in from the admin ───────────────────────────────────────────────

function loginDir(cfg) {
    return path.join(cfg.dataDir, 'login');
}

function readIf(p) {
    try {
        return fs.readFileSync(p, 'utf8');
    } catch {
        return null;
    }
}

function pidAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** The pending login, from its files (any worker can read it). */
function loginState(cfg) {
    const dir = loginDir(cfg);
    const pid = Number(readIf(path.join(dir, 'pid')) || 0);
    const done = readIf(path.join(dir, 'exit'));
    const output = readIf(path.join(dir, 'out')) || '';
    const running = pidAlive(pid) && done === null;
    return {
        pending: running,
        url: running ? extractLoginUrl(output) : null,
        startedAt: running ? (readIf(path.join(dir, 'started')) || null) : null,
    };
}

function killLogin(cfg) {
    const dir = loginDir(cfg);
    const pid = Number(readIf(path.join(dir, 'pid')) || 0);
    if (pidAlive(pid)) {
        try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
    }
    fs.rmSync(dir, { recursive: true, force: true });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start `claude auth login`; resolves with the sign-in link the admin opens. */
async function loginStart(cfg) {
    const claude = findBinary('claude', cfg.claudePath);
    if (!claude) return { ok: false, error: 'Claude Code is not installed on the server (see Setup).' };
    killLogin(cfg);
    const dir = loginDir(cfg);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const fifo = path.join(dir, 'in');
    const mk = await run('mkfifo', ['-m', '600', fifo]);
    if (mk.code !== 0) return { ok: false, error: `Could not create the login pipe: ${mk.stderr || mk.error}` };
    // `3<>` opens the FIFO read-write, which never blocks — so claude starts
    // now and waits on stdin until the code is written.
    const script = 'exec 3<>"$FIFO"; "$CLAUDE" auth login --claudeai <&3 >"$OUT" 2>&1; echo $? >"$EXIT"';
    const child = spawn('sh', ['-c', script], {
        detached: true,
        stdio: 'ignore',
        env: childEnv({ FIFO: fifo, CLAUDE: claude, OUT: path.join(dir, 'out'), EXIT: path.join(dir, 'exit'), BROWSER: 'true', NO_COLOR: '1' }),
    });
    child.unref();
    fs.writeFileSync(path.join(dir, 'pid'), String(child.pid));
    fs.writeFileSync(path.join(dir, 'started'), new Date().toISOString());
    for (let i = 0; i < 60; i++) {
        await sleep(250);
        const out = readIf(path.join(dir, 'out')) || '';
        const url = extractLoginUrl(out);
        if (url) return { ok: true, url };
        const exit = readIf(path.join(dir, 'exit'));
        if (exit !== null) {
            const text = stripAnsi(out).trim().slice(-400);
            killLogin(cfg);
            return { ok: false, error: text || `claude auth login exited (${exit.trim()})` };
        }
    }
    killLogin(cfg);
    return { ok: false, error: 'Claude Code did not print a sign-in link within 15 seconds.' };
}

/** Hand the code from the sign-in page to the waiting `claude auth login`. */
async function loginSubmit(cfg, code) {
    const c = String(code || '').trim();
    if (!c || c.length > 1024 || /[\r\n\0]/.test(c)) return { ok: false, error: 'Paste the code shown after signing in.' };
    const dir = loginDir(cfg);
    const state = loginState(cfg);
    if (!state.pending) return { ok: false, error: 'No sign-in is waiting — press "Sign in to Claude" again.' };
    const before = (readIf(path.join(dir, 'out')) || '').length;
    // O_NONBLOCK: the reader (fd 3 in the login shell) is open, so this never blocks.
    const fd = fs.openSync(path.join(dir, 'in'), fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
    try {
        fs.writeSync(fd, `${c}\n`);
    } finally {
        fs.closeSync(fd);
    }
    for (let i = 0; i < 120; i++) {
        await sleep(250);
        const exit = readIf(path.join(dir, 'exit'));
        const out = readIf(path.join(dir, 'out')) || '';
        const tail = stripAnsi(out.slice(before)).trim();
        if (exit !== null) {
            killLogin(cfg);
            const st = await claudeStatus(cfg);
            if (st.auth.loggedIn) return { ok: true, auth: st.auth };
            return { ok: false, error: tail.slice(-400) || `Sign-in failed (exit ${exit.trim()}).` };
        }
        // A wrong code re-prompts instead of exiting — report it and keep the login waiting.
        if (/invalid code|try again/i.test(tail)) {
            return { ok: false, retry: true, error: tail.split('\n').find((l) => /invalid|again/i.test(l)) || 'Invalid code — copy the whole code and try again.' };
        }
    }
    return { ok: false, error: 'Claude Code did not finish signing in within 30 seconds.' };
}

async function loginCancel(cfg) {
    killLogin(cfg);
    return { ok: true };
}

// ─── Broker sessions in tmux ──────────────────────────────────────────────

/**
 * The MCP config a session loads: the broker shim with this session's label
 * and the broker token (written 0600 under the plugin data dir).
 */
function writeMcpConfig(cfg, brokerCli, label) {
    const dir = path.join(cfg.dataDir, 'mcp');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${label}.json`);
    const env = {
        CLAUDE_BROKER_SOCKET: cfg.brokerSocket || '/tmp/claude-broker.sock',
        CLAUDE_BROKER_SESSION_LABEL: label,
        CLAUDE_BROKER_SESSION_ID: label,
    };
    if (cfg.token) env.CLAUDE_BROKER_TOKEN = cfg.token;
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { 'claude-broker': { command: brokerCli, args: ['shim'], env } } }, null, 2), { mode: 0o600 });
    return file;
}

/** The session labels a pool should have: `name` (count 1) or `name-1`…`name-N`. */
function poolLabels(pool) {
    const n = Math.max(1, Math.min(16, Number(pool.count) || 1));
    if (n === 1) return [pool.name];
    return Array.from({ length: n }, (_, i) => `${pool.name}-${i + 1}`);
}

async function tmuxWindows(tmux) {
    const r = await run(tmux, tmuxArgs('list-windows', '-t', TMUX_SESSION, '-F', '#{window_name}'));
    return r.code === 0 ? r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
}

/** Which option line is selected ("❯") in a capture of the pane. */
function selectedLine(pane) {
    return pane.split('\n').find((l) => /❯|›|>\s*\d+\./.test(l)) || '';
}

/**
 * Answer Claude Code's first-run prompts in a fresh session: trust this
 * folder, accept bypass-permissions mode, accept the development channel.
 * Moves the selection down to the wanted option, then Enter. Gives up after
 * ~60 s (the operator can finish in tmux: `tmux -L sitesurge-broker attach`).
 */
/** Claude Code started but refuses the broker channel (a gate on its side). */
const CHANNELS_UNAVAILABLE_RE = /Channels are not (currently )?available|not enabled for your org/i;

/** Per-session note for the Setup checklist (any worker reads it). */
function writeSessionNote(cfg, label, note) {
    const dir = path.join(cfg.dataDir, 'session-notes');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${label}.txt`);
    if (note) fs.writeFileSync(file, note);
    else fs.rmSync(file, { force: true });
}

function readSessionNote(cfg, label) {
    return readIf(path.join(cfg.dataDir, 'session-notes', `${label}.txt`));
}

/**
 * Answer Claude Code's first-run prompts in a fresh session (trust this
 * folder, accept bypass-permissions mode, accept the development channel):
 * move the selection to the wanted option, then Enter. Resolves when the
 * session is attached AND its channel is live, or with a note saying why not.
 * The shim attaches as soon as the MCP server starts, so "attached" alone is
 * not enough — a session whose channel was refused never receives a job.
 */
async function acceptPrompts(tmux, target, isAttached) {
    const want = [
        { when: /trust the files|trust this folder|Do you trust/i, choose: /Yes, (I )?trust|Yes, proceed|^\s*❯?\s*1\./i },
        { when: /Bypass Permissions mode/i, choose: /Yes, I accept/i },
        { when: /development channels/i, choose: /local development/i },
    ];
    let pane = '';
    for (let i = 0; i < 60; i++) {
        await sleep(1000);
        const cap = await run(tmux, tmuxArgs('capture-pane', '-p', '-t', target));
        if (cap.code !== 0) return { ok: false, note: 'The session window closed (Claude Code exited).' };
        pane = cap.stdout;
        if (CHANNELS_UNAVAILABLE_RE.test(pane)) {
            const line = pane.split('\n').find((l) => CHANNELS_UNAVAILABLE_RE.test(l)) || '';
            return { ok: false, note: `Claude Code refused the broker channel: "${line.replace(/^[\s▎]+/, '').trim()}". It cannot receive jobs.` };
        }
        const prompt = want.find((w) => w.when.test(pane));
        if (prompt) {
            const sel = selectedLine(pane);
            if (prompt.choose.test(sel)) await run(tmux, tmuxArgs('send-keys', '-t', target, 'Enter'));
            else await run(tmux, tmuxArgs('send-keys', '-t', target, 'Down'));
            continue;
        }
        // At the input prompt with no channel complaint → live once attached.
        if (/❯/.test(pane) && i >= 4 && await isAttached()) return { ok: true, note: null };
    }
    return { ok: false, note: 'The session did not reach the prompt within 60 seconds.' };
}

/**
 * Start a tmux window running a broker-attached Claude session for every
 * pool member that is neither attached nor already running. Returns at once
 * with the labels being started; each one answers its first-run prompts in
 * the background and attaches within ~30 s (the status list shows it).
 */
async function startSessions(cfg, attachedLabels, onlyPool) {
    const tmux = findBinary('tmux');
    if (!tmux) return { ok: false, error: 'tmux is not installed on the server (see Setup).' };
    const claude = findBinary('claude', cfg.claudePath);
    if (!claude) return { ok: false, error: 'Claude Code is not installed on the server (see Setup).' };
    if (/['\s]/.test(claude)) return { ok: false, error: 'The Claude Code path may not contain spaces or quotes.' };
    const brokerCli = findBinary('claude-broker', cfg.brokerCliPath);
    if (!brokerCli) return { ok: false, error: 'The claude-broker CLI is not installed on the server (see Setup).' };
    const pools = cfg.pools.filter((p) => !onlyPool || p.name === onlyPool);
    if (!pools.length) return { ok: false, error: onlyPool ? `No pool "${onlyPool}".` : 'Add a pool first.' };

    const cwd = cfg.sessionCwd || path.join(cfg.dataDir, 'sessions');
    fs.mkdirSync(cwd, { recursive: true });
    const has = await run(tmux, tmuxArgs('has-session', '-t', TMUX_SESSION));
    if (has.code !== 0) {
        const mk = await run(tmux, tmuxArgs('new-session', '-d', '-s', TMUX_SESSION, '-n', 'idle', '-c', cwd));
        if (mk.code !== 0) return { ok: false, error: `tmux: ${mk.stderr || mk.error}` };
    }
    const windows = new Set(await tmuxWindows(tmux));
    const attached = new Set(attachedLabels);
    const started = [];
    const skipped = [];
    for (const pool of pools) {
        for (const label of poolLabels(pool)) {
            if (!LABEL_RE.test(label)) continue;
            if (attached.has(label) || windows.has(label)) {
                skipped.push(label);
                continue;
            }
            // The shim's MCP config is per session (label + token in its env), so
            // no `claude mcp add` is needed and no fixed label in ~/.claude.json
            // can override the pool member's label.
            const mcpFile = writeMcpConfig(cfg, brokerCli, label);
            const cmd = `'${claude}' --dangerously-skip-permissions --mcp-config '${mcpFile}' --strict-mcp-config --dangerously-load-development-channels server:claude-broker`;
            const args = ['new-window', '-d', '-t', `${TMUX_SESSION}:`, '-n', label, '-c', cwd,
                '-e', `CLAUDE_BROKER_SESSION_LABEL=${label}`, '-e', `CLAUDE_BROKER_SESSION_ID=${label}`];
            args.push(cmd);
            const w = await run(tmux, tmuxArgs(...args));
            if (w.code !== 0) return { ok: false, error: `tmux: ${w.stderr || w.error}`, started };
            started.push(label);
        }
    }
    return { ok: true, started, skipped, tmux, target: TMUX_SESSION };
}

async function stopSessions(cfg, labels) {
    const tmux = findBinary('tmux');
    if (!tmux) return { ok: false, error: 'tmux is not installed on the server.' };
    const windows = await tmuxWindows(tmux);
    const stop = (labels && labels.length ? labels : windows.filter((w) => w !== 'idle')).filter((l) => windows.includes(l));
    for (const l of stop) {
        await run(tmux, tmuxArgs('kill-window', '-t', `${TMUX_SESSION}:${l}`));
        writeSessionNote(cfg, l, null);
    }
    return { ok: true, stopped: stop };
}

module.exports = {
    readSessionNote,
    writeSessionNote,
    TMUX_SESSION,
    TMUX_SOCKET,
    acceptPrompts,
    claudeStatus,
    extractLoginUrl,
    findBinary,
    loginCancel,
    loginStart,
    loginState,
    loginSubmit,
    poolLabels,
    selectedLine,
    startSessions,
    stopSessions,
    stripAnsi,
    tmuxWindows,
};
