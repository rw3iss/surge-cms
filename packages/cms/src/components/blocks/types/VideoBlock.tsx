/**
 * Video block.
 *
 * Source precedence:
 *   1. `settings.mediaId` — a library video → `MediaVideo` (HLS / teaser /
 *      access checks; the stored url plays as a plain file if playback fails).
 *   2. A YouTube / Vimeo URL → the provider's iframe player.
 *   3. Any other URL → `VideoPlayer` with the MIME derived from the extension
 *      (`.m3u8` plays as HLS).
 * The URL is `settings.url` (what the admin editor writes), else the legacy
 * `content` column. `settings.showTitle` prints `settings.title` above it, centred.
 */
import { type Block, cssLength, } from '@sitesurge/types';
import { Component, Match, Show, Switch, } from 'solid-js';
import { resolveVideoSource, } from '../../../utils/resolveVideoSource';
import MediaVideo from '../media/MediaVideo';
import VideoPlayer from '../media/VideoPlayer';

export const VideoBlock: Component<{ block: Block; }> = (props,) => {
    const s = () => (props.block.settings || {}) as Record<string, any>;
    const url = () => (s().url as string | undefined) || props.block.content || '';
    const mediaId = () => (s().mediaId as string | undefined) || '';
    const resolved = () => resolveVideoSource({ url: url(), },);
    const sizeStyle = (): Record<string, string> => {
        // A bare number is px; a value with a unit passes through (`cssLength`).
        const maxW = cssLength(s().maxWidth,);
        const maxH = cssLength(s().maxHeight,);
        return {
            ...(maxW ? { 'max-width': maxW, 'margin-inline': 'auto', } : {}),
            // The block's own "Max height" setting caps the player the same way a
            // block style max-height does (MediaVideo reads --block-max-height).
            ...(maxH ? { 'max-height': maxH, '--block-max-height': maxH, } : {}),
        };
    };

    // "Show title": the title (the media's, kept on the block when it is picked;
    // else the block's own) centred above the video.
    const title = () => (s().showTitle === true && typeof s().title === 'string' ? s().title.trim() : '');

    return (
        <div class="video-block" style={sizeStyle()}>
            <Show when={title()}>
                <h3 class="video-block__title">{title()}</h3>
            </Show>
            <Switch>
                <Match when={mediaId()}>
                    <MediaVideo
                        mediaId={mediaId()}
                        autoplay={Boolean(s().autoplay,)}
                        fallbackSrc={url() || undefined}
                    />
                </Match>
                <Match when={url() && resolved().kind === 'embed'}>
                    <div class="video-block__wrapper">
                        <iframe
                            src={resolved().src}
                            frameborder="0"
                            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                            allowfullscreen
                            class="video-block__iframe"
                        />
                    </div>
                </Match>
                <Match when={url()}>
                    <VideoPlayer
                        src={resolved().kind === 'file' ? resolved().src : undefined}
                        hlsSrc={resolved().kind === 'hls' ? resolved().src : undefined}
                        type={resolved().type}
                        autoplay={Boolean(s().autoplay,)}
                        muted={Boolean(s().autoplay,)}
                        loop={Boolean(s().loop,)}
                    />
                </Match>
            </Switch>
        </div>
    );
};
