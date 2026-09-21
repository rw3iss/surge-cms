import {
    resolveSocialDisplay,
    type SocialMediaDisplay,
    SOCIAL_THUMB_WIDTH,
    type SocialDisplay,
    type SocialPlatform,
    usesPlayer,
} from '@sitesurge/types';
import { Component, Match, onCleanup, onMount, Show, Switch, } from 'solid-js';
import { attachYouTubePlayer, } from './playbackCoordinator';
import './SocialEmbed.scss';

interface SocialEmbedProps {
    platform: SocialPlatform;
    externalId: string;
    mediaUrl?: string;
    content?: string;
    thumbnailUrl?: string;
    authorName?: string;
    /**
     * Content kind. A YouTube Short is a 9:16 video; rendering it in the 16:9
     * box pillarboxes it to a sliver, and YouTube collapses its control set
     * (fullscreen included) once the player is that small — which is why
     * auto-pulled Shorts looked and behaved differently from hand-embedded ones.
     */
    mediaKind?: 'short' | 'live' | 'video' | null;
    /**
     * Media presentation, from the block's settings.
     *
     * `full` (default) keeps the previous behaviour — an embedded player for
     * YouTube, a full-width card otherwise. `medium`/`small` render a capped
     * THUMBNAIL that links out: at those widths a player is the wrong element,
     * since it would still load an iframe and still claim a 16:9 box.
     */
    mediaDisplay?: SocialMediaDisplay;
    /** Show the post's title beneath the media. */
    showTitle?: boolean;
    /** Show the author / channel name. Off by default. */
    showAuthor?: boolean;
    /** Show the post's publish date, right-aligned beside the title. */
    showDate?: boolean;
    /** ISO publish date, when known. */
    publishedAt?: string;
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
    /** The block's media/title settings, defaulted. Shared with the email
     *  renderer so a block looks the same in both. */
    const display = () => resolveSocialDisplay({
        mediaDisplay: props.mediaDisplay,
        showTitle: props.showTitle,
        showAuthor: props.showAuthor,
        showDate: props.showDate,
    },);

    // Only the YouTube branch renders an iframe; every other provider is a
    // thumbnail card that links out and has nothing to pause.
    let ytIframe: HTMLIFrameElement | undefined;
    onMount(() => {
        if (!ytIframe) return;
        onCleanup(attachYouTubePlayer(ytIframe,),);
    },);

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
                <Switch fallback={<PostCard {...props} url={platformUrl()} display={display()} />}>
                    {/* A capped size always renders as a thumbnail — the player
                        is only appropriate when it can fill the space. */}
                    <Match when={!usesPlayer(props.platform, display().mediaDisplay,)
                        && display().mediaDisplay !== 'full'}>
                        <PostCard {...props} url={platformUrl()} display={display()} />
                    </Match>
                    {/* YouTube at full size: iframe embed works well at 16:9 */}
                    <Match when={props.platform === 'youtube'}>
                        <div
                            class={`social-embed__iframe-wrapper social-embed__iframe-wrapper--${
                                props.mediaKind === 'short' ? '9x16' : '16x9'
                            }`}
                        >
                            {/* The aspect ratio lives in the stylesheet, keyed off the
                                wrapper's --9x16/--16x9 class, NOT inline here.

                                An inline style is unbeatable by any rule that doesn't
                                use !important — which the cascade-layer doctrine rules
                                out — so an inline `aspect-ratio` made the player's
                                height uncontrollable: setting Item Height grew the card
                                and left the video its 16:9 box, with dead space below.
                                The wrapper class already encodes the ratio, so this was
                                a duplicate that happened to win. */}
                            <iframe
                                // enablejsapi=1 is what lets the page both send the
                                // player commands and hear when it starts — without it
                                // the frame ignores postMessage entirely. See
                                // playbackCoordinator: only one social post plays at a
                                // time, page-wide.
                                src={`https://www.youtube.com/embed/${props.externalId}?enablejsapi=1`}
                                ref={ytIframe}
                                width="100%"
                                frameborder="0"
                                // web-share matches what a hand-written embed carries; without
                                // it the player drops its share affordance.
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                allowfullscreen
                                loading="lazy"
                                title={props.content || 'YouTube video'}
                            />
                        </div>
                        <SocialMeta {...props} url={platformUrl()} display={display()} />
                    </Match>

