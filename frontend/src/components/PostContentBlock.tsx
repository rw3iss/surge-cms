import type { SocialPlatform, } from '@surge/shared';
import { Component, Show, } from 'solid-js';
import SocialEmbed from './SocialEmbed';

/** Renders a single post content block on the public post page */
const nd = (val: string | undefined, defaults: string[],): string | undefined => {
    if (!val) return undefined;
    return defaults.includes(val,) ? undefined : val;
};

const PostContentBlock: Component<{ block: any; }> = (props,) => {
    const data = () => props.block.data || {};
    const type = () => props.block.type;
    const blockStyle = () => props.block.style || props.block.data?.styleRef?.custom || {};

    return (
        <div
            class={`post-block post-block--${type()}`}
            style={{
                'background-color': nd(blockStyle()?.backgroundColor, ['#ffffff',],),
                color: nd(blockStyle()?.textColor, ['#000000',],),
                'text-align': nd(blockStyle()?.textAlign, ['left',],),
                display: blockStyle()?.verticalAlign && blockStyle()?.verticalAlign !== 'top' ? 'flex' : undefined,
                'flex-direction': blockStyle()?.verticalAlign && blockStyle()?.verticalAlign !== 'top' ?
                    'column' :
                    undefined,
                'justify-content': blockStyle()?.verticalAlign === 'center' ?
                    'center' :
                    blockStyle()?.verticalAlign === 'bottom' ?
                    'flex-end' :
                    undefined,
                'font-size': nd(blockStyle()?.fontSize, ['16px',],),
                width: nd(blockStyle()?.width, ['100%',],),
                padding: nd(blockStyle()?.padding, ['0px',],),
                margin: nd(blockStyle()?.margin, ['0px',],),
            }}
        >
            <Show when={type() === 'text'}>
                <div class="rich-text" innerHTML={data().content || ''} />
            </Show>

            <Show when={type() === 'image'}>
                <Show when={data().url}>
                    <figure class="post-block__figure">
                        <img
                            src={data().url}
                            alt={data().alt || ''}
                            loading="lazy"
                            style={{
                                'max-width': data().maxWidth ?
                                    (typeof data().maxWidth === 'number' ? `${data().maxWidth}px` : data().maxWidth) :
                                    '100%',
                                'max-height': data().maxHeight ?
                                    (typeof data().maxHeight === 'number' ?
                                        `${data().maxHeight}px` :
                                        data().maxHeight) :
                                    undefined,
                                display: 'block',
                                margin: data().alignment === 'center' ?
                                    '0 auto' :
                                    data().alignment === 'right' ?
                                    '0 0 0 auto' :
                                    undefined,
                            }}
                        />
                        <Show when={data().caption}>
                            <figcaption>{data().caption}</figcaption>
                        </Show>
                    </figure>
                </Show>
            </Show>

            <Show when={type() === 'video'}>
                <Show when={data().url}>
                    <div class="post-block__video">
                        <video
                            src={data().url}
                            controls
                            autoplay={data().autoplay}
                            loop={data().loop}
                            style={{
                                'max-width': data().maxWidth || '100%',
                                'max-height': data().maxHeight || undefined,
                            }}
                        />
                    </div>
                </Show>
            </Show>

            <Show when={type() === 'social_media'}>
                <Show when={data().provider && (data().postId || data().postUrl)}>
                    <SocialEmbed
                        platform={data().provider as SocialPlatform}
                        externalId={data().postId || ''}
                        mediaUrl={data().postUrl}
                        content={data().content}
                    />
                </Show>
            </Show>

            <Show when={type() === 'document'}>
                <Show when={data().url}>
                    <a
                        href={data().url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="post-block__document"
                    >
                        <span class="post-block__document-icon">&#128196;</span>
                        <span>{data().displayName || data().fileName || 'Download document'}</span>
                    </a>
                </Show>
            </Show>

            <Show when={type() === 'url_link'}>
                <Show when={data().url}>
                    <a
                        href={data().url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="post-block__link-card"
                    >
                        <Show when={data().image}>
                            <img src={data().image} alt="" class="post-block__link-image" loading="lazy" />
                        </Show>
                        <div class="post-block__link-body">
                            <Show when={data().siteName}>
                                <span class="post-block__link-site">{data().siteName}</span>
                            </Show>
                            <span class="post-block__link-title">{data().title || data().url}</span>
                            <Show when={data().description}>
                                <span class="post-block__link-desc">{data().description}</span>
                            </Show>
                        </div>
                    </a>
                </Show>
            </Show>
        </div>
    );
};

export default PostContentBlock;
