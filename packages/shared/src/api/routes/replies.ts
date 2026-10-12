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

/** donation (campaign donor) · submission (form respondent) · user (any account — Users / user detail). */
export type ReplySourceKey = 'donation' | 'submission' | 'user';

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
    /** The recorded reply (see GET /replies/item/:id). */
    replyId: string;
}

// ─── Tracking: every reply sent from the admin is recorded ──────────

export type ReplyStatus = 'sent' | 'failed';

/**
 * What the mail system said after the relay accepted the message (SES event
 * publishing → SNS → our webhook). `null` = no event yet (or tracking off).
 */
export type ReplyDelivery = 'delivered' | 'delayed' | 'bounced' | 'complained' | 'rejected';

export type ReplyEventType = 'send' | 'delivery' | 'delay' | 'bounce' | 'complaint' | 'reject' | 'open' | 'click';

/** One thing that happened to a sent reply. */
export interface ReplyEvent {
    type: ReplyEventType;
    at: string;
    /** `ses` (SES event), `pixel` (our open image) or `link` (our click redirect). */
    via: 'ses' | 'pixel' | 'link';
    /** Bounce reason, delay type, the clicked URL, or the mail client seen. */
    detail: string | null;
}

/** One reply as sent (or attempted). */
export interface ReplyRecord {
    id: string;
    source: ReplySourceKey;
    /** The record replied to — the donation / submission / user id. */
    subjectId: string;
    ref: ReplyRef;
    to: string;
    toName: string | null;
    subject: string;
    /** What the admin typed (before the template). */
    message: string;
    /** The exact email HTML that was sent. */
    html: string;
    templateId: string | null;
    fromName: string | null;
    fromEmail: string | null;
    status: ReplyStatus;
    error: string | null;
    sentBy: { id: string; name: string; } | null;
    createdAt: string;
    /** Latest delivery outcome reported by the mail system. */
    delivery: ReplyDelivery | null;
    /** Bounce / complaint / delay reason. */
    deliveryDetail: string | null;
    deliveredAt: string | null;
    /** Opens are APPROXIMATE: image proxies can open mail automatically, and blocked images hide real opens. */
    openCount: number;
    firstOpenedAt: string | null;
    lastOpenedAt: string | null;
    clickCount: number;
    /** Oldest first. Present on history / item reads. */
    events?: ReplyEvent[];
}

/** Per-record roll-up for a table row. */
export interface ReplySummary {
    count: number;
    sentCount: number;
    lastAt: string;
    lastStatus: ReplyStatus;
    /** Delivery outcome of the latest reply. */
    lastDelivery: ReplyDelivery | null;
    /** The latest reply was opened (approximate). */
    lastOpened: boolean;
}

/** GET /replies/:source/summary?ids=a,b — subjectId → summary (ids with no reply are absent). */
export type ReplySummaryResponse = Record<string, ReplySummary>;
/** GET /replies/:source/:subjectId/history — newest first. */
export type ReplyHistoryResponse = ReplyRecord[];
export type ReplyItemResponse = ReplyRecord;

export interface ReplySenderResponse {
    fromName: string;
    fromEmail: string;
}

// ─── Tracking settings (Settings → General → Reply tracking) ─────────

export interface ReplyTrackingSettings {
    /** Ask SES for delivery / bounce / complaint events (needs a configuration set + SNS). */
    deliveryEvents: boolean;
    /** SES configuration set name, sent as `X-SES-CONFIGURATION-SET`. Empty = rely on the identity's default set. */
    configurationSet: string;
    /** Add a 1×1 image to each reply and record when it loads. */
    trackOpens: boolean;
    /** Send links through a redirect that records the click. */
    trackClicks: boolean;
}

export interface ReplyTrackingStatus extends ReplyTrackingSettings {
    /** Paste into the SNS subscription (HTTPS). Contains a secret token. */
    webhookUrl: string;
    /** The SNS topic that confirmed the subscription; other topics are refused. */
    topicArn: string | null;
    subscriptionConfirmedAt: string | null;
    /** Last SES event received (any type). */
    lastEventAt: string | null;
    lastEventType: string | null;
    /** SES events received in the last 30 days. */
    eventsLast30Days: number;
}

/** GET /mail-events/settings · PUT returns the same · POST …/rotate returns the same. */
export type ReplyTrackingSettingsResponse = ReplyTrackingStatus;
export type ReplyTrackingSettingsBody = Partial<ReplyTrackingSettings>;
