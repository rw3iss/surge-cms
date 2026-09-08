/**
 * Mounting a component's client module.
 *
 * Shared by the public `template` block and the component EDITOR, so what an
 * operator sees while authoring is what visitors get. Without this the editor
 * rendered the component's blocks as inert markup: a component whose layout is
 * produced by its script (a ticker, a carousel, anything measured) looked
 * broken in the one place you'd go to fix it.
 *
 * Loaded as a REAL same-origin ES module rather than an inline <script>,
 * because CSP is `script-src 'self'` with no `'unsafe-inline'` — an inline
 * script, and an inline onclick, are both blocked. The endpoint always returns
 * valid JS (an empty `mount` when there is no script), so the import can't
 * throw on a healthy page.
 */
import { cms, } from './cmsClient';
import { siteSettings, } from '../stores/siteSettings';

export interface ComponentScriptCtx {
    /** The component whose `client.js` to load. */
    templateId: string;
    /** Element WRAPPING the rendered blocks — the script queries into it. */
    el: HTMLElement;
    /** The using block's settings; `{}` in the editor, where there is none. */
    blockSettings?: Record<string, unknown>;
    /** Signed-in user, or null. */
    user?: unknown;
}

/**
 * Load and mount the module. Returns the teardown the module handed back (or a
 * no-op), so the caller can dispose it.
 *
 * Never throws: a broken component must not break the page it is on — the same
 * contract the plugin widget host holds.
 */
export async function mountComponentScript(
    ctx: ComponentScriptCtx,
): Promise<() => void> {
    try {
        const mod = await import(
            /* @vite-ignore */ `/api/v1/components/templates/${ctx.templateId}/client.js`
        );
        if (typeof mod.mount !== 'function') return () => {};
        const ret = mod.mount(ctx.el, {
            cms,
            user: ctx.user ?? null,
            settings: siteSettings() ?? {},
            block: ctx.blockSettings ?? {},
        },);
        return typeof ret === 'function' ? ret : () => {};
    } catch (err) {
        console.warn('[components] script failed to mount', err,);
        return () => {};
    }
}
