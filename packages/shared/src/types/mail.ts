/**
 * Shared types for the Mailing Lists feature module. Used by both
 * frontend and backend.
 */

export interface MailingList {
    id: string;
    slug: string;
    name: string;
    description?: string;
    isEnabled: boolean;
    registeredUsersOnly: boolean;
    doubleOptIn: boolean;
    defaultTemplateId?: string | null;
    createdBy?: string | null;
    createdAt: string;
    updatedAt: string;
    subscriberCount?: number;
}

export type SubscriberStatus =
    | 'subscribed'
    | 'pending_confirmation'
    | 'unsubscribed'
    | 'bounced'
    | 'complained';

export interface MailingListSubscriber {
    id: string;
    listId: string;
    userId?: string | null;
    email: string;
    name?: string;
    phone?: string;
    status: SubscriberStatus;
    customFields: Record<string, unknown>;
    subscribedAt: string;
    confirmedAt?: string;
    unsubscribedAt?: string;
    lastSendAt?: string;
}

export interface MailTemplate {
    id: string;
    name: string;
    description?: string;
    isEnabled: boolean;
    subject: string;
    preheader?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
    createdBy?: string | null;
    createdAt: string;
    updatedAt: string;
}

export type MailSendJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface MailSendJob {
    id: string;
    listId: string;
    /** Name of the list at send time — joined on read, not stored on
     *  the job row (the FK on list_id is RESTRICT so the list still
     *  exists). */
    listName?: string | null;
    templateId?: string | null;
    /** Template name captured at send time. Survives the source
     *  template being renamed or deleted. */
    templateName?: string | null;
    /** True when the operator edited blocks / meta after picking a
     *  template (or when they chose "new blank template"). The detail
     *  page shows "Template Name (custom)" when set. */
    templateWasModified?: boolean;
    subject: string;
    preheader?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
    renderedHtmlTemplate: string;
    status: MailSendJobStatus;
    totalRecipients: number;
    sentCount: number;
    failedCount: number;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    createdBy?: string | null;
    createdAt: string;
}

export type MailRecipientStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface MailSendRecipient {
    id: string;
    jobId: string;
    subscriberId?: string | null;
    email: string;
    status: MailRecipientStatus;
    error?: string;
    sentAt?: string;
    attemptCount: number;
}

export interface OutboundMessage {
    to: string;
    fromName?: string;
    fromEmail: string;
    replyTo?: string;
    subject: string;
    html: string;
    headers?: Record<string, string>;
}

export interface VariableDescriptor {
    path: string;
    description: string;
    sample: string;
}
