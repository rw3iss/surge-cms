/**
 * Single source of truth for "this is what the email looks like".
 *
 * Walks a flat block list, builds the tree, applies per-block renderers,
 * wraps the result in a standard email boilerplate (table-based, 600px
 * centered, inline styles only). Variable tokens (`{{...}}`) are
 * preserved in the output so per-recipient substitution can happen
 * at send time.
 *
 * Used by:
 *   - `POST /admin/mail-templates/preview` for the editor's iframe
 *     preview, with sample variables substituted before responding.
 *   - The send worker, which calls this once per job and substitutes
 *     per-recipient variables over the result before each send.
 */
import type { SiteBreakpoint, } from '@sitesurge/types';
import { detectVariables, } from './variables';
import { EmailBlockNode, EmailRenderCtx, renderNode, } from './blocks';
import { buildEmailResponsiveCss, } from './blocks/responsiveCss';
import { wrapEmailShell, } from './shell';

export interface FlatBlock {
    /** Required at render time. Preview accepts blocks without IDs and
     *  the route synthesizes a placeholder before calling render. */
    id: string;
    parentBlockId?: string | null;
    blockType: string;
    position: number;
    settings?: Record<string, unknown>;
    style?: Record<string, unknown>;
}

export interface RenderInput {
    blocks: FlatBlock[];
    subject: string;
    preheader?: string;
    siteName: string;
    siteUrl: string;
    palette: Record<string, string>;
    fontFamily?: string;
    textColor?: string;
    bgColor?: string;
    linkColor?: string;
    /** Named responsive breakpoints — emit an `@media` rule per block override. */
    breakpoints?: SiteBreakpoint[];
}

export interface RenderResult {
    html: string;
    subject: string;
    preheader?: string;
    detectedVariables: string[];
}

function buildTree(blocks: FlatBlock[],): EmailBlockNode[] {
    const byParent = new Map<string | null, FlatBlock[]>();
    for (const b of blocks) {
        const key = b.parentBlockId ?? null;
        const arr = byParent.get(key,) ?? [];
        arr.push(b,);
        byParent.set(key, arr,);
    }
    for (const arr of byParent.values()) {
        arr.sort((a, b,) => (a.position ?? 0) - (b.position ?? 0),);
    }
    const toNode = (b: FlatBlock,): EmailBlockNode => ({
        id: b.id,
        blockType: b.blockType,
        settings: b.settings ?? {},
        style: b.style ?? {},
        children: (byParent.get(b.id,) ?? []).map(toNode,),
    });
    return (byParent.get(null,) ?? []).map(toNode,);
}

export function renderMailHtml(input: RenderInput,): RenderResult {
    const ctx: EmailRenderCtx = {
        siteName: input.siteName,
        siteUrl: input.siteUrl,
        palette: input.palette,
        fontFamily: input.fontFamily ?? 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        textColor: input.textColor ?? '#333333',
        bgColor: input.bgColor ?? '#ffffff',
        linkColor: input.linkColor ?? '#3498cf',
    };

    // Only ENABLED blocks render — a block flagged `settings.disabled` is kept
    // in the DB but excluded from both the preview and the sent email (dropping
    // it from the flat list also drops its whole subtree, since children are
    // only reached through their parent). Matches the public renderer.
    const enabledBlocks = input.blocks.filter(
        (b,) => !((b.settings as { disabled?: unknown; } | undefined)?.disabled),
    );

    const tree = buildTree(enabledBlocks,);
    const rows = tree.map((n,) => renderNode(n, ctx,),).join('\n',);

    // Per-breakpoint @media overrides for any block with `style.breakpoints`,
    // scoped by `data-block-id`. Injected into the head so clients that honor
    // <style> apply the responsive tweaks; the inline base stays authoritative.
    const responsiveCss = buildEmailResponsiveCss(enabledBlocks, input.breakpoints ?? [], input.palette,);

    // Preheader (off-screen first-line inbox preview) + the standard email
    // shell are shared with the other transactional templates via
    // `wrapEmailShell`. Variable tokens (`{{...}}`) survive into the output so
    // they substitute per-recipient at send time.
    const html = wrapEmailShell({
        title: input.subject,
        bodyHtml: rows,
        bg: ctx.bgColor,
        innerBg: ctx.bgColor,
        font: ctx.fontFamily,
        color: ctx.textColor,
        bodyStyleExtra: ';-webkit-font-smoothing:antialiased',
        outerPadding: '24px 12px',
        innerBorder: '1px solid #eee',
        innerRadius: '6px',
        headExtra: `<meta name="x-apple-disable-message-reformatting">\n${responsiveCss}`,
        preheader: input.preheader,
    },);

    const all = `${html} ${input.subject} ${input.preheader ?? ''}`;
    return {
        html,
        subject: input.subject,
        preheader: input.preheader,
        detectedVariables: detectVariables(all,),
    };
}
