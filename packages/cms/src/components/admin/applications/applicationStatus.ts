import type { MembershipApplication, MembershipApplicationStatus, } from '@sitesurge/types';
import { formatDate, } from '@sitesurge/types';

/**
 * Extra status line for an approved "hide price" application: approval is an
 * OFFER, and the membership starts only when the member picks billing and pays.
 */
export function offerStatus(a: Pick<MembershipApplication, 'status' | 'tierHidePrice' | 'activatedAt'>,): string | null {
    if (a.status !== 'approved' || !a.tierHidePrice) return null;
    return a.activatedAt
        ? `Started ${formatDate(a.activatedAt,)}`
        : 'Approved — waiting for the member to choose billing and pay';
}

/** Badge class + label for an application (or a user's approval) status. */
export function approvalBadge(status: MembershipApplicationStatus | 'pending' | 'approved' | 'rejected' | null | undefined,): { cls: string; label: string; } | null {
    switch (status) {
        case 'pending': return { cls: 'badge badge--warning', label: 'Pending approval', };
        case 'approved': return { cls: 'badge badge--success', label: 'Approved', };
        case 'rejected': return { cls: 'badge badge--error', label: 'Rejected', };
        case 'withdrawn': return { cls: 'badge badge--muted', label: 'Withdrawn', };
        default: return null;
    }
}
