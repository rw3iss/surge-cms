/**
 * Email renderer for the `event` block.
 *
 * Table-based with inline styles, like every other mail block — email clients
 * have no reliable flexbox or external stylesheets.
 */
import { escapeHtml, } from './_util';

export function renderEvent(block: {
    content?: string | null;
    settings?: Record<string, unknown> | null;
},): string {
    const s = (block.settings ?? {}) as { heading?: string; };
    const heading = s.heading
        ? `<tr><td style="padding:0 0 8px;font-size:18px;font-weight:700">`
            + `${escapeHtml(s.heading,)}</td></tr>`
        : '';
    const body = block.content
        ? `<tr><td style="padding:0 0 8px;font-size:14px;line-height:1.5">${block.content}</td></tr>`
        : '';
    if (!heading && !body) return '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">`
        + `${heading}${body}</table>`;
}
