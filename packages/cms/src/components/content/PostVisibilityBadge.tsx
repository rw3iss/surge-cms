/**
 * A post's visibility for the CURRENT viewer, as a small icon badge:
 *   public  — open to everyone (globe)
 *   locked  — needs a subscription tier the viewer does not have (padlock)
 *   premium — needs a tier, and the viewer has it (star)
 *
 * Reads the `gate` the API stamps on every public post read, so the badge
 * always agrees with what the page will actually show. Use after a post title
 * (cards, list rows, the post page); `showLabel` adds the word.
 */
import type { PostGate, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';
import './PostVisibilityBadge.scss';

export interface PostVisibilityBadgeProps {
    gate?: PostGate | null;
    showLabel?: boolean;
    /** Hide the badge for public posts (most of a feed). Default: shown. */
    hidePublic?: boolean;
    class?: string;
}

/** Factories, not shared elements: a DOM node can live in ONE place, so a
 *  shared JSX constant would be moved into the last badge rendered. */
const ICONS = {
    public: () => (
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
    ),
    locked: () => (
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
    ),
    premium: () => (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>
    ),
} as const;

export function visibilityLabel(gate: PostGate | null | undefined,): { state: PostGate['state']; label: string; title: string; } {
    const state = gate?.state ?? 'public';
    const tier = gate?.requiredTier?.name;
    if (state === 'locked') {
        return { state, label: tier ?? 'Subscribers', title: tier ? `Requires the ${tier} subscription` : 'Requires a subscription', };
    }
    if (state === 'premium') {
        return { state, label: 'Premium', title: tier ? `Premium content — included in your ${tier} access` : 'Premium content', };
    }
    return { state, label: 'Public', title: 'Free to read', };
}

const PostVisibilityBadge: Component<PostVisibilityBadgeProps> = (props,) => {
    const v = () => visibilityLabel(props.gate,);
    return (
        <Show when={!(props.hidePublic && v().state === 'public')}>
            <span
                class={`post-visibility post-visibility--${v().state}${props.class ? ` ${props.class}` : ''}`}
                title={v().title}
                aria-label={v().title}
                role="img"
            >
                {ICONS[v().state]()}
                <Show when={props.showLabel}>
                    <span class="post-visibility__label">{v().label}</span>
                </Show>
            </span>
        </Show>
    );
};

export default PostVisibilityBadge;
