import type { Block, Campaign, Form, Post, SocialPlatform, SocialPost, } from '@surge/shared';
import { Component, createResource, For, Match, Show, Switch, } from 'solid-js';
import { api, fetchSocialPosts, } from '../../services/api';
import SocialEmbed from '../SocialEmbed';
import './BlockRenderer.scss';

interface BlockRendererProps {
    block: Block;
}

/** Only return a style value if it's non-default (avoids overriding CSS class styles with defaults) */
const nonDefault = (val: string | undefined, defaults: string[],): string | undefined => {
    if (!val) return undefined;
    return defaults.includes(val,) ? undefined : val;
};

export const BlockRenderer: Component<BlockRendererProps> = (props,) => {
    const blockStyle = () => (props.block as any).style as Record<string, any> | undefined;
    const s = () => blockStyle() || {};

    return (
        <div
            class={`block block--${props.block.type}`}
            style={{
                'background-color': nonDefault(s().backgroundColor, ['#ffffff',],) ||
                    props.block.settings.backgroundColor as string,
                color: nonDefault(s().textColor, ['#000000',],) || props.block.settings.textColor as string,
                'text-align': nonDefault(s().textAlign, ['left',],),
                display: s().verticalAlign && s().verticalAlign !== 'top' ? 'flex' : undefined,
                'flex-direction': s().verticalAlign && s().verticalAlign !== 'top' ? 'column' : undefined,
                'justify-content': s().verticalAlign === 'center' ?
                    'center' :
                    s().verticalAlign === 'bottom' ?
                    'flex-end' :
                    undefined,
                'font-size': nonDefault(s().fontSize, ['16px',],),
                width: nonDefault(s().width, ['100%',],),
                padding: nonDefault(s().padding, ['0px',],) || props.block.settings.padding as string,
                margin: nonDefault(s().margin, ['0px',],),
            }}
        >
            <div class={`block__inner block__inner--${props.block.settings.layout || 'contained'}`}>
                <Switch>
                    <Match when={props.block.type === 'hero'}>
                        <HeroBlock block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'rich_text'}>
                        <RichTextBlock block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'image'}>
                        <ImageBlock block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'video'}>
                        <VideoBlock block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'post'}>
                        <PostBlock block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'form'}>
                        <FormBlock block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'campaign'}>
                        <CampaignBlock block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'social_feed'}>
                        <SocialFeedBlock block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'html'}>
                        <HTMLBlock block={props.block} />
                    </Match>
                </Switch>
            </div>
        </div>
    );
};

const HeroBlock: Component<{ block: Block; }> = (props,) => (
    <section class="hero-block">
        <Show when={props.block.title}>
            <h1 class="hero-block__title">{props.block.title}</h1>
        </Show>
        <Show when={props.block.content}>
            <p class="hero-block__content">{props.block.content}</p>
        </Show>
    </section>
);

const RichTextBlock: Component<{ block: Block; }> = (props,) => (
    <div class="rich-text-block">
        <Show when={props.block.title}>
            <h2 class="rich-text-block__title">{props.block.title}</h2>
        </Show>
        <div class="rich-text" innerHTML={props.block.content || ''} />
    </div>
);

const ImageBlock: Component<{ block: Block; }> = (props,) => {
    const imageUrl = () =>
        props.block.content ||
        (props.block.settings.url as string) ||
        '';
    const altText = () => (props.block.settings.alt as string) || props.block.title || '';
    const maxW = () => {
        const v = props.block.settings.maxWidth;
        if (!v) return undefined;
        return typeof v === 'number' ? `${v}px` : String(v,);
    };
    const maxH = () => {
        const v = props.block.settings.maxHeight;
        if (!v) return undefined;
        return typeof v === 'number' ? `${v}px` : String(v,);
    };
    const alignment = () => props.block.settings.alignment as string || 'left';
    const imgMargin = () =>
        alignment() === 'center' ?
            '0 auto' :
            alignment() === 'right' ?
            '0 0 0 auto' :
            undefined;

    return (
        <div class="image-block">
            <Show when={props.block.title}>
                <h2 class="image-block__title">{props.block.title}</h2>
            </Show>
            <Show when={imageUrl()}>
                <img
                    src={imageUrl()}
                    alt={altText()}
                    class="image-block__img"
                    loading="lazy"
                    style={{
                        'max-width': maxW() || '100%',
                        'max-height': maxH(),
                        display: 'block',
                        margin: imgMargin(),
                    }}
                />
            </Show>
            <Show when={props.block.settings.caption}>
                <p class="image-block__caption">{props.block.settings.caption as string}</p>
            </Show>
        </div>
    );
};

