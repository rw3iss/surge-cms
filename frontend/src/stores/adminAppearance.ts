import { createSignal, } from 'solid-js';
import { fetchAdminAppearance, } from '../services/api';
import { colorCssValue, } from './../services/colorResolver';

/**
 * Admin-chrome color tokens.
 *
 * Loaded once per session into a module-level signal, then read by
 * AdminLayout to drive `--admin-*` CSS custom properties. The
 * Settings → Admin tab calls `reloadAdminAppearance()` after a
 * successful save so the chrome updates immediately without a reload.
 *
 * Each field is optional; SCSS uses `var(--admin-x, fallback)` so
 * unset values keep the static default theme. That's why the wire
 * shape is a partial — operators don't have to fill every field.
 */

export interface AdminAppearance {
    sidebarBg?: string;
    sidebarText?: string;
    pageBg?: string;
    pageText?: string;
    panelBg?: string;
    /** Text color inside panels (cards, dashboard sections, tables, etc).
     * Falls back to `pageText` when unset. */
    panelText?: string;
    /** Border color used by panels (cards, theme-section blocks, etc).
     * Falls back to the static neutral grey when unset. */
    panelBorder?: string;
    /** Background color applied to inputs / selects / textareas globally
     * inside the admin chrome. */
    inputBg?: string;
    /** Text color inside inputs / selects / textareas globally inside
     * the admin chrome. */
    inputText?: string;
}

const [adminAppearance, setAdminAppearance,] = createSignal<AdminAppearance | null>(null,);
let loadPromise: Promise<AdminAppearance | null> | null = null;

export function loadAdminAppearance(): Promise<AdminAppearance | null> {
    if (adminAppearance()) return Promise.resolve(adminAppearance(),);
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        try {
            const r = await fetchAdminAppearance();
            const data = (r.success && r.data) ? r.data as AdminAppearance : {};
            setAdminAppearance(data,);
            return data;
        } catch {
            setAdminAppearance({},);
            return null;
        }
    })();
    return loadPromise;
}

/** Force-refresh after a save. */
export async function reloadAdminAppearance(): Promise<AdminAppearance | null> {
    loadPromise = null;
    setAdminAppearance(null,);
    return loadAdminAppearance();
}

export { adminAppearance, };

/**
 * Translate `AdminAppearance` into the inline-style object that drives
 * `--admin-*` CSS custom properties on the admin root. Mirrors the
 * pattern used by `appearanceCssVars()` for the public site, but
 * scoped to admin-chrome tokens.
 */
export function adminAppearanceCssVars(a: AdminAppearance | null,): Record<string, string> {
    const s: Record<string, string> = {};
    if (!a) return s;
    // Each color may be a raw hex OR `swatch:{id}` — `colorCssValue`
    // collapses both into a CSS-ready expression so palette edits
    // propagate without re-saving the admin appearance row.
    const apply = (key: string, value: string | undefined,) => {
        if (!value) return;
        const css = colorCssValue(value, '',);
        if (css) s[key] = css;
    };
    apply('--admin-sidebar-bg', a.sidebarBg,);
    apply('--admin-sidebar-text', a.sidebarText,);
    apply('--admin-page-bg', a.pageBg,);
    apply('--admin-page-text', a.pageText,);
    apply('--admin-panel-bg', a.panelBg,);
    apply('--admin-panel-text', a.panelText,);
    apply('--admin-panel-border', a.panelBorder,);
    apply('--admin-input-bg', a.inputBg,);
    apply('--admin-input-text', a.inputText,);
    return s;
}
