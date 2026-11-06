// claude-broker plugin — admin config page (plain DOM, no framework).
// Edits the broker address/token and the session POOLS, shows each pool's live
// status (attached vs expected, busy), and sends a test prompt.

function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (k === 'style') Object.assign(n.style, v);
        else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'text') n.textContent = v;
        else if (v !== undefined && v !== null) n[k] = v;
    }
    for (const c of kids.flat()) if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
}

function section(title, help) {
    const s = el('section', { className: 'admin-section' });
    const h = el('header', { className: 'admin-section__header' }, el('h2', { text: title }));
    if (help) h.appendChild(el('p', { className: 'form-help-muted', text: help }));
    s.appendChild(h);
    return s;
}

/** A text/number input that writes back on blur (+ Enter). */
function commitInput(value, onCommit, opts) {
    const o = opts || {};
    const i = el('input', { className: 'input', type: o.type || 'text', value: value == null ? '' : String(value), placeholder: o.placeholder || '' });
    if (o.width) i.style.width = o.width;
    const commit = () => onCommit(o.type === 'number' ? Number(i.value) : i.value);
    i.addEventListener('blur', commit);
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    return i;
}

async function action(host, name, payload) {
    try {
        const r = await host.api.post(`/action/${name}`, payload || {});
        if (r && typeof r === 'object' && 'ok' in r) return r;
        if (r && r.error) return { ok: false, error: r.error.message || String(r.error) };
        return { ok: false, error: 'Unexpected response' };
    } catch (e) {
        return { ok: false, error: (e && e.message) || 'Request failed' };
    }
}

const OK = '#15803d';
const WARN = '#b45309';
const BAD = '#b91c1c';

function check(ok, label, detail, pending) {
    const mark = pending ? '…' : ok ? '✓' : '✕';
    const color = pending ? WARN : ok ? OK : BAD;
    return el('li', { style: { display: 'flex', gap: '0.5rem', alignItems: 'baseline', margin: '0.3rem 0' } },
        el('span', { style: { color, fontWeight: '700', width: '1rem' }, text: mark }),
        el('span', {}, el('strong', { text: label }), detail ? el('span', { className: 'form-help-muted', text: ` — ${detail}` }) : null));
}

/**
 * Setup checklist + "Sign in to Claude" + the session fleet. The broker
 * (claude-broker ≥ 0.6) does the work: it runs `claude setup-token` for the
 * sign-in (one long-lived token every session uses — sessions sharing one
 * interactive login blank each other's token), and starts, watches and
 * restarts the pool sessions in its own tmux server.
 */