const VideoBlock: Component<{ block: Block; }> = (props,) => (
    <div class="video-block">
        <Show when={props.block.title}>
            <h2 class="video-block__title">{props.block.title}</h2>
        </Show>
        <Show when={props.block.content}>
            <div class="video-block__wrapper">
                <iframe
                    src={props.block.content}
                    frameborder="0"
                    allowfullscreen
                    class="video-block__iframe"
                />
            </div>
        </Show>
    </div>
);

const PostBlock: Component<{ block: Block; }> = (props,) => {
    const postId = () => props.block.settings.postId as string;

    const [post,] = createResource(postId, async (id,) => {
        if (!id) return null;
        const response = await api.get<Post>(`/posts/${id}`,);
        return response.success ? response.data : null;
    },);

    return (
        <Show when={post()}>
            <article class="post-block">
                <Show when={post()!.featuredImage}>
                    <img src={post()!.featuredImage} alt={post()!.title} class="post-block__image" />
                </Show>
                <h2 class="post-block__title">{post()!.title}</h2>
                <div class="rich-text" innerHTML={post()!.content} />
            </article>
        </Show>
    );
};

const FormBlock: Component<{ block: Block; }> = (props,) => {
    const formId = () => props.block.settings.formId as string;

    return (
        <Show when={formId()}>
            <div class="form-block">
                {/* Form component would be rendered here */}
                <p>Form: {formId()}</p>
            </div>
        </Show>
    );
};

const CampaignBlock: Component<{ block: Block; }> = (props,) => {
    const campaignId = () => props.block.settings.campaignId as string;

    const [campaign,] = createResource(campaignId, async (id,) => {
        if (!id) return null;
        const response = await api.get<Campaign>(`/campaigns/${id}`,);
        return response.success ? response.data : null;
    },);

    return (
        <Show when={campaign()}>
            <div class="campaign-block">
                <h2 class="campaign-block__title">{campaign()!.title}</h2>
                <p class="campaign-block__desc">{campaign()!.shortDescription}</p>
                <div class="campaign-block__progress">
                    <div
                        class="campaign-block__progress-bar"
                        style={{
                            width: `${
                                Math.min((campaign()!.currentAmountCents / campaign()!.goalAmountCents) * 100, 100,)
                            }%`,
                        }}
                    />
                </div>
                <p class="campaign-block__stats">
                    ${(campaign()!.currentAmountCents / 100).toLocaleString()}{' '}
                    of ${(campaign()!.goalAmountCents / 100).toLocaleString()}
                </p>
            </div>
        </Show>
    );
};

const SocialFeedBlock: Component<{ block: Block; }> = (props,) => {
    const platform = () => props.block.settings.socialPlatform as SocialPlatform | undefined;

    const [posts,] = createResource(platform, async (p,) => {
        const response = await fetchSocialPosts(p, 6,);
        return response.success ? (response.data as SocialPost[]) : [];
    },);

    return (
        <div class="social-feed-block">
            <Show when={props.block.title}>
                <h2 class="social-feed-block__title">{props.block.title}</h2>
            </Show>
            <Show
                when={posts()?.length}
                fallback={
                    <Show when={!posts.loading}>
                        <p class="social-feed-block__empty">No social posts available.</p>
                    </Show>
                }
            >
                <div class="social-feed-block__grid">
                    <For each={posts()}>
                        {(post,) => (
                            <SocialEmbed
                                platform={post.platform}
                                externalId={post.externalId}
                                mediaUrl={post.mediaUrl}
                                content={post.content}
                                thumbnailUrl={post.thumbnailUrl}
                                authorName={post.authorName}
                            />
                        )}
                    </For>
                </div>
            </Show>
        </div>
    );
};

const HTMLBlock: Component<{ block: Block; }> = (props,) => (
    <div class="html-block" innerHTML={props.block.content || ''} />
);
