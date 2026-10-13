import type { MembershipApplicationStatus, } from '@sitesurge/types';

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
