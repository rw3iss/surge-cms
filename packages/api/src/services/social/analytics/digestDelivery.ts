/**
 * Digest delivery: the email (settings recipients, plus — in `augment` mode —
 * the email recipients of the "Social analytics digest" notification type)
 * and the notification's other channels (in-app, desktop, SMS).
 */
import type { SocialAnalyticsDigest, SocialAnalyticsDigestSendResponse, SocialAnalyticsSettings, } from '@sitesurge/types';
import { config, } from '../../../config';
import { query, } from '../../../db';
import { logger, } from '../../../utils/logger';
import { sendEmail, } from '../../email';
import { brandLayout, } from '../../mail/branded';
import { getNotificationSettings, notify, } from '../../notifications';
import { digestTitle, renderDigestEmail, } from './digestEmail';
import { getSettings, } from './settings';

export const DIGEST_NOTIFICATION_TYPE = 'social_analytics_digest';

const siteUrl = () => String(config.frontendUrl || '',).replace(/\/+$/, '',);
export const digestViewPath = (id: string,) => `/admin/social/analytics/digests/${id}`;
export const DIGEST_SETTINGS_PATH = '/admin/social/analytics/settings';

/**
 * Who gets the digest email. The "Email each digest" switch controls the
 * AUTOMATIC email; a manual "Send email" (`manual`) uses the same recipients
 * whether it is on or off.
 */
export async function digestRecipients(settings: SocialAnalyticsSettings, opts: { manual?: boolean; } = {},): Promise<string[]> {
    if (!settings.email.enabled && !opts.manual) return [];
    const out = new Set(settings.email.recipients.map((a,) => a.toLowerCase(),),);
    if (settings.email.recipientMode === 'augment') {
        const n = (await getNotificationSettings())[DIGEST_NOTIFICATION_TYPE];
        if (n?.email?.enabled) for (const a of n.email.addresses ?? []) if (a.trim()) out.add(a.trim().toLowerCase(),);
    }
    return [...out,];
}

export async function renderEmailFor(digest: SocialAnalyticsDigest, format: 'full' | 'summary',): Promise<string> {
    return renderDigestEmail(digest, await brandLayout(), {
        format,
        viewUrl: `${siteUrl()}${digestViewPath(digest.id,)}`,
        settingsUrl: `${siteUrl()}${DIGEST_SETTINGS_PATH}`,
    },);
}

/** Email a digest; one message per recipient. Returns who it went to (and why nothing was sent). */
export async function sendDigestEmail(
    digest: SocialAnalyticsDigest,
    opts: { settings?: SocialAnalyticsSettings; manual?: boolean; } = {},
): Promise<SocialAnalyticsDigestSendResponse> {
    const s = opts.settings ?? await getSettings();
    const recipients = await digestRecipients(s, { manual: opts.manual, },);
    if (digest.status !== 'ready') return { sent: 0, failed: 0, recipients, reason: 'not_ready', };
    if (!recipients.length) return { sent: 0, failed: 0, recipients, reason: 'no_recipients', };
    const html = await renderEmailFor(digest, s.email.format,);
    const subject = digestTitle(digest,);
    let sent = 0;
    for (const to of recipients) {
        try {
            await sendEmail({ to, subject, html, },);
            sent++;
        } catch (e) {
            logger.warn('digest email: send failed', { to, error: (e as Error).message, },);
        }
    }
    if (sent) {
        await query(
            `UPDATE social_analytics_digests SET emailed_at = NOW(), email_count = email_count + $2, updated_at = NOW() WHERE id = $1`,
            [digest.id, sent,],
        );
    }
    return { sent, failed: recipients.length - sent, recipients, reason: null, };
}

/**
 * "Your digest is ready" on the notification type's other channels. Its email
 * channel is skipped — the email recipients get the digest itself
 * (`sendDigestEmail`), not a second message about it.
 */
export async function announceDigest(digest: SocialAnalyticsDigest,): Promise<void> {
    if (digest.status !== 'ready') return;
    const title = digestTitle(digest,);
    const headline = digest.data?.ai.insights?.headline ?? digest.headline;
    await notify(DIGEST_NOTIFICATION_TYPE, {
        subject: title,
        title,
        body: headline ?? 'Your social analytics digest is ready.',
        text: `${title}\n${headline ?? ''}\n${siteUrl()}${digestViewPath(digest.id,)}`,
        url: digestViewPath(digest.id,),
    }, { skipChannels: ['email',], },);
}
