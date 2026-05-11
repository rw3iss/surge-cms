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
import { detectVariables, } from './variables';
import { EmailBlockNode, EmailRenderCtx, renderNode, } from './blocks';
import { escapeHtml, } from './blocks/_util';

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

    const tree = buildTree(input.blocks,);
    const rows = tree.map((n,) => renderNode(n, ctx,),).join('\n',);

    // Preheader: a single off-screen <div> at the very top of <body>.
    // Most clients use the first ~80 visible chars; this is the trick
    // for telling them what to show. Tokens survive into the final
    // string so they substitute per-recipient.
    const preheaderTag = input.preheader
        ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${input.preheader}</div>`
        : '';

    const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(input.subject,)}</title>
</head>
<body style="margin:0;padding:0;background:${ctx.bgColor};font-family:${ctx.fontFamily};color:${ctx.textColor};-webkit-font-smoothing:antialiased">
${preheaderTag}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${ctx.bgColor}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${ctx.bgColor === '#ffffff' ? '#ffffff' : ctx.bgColor};border:1px solid #eee;border-radius:6px">
${rows}
</table>
</td></tr>
</table>
</body>
</html>`;

    const all = `${html} ${input.subject} ${input.preheader ?? ''}`;
    return {
        html,
        subject: input.subject,
        preheader: input.preheader,
        detectedVariables: detectVariables(all,),
    };
}
