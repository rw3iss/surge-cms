/**
 * Reply to a donor by email from the campaign's donations table.
 *
 * The recipient is ALWAYS the donation's stored `donor_email` — never taken
 * from the request — and the donation must belong to the campaign in the URL,
 * so a staff member can only write to a donor of the campaign they're on.
 *
 * The body is formatted with a built-in, code-defined reply layout (site logo
 * on top linking home, the message, the logo again in the footer). It is the
 * backup until operators can pick a mail template for replies. Preview and
 * send render through the SAME `renderDonationReply`, so the preview is
 * exactly what is sent.
 */
import { NotFoundError, ValidationError, } from '../core/errors';
import { query, } from '../db';
import { logger, } from '../utils/logger';
import { escapeHtml, } from '../utils/html';
import { logAudit, } from './audit';
import { sendEmail, } from './email';
import { resolveSender, } from './mail/sender';
import { loadMailRenderContext, } from './mail/siteContext';
import type { AuditContext, } from './types';

export interface DonationReplyInput {
    subject: string;
    message: string;
    fromName?: string;
    fromEmail?: string;
}

export interface ReplyLayout {
    siteName: string;
    siteUrl: string;
    /** Absolute URL of an email-safe logo, or null to show the site name. */
    logoUrl: string | null;
}

/** Plain text → safe HTML paragraphs: blank lines split paragraphs, single
 *  newlines become <br>. Everything is escaped first. */
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

/** The built-in reply email: logo header → message → logo footer. */
export function renderDonationReply(message: string, layout: ReplyLayout,): string {
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
      <tr><td style="padding:12px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#222">${messageToHtml(message,)}</td></tr>
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

async function layout(): Promise<ReplyLayout> {
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

/** The donation, only if it belongs to this campaign. */
export async function loadDonation(campaignId: string, donationId: string,): Promise<{ donorEmail: string; donorName: string | null; }> {
    const res = await query<{ donor_email: string; donor_name: string | null; }>(
        `SELECT donor_email, donor_name FROM donations WHERE id = $1 AND campaign_id = $2`,
        [donationId, campaignId,],
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundError('Donation',);
    if (!row.donor_email?.trim()) throw new ValidationError('This donation has no email address to reply to.',);
    return { donorEmail: row.donor_email.trim(), donorName: row.donor_name, };
}

function validate(input: DonationReplyInput,): void {
    if (!input.subject?.trim()) throw new ValidationError('A subject is required.',);
    if (!input.message?.trim()) throw new ValidationError('A message is required.',);
}

/** The sender the reply form starts with (site default → EMAIL_FROM). */
export async function defaultSender(): Promise<{ fromName: string; fromEmail: string; }> {
    const s = await resolveSender();
    return { fromName: s.fromName ?? '', fromEmail: s.fromEmail, };
}

export async function preview(campaignId: string, donationId: string, input: Pick<DonationReplyInput, 'message'>,) {
    const donation = await loadDonation(campaignId, donationId,);
    return { to: donation.donorEmail, html: renderDonationReply(input.message ?? '', await layout(),), };
}

const sleep = (ms: number,) => new Promise((r,) => setTimeout(r, ms,),);

/**
 * Send the reply. One retry after a short pause covers a transient SMTP blip;
 * a retry only runs when the first attempt THREW (nothing was accepted), so it
 * cannot double-send. A final failure is re-thrown so the admin sees it.
 */
export async function send(campaignId: string, donationId: string, input: DonationReplyInput, ctx: AuditContext,) {
    validate(input,);
    const donation = await loadDonation(campaignId, donationId,);
    const html = renderDonationReply(input.message, await layout(),);
    const msg = {
        to: donation.donorEmail,
        subject: input.subject.trim(),
        html,
        fromName: input.fromName?.trim() || undefined,
        fromEmail: input.fromEmail?.trim() || undefined,
    };
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            await sendEmail(msg,);
            lastErr = undefined;
            break;
        } catch (err) {
            lastErr = err;
            logger.warn('donation reply send failed', { attempt, donationId, error: (err as Error).message, },);
            if (attempt < 2) await sleep(800,);
        }
    }
    if (lastErr) {
        throw new Error(`The reply could not be sent: ${(lastErr as Error).message || 'mail server error'}`,);
    }
    await logAudit({
        userId: ctx.userId,
        action: 'donation_reply',
        entityType: 'donation',
        entityId: donationId,
        newValues: { campaignId, to: donation.donorEmail, subject: msg.subject, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return { sent: true, to: donation.donorEmail, };
}
