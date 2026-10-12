import type {
    ReplyComposeBody, ReplyHistoryResponse, ReplyItemResponse, ReplyPreviewResponse, ReplyRef, ReplySendResponse, ReplySenderResponse, ReplySourceKey,
    ReplySummaryResponse, ReplyTargetResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * replies namespace (staff) — the generic "Reply by email" procedure for a
 * record someone submitted: a campaign `donation` (`ref: { campaignId,
 * donationId }`) or a form `submission` (`ref: { formId, submissionId }`).
 * The recipient is always the record's stored address. Every send (or failed
 * send) is recorded: `summary` / `history` / `item` read that record.
 */
export class RepliesModule extends ModuleBase {
    protected readonly module = 'replies';

    /** GET /replies/sender — the sender a reply starts with. */
    sender(): Promise<ReplySenderResponse> {
        return this.get<ReplySenderResponse>('/replies/sender', { options: { cache: false, }, },);
    }

    /** POST /replies/:source/target — recipient, defaults and available `{{ }}` variables. */
    target(source: ReplySourceKey, ref: ReplyRef,): Promise<ReplyTargetResponse> {
        return this.mutate<ReplyTargetResponse>('POST', '/replies/:source/target', { params: { source, }, body: { ref, }, },);
    }

    /** POST /replies/:source/preview — the exact HTML a send would deliver. */
    preview(source: ReplySourceKey, body: ReplyComposeBody,): Promise<ReplyPreviewResponse> {
        return this.mutate<ReplyPreviewResponse>('POST', '/replies/:source/preview', { params: { source, }, body, },);
    }

    /** POST /replies/:source/send — email the reply. */
    send(source: ReplySourceKey, body: ReplyComposeBody,): Promise<ReplySendResponse> {
        return this.mutate<ReplySendResponse>('POST', '/replies/:source/send', { params: { source, }, body, },);
    }

    /** GET /replies/:source/summary?ids= — reply count + last status per subject id (max 500). */
    summary(source: ReplySourceKey, ids: string[],): Promise<ReplySummaryResponse> {
        if (!ids.length) return Promise.resolve({},);
        return this.get<ReplySummaryResponse>('/replies/:source/summary', { params: { source, }, query: { ids: ids.join(',',), }, options: { cache: false, }, },);
    }

    /** GET /replies/:source/:subjectId/history — every reply sent for one record, newest first. */
    history(source: ReplySourceKey, subjectId: string,): Promise<ReplyHistoryResponse> {
        return this.get<ReplyHistoryResponse>('/replies/:source/:subjectId/history', { params: { source, subjectId, }, options: { cache: false, }, },);
    }

    /** GET /replies/item/:id — one recorded reply. */
    item(id: string,): Promise<ReplyItemResponse> {
        return this.get<ReplyItemResponse>('/replies/item/:id', { params: { id, }, options: { cache: false, }, },);
    }
}
