/**
 * Email-verification email + token helpers.
 *
 * A self-registered member (when the operator has verification enabled) gets
 * an email with a link to `/verify?token=…`. The email body is either the
 * operator's customized block set (Users settings page) rendered through the
 * standard mail pipeline, or — when they haven't customized one — a built-in
 * styled default. Token generation + the DB verification write live in
 * `services/auth.ts` (they touch the users table + session minting); this file
 * owns only the rendering/sending.
 */
import { config, } from '../../config';
import { logger, } from '../../utils/logger';
import { nanoid, } from '../../utils/nanoid';
import { getUsersSettings, } from '../settings';
import { sendEmail, } from '../email';
import { loadMailRenderContext, } from './siteContext';
import { renderStandaloneMail, } from './transactional';
import { resolveMailTemplate, } from './templateRuntime';
import { escapeHtml, } from './blocks/_util';
import type { FlatBlock, } from './renderer';

const DEFAULT_SUBJECT = 'Verify your email address';

/** URL-safe token stored on the user row + embedded in the verification link. */
export function generateVerificationToken(): string {
    return nanoid(48,);
}

/** Build the verification link for a token, anchored at the site frontend. */
export function verificationUrl(token: string,): string {
    const base = (config.frontendUrl as string | undefined ?? '').replace(/\/+$/, '',);
    return `${base}/verify?token=${encodeURIComponent(token,)}`;
}

/** Built-in styled default body — used when the operator hasn't customized
 *  the verification email's blocks. Table-based, inline styles (email-safe). */
function defaultVerificationHtml(name: string, siteName: string, url: string,): string {
    const greeting = name ? `Hi ${escapeHtml(name,)},` : 'Hi,';
    return `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;color:#333">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5">
<tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb">
<tr><td style="padding:32px">
<h1 style="margin:0 0 16px;font-size:22px;color:#111">Verify your email</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${greeting}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">Thanks for signing up for ${escapeHtml(siteName,)}. Please confirm your email address to activate your account.</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(url,)}" style="background:#111827;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">Verify email</a></p>
<p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5">Or paste this link into your browser:<br><a href="${escapeHtml(url,)}" style="color:#2563eb;word-break:break-all">${escapeHtml(url,)}</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/**
 * Render + send the verification email to a newly-registered member. Best
 * effort: throws are surfaced to the caller, which logs and continues (the
 * account is still created; the member can request a resend later).
 */
export async function sendVerificationEmail(
    user: { email: string; name?: string; },
    token: string,
): Promise<void> {
    const settings = await getUsersSettings();
    const site = await loadMailRenderContext();
    const url = verificationUrl(token,);

    const context: Record<string, unknown> = {
        user: { name: user.name ?? '', email: user.email, },
        site: { name: site.siteName, url: site.siteUrl, },
        // Both snake_case (mail convention) and camelCase, so either resolves.
        verification_url: url,
        verificationUrl: url,
    };

    const blocks = (settings.verificationEmail.blocks ?? []) as unknown as FlatBlock[];
    const subjectTpl = settings.verificationEmail.subject || DEFAULT_SUBJECT;

    if (blocks.length > 0) {
        const rendered = await renderStandaloneMail({ subject: subjectTpl, blocks, }, context,);
        await sendEmail({ to: user.email, subject: rendered.subject, html: rendered.html, },);
        logger.info('Verification email sent (custom template)', { to: user.email, },);
        return;
    }

    const subject = await resolveMailTemplate(subjectTpl, context,);
    const html = defaultVerificationHtml(user.name ?? '', site.siteName, url,);
    await sendEmail({ to: user.email, subject, html, },);
    logger.info('Verification email sent (default template)', { to: user.email, },);
}
