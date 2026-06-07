import type { SocialPlatform, } from '@rw/cms-shared';
import { Component, Match, Show, Switch, } from 'solid-js';
import './SocialEmbed.scss';

interface SocialEmbedProps {
    platform: SocialPlatform;
    externalId: string;
    mediaUrl?: string;
    content?: string;
    thumbnailUrl?: string;
    authorName?: string;
}

const PLATFORM_COLORS: Record<SocialPlatform, string> = {
    youtube: '#ff0000',
    instagram: '#e4405f',
    facebook: '#1877f2',
    twitter: '#1da1f2',
    tiktok: '#000000',
    patreon: '#f96854',
};

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
    youtube: 'YouTube',
    instagram: 'Instagram',
    facebook: 'Facebook',
    twitter: 'X / Twitter',
    tiktok: 'TikTok',
    patreon: 'Patreon',
};

const SocialEmbed: Component<SocialEmbedProps> = (props,) => {
    const platformUrl = () => {
        switch (props.platform) {
            case 'youtube':
                return `https://www.youtube.com/watch?v=${props.externalId}`;
            case 'instagram':
                return props.mediaUrl || `https://www.instagram.com/p/${props.externalId}/`;
            case 'twitter':
                return `https://twitter.com/i/status/${props.externalId}`;
            case 'tiktok':
                return `https://www.tiktok.com/video/${props.externalId}`;
            case 'facebook':
                return props.mediaUrl || '#';
            case 'patreon':
                return props.mediaUrl || '#';
            default:
                return props.mediaUrl || '#';
        }
    };

    return (
        <div class={`social-embed social-embed--${props.platform}`}>
            <div class="social-embed__badge" style={{ 'background-color': PLATFORM_COLORS[props.platform], }}>
                {PLATFORM_LABELS[props.platform]}
            </div>

            <div class="social-embed__content">
                <Switch fallback={<PostCard {...props} url={platformUrl()} />}>
                    {/* YouTube: iframe embed works well at 16:9 */}
                    <Match when={props.platform === 'youtube'}>
                        <div class="social-embed__iframe-wrapper social-embed__iframe-wrapper--16x9">
                            <iframe
                                src={`https://www.youtube.com/embed/${props.externalId}`}
                                width="100%"
                                style="aspect-ratio:16/9"
                                frameborder="0"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowfullscreen
                                loading="lazy"
                                title={props.content || 'YouTube video'}
                            />
                        </div>
                    </Match>

                    {/* Everything else: compact card with thumbnail + caption.
                        No iframes — renders cleanly at any size, loads instantly,
                        and links to the original post. */}
                    <Match when={props.platform === 'instagram'}>
                        <PostCard {...props} url={platformUrl()} />
                    </Match>
                    <Match when={props.platform === 'facebook'}>
                        <PostCard {...props} url={platformUrl()} />
                    </Match>
                    <Match when={props.platform === 'twitter'}>
                        <PostCard {...props} url={platformUrl()} />
                    </Match>
                    <Match when={props.platform === 'tiktok'}>
                        <PostCard {...props} url={platformUrl()} />
                    </Match>
                </Switch>
            </div>
        </div>
    );
};

/**
 * Compact social post card — thumbnail, caption, author, and link.
 * Replaces iframes for a cleaner, faster, scroll-free embed.
 *
 * Instagram CDN thumbnail URLs contain time-limited tokens and expire
 * after a few hours/days. When that happens the image 404s. We handle
 * this by hiding the broken image and showing a placeholder gradient
 * with the platform icon instead.
 */
const PostCard: Component<SocialEmbedProps & { url: string; }> = (props,) => {
    const handleImageError = (e: Event,) => {
        const img = e.target as HTMLImageElement;
        // Replace with a styled placeholder
        img.style.display = 'none';
        const placeholder = img.parentElement?.querySelector('.social-embed__card-placeholder',);
        if (placeholder) (placeholder as HTMLElement).style.display = 'flex';
    };

    return (
        <a
            href={props.url}
            target="_blank"
            rel="noopener noreferrer"
            class="social-embed__card"
        >
            <Show when={props.thumbnailUrl}>
                <img
                    src={props.thumbnailUrl}
                    alt=""
                    class="social-embed__card-image"
                    loading="lazy"
                    onError={handleImageError}
                />
                <div class="social-embed__card-placeholder" style={{ display: 'none', }}>
                    <span>{PLATFORM_LABELS[props.platform]}</span>
                </div>
            </Show>
            <Show when={!props.thumbnailUrl}>
                <div class="social-embed__card-placeholder">
                    <span>{PLATFORM_LABELS[props.platform]}</span>
                </div>
            </Show>
            <div class="social-embed__card-body">
                <Show when={props.authorName}>
                    <span class="social-embed__card-author">{props.authorName}</span>
                </Show>
                <Show when={props.content}>
                    <p class="social-embed__card-text">{props.content}</p>
                </Show>
                <span class="social-embed__card-link">
                    View on {PLATFORM_LABELS[props.platform]} &rarr;
                </span>
            </div>
        </a>
    );
};

export default SocialEmbed;
