/**
 * The one transactional-email HTML shell: a `<!DOCTYPE>` + email-safe
 * `role="presentation"` centering-table wrapper around a fixed-width
 * (default 600px) white card on a light background. Inline styles only,
 * table-based layout — the lowest-common-denominator that renders in
 * Outlook/Gmail/Apple Mail.
 *
 * Previously duplicated three times (the block-mail renderer, the shop
 * order emails, and the email-verification default). Each caller keeps
 * its own look by passing overrides (background, font, colors, border,
 * padding); `bodyHtml` is dropped verbatim INSIDE the inner card table,
 * so a caller supplies its own `<tr>`/`<td>` chrome (header/footer rows,
 * a padded content cell, or a flat block-row list).
 */
import { escapeHtml, } from '../../utils/html';

const DEFAULT_DOCTYPE = '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">';
const DEFAULT_FONT = 'system-ui,-apple-system,BlinkMacSystemFont,sans-serif';

export interface EmailShellOptions {
    /** Inner card content — placed verbatim inside the 600px card table.
     *  The caller owns its `<tr>`/`<td>` structure. */
    bodyHtml: string;
    /** `<title>`; omitted/empty → no `<title>` tag emitted. */
    title?: string;
    /** Page + outer-table background. */
    bg?: string;
    /** Inner card background. */
    innerBg?: string;
    /** Fixed card width in px. */
    maxWidth?: number;
    /** Body font-family stack. */
    font?: string;
    /** Body text color. */
    color?: string;
    /** Padding on the centering `<td>` (the gutter around the card). */
    outerPadding?: string;
    /** Inner card border (e.g. `1px solid #e5e7eb`); empty → no border. */
    innerBorder?: string;
    /** Inner card border-radius; empty → none. */
    innerRadius?: string;
    /** Extra CSS appended to the inner card table style (e.g. `overflow:hidden`). */
    innerStyleExtra?: string;
    /** Off-screen preheader text (first-line preview in the inbox). */
    preheader?: string;
    /** Extra `<meta>` lines injected after the standard content-type + viewport metas. */
    headExtra?: string;
    /** Extra CSS appended to the body style (e.g. `;-webkit-font-smoothing:antialiased`). */
    bodyStyleExtra?: string;
    /** Override the doctype string. */
    docType?: string;
}

/** Wrap inner card content in the standard transactional-email shell. */
export function wrapEmailShell(opts: EmailShellOptions,): string {
    const {
        bodyHtml,
        title = '',
        bg = '#f4f4f5',
        innerBg = '#ffffff',
        maxWidth = 600,
        font = DEFAULT_FONT,
        color = '#333333',
        outerPadding = '24px 12px',
        innerBorder = '1px solid #e5e7eb',
        innerRadius = '8px',
        innerStyleExtra = '',
        preheader = '',
        headExtra = '',
        bodyStyleExtra = '',
        docType = DEFAULT_DOCTYPE,
    } = opts;

    const titleTag = title ? `<title>${escapeHtml(title,)}</title>\n` : '';

    const preheaderTag = preheader
        ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preheader}</div>\n`
        : '';

    const innerStyleParts = [
        `max-width:${maxWidth}px`,
        'width:100%',
        `background:${innerBg}`,
        innerRadius ? `border-radius:${innerRadius}` : '',
        innerBorder ? `border:${innerBorder}` : '',
        innerStyleExtra,
    ].filter(Boolean,).join(';',);

    return `${docType}
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${headExtra}${titleTag}</head>
<body style="margin:0;padding:0;background:${bg};font-family:${font};color:${color}${bodyStyleExtra}">
${preheaderTag}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg}">
<tr><td align="center" style="padding:${outerPadding}">
<table role="presentation" width="${maxWidth}" cellpadding="0" cellspacing="0" border="0" style="${innerStyleParts}">
${bodyHtml}
</table>
</td></tr>
</table>
</body>
</html>`;
}
