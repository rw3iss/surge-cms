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

export default {
    async mountConfig(root, host) {
        const cfg = {
            brokerUrl: 'http://127.0.0.1:4180', token: '', pools: [], defaultPool: '',
            ttlSec: 300, waitSec: 120, framePrompts: true, sessionGapMs: 6000,
            ...(host.config || {}),
        };
        cfg.pools = Array.isArray(cfg.pools) ? cfg.pools.map((p) => ({ name: p.name || '', count: p.count || 1, description: p.description || '' })) : [];
        root.innerHTML = '';
        const { group, input, toggle } = host.ui.form(cfg);
        let live = null; // last status() result

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
