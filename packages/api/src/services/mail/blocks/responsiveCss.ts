/**
 * Per-breakpoint responsive CSS for the email renderer. Content blocks store
 * `style.breakpoints = { [breakpointId]: { prop: value } }` override bags (see
 * BlockStyle.breakpoints). The base style renders inline on each cell; this
 * builds a head `<style>` of `@media` rules that override those inline defaults
 * inside each configured breakpoint's media query, scoped to one block via
 * `[data-block-id="…"]` (added by renderNode). `!important` beats the inline base.
 *
 * Email-client support for `<style>` + media queries is partial (Apple Mail /
 * iOS honor it; Gmail app supports media queries; some clients strip it), so
 * this is a progressive enhancement over the always-correct inline base styles.
 */
import { breakpointMediaCondition, scopeCss, type SiteBreakpoint, } from '@sitesurge/types';
import { resolveColorForEmail, } from './_util';
import { importantify, planCustomCss, } from './customCss';

interface BlockLike {
    id: string;
    blockType: string;
    style?: Record<string, unknown>;
}

/** Box props that, for an image block, must constrain the <img>, not the cell. */
const BOX_PROPS = new Set(['max-width', 'width', 'height',],);

/** Map one override bag → CSS declarations (same subset as cellStyleFromBlock). */
function overrideToDecls(ov: Record<string, unknown>, palette: Record<string, string>,): Record<string, string> {
    const out: Record<string, string> = {};
    if (ov.padding != null && ov.padding !== '') out.padding = String(ov.padding,);
    if (ov.margin != null && ov.margin !== '') {
        const parts = String(ov.margin,).trim().split(/\s+/,);
        out.margin = parts.length === 1 && ov.margin !== 'auto' ? `${ov.margin} auto` : String(ov.margin,);
    }
    const bg = resolveColorForEmail(ov.backgroundColor as string | undefined, palette, '',);
    if (bg) out['background-color'] = bg;
    const fg = resolveColorForEmail(ov.textColor as string | undefined, palette, '',);
    if (fg) out.color = fg;
    if (ov.textAlign) out['text-align'] = String(ov.textAlign,);
    if (ov.fontSize) out['font-size'] = String(ov.fontSize,);
    if (ov.width) out.width = String(ov.width,);
    if (ov.height) out.height = String(ov.height,);
    if (ov.maxWidth) out['max-width'] = String(ov.maxWidth,);
    if (ov.borderRadius) out['border-radius'] = String(ov.borderRadius,);
    return out;
}

export function buildEmailResponsiveCss(
    blocks: BlockLike[],
    breakpoints: SiteBreakpoint[],
    palette: Record<string, string>,
): string {
    const bpById = new Map(breakpoints.map((b,) => [b.id, b,] as const),);
    // media condition → rule strings (grouped so each breakpoint is one @media).
    const byCond = new Map<string, string[]>();
    // Unconditional rules (a block's base Custom CSS that could not be inlined).
    const base: string[] = [];

    for (const b of blocks) {
        const style = b.style as {
            customCss?: string;
            breakpoints?: Record<string, Record<string, unknown>>;
        } | undefined;

        /*
         * Whatever of the block's Custom CSS could NOT be inlined onto an
         * element (descendant selectors, pseudo-classes, the operator's own
         * media queries). `renderNode` already inlined the rest; this is the
         * remainder, and it is best-effort by nature — see `customCss.ts`.
         */
        const leftover = planCustomCss(style?.customCss, `[data-block-id="${b.id}"]`,).stylesheet;
        if (leftover) base.push(importantify(leftover,),);

        const bps = style?.breakpoints;
        if (!bps) continue;
        for (const [bpId, override,] of Object.entries(bps,)) {
            const bp = bpById.get(bpId,);
            if (!bp || !override || typeof override !== 'object') continue;
            const cond = breakpointMediaCondition(bp,);
            if (!cond) continue;

            const sel = `[data-block-id="${b.id}"]`;

            /*
             * The breakpoint's own Custom CSS. Nothing about it can be inlined
             * — an inline style carries no media condition — so the ENTIRE
             * sheet goes here, including the parts that would have been
             * inlined at the base level.
             */
            const bpCustom = (override as { customCss?: string; }).customCss;
            if (typeof bpCustom === 'string' && bpCustom.trim()) {
                const scoped = importantify(scopeCss(bpCustom, sel,),);
                if (scoped) {
                    const arr = byCond.get(cond,) ?? [];
                    arr.push(scoped,);
                    byCond.set(cond, arr,);
                }
            }

            const decls = overrideToDecls(override, palette,);
            const keys = Object.keys(decls,);
            if (!keys.length) continue;

            const isImage = b.blockType === 'image' || b.blockType === 'gallery';
            const cellDecls: string[] = [];
            const imgDecls: string[] = [];
            for (const k of keys) {
                const decl = `${k}:${decls[k]} !important`;
                if (isImage && BOX_PROPS.has(k,)) imgDecls.push(decl,);
                else cellDecls.push(decl,);
            }
            const rules: string[] = [];
            if (cellDecls.length) rules.push(`${sel}{${cellDecls.join(';',)}}`,);
            if (imgDecls.length) rules.push(`${sel} img{${imgDecls.join(';',)};width:100% !important}`,);

            const arr = byCond.get(cond,) ?? [];
            arr.push(...rules,);
            byCond.set(cond, arr,);
        }
    }

    if (!byCond.size && !base.length) return '';
    // Unconditional rules first, so a breakpoint's @media still overrides them.
    const css = base.join('',) +
        Array.from(byCond.entries(),)
            .map(([cond, rules,],) => `@media ${cond}{${rules.join('',)}}`)
            .join('',);
    return `<style type="text/css">${css}</style>\n`;
}
