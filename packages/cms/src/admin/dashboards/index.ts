/**
 * Admin DASHBOARD views, by id. A role's admin shell names one
 * (`admin/shells`); unknown or missing → `default` (the staff dashboard).
 * Add a view: a component file here + one line below.
 */
import { lazy, type Component, } from 'solid-js';

export const DASHBOARDS: Record<string, Component> = {
    default: lazy(() => import('../../pages/admin/Dashboard')),
    contributor: lazy(() => import('./ContributorDashboard')),
};

export function dashboardFor(id: string | null | undefined,): Component {
    return (id && DASHBOARDS[id]) || DASHBOARDS.default;
}