function renderSetup(host) {
    const sec = section('Setup', 'Claude Code and the claude-broker daemon run on this server. Sign in once, then start your pools — the broker keeps the sessions running.');
    const body = el('div');
    const loginBox = el('div', { style: { display: 'none', margin: '0.75rem 0', padding: '0.75rem 1rem', border: '1px solid var(--admin-border, #e5e7eb)', borderRadius: '8px' } });
    const sessBox = el('div', { style: { marginTop: '0.75rem' } });
    const msg = el('p', { className: 'form-help-muted', style: { minHeight: '1.2em' } });
    const refreshBtn = el('button', { className: 'btn btn-secondary btn-sm', type: 'button', text: 'Re-check', onclick: () => load() });
    sec.appendChild(el('div', { className: 'form-actions' }, refreshBtn));
    sec.appendChild(body);
    sec.appendChild(loginBox);
    sec.appendChild(sessBox);
    sec.appendChild(msg);

    sec.appendChild(el('details', { style: { marginTop: '0.75rem' } },
        el('summary', { style: { cursor: 'pointer', fontWeight: '600' }, text: 'How to set up the server (one time)' }),
        el('ol', { style: { paddingLeft: '1.2rem', lineHeight: '1.6' } },
            el('li', {}, 'SSH to the server as the user the CMS runs as and run ', el('code', { text: 'bash <cms>/packages/api/plugins/claude-broker/setup/setup-server.sh' }), '. It installs tmux, Claude Code and claude-broker (≥ 0.6), starts the broker daemon and prints its token.'),
            el('li', {}, 'Paste the token into Broker connection below and Save.'),
            el('li', {}, 'Press ', el('strong', { text: 'Sign in to Claude' }), ': open the link, sign in with the Claude account the sessions should use, copy the code the page shows and paste it here.'),
            el('li', {}, 'Add pools below, Save, then ', el('strong', { text: 'Start sessions' }), '. The broker answers each session\'s first-run questions, restarts sessions that exit or get stuck, and wakes idle ones when a job waits.'),
            el('li', {}, 'Send a test prompt at the bottom of this page.')),
        el('p', {}, el('a', { href: '/admin/help/claude-broker', text: 'Full guide: Claude Broker (AI) →' }))));

    let st = null;

    function showLogin(url) {
        loginBox.style.display = '';
        loginBox.innerHTML = '';
        const code = el('input', { className: 'input', type: 'text', placeholder: 'Paste the code here', style: { minWidth: '22rem' } });
        const submit = el('button', { className: 'btn btn-primary', type: 'button', text: 'Submit code' });
        const cancel = el('button', { className: 'btn btn-secondary', type: 'button', text: 'Cancel' });
        const out = el('p', { className: 'form-help-muted' });
        submit.onclick = async () => {
            submit.disabled = true; out.style.color = ''; out.textContent = 'Signing in…';
            const r = await action(host, 'loginSubmit', { code: code.value });
            submit.disabled = false;
            if (r.ok) { loginBox.style.display = 'none'; msg.style.color = ''; msg.textContent = 'Signed in — the sessions use this sign-in from their next start.'; load(); return; }
            out.style.color = BAD;
            out.textContent = (r.error || 'Sign-in failed.') + (r.retry ? ' Each link works once — open the NEW link above, sign in again and paste the new code.' : '');
            if (r.retry && r.url) { link.href = r.url; code.value = ''; }
            if (!r.retry) load();
        };
        code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit.onclick(); } });
        cancel.onclick = async () => { await action(host, 'loginCancel'); loginBox.style.display = 'none'; load(); };
        const link = el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: 'Open the Claude sign-in page' });
        loginBox.appendChild(el('p', {}, el('strong', { text: '1. ' }), link, ' and sign in with the account the sessions should use (a Claude subscription).'));
        loginBox.appendChild(el('p', {}, el('strong', { text: '2. ' }), 'Copy the code the page shows and paste it here:'));
        loginBox.appendChild(el('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' } }, code, submit, cancel));
        loginBox.appendChild(out);
    }

    async function startLogin() {
        msg.style.color = ''; msg.textContent = 'Starting the sign-in on the server…';
        const r = await action(host, 'loginStart');
        if (!r.ok) { msg.style.color = BAD; msg.textContent = r.error || 'Could not start the sign-in.'; return; }
        msg.textContent = '';
        showLogin(r.url);
    }

    function renderSessions() {
        sessBox.innerHTML = '';
        if (!st || !st.ok || !st.broker.reachable) return;
        sessBox.appendChild(el('h3', { style: { fontSize: '0.95rem', margin: '0.5rem 0 0.25rem' }, text: 'Sessions' }));
        if (!st.managed) {
            sessBox.appendChild(el('p', { className: 'form-help-muted', text: `This broker (v${st.broker.version || '?'}) does not manage sessions. Update it (claude-broker update, or re-run the setup script) to sign in and start sessions from here. Attached now: ${st.attached.map((s) => s.label).join(', ') || 'none'}.` }));
            return;
        }
        const pools = st.fleet ? st.fleet.pools : [];
        if (!pools.length) sessBox.appendChild(el('p', { className: 'form-help-muted', text: 'No pools yet — add one below, Save, then Start sessions.' }));
        const ul = el('ul', { style: { listStyle: 'none', padding: 0, margin: 0 } });
        for (const p of pools) {
            if (!p.sessions.length) ul.appendChild(check(false, p.name, 'not started', false));
            for (const x of p.sessions) {
                const row = check(x.healthy, `${p.name} · ${x.label}`, `${x.stateText}${x.detail && x.state !== 'ready' ? ` — ${x.detail}` : ''}${x.restarts ? ` · ${x.restarts} restart(s)` : ''}`, !x.healthy && (x.state === 'starting' || x.state === 'prompt'));
                row.appendChild(el('button', {
                    className: 'btn btn-secondary btn-sm', type: 'button', style: { marginLeft: 'auto' }, text: 'Restart',
                    onclick: async () => { const r = await action(host, 'restartSession', { label: x.label }); msg.style.color = r.ok ? '' : BAD; msg.textContent = r.ok ? `Restarting ${x.label}…` : r.error; setTimeout(load, 5000); },
                }));
                ul.appendChild(row);
            }
        }
        sessBox.appendChild(ul);
        const others = st.attached.filter((s) => !s.managed);
        if (others.length) sessBox.appendChild(el('p', { className: 'form-help-muted', text: `Also attached (not started here): ${others.map((s) => s.label || s.id).join(', ')}.` }));
        const start = el('button', { className: 'btn btn-primary btn-sm', type: 'button', text: 'Start sessions' });
        const stop = el('button', { className: 'btn btn-secondary btn-sm', type: 'button', text: 'Stop sessions' });
        start.onclick = async () => {
            start.disabled = true; msg.style.color = ''; msg.textContent = 'Applying the pools…';
            const r = await action(host, 'startSessions');
            start.disabled = false;
            if (!r.ok) { msg.style.color = BAD; msg.textContent = r.error; return; }
            const started = r.started || [];
            const stopped = r.stopped || [];
            msg.textContent = `${started.length ? `Starting ${started.join(', ')} — they attach within ~30 s. ` : 'Every session is already running. '}${stopped.length ? `Stopped ${stopped.join(', ')}.` : ''}`;
            setTimeout(load, 3000); setTimeout(load, 15000); setTimeout(load, 40000);
        };
        stop.onclick = async () => {
            if (!confirm('Stop every session started here? Jobs in progress are lost.')) return;
            const r = await action(host, 'stopSessions');
            msg.style.color = r.ok ? '' : BAD;
            msg.textContent = r.ok ? `Stopped ${(r.stopped || []).length} session(s).` : r.error;
            load();
        };
        sessBox.appendChild(el('div', { className: 'form-actions' }, start, stop));
        if (st.fleet && st.fleet.tmux && st.fleet.tmux.attach) {
            sessBox.appendChild(el('p', { className: 'form-help-muted' }, 'Watch a session on the server: ', el('code', { text: st.fleet.tmux.attach })));
        }
    }

    async function load() {
        refreshBtn.disabled = true;
        st = await action(host, 'setupStatus');
        refreshBtn.disabled = false;
        body.innerHTML = '';
        if (!st.ok) { body.appendChild(el('p', { style: { color: BAD }, text: st.error || 'Could not read the status.' })); return; }
        const ul = el('ul', { style: { listStyle: 'none', padding: 0, margin: 0 } });
        const b = st.broker;
        ul.appendChild(check(b.reachable, 'Broker daemon', b.reachable ? `${b.url} · v${b.version || '?'}` : `${b.url} — ${b.error || 'not reachable'} (run the setup script, then save the token)`));
        if (b.reachable && st.managed) {
            const a = st.auth || {};
            const claude = a.claude || (st.fleet && st.fleet.claude) || {};
            ul.appendChild(check(Boolean(claude.installed), 'Claude Code', claude.installed ? `${claude.version || ''} (${claude.path || ''})` : 'not installed on the server — run the setup script'));
            const tok = a.token || {};
            const login = a.login || {};
            const tokDetail = tok.set
                ? `long-lived token saved${tok.created_at ? ` ${String(tok.created_at).slice(0, 10)}` : ''}${tok.expires_at ? `, valid until ${String(tok.expires_at).slice(0, 10)}` : ''}`
                : (login.error || 'not signed in');
            const authRow = check(Boolean(tok.set), 'Signed in to Claude', tokDetail, Boolean(login.pending));
            if (claude.installed) {
                authRow.appendChild(el('button', {
                    className: 'btn btn-secondary btn-sm', type: 'button', style: { marginLeft: 'auto' },
                    text: login.pending ? 'Continue sign-in' : tok.set ? 'Sign in again' : 'Sign in to Claude',
                    onclick: () => (login.pending && login.url ? showLogin(login.url) : startLogin()),
                }));
            }
            ul.appendChild(authRow);
            const tm = st.fleet && st.fleet.tmux;
            if (tm) ul.appendChild(check(Boolean(tm.installed), 'tmux', tm.installed ? `sessions run on the private server "${tm.socket}"` : 'not installed — run the setup script'));
            if (st.authError) ul.appendChild(check(false, 'Sign-in status', st.authError));
            if (st.fleetError) ul.appendChild(check(false, 'Sessions', st.fleetError));
        }
        body.appendChild(ul);
        renderSessions();
    }

    load();
    return sec;
}

