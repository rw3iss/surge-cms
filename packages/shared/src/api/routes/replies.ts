/**
 * replies — the generic "Reply by email" procedure (`/api/v1/replies`).
 *
 * One flow for every admin surface that answers a person who reached out:
 * a campaign donation (`donation`) and a form submission (`submission`) today.
 * A SOURCE knows how to load its record and find the recipient; the recipient
 * is always read from the stored record, never taken from the request.
 *
 * `ref` identifies the record within its source:
 *   donation   → { campaignId, donationId }
 *   submission → { formId, submissionId }
 *
 * Templates: `templateId` null/absent = the built-in Default Template; else a
 * Mailing Lists template (needs that feature). Either way the render context
 * carries `reply.*` (fromName, fromEmail, subject, message, messageText, to,
 * toName, date), the source's own objects (`donation` + `campaign`, or
 * `submission` + `form`) and `site.*`.
 */

export type ReplySourceKey = 'donation' | 'submission';

/** Identifies the record being replied to, within its source. */
export type ReplyRef = Record<string, string>;

export interface ReplyTargetBody {
    ref: ReplyRef;
}

export interface ReplyTargetResponse {
    /** The recipient — read from the stored record. */
    to: string;
    toName: string | null;
    /** A heading for the modal, e.g. "Reply to donor". */
    title: string;
    defaultSubject: string;
    defaultMessage: string;
    /** Every `{{ }}` path available to the template (e.g. `donation.amount`). */
    variables: string[];
}

export interface ReplyComposeBody {
    ref: ReplyRef;
    /** Mailing Lists template id; null/absent = Default Template. */
    templateId?: string | null;
    subject: string;
    message: string;
    fromName?: string;
    fromEmail?: string;
}

export type ReplyPreviewBody = ReplyComposeBody;
export interface ReplyPreviewResponse {
    to: string;
    subject: string;
    html: string;
    /** False when the chosen template never uses `{{reply.message}}` /
     *  `{{reply.messageText}}` — the typed message would not appear. */
    messageShown: boolean;
}

export type ReplySendBody = ReplyComposeBody;
export interface ReplySendResponse {
    sent: true;
    to: string;
}

export interface ReplySenderResponse {
    fromName: string;
    fromEmail: string;
}
