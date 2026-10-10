/**
 * Who wrote a comment or forum post: avatar, name (linked to their public
 * member page's Comments tab), staff / tier badges, activity count, joined.
 * Shared by Comments and the Forum.
 */
import { A, } from '@solidjs/router';
import type { CommentAuthor, } from '@sitesurge/types';
import { isStaffRole, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';
import './discussions.scss';

export interface AuthorCardProps {
    author: CommentAuthor;
    /** One line (name + badges) instead of the full card. */
    compact?: boolean;
    /** Show "N posts · Joined …". Default true. */
    showStats?: boolean;
    class?: string;
}

export const memberUrl = (handle: string,): string => `/members/${encodeURIComponent(handle,)}?tab=comments`;

const initials = (name: string,): string =>
    name.split(/\s+/,).filter(Boolean,).slice(0, 2,).map((p,) => p[0]!.toUpperCase()).join('',) || '?';

const joined = (iso: string | null,): string =>
    iso ? new Date(iso,).toLocaleDateString(undefined, { month: 'short', year: 'numeric', },) : '';

const AuthorCard: Component<AuthorCardProps> = (props,) => {
    const a = () => props.author;
    const staff = () => !a().isGuest && isStaffRole(a().role ?? undefined,);
    const name = () => (
        <Show when={a().handle} fallback={<span class="author-card__name">{a().name}</span>}>
            {(h,) => <A class="author-card__name author-card__name--link" href={memberUrl(h(),)}>{a().name}</A>}
        </Show>
    );
    return (
        <div class={`author-card${props.compact ? ' author-card--compact' : ''}${props.class ? ` ${props.class}` : ''}`}>
            <Show
                when={a().avatarUrl}
                fallback={<span class="author-card__avatar author-card__avatar--initials" aria-hidden="true">{initials(a().name,)}</span>}
            >
                {(src,) => <img class="author-card__avatar" src={src()} alt="" loading="lazy" />}
            </Show>
            <div class="author-card__text">
                <div class="author-card__line">
                    {name()}
                    <Show when={staff()}>
                        <span class="author-card__badge author-card__badge--staff">Staff</span>
                    </Show>
                    <Show when={a().tierName}>
                        <span class="author-card__badge">{a().tierName}</span>
                    </Show>
                    <Show when={a().isGuest && a().name !== '[deleted]' && a().name !== 'Deleted user'}>
                        <span class="author-card__badge author-card__badge--guest">Guest</span>
                    </Show>
                </div>
                <Show when={!props.compact && props.showStats !== false && !a().isGuest}>
                    <div class="author-card__stats">
                        <span>{a().activityCount} {a().activityCount === 1 ? 'post' : 'posts'}</span>
                        <Show when={a().joinedAt}>
                            <span>Joined {joined(a().joinedAt,)}</span>
                        </Show>
                    </div>
                </Show>
            </div>
        </div>
    );
};

export default AuthorCard;
