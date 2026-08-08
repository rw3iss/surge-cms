import type { DashboardSummaryResponse, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/** /dashboard namespace (admin) — aggregated stats + recent activity. */
export class DashboardModule extends ModuleBase {
    protected readonly module = 'dashboard';

    /** GET /dashboard/summary — admin stats, recent posts, quick actions.
     *  Pass `fresh` to bypass the client cache (e.g. on dashboard mount) so
     *  counts like unread-messages reflect the latest data, not a stale SWR hit. */
    summary(fresh = false,): Promise<DashboardSummaryResponse> {
        return this.get<DashboardSummaryResponse>('/dashboard/summary', fresh ? { options: { cache: false, }, } : {},);
    }

    /** POST /dashboard/dismiss-pending-donations — clear the alert for all admins. */
    dismissPendingDonations(): Promise<{ ok: boolean; }> {
        return this.mutate<{ ok: boolean; }>('POST', '/dashboard/dismiss-pending-donations',);
    }
}
