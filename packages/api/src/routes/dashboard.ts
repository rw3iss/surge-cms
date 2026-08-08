import type { DashboardSummaryResponse, } from '@sitesurge/types';
import { defineRoute, } from '../api/defineRoute';
import * as dashboard from '../services/dashboard';

export const dashboardRoutes = [

    defineRoute({
        method: 'get', path: '/summary', auth: 'admin',
        summary: 'Admin dashboard stats (counts + recent activity + quick actions).',
        handler: (): Promise<DashboardSummaryResponse> => dashboard.summary(),
    },),

    defineRoute({
        method: 'post', path: '/dismiss-pending-donations', auth: 'admin',
        summary: 'Dismiss the pending-donations alert for all admins (records "now").',
        handler: async () => { await dashboard.dismissPendingDonations(); return { ok: true, }; },
    },),
];
