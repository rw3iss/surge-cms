import type {
    ReplyComposeBody, ReplyPreviewResponse, ReplyRef, ReplySendResponse, ReplySenderResponse, ReplySourceKey, ReplyTargetResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * replies namespace (staff) — the generic "Reply by email" procedure for a
 * record someone submitted: a campaign `donation` (`ref: { campaignId,
 * donationId }`) or a form `submission` (`ref: { formId, submissionId }`).
 * The recipient is always the record's stored address.
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
}
