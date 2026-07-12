import type {
    MailSendBody, MailSendResponse, MailJobsListQuery, MailJobsListResponse,
    MailJobGetResponse, MailJobRecipientsQuery, MailJobRecipientsResponse,
    MailJobRetryResponse, MailJobPatchResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * mailSend namespace (all admin) — fire a tracked send job and inspect its
 * progress. `send` returns 202 (Accepted); the worker is async. Job and
 * recipient lists use offset/limit paging carried inside data (no meta).
 */
export class MailSendModule extends ModuleBase {
    protected readonly module = 'mailSend';

    /** POST /mail/send — create a tracked send job (202 Accepted). */
    send(body: MailSendBody,): Promise<MailSendResponse> {
        return this.mutate<MailSendResponse>('POST', '/mail/send', { body, invalidates: ['mailSend',], },);
    }

    /** GET /mail/jobs — newest first; offset/limit paging (no meta). */
    listJobs(query?: MailJobsListQuery,): Promise<MailJobsListResponse> {
        return this.get<MailJobsListResponse>('/mail/jobs', { query: query as Record<string, unknown>, },);
    }

    /** GET /mail/jobs/:id — status snapshot. */
    getJob(id: string,): Promise<MailJobGetResponse> {
        return this.get<MailJobGetResponse>('/mail/jobs/:id', { params: { id, }, },);
    }

    /** GET /mail/jobs/:id/recipients — `{ items, total }` wrapper; optional status filter. */
    jobRecipients(id: string, query?: MailJobRecipientsQuery,): Promise<MailJobRecipientsResponse> {
        return this.get<MailJobRecipientsResponse>('/mail/jobs/:id/recipients', { params: { id, }, query: query as Record<string, unknown>, },);
    }

    /** POST /mail/jobs/:id/retry — reset failed → pending, re-kick worker. */
    retryJob(id: string,): Promise<MailJobRetryResponse> {
        return this.mutate<MailJobRetryResponse>('POST', '/mail/jobs/:id/retry', { params: { id, }, invalidates: ['mailSend',], },);
    }

    /** PATCH /mail/jobs/:id — cancel (the only supported transition). */
    cancelJob(id: string,): Promise<MailJobPatchResponse> {
        return this.mutate<MailJobPatchResponse>('PATCH', '/mail/jobs/:id', { params: { id, }, body: { status: 'cancelled', }, invalidates: ['mailSend',], },);
    }
}
