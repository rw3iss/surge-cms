import type { DashboardSummaryResponse, } from '@sitesurge/types';
import { defineRoute, } from '../api/defineRoute';
import * as dashboard from '../services/dashboard';

export const dashboardRoutes = [

    defineRoute({
        method: 'get', path: '/summary', auth: 'admin',
        summary: 'Admin dashboard stats (counts + recent activity + quick actions).',
        handler: (): Promise<DashboardSummaryResponse> => dashboard.summary(),
    },),
];
