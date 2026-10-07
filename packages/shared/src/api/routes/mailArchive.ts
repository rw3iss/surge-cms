/**
 * mail-archive — mailing-list sends viewed as web pages (`/api/v1/mail-archive`,
 * needs the `mailing_lists` feature). Backs the public `/mail` archive, the
 * `/mail/:jobId` web view behind `{{mail.viewUrl}}` / `{{mail.url}}`, and the
 * admin job page's "View Sent Template".
 */

/** Query for GET /mail-archive/:jobId — `r` is the signed per-recipient token
 *  carried by `{{mail.viewUrl}}`. */
export interface MailArchiveViewQuery {
    r?: string;
}

export interface MailArchiveViewResponse {
    jobId: string;
    subject: string;
    /** Full email HTML, resolved for this viewer. Render sandboxed. */
    html: string;
    listName: string;
    sentAt: string | null;
    templateId: string | null;
    templateName: string | null;
    /** The template revision the send used (see the template's history). */
    templateVersion: number | null;
    templateWasModified: boolean;
    personalisedFor: 'recipient' | 'viewer' | 'anonymous';
}

export interface MailArchiveListQuery {
    page?: number;
    limit?: number;
}

export interface MailArchiveEntry {
    jobId: string;
    subject: string;
    listName: string;
    listSlug: string;
    sentAt: string | null;
}

/** GET /mail-archive — public-archive sends, newest first (pagination on meta). */
export type MailArchiveListResponse = MailArchiveEntry[];
