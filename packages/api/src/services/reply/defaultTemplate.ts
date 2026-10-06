/**
 * The built-in **Default Template** for every reply (donations, form
 * submissions, …): site logo on top linking home → the message → logo footer.
 * Used whenever no Mailing Lists template is chosen — and the only option when
 * that feature is off. Code-defined, table-based, inline-styled: it is already
 * email HTML, so it needs no block render pass.
 */
import { escapeHtml, } from '../../utils/html';
import { loadMailRenderContext, } from '../mail/siteContext';

export interface ReplyLayout {
    siteName: string;
    siteUrl: string;
    /** Absolute URL of an email-safe logo, or null to show the site name. */
    logoUrl: string | null;
}

/** Plain text → safe HTML paragraphs: blank lines split paragraphs, single
 *  newlines become <br>. Everything is escaped first. This is what
 *  `{{reply.message}}` holds. */
export function messageToHtml(message: string,): string {
    return message
        .replace(/\r\n?/g, '\n',)
        .trim()
        .split(/\n{2,}/,)
        .map((p,) => p.trim())
        .filter(Boolean,)
        .map((p,) => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(p,).replace(/\n/g, '<br>',)}</p>`)
        .join('',);
}

/** The Default Template around an already-HTML message body. */
export function renderDefaultReply(messageHtml: string, layout: ReplyLayout,): string {
    const home = escapeHtml(layout.siteUrl || '/',);
    const name = escapeHtml(layout.siteName,);
    const brand = (height: number,) =>
        layout.logoUrl ?
            `<a href="${home}" style="text-decoration:none"><img src="${escapeHtml(layout.logoUrl,)}" alt="${name}" height="${height}" style="display:block;margin:0 auto;height:${height}px;width:auto;border:0"></a>` :
            `<a href="${home}" style="color:#111;font-size:20px;font-weight:700;text-decoration:none">${name}</a>`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:8px">
      <tr><td align="center" style="padding:28px 24px 12px">${brand(56,)}</td></tr>
      <tr><td style="padding:12px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#222">${messageHtml}</td></tr>
      <tr><td align="center" style="padding:20px 24px 28px;border-top:1px solid #e5e7eb">
        ${brand(36,)}
        <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280">
          <a href="${home}" style="color:#6b7280">${escapeHtml((layout.siteUrl || '').replace(/^https?:\/\//, '',),) || name}</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export async function replyLayout(): Promise<ReplyLayout> {
    const ctx = await loadMailRenderContext();
    // `/logo.png` is the site-origin PNG of the Site Branding logo — the form
    // mail clients (Gmail) accept; only offered when a logo is configured.
    const hasLogo = Boolean(ctx.siteSettings.logo,);
    return {
        siteName: ctx.siteName,
        siteUrl: ctx.siteUrl,
        logoUrl: hasLogo && ctx.siteUrl ? `${ctx.siteUrl}/logo.png` : null,
    };
}
