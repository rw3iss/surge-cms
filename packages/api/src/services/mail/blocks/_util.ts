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

export { escapeHtml, } from '../../../utils/html';

export function inlineStyle(obj: Record<string, string | number | undefined>,): string {
    return Object.entries(obj,)
        .filter(([, v,],) => v !== undefined && v !== '' && v !== null)
        .map(([k, v,],) => `${k}:${v}`)
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

    // Sizing. (Image blocks apply maxWidth to the <img> itself; here it caps
    // the cell for other block types.)
    if (s.width) out.width = String(s.width,);
    if (s.height) out.height = String(s.height,);
    if (s.maxWidth && node.blockType !== 'image' && node.blockType !== 'gallery') {
        out['max-width'] = String(s.maxWidth,);
    }

    // Vertical-align inside cell (top by default; explicit override only).
    if (s.verticalAlign && s.verticalAlign !== 'top') {
        out['vertical-align'] = String(s.verticalAlign,);
    }

    /*
     * Border radius. Honoured by Apple Mail, iOS Mail, Gmail (web + apps) and
     * Outlook.com; Outlook for Windows renders with Word, which has no notion
     * of a rounded box and squares the corner off. That is a clean degradation
     * — the block is still the right size, colour and position — so it is
     * emitted rather than withheld.
     *
     * The web renderer pairs a radius with `overflow:hidden` to clip whatever
     * is painted inside it. There is no point doing that here: `overflow` on a
     * table cell is not something email clients implement, so it would be dead
     * weight in every message. Instead, the renderers whose visible box IS a
     * media element put the radius on that element — see `mediaRadius`.
     */
    if (s.borderRadius) out['border-radius'] = String(s.borderRadius,);

    return out;
}

/**
 * The radius for a media element that FILLS its block — a social thumbnail, an
 * image, a video poster, a carousel still.
 *
 * On the web these are clipped by the block wrapper's `border-radius` plus the
 * `overflow: hidden` that comes with it. Email has neither: `overflow` does
 * nothing on a table cell, and the cell has no background of its own, so a
 * radius there is invisible while the square image sits on top of it. The
 * operator sets Border Radius, the site rounds the picture, and the email does
 * not — which reads as the setting being broken.
 *
 * So the block's radius is pushed onto the element that is actually visible.
 * `fallback` keeps each renderer's existing default for blocks that set none,
 * so an untouched email is unchanged.
 */
export function mediaRadius(
    node: EmailBlockNode,
    fallback?: string,
): string | undefined {
    const own = (node.style as { borderRadius?: unknown; } | undefined)?.borderRadius;
    return typeof own === 'string' && own.trim() ? own.trim() : fallback;
}

/**
 * `mediaRadius` as a style FRAGMENT, ready to append to a style string.
 *
 * Every media renderer needs the same conditional — a radius or nothing — and
 * each had written its own `radius ? ';border-radius:' + radius : ''`. Four
 * copies of a string concatenation is four chances to drop or double a `;`,
 * and an image block was calling `mediaRadius` twice in one expression to
 * avoid a local. Returns the LEADING separator, so callers append it to an
 * existing declaration list without thinking about punctuation.
 */
export function mediaRadiusCss(
    node: EmailBlockNode,
    fallback?: string,
): string {
    const r = mediaRadius(node, fallback,);
    return r ? `;border-radius:${r}` : '';
}
