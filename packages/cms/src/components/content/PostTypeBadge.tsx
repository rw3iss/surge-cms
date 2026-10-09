/**
 * A post's TYPE (article / video / live / …) as a round icon badge.
 *
 * Icon + label come from the shared post-type registry (`getPostType`), so a
 * site-registered type gets a badge with no change here. A live post that has
 * not ended uses the primary colour and pulses softly.
 *
 *   `variant="float"`  — the card overlay on `/posts` (positioned by the card).
 *   `variant="inline"` — small, beside a title (post page, post-list blocks).
 */
import { getPostType, } from '@sitesurge/types';
import { Component, } from 'solid-js';
import './PostTypeBadge.scss';

export interface PostTypeBadgeProps {
    type?: string | null;
    /** Live posts: stop the pulse once the show ended. */
    ended?: boolean;
    variant?: 'float' | 'inline';
    class?: string;
}

const PostTypeBadge: Component<PostTypeBadgeProps> = (props,) => {
    const def = () => getPostType(props.type,);
    const isLive = () => def().display === 'live';
    const cls = () => [
        'post-type-badge',
        `post-type-badge--${props.variant ?? 'inline'}`,
        `post-type-badge--${def().key}`,
        isLive() ? 'post-type-badge--live' : '',
        isLive() && !props.ended ? 'post-type-badge--pulse' : '',
        props.class ?? '',
    ].filter(Boolean,).join(' ',);
    return (
        <span class={cls()} title={def().label} aria-label={def().label} role="img">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={def().icon} /></svg>
        </span>
    );
};

export default PostTypeBadge;
