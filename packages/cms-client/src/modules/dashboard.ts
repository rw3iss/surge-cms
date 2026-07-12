import type { DashboardSummaryResponse, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/** /dashboard namespace (admin) — aggregated stats + recent activity. */
export class DashboardModule extends ModuleBase {
    protected readonly module = 'dashboard';

    /** GET /dashboard/summary — admin stats, recent posts, quick actions. */
    summary(): Promise<DashboardSummaryResponse> {
        return this.get<DashboardSummaryResponse>('/dashboard/summary',);
    }
}
