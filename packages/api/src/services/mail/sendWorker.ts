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
import { buildVariableContext, substituteVariables, } from './variables';
import { generateUnsubscribeToken, } from './unsubscribe';
import type { MailingListSubscriber, } from '@rw/cms-shared';

const sleep = (ms: number,): Promise<void> => new Promise((r,) => setTimeout(r, ms,),);

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

        const batch = await recipients.findPending(jobId, concurrency,);
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
                const subject = substituteVariables(job.subject, ctx,);
                const html = substituteVariables(job.renderedHtmlTemplate, ctx,);

                const headers: Record<string, string> = { 'X-Mail-Job-Id': jobId, };
                if (unsubscribeUrl) {
                    // RFC 8058 one-click unsubscribe — required for
                    // Gmail/Apple Mail native "Unsubscribe" buttons.
                    headers['List-Unsubscribe'] = `<${unsubscribeUrl}>`;
                    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
                }

                await provider.send({
                    to: r.email,
                    fromName: job.fromName ?? site.name,
                    fromEmail: job.fromEmail ?? config.email.from ?? 'no-reply@example.com',
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
 * Resume any jobs left in `running` state by a previous process
 * crash. Called on backend boot.
 */
export async function resumeRunningJobs(): Promise<void> {
    try {
        const running = await jobs.findRunning();
        for (const j of running) {
            logger.info(`Resuming send job ${j.id} (left running from a previous boot)`,);
            setImmediate(() => { void kickJob(j.id,); },);
        }
    } catch (err) {
        logger.warn('resumeRunningJobs failed', { error: err, },);
    }
}
