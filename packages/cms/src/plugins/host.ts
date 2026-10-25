/**
 * Client-side plugin host contract. Plugins are FRAMEWORK-AGNOSTIC: their
 * browser bundle default-exports `{ mountWidget?, mountConfig? }` and mounts
 * into a plain DOM element, receiving a host context object. This keeps plugins
 * isolated from the host's Solid runtime/context singleton (and portable if the
 * CMS ever moves off SolidJS).
 */
import type { PublicPlugin } from '@sitesurge/types';
import { cms } from '../services/cmsClient';

export interface PluginHost {
    name: string;
    /** The plugin's version (from its manifest). Handy for cache-busting the
     *  plugin's own assets so an update reliably reaches every browser. */
    version: string;
    /** Current plugin config (public subset for widgets; full for config pages). */
    config: Record<string, unknown>;
    /** Public site settings snapshot. */
    settings: Record<string, unknown>;
    user: { id: string; role: string } | null;
    isAdmin: boolean;
    /** Persist a config patch (admin config pages only; no-op for public widgets). */
    saveConfig(patch: Record<string, unknown>): Promise<void>;
    /** Scoped fetch to this plugin's backend routes (/api/v1/plugins/:name/*). */
    api: {
        get(path: string): Promise<unknown>;
        post(path: string, body?: unknown): Promise<unknown>;
    };
    /** The element the plugin renders into. */
    mountPoint: HTMLElement;
    /** Register teardown; the host calls these on unmount. */
    onCleanup(fn: () => void): void;
    /** Host-provided config-form DOM builders — a framework-agnostic way for a
     *  `mountConfig` page to render admin-styled fields WITHOUT each plugin
     *  redefining the same `group`/`input`/`select`/`checkbox` helpers. Bind
     *  them to the config object being edited: `const { input } = host.ui.form(cfg)`.
     *  The `input`/`select`/`checkbox` builders read + two-way-bind `cfg[key]`. */
    ui: {
        form(cfg: Record<string, unknown>): PluginFormBuilders;
    };
    /** The site's roles (built-in + custom) for a role picker — admin config
     *  pages only (the endpoint is admin-gated); [] when unavailable. */
    listRoles(): Promise<Array<{ key: string; label: string; }>>;
}

/** DOM builders returned by `host.ui.form(cfg)`. Match the admin form styling
 *  (`.form-group`/`.input`/`.form-help-muted`). */
export interface PluginFormBuilders {
    /** A labelled `.form-group` wrapping `control`, with optional muted help text. */
    group(labelText: string, control: HTMLElement, help?: string): HTMLElement;
    /** A text/password/url `<input>` two-way-bound to `cfg[key]`. */
    input(key: string, type?: string): HTMLInputElement;
    /** A `<select>` of string options two-way-bound to `cfg[key]`. */
    select(key: string, options: string[]): HTMLSelectElement;
    /** A checkbox two-way-bound to `cfg[key]` (boolean). */
    checkbox(key: string): HTMLInputElement;
    /** A list of role checkboxes two-way-bound to `cfg[key]` (string[] of role keys).
     *  Pass the roles from `host.listRoles()`. */
    roles(key: string, roles: Array<{ key: string; label: string; }>): HTMLElement;
}

/** A plugin's browser module (default export). */
export interface PluginClientModule {
    mountWidget?(el: HTMLElement, host: PluginHost): void | (() => void);
    mountConfig?(el: HTMLElement, host: PluginHost): void | (() => void);
}

const moduleCache = new Map<string, Promise<PluginClientModule>>();

/**
 * Dynamically import a plugin's ESM bundle. Same-origin (served by the backend
 * at /api/v1/plugins/:name/client.js) so it satisfies the `scriptSrc 'self'`
 * CSP. `@vite-ignore` keeps the bundler from trying to resolve it at build time.
 */
export function loadPluginModule(clientUrl: string): Promise<PluginClientModule> {
    let p = moduleCache.get(clientUrl);
    if (!p) {
        p = import(/* @vite-ignore */ clientUrl).then(
            (m) => ((m as { default?: PluginClientModule }).default ?? m) as PluginClientModule,
        );
        moduleCache.set(clientUrl, p);
    }
    return p;
}

