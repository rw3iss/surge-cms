/**
 * Donor replies — kept as the original campaign endpoints' implementation for
 * API compatibility (`/campaigns/:id/donations/:donationId/reply[/preview]`,
 * published in the SDK). Everything delegates to the generic reply procedure
 * in `services/reply` (source `donation`, Default Template); new code should
 * call `/replies/donation/*` instead.
 */
import * as reply from './reply';
import type { AuditContext, } from './types';

export interface DonationReplyInput {
    subject: string;
    message: string;
    fromName?: string;
    fromEmail?: string;
}

export const defaultSender = reply.defaultSender;

export function preview(campaignId: string, donationId: string, input: Pick<DonationReplyInput, 'message'>,) {
    return reply
        .preview('donation', { ref: { campaignId, donationId, }, subject: '', message: input.message ?? '', },)
        .then(({ to, html, },) => ({ to, html, }));
}

export function send(campaignId: string, donationId: string, input: DonationReplyInput, ctx: AuditContext,) {
    return reply.send('donation', { ref: { campaignId, donationId, }, ...input, }, ctx,);
}
