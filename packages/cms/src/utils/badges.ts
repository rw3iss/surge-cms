/**
 * Shared badge class mappings for status, role, and other enums.
 * Use throughout admin list pages to avoid duplicating these switch statements.
 */

export const STATUS_BADGE_MAP: Record<string, string> = {
    published: 'badge--success',
    active: 'badge--success',
    completed: 'badge--info',
    draft: 'badge--warning',
    // A contributor's post waiting for review.
    pending_review: 'badge--info',
    archived: 'badge--muted',
    closed: 'badge--muted',
    cancelled: 'badge--error',
    deleted: 'badge--error',
    new: 'badge--info',
    unread: 'badge--info',
    read: 'badge--muted',
    replied: 'badge--success',
    spam: 'badge--error',
    closed_campaign: 'badge--info',
    // Shop order statuses.
    pending: 'badge--warning',
    paid: 'badge--success',
    processing: 'badge--info',
    shipped: 'badge--info',
    delivered: 'badge--success',
    refunded: 'badge--error',
};

export function getStatusBadgeClass(status: string | undefined,): string {
    if (!status) return 'badge--muted';
    return STATUS_BADGE_MAP[status] || 'badge--muted';
}

export const ROLE_BADGE_MAP: Record<string, string> = {
    sysadmin: 'badge--error',
    admin: 'badge--error',
    editor: 'badge--info',
    member: 'badge--success',
    anonymous: 'badge--muted',
};

export function getRoleBadgeClass(role: string | undefined,): string {
    if (!role) return 'badge--muted';
    return ROLE_BADGE_MAP[role] || 'badge--muted';
}

/** User status — takes the full user record */
export function getUserStatusBadge(user: { isBanned?: boolean; isActive?: boolean; },): { class: string; label: string; } {
    if (user.isBanned) return { class: 'badge--error', label: 'Banned', };
    if (user.isActive) return { class: 'badge--success', label: 'Active', };
    return { class: 'badge--muted', label: 'Inactive', };
}
