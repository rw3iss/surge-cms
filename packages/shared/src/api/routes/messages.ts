/**
 * Wire DTOs for the /messages module. Validation schemas live in
 * `packages/api/src/routes/messages.ts`.
 */

import type { ContactMessage, MessageStatus, } from '../../types/message';
import type { BulkActionResult, } from './_shared';

// ─── POST /messages (public) ──────────────────────────────────────

/** Body for POST /messages — a contact-form submission. The server adds
 *  ip/user-agent/userId from the request; the client supplies only these. */
export interface MessageSubmitBody {
    name: string;
    email: string;
    subject?: string;
    message: string;
}

/** POST /messages (201) — submission acknowledgement. */
export interface MessageSubmitResponse {
    message: string;
}

// ─── GET /messages (admin) ────────────────────────────────────────

/** Query accepted by GET /messages. */
export interface MessageListQuery {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
}

/** GET /messages — list items. Page meta rides the ApiResponse envelope
 *  (the service's `unreadCount` is not forwarded to the wire). */
export type MessageListResponse = ContactMessage[];

/** GET /messages/mine — the authenticated user's own messages (newest first). */
export type MessagesMineResponse = ContactMessage[];

// ─── POST /messages/bulk ──────────────────────────────────────────

/** Body for POST /messages/bulk (unified bulk runner). */
export interface MessageBulkBody {
    ids: string[];
    action: 'delete' | 'status';
    /** status value when action='status' */
    value?: string;
}

/** POST /messages/bulk — count + action performed. */
export type MessageBulkResponse = BulkActionResult;

// ─── POST /messages/bulk-status (legacy) ──────────────────────────

/** Body for the legacy POST /messages/bulk-status endpoint. */
export interface MessageBulkStatusBody {
    messageIds: string[];
    status: MessageStatus;
}

/** POST /messages/bulk-status — confirmation message. */
export interface MessageBulkStatusResponse {
    message: string;
}

// ─── POST /messages/bulk-delete (legacy) ──────────────────────────

/** Body for the legacy POST /messages/bulk-delete endpoint. */
export interface MessageBulkDeleteBody {
    messageIds: string[];
}

/** POST /messages/bulk-delete — confirmation message. */
export interface MessageBulkDeleteResponse {
    message: string;
}

// ─── GET /messages/:id (admin) ────────────────────────────────────

/** Params for the message-by-id family of routes. */
export interface MessageIdParams {
    id: string;
}

/** GET /messages/:id — one message (fetching marks unread → read). */
export type MessageByIdResponse = ContactMessage;

// ─── PUT /messages/:id/status ─────────────────────────────────────

/** Body for PUT /messages/:id/status. */
export interface MessageStatusUpdateBody {
    status: MessageStatus;
}

/** PUT /messages/:id/status — the updated message. */
export type MessageStatusUpdateResponse = ContactMessage;

// ─── DELETE /messages/:id ─────────────────────────────────────────

/** DELETE /messages/:id — confirmation message. */
export interface MessageDeleteResponse {
    message: string;
}
