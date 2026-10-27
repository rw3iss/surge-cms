// PageLoop plugin — framework-agnostic browser client (plain ESM, no build step).
// mountWidget: loads the same-origin UMD widget bundle (downloaded by install())
// and calls PageLoop.init() with the saved config.
// mountConfig: a plugin-provided config page (vanilla DOM), demonstrating the
// custom config-page capability of the plugin API.

const ASSET_BASE = '/api/v1/plugins/pageloop/assets';

function loadBundle(version) {
    // Cache-bust the bundle URL with the plugin version so an update (which
    // re-fetches the vendor bundle at the SAME asset path) reliably reaches
    // every browser instead of serving a stale cached copy.
    const v = version ? `?v=${encodeURIComponent(version)}` : '';
    if (window.PageLoop) return Promise.resolve(window.PageLoop);
    return new Promise((resolve, reject) => {
        if (!document.querySelector('link[data-pageloop]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `${ASSET_BASE}/vanilla.css${v}`;
            link.setAttribute('data-pageloop', '1');
            document.head.appendChild(link);
        }
        const existing = document.querySelector('script[data-pageloop]');
        if (existing) {
            existing.addEventListener('load', () => resolve(window.PageLoop));
            existing.addEventListener('error', () => reject(new Error('PageLoop bundle failed to load')));
            if (window.PageLoop) resolve(window.PageLoop);
            return;
        }
        const s = document.createElement('script');
        s.src = `${ASSET_BASE}/pageloop.umd.js${v}`;
        s.async = true;
        s.setAttribute('data-pageloop', '1');
        s.onload = () => resolve(window.PageLoop);
        s.onerror = () => reject(new Error('PageLoop bundle not found — run Install first'));
        document.head.appendChild(s);
    });
}

// At most one live PageLoop widget across the whole app. The bundle is a
// singleton (window.PageLoop) and injects its UI into <body>, so a second
// init() would spawn a duplicate toolbar. This module-scoped guard makes an
// accidental second mount a no-op — belt-and-suspenders on top of the host
// only rendering this widget once.
let activeInstance = null;

export default {
    async mountWidget(el, host) {
        const cfg = host.config || {};
        if (!cfg.endpoint || !cfg.projectId) return; // not configured yet
        if (activeInstance) return;                   // already live — never duplicate
        let instance = null;
        let unmounted = false;
        // The PageLoop instance has stop() (async; unmounts its toolbar/sidebar),
        // not destroy() — calling only destroy() left the widget on screen.
        const stopInstance = (inst) => {
            try {
                if (inst && typeof inst.stop === 'function') void inst.stop();
                else if (inst && typeof inst.destroy === 'function') inst.destroy();
            } catch (_) { /* noop */ }
            if (activeInstance === inst) activeInstance = null;
        };
        // Registered BEFORE the async load: an unmount during it (e.g. signing
        // out / switching user) must still tear the widget down.
        host.onCleanup(() => {
            unmounted = true;
            stopInstance(instance);
        });
        try {
            const PageLoop = await loadBundle(host && host.version);
            if (!PageLoop || typeof PageLoop.init !== 'function' || unmounted) return;
            if (activeInstance) return;                // lost an init race — bail
            instance = PageLoop.init({
                endpoint: cfg.endpoint,
                projectId: cfg.projectId,
                debug: false,
                ui: {
                    theme: cfg.theme || 'auto',
                    toolbarPosition: cfg.toolbarPosition || 'top',
                    sidebarPosition: cfg.sidebarPosition || 'right',
                },
            });
            activeInstance = instance;
            if (unmounted) stopInstance(instance);     // unmounted while initialising
        } catch (err) {
            console.warn('[pageloop] widget init failed:', err && err.message);
        }
    },

    async mountConfig(el, host) {
        const cfg = {
            installType: 'remote', endpoint: 'https://pageloop.dev', projectId: '',
            publicComments: false, visibleRoles: [], theme: 'auto',
            toolbarPosition: 'top', sidebarPosition: 'right',
            ...(host.config || {}),
        };
        // Migrate the old "Show only to signed-in admins" switch to the role list.
        if (cfg.adminOnly === true && (!Array.isArray(cfg.visibleRoles) || !cfg.visibleRoles.length)) {
            cfg.visibleRoles = ['admin', 'sysadmin'];
        }
        cfg.adminOnly = false;
        const roleOptions = typeof host.listRoles === 'function' ? await host.listRoles() : [];
        el.innerHTML = '';

        // Admin-styled form builders provided by the host (bound to `cfg`).
        const { group, input, checkbox, select, roles, toggle } = host.ui.form(cfg);

        el.appendChild(group('Storage mode', select('installType', ['remote', 'local-sqlite']), 'remote: a hosted/self-hosted PageLoop server. local-sqlite: a locally-run PageLoop server (pageloop go).'));
        el.appendChild(group('PageLoop server endpoint', input('endpoint', 'url'), 'The PageLoop backend for comments + the widget bundle.'));
        el.appendChild(group('Project ID / slug', input('projectId'), 'The PageLoop project this site maps to.'));
        el.appendChild(group('Theme', select('theme', ['auto', 'light', 'dark'])));
        el.appendChild(group('Toolbar position', select('toolbarPosition', ['top', 'bottom'])));
        el.appendChild(group('Sidebar position', select('sidebarPosition', ['right', 'left'])));

        // Switch first, then its label (the admin Toggle); older hosts lack `toggle`.
        if (typeof toggle === 'function') {
            const pc = document.createElement('div'); pc.className = 'form-group';
            pc.appendChild(toggle('publicComments', 'Allow public commenting', 'If off, only signed-in users may comment.'));
            el.appendChild(pc);
        } else {
            const pc = group('Allow public commenting', checkbox('publicComments'), 'If off, only signed-in users may comment.');
            pc.classList.add('form-group--inline'); el.appendChild(pc);
        }
        if (typeof roles === 'function') {
            el.appendChild(group(
                'Show the widget to these roles',
                roles('visibleRoles', roleOptions),
                'The widget loads only for signed-in users with at least one of these roles (main or extra role). None chosen = every visitor.',
            ));
        } else {
            // An older CMS host without the role picker: keep the admins-only switch.
            cfg.adminOnly = (host.config || {}).adminOnly === true;
            const ao = group('Show only to signed-in admins', checkbox('adminOnly'), 'When on, the widget renders only for logged-in admins; otherwise for everyone.');
            ao.classList.add('form-group--inline'); el.appendChild(ao);
        }

        const status = document.createElement('div'); status.className = 'text-muted text-sm'; status.style.marginTop = '.5em';

        const actions = document.createElement('div'); actions.className = 'form-actions';
        const saveBtn = document.createElement('button'); saveBtn.className = 'btn btn-primary'; saveBtn.textContent = 'Save configuration';
        saveBtn.addEventListener('click', async () => {
            saveBtn.disabled = true; status.textContent = 'Saving…';
            try { await host.saveConfig(cfg); status.textContent = 'Saved ✓'; }
            catch (e) { status.textContent = 'Save failed: ' + (e && e.message); }
            finally { saveBtn.disabled = false; }
        });
        const testBtn = document.createElement('button'); testBtn.className = 'btn btn-secondary'; testBtn.textContent = 'Test connection';
        testBtn.addEventListener('click', async () => {
            status.textContent = 'Testing…';
            try {
                const res = await fetch(String(cfg.endpoint).replace(/\/$/, '') + '/health', { mode: 'cors' });
                status.textContent = res.ok ? 'Connected ✓' : `Endpoint responded ${res.status}`;
            } catch (e) { status.textContent = 'Could not reach endpoint (CORS or offline): ' + (e && e.message); }
        });
        actions.appendChild(saveBtn); actions.appendChild(testBtn);
        el.appendChild(actions); el.appendChild(status);
    },
};
