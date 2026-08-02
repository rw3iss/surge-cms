/**
 * In-process send worker. Walks pending recipients in chunks of
 * MAIL_SEND_CONCURRENCY (default 10), delivers via the configured
 * MailProvider, updates per-recipient status. Honors `cancelled`
 * status by re-checking at every chunk start.
 *
 * On boot, `resumeRunningJobs()` re-kicks any job that was left in
 * `running` state by a previous process crash. Recipients already
 * marked `sent` are skipped naturally because the worker pulls only
 * `pending`.
 */
import { config, } from '../../config';
import * as jobs from '../../repositories/mailSendJobs.repo';
import * as recipients from '../../repositories/mailSendRecipients.repo';
import * as lists from '../../repositories/mailingLists.repo';
import * as subs from '../../repositories/mailingListSubscribers.repo';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { getProvider, } from './providers/factory';
import { buildVariableContext, } from './variables';
import { resolveMailTemplate, } from './templateRuntime';
import { isFeatureEnabledServer, } from '../settings';
import { generateUnsubscribeToken, } from './unsubscribe';
import type { MailingListSubscriber, OutboundMessage, } from '@sitesurge/types';
import type { MailProvider, } from './providers/types';

const sleep = (ms: number,): Promise<void> => new Promise((r,) => setTimeout(r, ms,),);

/** Deliver with a small exponential backoff so a transient SMTP blip (SES
 *  throttling / a dropped socket) doesn't fail an otherwise-deliverable
 *  recipient. Never produces a duplicate: a retry only fires when the prior
 *  attempt THREW (no message accepted). */
async function sendWithRetry(
    provider: MailProvider,
    msg: OutboundMessage,
    attempts = 3,
): Promise<void> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            await provider.send(msg,);
            return;
        } catch (err) {
            lastErr = err;
            if (i < attempts - 1) await sleep(500 * 2 ** i,);
        }
    }
    throw lastErr;
}

async function siteContext(): Promise<{ name: string; url: string; }> {
    const r = await query<{ key: string; value: unknown; }>(
        `SELECT key, value FROM site_settings WHERE key IN ('site_name', 'site_url')`,
    );
    let name = 'Site';
    let url = '';
    for (const row of r.rows) {
        if (row.key === 'site_name' && typeof row.value === 'string') name = row.value;
        if (row.key === 'site_url' && typeof row.value === 'string') url = row.value;
    }
    return { name, url, };
}

function frontendUrl(): string {
    return (config.frontendUrl as string | undefined) ?? '';
}

export async function kickJob(jobId: string,): Promise<void> {
    const job = await jobs.findById(jobId,);
    if (!job) return;
    if (job.status !== 'pending' && job.status !== 'running') return;

    if (job.status === 'pending') {
        await jobs.setStatus(jobId, 'running', { startedAt: new Date().toISOString(), },);
    }

    // Requeue any recipients stranded 'sending' by a previous crash so a
    // resume picks up exactly where it stopped (no-op for a fresh send).
    const requeued = await recipients.resetStaleSending(jobId,);
    if (requeued > 0) logger.info(`Requeued ${requeued} stranded recipient(s) for job ${jobId}`,);

    const list = await lists.findById(job.listId,);
    if (!list) {
        await jobs.setStatus(jobId, 'failed', {
            error: 'List not found',
            completedAt: new Date().toISOString(),
        },);
        return;
    }

    const provider = getProvider();
    const site = await siteContext();
    const fe = frontendUrl();
    const concurrency = Math.max(1, config.mail.sendConcurrency,);
    const delay = Math.max(0, config.mail.sendDelayMs,);

    while (true) {
        // Re-check job status at the start of each chunk so cancel
        // takes effect within ~1 chunk of being requested.
        const fresh = await jobs.findById(jobId,);
        if (!fresh || fresh.status === 'cancelled') break;

        // Atomic claim: flips pending → sending + returns the rows, so a
        // concurrent run can't grab the same recipients (no double-send).
        const batch = await recipients.claimBatch(jobId, concurrency,);
        if (batch.length === 0) break;

        await Promise.all(batch.map(async (r,) => {
            try {
                const sub = r.subscriberId ? await subs.findById(r.subscriberId,) : null;
                const unsubscribeUrl = sub
                    ? `${fe}/u/${generateUnsubscribeToken(sub.id, list.id,)}`
                    : '';
                const ctx = buildVariableContext({
                    subscriber: (sub ?? {
                        id: '',
                        listId: list.id,
                        email: r.email,
                        customFields: {},
                        status: 'subscribed',
                        subscribedAt: '',
                    }) as MailingListSubscriber,
                    list,
                    siteName: site.name,
                    siteUrl: site.url,
                    unsubscribeUrl,
                },);
                const subject = await resolveMailTemplate(job.subject, ctx as unknown as Record<string, unknown>,);
                const html = await resolveMailTemplate(job.renderedHtmlTemplate, ctx as unknown as Record<string, unknown>,);

                const headers: Record<string, string> = { 'X-Mail-Job-Id': jobId, };
                if (unsubscribeUrl) {
                    // RFC 8058 one-click unsubscribe — required for
                    // Gmail/Apple Mail native "Unsubscribe" buttons.
                    headers['List-Unsubscribe'] = `<${unsubscribeUrl}>`;
                    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
                }

                await sendWithRetry(provider, {
                    to: r.email,
                    fromName: job.fromName ?? site.name,
                    // Per-template From overrides; else the dedicated mailing-list
                    // sender (MAIL_LIST_FROM); else the transactional EMAIL_FROM.
                    fromEmail: job.fromEmail ?? config.mail.listFrom ?? config.email.from ?? 'no-reply@example.com',
                    replyTo: job.replyTo,
                    subject,
                    html,
                    headers,
                },);
                await recipients.setStatus(r.id, 'sent',);
                await jobs.incrementCounts(jobId, 1, 0,);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err,);
                logger.warn(`Mail send failed: ${r.email}: ${msg}`,);
                await recipients.setStatus(r.id, 'failed', msg,);
                await jobs.incrementCounts(jobId, 0, 1,);
            }
        }),);

        if (delay > 0) await sleep(delay,);
    }

    const final = await jobs.findById(jobId,);
    if (!final) return;
    if (final.status === 'cancelled') return;

    const allFailed = final.totalRecipients > 0 && final.failedCount === final.totalRecipients;
    await jobs.setStatus(jobId, allFailed ? 'failed' : 'completed', {
        completedAt: new Date().toISOString(),
    },);
}

/**
 * Resume any jobs left `running` (crashed mid-send) OR `pending` (created
 * but the process died before the worker started) by a previous process.
 * Called on backend boot. `kickJob` requeues any stranded 'sending'
 * recipients, so a resumed job continues exactly where it stopped without
 * re-sending anyone already 'sent'.
 */
export async function resumeRunningJobs(): Promise<void> {
    try {
        // `mail_send_jobs` only exists when the mailing_lists feature is
        // installed. On a site with the feature disabled the table is absent,
        // so skip the resumer entirely rather than error on a missing relation.
        if (!(await isFeatureEnabledServer('mailing_lists',))) return;
        const resumable = await jobs.findResumable();
        for (const j of resumable) {
            logger.info(`Resuming send job ${j.id} (status=${j.status} from a previous boot)`,);
            setImmediate(() => { void kickJob(j.id,); },);
        }
    } catch (err) {
        logger.warn('resumeRunningJobs failed', { error: err, },);
    }
}
