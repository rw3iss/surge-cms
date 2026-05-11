/**
 * Tiny string-rendering helpers shared across all per-block-type email
 * renderers. Email HTML rules:
 *   - Inline styles only (no class names, no <style> reliance).
 *   - Table-based outer layout.
 *   - Explicit width/height attrs on images for Outlook.
 *   - Escape any operator-supplied text (rich_text + html are explicit
 *     exceptions; they get sanitized via the existing util).
 *   - swatch:{id} refs resolve to literal hex via the palette in
 *     EmailRenderCtx (no `var()` survives — most clients drop it).
 */
import type { EmailBlockNode, EmailRenderCtx, } from './index';

export function escapeHtml(s: string,): string {
    return s.replace(/[&<>"']/g, (c,) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    } as Record<string, string>)[c]!,);
}

export function inlineStyle(obj: Record<string, string | number | undefined>,): string {
    return Object.entries(obj,)
        .filter(([, v,],) => v !== undefined && v !== '' && v !== null,)
        .map(([k, v,],) => `${k}:${v}`,)
        .join(';',);
}

/** Convert an HTTP-ish URL relative path into an absolute URL anchored
 *  at the site root, for email-client clients that don't follow
 *  relative links. */
export function absUrl(siteUrl: string, link: string,): string {
    if (!link) return siteUrl || '#';
    if (/^https?:\/\//i.test(link,)) return link;
    if (!siteUrl) return link;
    return siteUrl.replace(/\/+$/, '',) + (link.startsWith('/',) ? link : `/${link}`);
}

/**
 * Resolve a stored color value (raw hex, `swatch:{id}`, empty,
 * `none`, `transparent`) to a literal CSS color string for email.
 * `var(--swatch-...)` is unsafe in email — most clients drop CSS
 * variables — so swatches get baked to their palette hex at render
 * time.
 */
export function resolveColorForEmail(
    value: string | null | undefined,
    palette: Record<string, string>,
    fallback: string,
): string {
    if (!value || value === 'none' || value === 'transparent') return fallback;
    if (typeof value === 'string' && value.startsWith('swatch:',)) {
        const id = value.slice('swatch:'.length,);
        return palette[id] ?? fallback;
    }
    return value;
}

/**
 * Translate a block's persisted `style` JSONB (plus a few `settings`
 * fallbacks the public renderer honours) into a CSS-property record
 * suitable for the wrapping `<td>` inline `style` attribute. The
 * renderNode orchestration in `index.ts` merges this with any
 * renderer-supplied per-cell style overrides.
 */
export function cellStyleFromBlock(
    node: EmailBlockNode,
    ctx: EmailRenderCtx,
): Record<string, string> {
    const s = (node.style ?? {}) as Record<string, unknown>;
    const settings = (node.settings ?? {}) as Record<string, unknown>;
    const out: Record<string, string> = {};

    // Padding: explicit style.padding > settings.padding > site default.
    const explicitPadding = (s.padding as string | undefined) ?? (settings.padding as string | undefined);
    if (explicitPadding) {
        out.padding = explicitPadding;
    } else if (settings.useDefaultPadding !== false) {
        // Email-safe default — operators can override per-block by
        // setting padding to '' to suppress it.
        out.padding = '16px';
    }

    // Margin. Single-value gets `auto` on the sides for centering, same
    // as the public renderer.
    const margin = s.margin as string | undefined;
    if (margin) {
        const parts = margin.trim().split(/\s+/,);
        out.margin = parts.length === 1 && margin !== 'auto' ? `${margin} auto` : margin;
    }

    // Background.
    const bg = (s.backgroundColor as string | undefined) ?? (settings.backgroundColor as string | undefined);
    const resolvedBg = resolveColorForEmail(bg, ctx.palette, '',);
    if (resolvedBg) out['background-color'] = resolvedBg;

    // Text color.
    const fg = (s.textColor as string | undefined) ?? (settings.textColor as string | undefined);
    const resolvedFg = resolveColorForEmail(fg, ctx.palette, '',);
    if (resolvedFg) out.color = resolvedFg;

    // Text align.
    if (s.textAlign) out['text-align'] = String(s.textAlign,);

    // Font size.
    if (s.fontSize) out['font-size'] = String(s.fontSize,);

    // Vertical sizing.
    if (s.width) out.width = String(s.width,);
    if (s.height) out.height = String(s.height,);

    // Vertical-align inside cell (top by default; explicit override only).
    if (s.verticalAlign && s.verticalAlign !== 'top') {
        out['vertical-align'] = String(s.verticalAlign,);
    }

    return out;
}
