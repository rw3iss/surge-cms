import type { SocialPlatform, } from '@surge/shared';
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
                return `https://www.instagram.com/p/${props.externalId}/`;
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
                <Switch fallback={<FallbackCard {...props} url={platformUrl()} />}>
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

                    <Match when={props.platform === 'instagram'}>
                        <iframe
                            src={`https://www.instagram.com/p/${props.externalId}/embed`}
                            width="100%"
                            height="480"
                            frameborder="0"
                            loading="lazy"
                            title={props.content || 'Instagram post'}
                            class="social-embed__iframe"
                        />
                    </Match>

                    <Match when={props.platform === 'facebook' && props.mediaUrl}>
                        <iframe
                            src={`https://www.facebook.com/plugins/post.php?href=${
                                encodeURIComponent(props.mediaUrl!,)
                            }&width=500`}
                            width="100%"
                            height="400"
                            frameborder="0"
                            loading="lazy"
                            title={props.content || 'Facebook post'}
                            class="social-embed__iframe"
                        />
                    </Match>

                    <Match when={props.platform === 'twitter'}>
                        <iframe
                            src={`https://platform.twitter.com/embed/Tweet.html?id=${props.externalId}`}
                            width="100%"
                            height="400"
                            frameborder="0"
                            loading="lazy"
                            title={props.content || 'Tweet'}
                            class="social-embed__iframe"
                        />
                    </Match>

                    <Match when={props.platform === 'tiktok'}>
                        <iframe
                            src={`https://www.tiktok.com/embed/v2/${props.externalId}`}
                            width="100%"
                            height="740"
                            frameborder="0"
                            loading="lazy"
                            title={props.content || 'TikTok video'}
                            class="social-embed__iframe"
                        />
                    </Match>

                    <Match when={props.platform === 'patreon'}>
                        <FallbackCard {...props} url={platformUrl()} />
                    </Match>
                </Switch>
            </div>
        </div>
    );
};

const FallbackCard: Component<SocialEmbedProps & { url: string; }> = (props,) => (
    <a
        href={props.url}
        target="_blank"
        rel="noopener noreferrer"
        class="social-embed__fallback"
    >
        <Show when={props.thumbnailUrl}>
            <img
                src={props.thumbnailUrl}
                alt=""
                class="social-embed__fallback-thumb"
                loading="lazy"
            />
        </Show>
        <div class="social-embed__fallback-body">
            <Show when={props.authorName}>
                <span class="social-embed__fallback-author">{props.authorName}</span>
            </Show>
            <Show when={props.content}>
                <p class="social-embed__fallback-text">{props.content}</p>
            </Show>
            <span class="social-embed__fallback-link">
                View on {PLATFORM_LABELS[props.platform]} &rarr;
            </span>
        </div>
    </a>
);

export default SocialEmbed;