/** Build a PluginHost around a mounted plugin. */
export function buildHost(opts: {
    name: string;
    version?: string;
    config: Record<string, unknown>;
    settings: Record<string, unknown>;
    user: { id: string; role: string } | null;
    isAdmin: boolean;
    mountPoint: HTMLElement;
    cleanups: Array<() => void>;
    saveConfig?: (patch: Record<string, unknown>) => Promise<void>;
}): PluginHost {
    const base = `/api/v1/plugins/${opts.name}`;
    const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
        // State-changing requests (admin action dispatch) need the CSRF header
        // matching the csrf-token cookie — cookie-auth POSTs are rejected without
        // it. Read it off the cookie (the SPA session already set it).
        const headers: Record<string, string> = body ? { 'Content-Type': 'application/json' } : {};
        if (method !== 'GET' && method !== 'HEAD') {
            const m = typeof document !== 'undefined' && document.cookie.match(/(?:^|; )csrf-token=([^;]+)/);
            if (m) headers['x-csrf-token'] = decodeURIComponent(m[1]);
        }
        const res = await fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
            method,
            credentials: 'include',
            headers: Object.keys(headers).length ? headers : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        const json = await res.json().catch(() => ({}));
        return (json as { data?: unknown }).data ?? json;
    };
    return {
        name: opts.name,
        version: opts.version ?? '',
        config: opts.config,
        settings: opts.settings,
        user: opts.user,
        isAdmin: opts.isAdmin,
        mountPoint: opts.mountPoint,
        saveConfig: opts.saveConfig ?? (async () => { /* read-only host */ }),
        api: {
            get: (path) => call('GET', path),
            post: (path, b) => call('POST', path, b),
        },
        onCleanup: (fn) => opts.cleanups.push(fn),
        ui: { form: makeFormBuilders },
        listRoles: async () => {
            try {
                // 'anonymous' is never a signed-in user's role, so it could never match.
                return (await cms.roles.list()).filter((r) => r.key !== 'anonymous').map((r) => ({ key: r.key, label: r.label || r.key }));
            } catch {
                return [];
            }
        },
    };
}

/** Admin-styled, framework-agnostic config-form DOM builders bound to `cfg`.
 *  Shared by all plugins' `mountConfig` pages via `host.ui.form(cfg)` so they no
 *  longer each redefine these. */
function makeFormBuilders(cfg: Record<string, unknown>): PluginFormBuilders {
    return {
        group(labelText, control, help) {
            const g = document.createElement('div');
            g.className = 'form-group';
            const l = document.createElement('label');
            l.textContent = labelText;
            g.appendChild(l);
            if (help) {
                const h = document.createElement('div');
                h.className = 'form-help-muted';
                h.textContent = help;
                g.appendChild(h);
            }
            g.appendChild(control);
            return g;
        },
        input(key, type) {
            const i = document.createElement('input');
            i.className = 'input';
            i.type = type ?? 'text';
            i.value = cfg[key] != null ? String(cfg[key]) : '';
            i.addEventListener('input', () => { cfg[key] = i.value; });
            return i;
        },
        select(key, options) {
            const sel = document.createElement('select');
            sel.className = 'input';
            for (const o of options) {
                const opt = document.createElement('option');
                opt.value = o;
                opt.textContent = o;
                if (cfg[key] === o) opt.selected = true;
                sel.appendChild(opt);
            }
            sel.addEventListener('change', () => { cfg[key] = sel.value; });
            return sel;
        },
        checkbox(key) {
            const i = document.createElement('input');
            i.type = 'checkbox';
            i.checked = cfg[key] === true;
            i.addEventListener('change', () => { cfg[key] = i.checked; });
            return i;
        },
        roles(key, roles) {
            // Selection (which roles are included), so checkboxes — one per role.
            const wrap = document.createElement('div');
            wrap.className = 'plugin-roles';
            const chosen = (): string[] => (Array.isArray(cfg[key]) ? (cfg[key] as unknown[]).filter((x): x is string => typeof x === 'string') : []);
            for (const r of roles) {
                const l = document.createElement('label');
                l.className = 'plugin-roles__item';
                const i = document.createElement('input');
                i.type = 'checkbox';
                i.value = r.key;
                i.checked = chosen().includes(r.key);
                i.addEventListener('change', () => {
                    const next = new Set(chosen());
                    if (i.checked) next.add(r.key); else next.delete(r.key);
                    cfg[key] = [...next];
                });
                const t = document.createElement('span');
                t.textContent = r.label;
                l.append(i, t);
                wrap.appendChild(l);
            }
            if (!roles.length) {
                const none = document.createElement('div');
                none.className = 'form-help-muted';
                none.textContent = 'Roles could not be loaded.';
                wrap.appendChild(none);
            }
            return wrap;
        },
    };
}

export type { PublicPlugin };