export default {
    async mountConfig(root, host) {
        const cfg = {
            brokerUrl: 'http://127.0.0.1:4180', token: '', pools: [], defaultPool: '',
            ttlSec: 300, waitSec: 120, framePrompts: true, sessionGapMs: 6000, model: '', effort: '',
            ...(host.config || {}),
        };
        cfg.pools = Array.isArray(cfg.pools) ? cfg.pools.map((p) => ({ name: p.name || '', count: p.count || 1, description: p.description || '' })) : [];
        root.innerHTML = '';
        const { group, input, toggle, select } = host.ui.form(cfg);
        let live = null; // last status() result

        // ── Setup: Claude Code on this server ──
        root.appendChild(renderSetup(host));

        // ── Connection ──
        const conn = section('Broker connection', 'The claude-broker daemon (see its README). The token is the daemon\'s CLAUDE_BROKER_TOKEN.');
        const row1 = el('div', { className: 'admin-form-row' },
            group('Broker URL', input('brokerUrl', 'text'), 'Usually http://127.0.0.1:4180 on the same server.'),
            group('Token', input('token', 'password')));
        conn.appendChild(row1);
        const row2 = el('div', { className: 'admin-form-row' },
            group('Job TTL (seconds)', input('ttlSec', 'number'), 'A job not answered in this time expires.'),
            group('Wait timeout (seconds)', input('waitSec', 'number'), 'How long a waiting request polls for the answer.'),
            group('Gap between jobs to one session (ms)', input('sessionGapMs', 'number'), 'A job sent while the session\'s previous turn is still open can be refused.'));
        conn.appendChild(row2);
        conn.appendChild(el('div', { className: 'form-group' },
            toggle('framePrompts', 'Frame prompts', 'Adds a "▶ KIND" header and the complete_job instruction to every prompt (recommended).')));
        root.appendChild(conn);

        // ── Pools ──
        const poolsSec = section('Pools', 'A pool is a session label. Its sessions are labelled <name> or <name>-<n> (summary, summary-1, summary-2…). Count = how many sessions you run for it.');
        const poolList = el('div');
        const defaultSel = el('select', { className: 'input', onchange: () => { cfg.defaultPool = defaultSel.value; } });
        const renderDefault = () => {
            defaultSel.innerHTML = '';
            defaultSel.appendChild(el('option', { value: '', text: '(first pool)' }));
            for (const p of cfg.pools) if (p.name) defaultSel.appendChild(el('option', { value: p.name, text: p.name, selected: cfg.defaultPool === p.name }));
            if (typeof fillTestPools === 'function') fillTestPools();
        };
        const statusOf = (name) => live && live.ok && Array.isArray(live.pools) ? live.pools.find((x) => x.name === name) : null;
        const renderPools = () => {
            poolList.innerHTML = '';
            if (!cfg.pools.length) poolList.appendChild(el('p', { className: 'form-help-muted', text: 'No pools yet. Add one, or add an attached session label from the status list below.' }));
            cfg.pools.forEach((p, i) => {
                const st = statusOf(p.name);
                const badge = el('span', {
                    className: 'form-help-muted',
                    style: { minWidth: '11rem', alignSelf: 'center', color: st ? (st.healthy ? '#15803d' : '#b45309') : '' },
                    text: st ? `${st.attached}/${st.expected} attached · ${st.busy} busy` : '—',
                });
                poolList.appendChild(el('div', { className: 'admin-form-row', style: { alignItems: 'flex-start', gap: '0.5rem' } },
                    commitInput(p.name, (v) => { p.name = String(v).trim(); renderDefault(); renderPools(); }, { placeholder: 'name (label)', width: '12rem' }),
                    commitInput(p.count, (v) => { p.count = Math.max(1, Math.round(v) || 1); renderPools(); }, { type: 'number', width: '5rem' }),
                    commitInput(p.description, (v) => { p.description = v; }, { placeholder: 'What this pool is for' }),
                    badge,
                    el('button', { className: 'btn btn-secondary', type: 'button', text: 'Remove', onclick: () => { cfg.pools.splice(i, 1); renderDefault(); renderPools(); } })));
            });
        };
        poolsSec.appendChild(poolList);
        poolsSec.appendChild(el('div', { className: 'form-actions' },
            el('button', { className: 'btn btn-secondary', type: 'button', text: '+ Add pool', onclick: () => { cfg.pools.push({ name: '', count: 1, description: '' }); renderPools(); } })));
        poolsSec.appendChild(group('Default pool', defaultSel, 'Used when a request names no pool.'));
        poolsSec.appendChild(el('div', { className: 'admin-form-row' },
            group('Session model', select('model', ['', 'haiku', 'sonnet', 'opus']), 'Empty = the account default. Applied when sessions (re)start.'),
            group('Session effort', select('effort', ['', 'low', 'medium', 'high', 'xhigh', 'max']), 'Empty = the default.')));
        root.appendChild(poolsSec);

        // ── Save ──
        const saveStatus = el('span', { className: 'form-help-muted', style: { marginLeft: '0.75rem' } });
        const saveBtn = el('button', {
            className: 'btn btn-primary', type: 'button', text: 'Save configuration',
            onclick: async () => {
                saveBtn.disabled = true; saveStatus.textContent = 'Saving…';
                try {
                    const pools = cfg.pools.filter((p) => p.name).map((p) => ({ name: p.name, count: Number(p.count) || 1, description: p.description || '' }));
                    await host.saveConfig({ ...cfg, pools, ttlSec: Number(cfg.ttlSec) || 300, waitSec: Number(cfg.waitSec) || 120, sessionGapMs: Number(cfg.sessionGapMs) || 0 });
                    saveStatus.textContent = 'Saved ✓';
                    refresh();
                } catch (e) { saveStatus.textContent = 'Save failed: ' + ((e && e.message) || e); }
                finally { saveBtn.disabled = false; }
            },
        });
        root.appendChild(el('div', { className: 'form-actions' }, saveBtn, saveStatus));

        // ── Live status ──
        const liveSec = section('Live status', 'Read from the broker (save first after changing the URL or token).');
        const liveBody = el('div');
        const refreshBtn = el('button', { className: 'btn btn-secondary', type: 'button', text: 'Refresh', onclick: () => refresh() });
        liveSec.appendChild(el('div', { className: 'form-actions' }, refreshBtn));
        liveSec.appendChild(liveBody);
        root.appendChild(liveSec);

        async function refresh() {
            refreshBtn.disabled = true;
            liveBody.textContent = 'Checking…';
            live = await action(host, 'status');
            refreshBtn.disabled = false;
            liveBody.innerHTML = '';
            renderPools();
            if (!live.ok) {
                liveBody.appendChild(el('p', { style: { color: '#b91c1c' }, text: live.error || 'Broker unavailable' }));
                return;
            }
            liveBody.appendChild(el('p', { text: `Broker ${live.broker.version || ''} · ${live.broker.sessionCount} session(s) attached.` }));
            const ul = el('ul', { style: { margin: '0.25rem 0 0', paddingLeft: '1.2rem' } });
            for (const p of live.pools) {
                ul.appendChild(el('li', { text: `${p.name}: ${p.attached}/${p.expected} attached, ${p.idle} idle, ${p.busy} busy${p.sessions.length ? ' — ' + p.sessions.map((s) => s.label).join(', ') : ''}` }));
            }
            if (live.pools.length) liveBody.appendChild(ul);
            if (live.unpooled && live.unpooled.length) {
                liveBody.appendChild(el('p', { className: 'form-help-muted', style: { marginTop: '0.75rem' }, text: 'Attached sessions in no pool:' }));
                const wrap = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem' } });
                const bases = [...new Set(live.unpooled.map((s) => String(s.label || '').replace(/-\d+$/, '')).filter(Boolean))];
                for (const b of bases) {
                    const n = live.unpooled.filter((s) => String(s.label || '').replace(/-\d+$/, '') === b).length;
                    wrap.appendChild(el('button', {
                        className: 'btn btn-secondary btn-sm', type: 'button', text: `+ ${b} (${n})`, title: 'Add as a pool',
                        onclick: () => { cfg.pools.push({ name: b, count: n, description: '' }); renderDefault(); renderPools(); },
                    }));
                }
                liveBody.appendChild(wrap);
            }
        }

        // ── Test prompt ──
        const testSec = section('Test prompt', 'Sends a prompt to the chosen pool and waits for the answer (uses the saved configuration).');
        const testPool = el('select', { className: 'input' });
        function fillTestPools() {
            testPool.innerHTML = '';
            for (const p of cfg.pools) if (p.name) testPool.appendChild(el('option', { value: p.name, text: p.name }));
        }
        const testText = el('textarea', { className: 'input', rows: 3, value: 'Reply with the single word: pong' });
        const testOut = el('pre', { style: { whiteSpace: 'pre-wrap', maxHeight: '20rem', overflow: 'auto', fontSize: '0.8rem' } });
        const testBtn = el('button', {
            className: 'btn btn-primary', type: 'button', text: 'Send',
            onclick: async () => {
                testBtn.disabled = true; testOut.textContent = 'Waiting for the answer…';
                const r = await action(host, 'submit', { prompt: testText.value, pool: testPool.value || undefined, wait: true, kind: 'TEST' });
                testBtn.disabled = false;
                testOut.textContent = r.ok
                    ? `${r.job.status}${r.job.timedOut ? ' (still running — timed out waiting)' : ''} · ${r.job.sessionLabel || r.job.sessionId || ''}\n\n${r.job.text || r.job.error || ''}`
                    : `Error: ${r.error}`;
            },
        });
        testSec.appendChild(el('div', { className: 'admin-form-row' }, group('Pool', testPool), group('Prompt', testText)));
        testSec.appendChild(el('div', { className: 'form-actions' }, testBtn));
        testSec.appendChild(testOut);
        root.appendChild(testSec);

        renderDefault();
        renderPools();
        fillTestPools();
        refresh();
    },
};
