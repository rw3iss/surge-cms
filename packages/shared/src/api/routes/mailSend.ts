/**
 * Wire DTOs for the /mail module — the send wizard, job status, recipient
 * pagination, retry/resume and cancel (all admin tier). Validation lives
 * in `packages/api/src/routes/mailSend.ts`; orchestration in
 * `packages/api/src/services/mailSend.ts` (the worker itself in
 * `services/mail/sendWorker.ts`).
 *
 * `MailSendJob` and `MailSendRecipient` are reused verbatim from
 * `../../types/mail` (they already carry the progress counters + ISO
 * timestamps). The send body's block shape matches the mail-template
 * block input — re-exported from `./mailTemplates` rather than redeclared.
 */

import type {
    MailRecipientStatus,
    MailSendJob,
    MailSendRecipient,
} from '../../types/mail';
import type { MailTemplateBlockInput, } from './mailTemplates';

// ─── POST /mail/send ──────────────────────────────────────────────────

/**
 * Body for POST /mail/send. The wizard renders this block set once
 * (server-side); `{{tokens}}` survive into the stored HTML and get
 * per-recipient substituted by the worker. `templateId` may be null when
 * the operator started from a blank template; `templateWasModified` flags
 * that they edited blocks/meta after picking one (drives the "(custom)"
 * suffix on the job detail page). `subject` is required.
 */
export interface MailSendBody {
    listId: string;
    templateId?: string | null;
    templateWasModified?: boolean;
    subject: string;
    preheader?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
    blocks: MailTemplateBlockInput[];
}

/**
 * POST /mail/send (202) — the created job id + the total recipient count
 * expanded from the list's `subscribed` members. The worker is kicked
 * fire-and-forget; poll GET /mail/jobs/:id for progress.
 */
export interface MailSendResponse {
    jobId: string;
    total: number;
}

// ─── GET /mail/jobs ───────────────────────────────────────────────────

/** Query accepted by GET /mail/jobs. `limit`/`offset` coerce server-side
 *  (default limit 50). */
export interface MailJobsListQuery {
    limit?: number;
    offset?: number;
}

/**
 * A send job as surfaced by GET /mail/jobs — `MailSendJob` with the
 * list name joined in and guaranteed present on the key (`string | null`,
 * narrowing the entity's optional `listName?`). Mirrors `JobWithListName`
 * in `repositories/mailSendJobs.repo.ts`.
 */
export type MailSendJobRow = MailSendJob & { listName: string | null; };

/** GET /mail/jobs — recent jobs, newest first. Bare array (offset/limit
 *  paging is driven by the query, not echoed in meta). */
export type MailJobsListResponse = MailSendJobRow[];

// ─── GET /mail/jobs/:id ───────────────────────────────────────────────

/** Params for the job-by-id family of routes. */
export interface MailJobIdParams {
    id: string;
}

/** GET /mail/jobs/:id — a job status snapshot (incl. `totalRecipients`,
 *  `sentCount`, `failedCount`, `status`). */
export type MailJobGetResponse = MailSendJob;

// ─── GET /mail/jobs/:id/recipients ────────────────────────────────────

/** Query accepted by GET /mail/jobs/:id/recipients. `status` narrows to a
 *  `MailRecipientStatus` in the handler (typed `string` on the wire). */
export interface MailJobRecipientsQuery {
    limit?: number;
    offset?: number;
    status?: string;
}

/**
 * GET /mail/jobs/:id/recipients — NON-STANDARD list shape: the service
 * returns `{ items, total }` as the `data` payload (offset/limit paging
 * lives INSIDE data, not on the `ApiResponse.meta` envelope).
 */
export interface MailJobRecipientsResponse {
    items: MailSendRecipient[];
    total: number;
}

// ─── POST /mail/jobs/:id/retry ────────────────────────────────────────

/** POST /mail/jobs/:id/retry — resume/retry. Resets failed recipients →
 *  pending (and resumes a cancelled job) and re-kicks the worker; `reset`
 *  is how many recipients were moved back to pending (0 for a job already
 *  running/pending). */
export interface MailJobRetryResponse {
    reset: number;
}

// ─── PATCH /mail/jobs/:id ─────────────────────────────────────────────

/** Body for PATCH /mail/jobs/:id — the only supported transition is
 *  cancel. */
export interface MailJobPatchBody {
    status: 'cancelled';
}

/** PATCH /mail/jobs/:id — `{ ok: true }` once the job is marked
 *  cancelled. */
export interface MailJobPatchResponse {
    ok: true;
}

// Re-export the recipient-status enum + block input for consumers wiring
// the recipient filter / send body without a second import.
export type { MailRecipientStatus, MailTemplateBlockInput, };
