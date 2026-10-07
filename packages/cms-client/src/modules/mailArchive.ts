import type {
    MailArchiveEntry, MailArchiveListQuery, MailArchiveViewResponse, Paginated,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * mailArchive namespace — mailing-list sends as web pages. `view(jobId, r?)`
 * is personalised by the signed `r` token from `{{mail.viewUrl}}`, else by the
 * signed-in user; `list()` is the public archive.
 */
export class MailArchiveModule extends ModuleBase {
    protected readonly module = 'mailArchive';

    /** GET /mail-archive — public-archive sends, newest first. */
    list(params: MailArchiveListQuery = {},): Promise<Paginated<MailArchiveEntry>> {
        return this.getPaged<MailArchiveEntry>('/mail-archive', { query: params as Record<string, unknown>, },);
    }

    /** GET /mail-archive/:jobId — one sent mail, resolved for the viewer. */
    view(jobId: string, r?: string,): Promise<MailArchiveViewResponse> {
        return this.get<MailArchiveViewResponse>('/mail-archive/:jobId', {
            params: { jobId, },
            query: r ? { r, } : undefined,
            options: { cache: false, },
        },);
    }
}
