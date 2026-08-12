import { Component, JSX, splitProps, } from 'solid-js';
import './Badge.scss';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends Omit<JSX.HTMLAttributes<HTMLSpanElement>, 'class'> {
    /** Explicit visual variant. Wins over `status` when both are set. */
    variant?: BadgeVariant;
    /** A status/role string mapped to a variant via {@link statusToVariant}.
     * Convenience for list pages so callers don't hand-map every status. */
    status?: string;
    size?: BadgeSize;
    class?: string;
}

/**
 * Maps a status/role string to a badge variant. Mirrors the mapping concepts
 * in `utils/badges.ts` (the page-layer helper) but is self-contained so the
 * kit has no dependency on page code.
 */
const STATUS_VARIANT_MAP: Record<string, BadgeVariant> = {
    // Content / lifecycle
    published: 'success',
    active: 'success',
    completed: 'info',
    draft: 'warning',
    archived: 'neutral',
    closed: 'neutral',
    cancelled: 'danger',
    deleted: 'danger',
    inactive: 'neutral',
    banned: 'danger',
    // Messages
    new: 'info',
    unread: 'info',
    read: 'neutral',
    replied: 'success',
    spam: 'danger',
    // Shop order statuses
    pending: 'warning',
    paid: 'success',
    processing: 'info',
    shipped: 'info',
    delivered: 'success',
    refunded: 'danger',
    // Roles
    sysadmin: 'danger',
    admin: 'danger',
    editor: 'info',
    member: 'success',
    anonymous: 'neutral',
};

export function statusToVariant(status: string | undefined,): BadgeVariant {
    if (!status) return 'neutral';
    return STATUS_VARIANT_MAP[status] ?? 'neutral';
}

/**
 * Status/label pill. Use `variant` for an explicit look, or `status` to let
 * a known status string pick the variant automatically.
 */
export const Badge: Component<BadgeProps> = (props,) => {
    const [own, rest,] = splitProps(props, ['variant', 'status', 'size', 'class', 'children',],);

    const variant = () => own.variant ?? statusToVariant(own.status,);

    const klass = () =>
        [
            'ui-badge',
            `ui-badge--${variant()}`,
            own.size === 'sm' ? 'ui-badge--sm' : '',
            own.class ?? '',
        ].filter(Boolean,).join(' ',);

    return (
        <span class={klass()} {...rest}>
            {own.children}
        </span>
    );
};

export default Badge;