                    {/* Everything else: compact card with thumbnail + caption.
                        No iframes — renders cleanly at any size, loads instantly,
                        and links to the original post. */}
                    <Match when={props.platform === 'instagram'}>
                        <PostCard {...props} url={platformUrl()} display={display()} />
                    </Match>
                    <Match when={props.platform === 'facebook'}>
                        <PostCard {...props} url={platformUrl()} display={display()} />
                    </Match>
                    <Match when={props.platform === 'twitter'}>
                        <PostCard {...props} url={platformUrl()} display={display()} />
                    </Match>
                    <Match when={props.platform === 'tiktok'}>
                        <PostCard {...props} url={platformUrl()} display={display()} />
                    </Match>
                </Switch>
            </div>
        </div>
    );
};


/**
 * The row beneath a post's media: title on the left, date on the right, with
 * the author below when enabled.
 *
 *   [        media        ]
 *   [title]          [date]
 *   [author?]
 *
 * Shared by the full-size player and the thumbnail card so the two lay out
 * identically, and mirrored by the email renderer (which builds the same shape
 * as a two-cell table, the only layout every mail client agrees on).
 *
 * The title links to the post, as the media does — with no player at small
 * sizes, and none at all in email, the link is the whole affordance. A separate
 * "Watch" button was redundant and read as an advert.
 */
const SocialMeta: Component<SocialEmbedProps & { url: string; display: SocialDisplay; }> = (props,) => {
    const dateText = () => {
        if (!props.display.showDate || !props.publishedAt) return '';
        const d = new Date(props.publishedAt,);
        if (Number.isNaN(d.getTime(),)) return '';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', },);
    };
    const showTitle = () => props.display.showTitle && Boolean(props.content,);

    return (
        <Show when={showTitle() || dateText() || (props.display.showAuthor && props.authorName)}>
            <div class="social-embed__meta">
                <Show when={showTitle() || dateText()}>
                    <div class="social-embed__meta-row">
                        <Show when={showTitle()}>
                            <h3 class="social-embed__title">
                                <a href={props.url} target="_blank" rel="noopener noreferrer">{props.content}</a>
                            </h3>
                        </Show>
                        <Show when={dateText()}>
                            <span class="social-embed__date">{dateText()}</span>
                        </Show>
                    </div>
                </Show>
                <Show when={props.display.showAuthor && props.authorName}>
                    <span class="social-embed__author">{props.authorName}</span>
                </Show>
            </div>
        </Show>
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
const PostCard: Component<SocialEmbedProps & {
    url: string;
    display: SocialDisplay;
}> = (props,) => {
    /** Cap the thumbnail at the configured size. `full` is uncapped so it keeps
     *  behaving as a fluid element rather than a very wide fixed one. */
    const thumbWidth = () => SOCIAL_THUMB_WIDTH[props.display.mediaDisplay];
    const handleImageError = (e: Event,) => {
        const img = e.target as HTMLImageElement;
        // Replace with a styled placeholder
        img.style.display = 'none';
        const placeholder = img.parentElement?.querySelector('.social-embed__card-placeholder',);
        if (placeholder) (placeholder as HTMLElement).style.display = 'flex';
    };

    // A DIV, not an anchor wrapping the whole card: the title inside is its own
    // link (as requested — thumbnail and title both go to the post), and an
    // <a> inside an <a> is invalid HTML that browsers silently re-nest.
    return (
        <div
            class={`social-embed__card social-embed__card--${props.display.mediaDisplay}`}
            style={thumbWidth() ? { 'max-width': `${thumbWidth()}px`, } : undefined}
        >
            <a href={props.url} target="_blank" rel="noopener noreferrer" class="social-embed__card-media">
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
            </a>
            <div class="social-embed__card-body">
                <SocialMeta {...props} />
            </div>
        </div>
    );
};

export default SocialEmbed;
