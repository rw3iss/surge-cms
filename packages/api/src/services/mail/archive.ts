/**
 * Sent-mail archive — a mailing-list send viewed as a web page.
 *
 * The source is the job's `rendered_html_template`: the email HTML exactly as
 * the send rendered it, `{{ }}` still unresolved. Resolving it against a
 * per-viewer context (`recipientContext.ts`, shared with the send worker)
 * reproduces the email; nothing is re-rendered from the template, so a later
 * template edit cannot change what an archived send shows.
 *
 * Who sees what:
 *   - a valid signed `?r=` token → THAT recipient (their `{{user.*}}` and
 *     unsubscribe link) — the "View in browser" link in the email;
 *   - staff → allowed; rendered for the staff member;
 *   - a signed-in subscriber of the list → allowed; rendered for them;
 *   - anyone else → only when the list has a public archive; `{{user.*}}` blank.
 * Otherwise 404, so a private list's sends cannot be probed by job id.
 */
import type { MailingListSubscriber, } from '@sitesurge/types';
import { NotFoundError, } from '../../core/errors';
import { query, } from '../../db';
import * as jobs from '../../repositories/mailSendJobs.repo';
import * as recipients from '../../repositories/mailSendRecipients.repo';
import * as lists from '../../repositories/mailingLists.repo';
import * as subs from '../../repositories/mailingListSubscribers.repo';
import { absolutiseUrls, } from './postProcess';
import { buildRecipientContext, frontendUrl, verifyViewToken, } from './recipientContext';
import { siteContext, } from './sendWorker';
import { resolveMailTemplate, } from './templateRuntime';

export interface ArchiveViewer {
    id?: string;
    role?: string;
    email?: string;
    displayName?: string;
    staff?: boolean;
}

export interface SentMailView {
    jobId: string;
    subject: string;
    html: string;
    listName: string;
    sentAt: string | null;
    templateId: string | null;
    templateName: string | null;
    templateVersion: number | null;
    templateWasModified: boolean;
    /** Whose values filled `{{user.*}}`. */
    personalisedFor: 'recipient' | 'viewer' | 'anonymous';
}

/** Statuses whose mail actually went out (the archive never shows a draft). */
const SENT = new Set(['running', 'completed',],);

export async function viewSentMail(jobId: string, opts: { token?: string | null; viewer?: ArchiveViewer | null; },): Promise<SentMailView> {
    const job = await jobs.findById(jobId,);
    const viewer = opts.viewer ?? null;
    if (!job || (!SENT.has(job.status,) && !viewer?.staff)) throw new NotFoundError('Mail',);
    const list = await lists.findById(job.listId,);
    if (!list) throw new NotFoundError('Mail',);

    // 1. The signed recipient token from the email link.
    const recipientId = verifyViewToken(jobId, opts.token,);
    const recipient = recipientId ? await recipients.findInJob(jobId, recipientId,) : null;

    // 2. A signed-in viewer's own subscription to this list, if any.
    const viewerSub: MailingListSubscriber | null = !recipient && viewer?.email ? await subs.findByEmail(list.id, viewer.email,) : null;

    const allowed = Boolean(recipient,) || Boolean(viewer?.staff,) || Boolean(viewerSub,) || list.publicArchive;
    if (!allowed) throw new NotFoundError('Mail',);

    let subscriber: MailingListSubscriber | null = null;
    let email = '';
    let user: { name?: string; email?: string; } | null = null;
    let personalisedFor: SentMailView['personalisedFor'] = 'anonymous';
    if (recipient) {
        subscriber = recipient.subscriberId ? await subs.findById(recipient.subscriberId,) : null;
        email = recipient.email;
        personalisedFor = 'recipient';
    } else if (viewer?.email) {
        subscriber = viewerSub;
        email = viewer.email;
        // The account's name when the subscription has none.
        user = { name: viewerSub?.name || viewer.displayName || '', email: viewer.email, };
        personalisedFor = 'viewer';
    }

    const site = await siteContext();
    const ctx = buildRecipientContext({
        job,
        list,
        site,
        subscriber,
        email,
        recipientId: recipient?.id ?? null,
        user,
        // Only the real recipient (or the signed-in subscriber themself) gets a
        // working unsubscribe link; an anonymous archive reader gets none.
        withUnsubscribe: Boolean(recipient || viewerSub,),
    },);

    const html = absolutiseUrls(await resolveMailTemplate(job.renderedHtmlTemplate, ctx,), site.url || frontendUrl(),);
    return {
        jobId: job.id,
        subject: (await resolveMailTemplate(job.subject, ctx,)).trim(),
        html,
        listName: list.name,
        sentAt: job.completedAt ?? job.startedAt ?? null,
        templateId: job.templateId ?? null,
        templateName: job.templateName ?? null,
        templateVersion: job.templateVersion ?? null,
        templateWasModified: Boolean(job.templateWasModified,),
        personalisedFor,
    };
}

export interface ArchiveEntry {
    jobId: string;
    subject: string;
    listName: string;
    listSlug: string;
    sentAt: string | null;
}

/** Completed sends of lists with a public archive, newest first. Subjects are
 *  resolved anonymously (a `{{user.name}}` in a subject reads blank here). */
export async function listPublicArchive(page = 1, limit = 20,): Promise<{ data: ArchiveEntry[]; total: number; }> {
    const offset = (Math.max(1, page,) - 1) * limit;
    const r = await query<{ id: string; subject: string; completed_at: Date | null; list_name: string; list_slug: string; total: string; }>(
        `SELECT j.id, j.subject, j.completed_at, l.name AS list_name, l.slug AS list_slug,
                COUNT(*) OVER() AS total
           FROM mail_send_jobs j
           JOIN mailing_lists l ON l.id = j.list_id
          WHERE l.public_archive = true AND j.status = 'completed'
          ORDER BY j.completed_at DESC NULLS LAST
          LIMIT $1 OFFSET $2`,
        [limit, offset,],
    );
    const data: ArchiveEntry[] = [];
    for (const row of r.rows) {
        data.push({
            jobId: row.id,
            subject: (await resolveMailTemplate(row.subject, { user: {}, list: { name: row.list_name, }, },)).trim(),
            listName: row.list_name,
            listSlug: row.list_slug,
            sentAt: row.completed_at ? row.completed_at.toISOString() : null,
        },);
    }
    return { data, total: Number(r.rows[0]?.total ?? 0,), };
}
