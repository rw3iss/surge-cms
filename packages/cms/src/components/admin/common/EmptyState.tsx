import { type JSX, Show, } from 'solid-js';

interface EmptyStateProps {
    /** Primary message (e.g. "No posts found."). */
    message: string;
    /** Optional icon / illustration rendered above the message. */
    icon?: JSX.Element;
    /** Optional call-to-action (e.g. a "Create post" button). */
    action?: JSX.Element;
}

/**
 * The one empty-list affordance — renders the shared `.empty-state` class with an
 * optional icon + CTA, so hand-written `<div class="empty-state">No X found.</div>`
 * blocks across the admin can consolidate onto a single, consistent component.
 */
export default function EmptyState(props: EmptyStateProps,) {
    return (
        <div class="empty-state">
            <Show when={props.icon}>
                <div class="empty-state__icon">{props.icon}</div>
            </Show>
            <div class="empty-state__message">{props.message}</div>
            <Show when={props.action}>
                <div class="empty-state__action">{props.action}</div>
            </Show>
        </div>
    );
}
