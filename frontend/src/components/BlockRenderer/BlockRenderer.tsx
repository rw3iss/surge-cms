import type { Block, Campaign, Form, HeroCarouselOptions, HeroItem, Post, SocialPlatform, SocialPost, } from '@surge/shared';
import { A, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Match, onMount, Show, Switch, } from 'solid-js';
import { api, fetchAppearance, fetchSocialPosts, } from '../../services/api';
import FormRenderer from '../FormRenderer';
import HeroCarousel from '../HeroCarousel';
import SocialEmbed from '../SocialEmbed';
import './BlockRenderer.scss';

interface BlockRendererProps {
    block: Block;
}

export const BlockRenderer: Component<BlockRendererProps> = (props,) => {
    const blockStyle = () => (props.block as any).style as Record<string, any> | undefined;
    const s = () => blockStyle() || {};

    return (
        <div
            class={`block block--${props.block.type}`}
            style={{
                'background-color': (s().backgroundColor || props.block.settings.backgroundColor as string) || undefined,
                color: s().textColor || props.block.settings.textColor as string || undefined,
                'text-align': s().textAlign || undefined,
                display: s().verticalAlign && s().verticalAlign !== 'top' ? 'flex' : undefined,
                'flex-direction': s().verticalAlign && s().verticalAlign !== 'top' ? 'column' : undefined,
                'justify-content': s().verticalAlign === 'center' ?
                    'center' :
                    s().verticalAlign === 'bottom' ?
                    'flex-end' :
                    undefined,
                'font-size': s().fontSize || undefined,
                width: s().width || undefined,
                height: s().height || undefined,
                padding: s().padding || (props.block.settings.padding as string) ||
                    (props.block.settings.useDefaultPadding === false ? undefined : 'var(--site-block-padding, 0)'),
                margin: (() => {
                    const m = s().margin;
                    if (!m) return undefined;
                    const parts = m.trim().split(/\s+/,);
                    return parts.length === 1 && m !== 'auto' ? `${m} auto` : m;
                })(),
                'overflow-x': s().overflowX || undefined,
                'overflow-y': s().overflowY || undefined,
            }}
        >
            <div
                class={`block__inner block__inner--${
                    props.block.settings.layout ||
                    (['carousel', 'hero',].includes(props.block.type,) ? 'full' : 'contained')
                }`}
                style={{
                    ...(s().gap ? { display: 'flex', 'flex-direction': 'column', gap: s().gap, } : {}),
                    ...(s().overflowX ? { 'overflow-x': s().overflowX, 'max-width': '100%', } : {}),
                    ...(s().overflowY ? { 'overflow-y': s().overflowY, } : {}),
                }}
            >
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
                    <Match when={props.block.type === 'social_media'}>
                        <SocialMediaEmbed block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'text'}>
                        <RichTextBlock block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'document'}>
                        <DocumentLink block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'url_link'}>
                        <UrlLinkCard block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'html'}>
                        <HTMLBlock block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'carousel'}>
                        <CarouselBlockRenderer block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'spacer'}>
                        <div
                            style={{
                                height: (props.block.settings?.height as string) || '60px',
                            }}
                        />
                    </Match>
                </Switch>
            </div>
        </div>
    );
};

const HeroBlock: Component<{ block: Block; }> = (props,) => {
    const bgImage = () => (props.block.settings.backgroundImage as string) || undefined;
    const bgSize = () => (props.block.settings.backgroundSize as string) || 'cover';
    const heroTitle = () => props.block.title || (props.block.settings.title as string) || '';
    const heroSubtitle = () => (props.block.settings.subtitle as string) || '';
    const isFullWidth = () => (props.block.settings.heroWidth as string) !== 'page';

    return (
        <section
            class={`hero-block ${isFullWidth() ? 'hero-block--full' : 'hero-block--page'}`}
            style={{
                ...(bgImage() ? {
                    'background-image': `url(${bgImage()})`,
                    'background-size': bgSize(),
                    'background-position': 'center',
                    'background-repeat': 'no-repeat',
                } : {}),
                'min-height': (props.block.settings.minHeight as string) || undefined,
            }}
        >
            <Show when={heroTitle()}>
                <h1 class="hero-block__title">{heroTitle()}</h1>
            </Show>
            <Show when={heroSubtitle()}>
                <p class="hero-block__subtitle">{heroSubtitle()}</p>
            </Show>
            <Show when={props.block.content}>
                <div class="hero-block__content rich-text" innerHTML={props.block.content} />
            </Show>
        </section>
    );
};

const RichTextBlock: Component<{ block: Block; }> = (props,) => (
    <div class="rich-text-block">
        <div class="rich-text" innerHTML={props.block.content || (props.block.settings?.content as string) || ''} />
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
    const formSlug = () => props.block.settings.slug as string;

    const [form,] = createResource(
        () => formId() || formSlug(),
        async () => {
            const id = formId();
            const slug = formSlug();
            // Try slug first if available (public endpoint), then fall back to id
            if (slug) {
                const response = await api.get<Form>(`/forms/slug/${slug}`,);
                if (response.success && response.data) return response.data;
            }
            if (id) {
                const response = await api.get<Form>(`/forms/${id}`,);
                if (response.success && response.data) return response.data;
            }
            return null;
        },
    );

    return (
        <Show when={form()} fallback={
            <Show when={form.loading}>
                <p style={{ color: '#999', 'text-align': 'center', padding: '1rem', }}>Loading form...</p>
            </Show>
        }>
            <div class="form-block">
                <FormRenderer form={form()!} inline={true} />
            </div>
        </Show>
    );
};

const ALL_CAMPAIGNS_ID = '__all-campaigns__';

const CampaignCard: Component<{ campaign: Campaign; }> = (props,) => (
    <A href={`/campaigns/${props.campaign.slug}`} class="campaign-block" style={{ 'text-decoration': 'none', color: 'inherit', display: 'block', }}>
        <h2 class="campaign-block__title">{props.campaign.title}</h2>
        <p class="campaign-block__desc">{props.campaign.shortDescription}</p>
        <div class="campaign-block__progress">
            <div
                class="campaign-block__progress-bar"
                style={{
                    width: `${
                        Math.min(
                            (props.campaign.currentAmountCents / props.campaign.goalAmountCents) * 100,
                            100,
                        )
                    }%`,
                }}
            />
        </div>
        <p class="campaign-block__stats">
            ${(props.campaign.currentAmountCents / 100).toLocaleString()}{' '}
            of ${(props.campaign.goalAmountCents / 100).toLocaleString()}
        </p>
    </A>
);

const CampaignBlock: Component<{ block: Block; }> = (props,) => {
    const campaignId = () => props.block.settings.campaignId as string;
    const isAllCampaigns = () => campaignId() === ALL_CAMPAIGNS_ID;

    const [campaign,] = createResource(
        () => isAllCampaigns() ? null : campaignId(),
        async (id,) => {
            if (!id) return null;
            const response = await api.get<Campaign>(`/campaigns/${id}`,);
            return response.success ? response.data : null;
        },
    );

    const [allCampaigns,] = createResource(
        () => isAllCampaigns() ? 'active' : null,
        async () => {
            const sortBy = (props.block.settings.sortBy as string) || 'created_at';
            const sortOrder = (props.block.settings.sortOrder as string) || 'desc';
            const params = new URLSearchParams({
                includePast: 'false',
                activeOnly: 'true',
                sortBy,
                sortOrder,
            },);
            const response = await api.get(`/campaigns/public?${params.toString()}`,);
            if (response.success && response.data) {
                const data = response.data;
                return Array.isArray(data) ? data as Campaign[] : (data as any).data || [];
            }
            return [];
        },
    );

    const gap = () => {
        const style = (props.block as any).style;
        return style?.gap || '1rem';
    };

    const direction = () => (props.block.settings.direction as string) || 'vertical';
    const isHorizontal = () => direction() === 'horizontal';

    return (
        <>
            <Show when={!isAllCampaigns() && campaign()}>
                <CampaignCard campaign={campaign()!} />
            </Show>
            <Show when={isAllCampaigns()}>
                <Show when={allCampaigns.loading}>
                    <p style={{ color: '#999', 'text-align': 'center', padding: '1rem', }}>Loading campaigns...</p>
                </Show>
                <Show when={!allCampaigns.loading && allCampaigns()?.length === 0}>
                    <p style={{ color: '#999', 'text-align': 'center', padding: '1rem', }}>No active campaigns.</p>
                </Show>
                <Show when={!allCampaigns.loading && (allCampaigns()?.length ?? 0) > 0}>
                    <div
                        class={`campaign-block-list ${isHorizontal() ? 'campaign-block-list--horizontal' : ''}`}
                        style={{
                            display: 'flex',
                            'flex-direction': isHorizontal() ? 'row' : 'column',
                            'flex-wrap': isHorizontal() ? 'wrap' : undefined,
                            'justify-content': isHorizontal() ? 'center' : undefined,
                            gap: gap(),
                        }}
                    >
                        <For each={allCampaigns()!}>
                            {(c,) => <CampaignCard campaign={c} />}
                        </For>
                    </div>
                </Show>
            </Show>
        </>
    );
};

const FEED_LAYOUT_CLASS: Record<string, string> = {
    'grid': 'social-feed-block__grid',
    '2-col': 'social-feed-block__grid social-feed-block__grid--2col',
    '1-col': 'social-feed-block__grid social-feed-block__grid--1col',
    'row': 'social-feed-block__grid social-feed-block__grid--row',
};

const SocialFeedBlock: Component<{ block: Block; }> = (props,) => {
    const platform = () => props.block.settings.socialPlatform as SocialPlatform | undefined;
    const limit = () => (props.block.settings.limit as number) || 6;
    const layout = () => (props.block.settings.layout as string) || 'grid';
    const snapScroll = () => props.block.settings.snapScroll as boolean ?? false;
    const rowHeight = () => (props.block.settings.rowHeight as string) || undefined;
    const blockStyle = () => (props.block as any).style as Record<string, any> | undefined;

    const [posts,] = createResource(
        () => `${platform()}:${limit()}`,
        async () => {
            const p = platform();
            if (!p) return [];
            const response = await fetchSocialPosts(p, limit(),);
            return response.success ? (response.data as SocialPost[]) : [];
        },
    );

    const hasRowHeight = () => layout() === 'row' && !!rowHeight();

    return (
        <div
            class={`social-feed-block${hasRowHeight() ? ' social-feed-block--has-height' : ''}`}
            style={hasRowHeight() ? { height: rowHeight(), } : undefined}
        >
            <Show
                when={posts()?.length}
                fallback={
                    <Show when={!posts.loading}>
                        <p class="social-feed-block__empty">No social posts available.</p>
                    </Show>
                }
            >
                <div
                    class={`${FEED_LAYOUT_CLASS[layout()] || FEED_LAYOUT_CLASS.grid}${
                        !snapScroll() ? ' social-feed-block__grid--no-snap' : ''
                    }`}
                    style={{
                        ...(blockStyle()?.padding ? { padding: blockStyle()!.padding, } : {}),
                        ...(blockStyle()?.gap ? { gap: blockStyle()!.gap, } : {}),
                    }}
                >
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

const SocialMediaEmbed: Component<{ block: Block; }> = (props,) => {
    const s = () => props.block.settings || {};
    return (
        <Show when={s().provider && (s().postId || s().postUrl)}>
            <SocialEmbed
                platform={s().provider as SocialPlatform}
                externalId={String(s().postId || '',)}
                mediaUrl={s().postUrl as string}
                content={(s().content || props.block.content) as string}
                thumbnailUrl={s().thumbnailUrl as string}
                authorName={s().authorName as string}
            />
        </Show>
    );
};

const DocumentLink: Component<{ block: Block; }> = (props,) => {
    const s = () => props.block.settings || {};
    return (
        <Show when={s().url}>
            <a
                href={s().url as string}
                target="_blank"
                rel="noopener noreferrer"
                class="post-block__document"
            >
                <span>&#128196;</span>
                <span>{(s().displayName || s().fileName || 'Download document') as string}</span>
            </a>
        </Show>
    );
};

const UrlLinkCard: Component<{ block: Block; }> = (props,) => {
    const s = () => props.block.settings || {};
    return (
        <Show when={s().url}>
            <a
                href={s().url as string}
                target="_blank"
                rel="noopener noreferrer"
                class="post-block__link-card"
            >
                <Show when={s().image}>
                    <img src={s().image as string} alt="" class="post-block__link-image" loading="lazy" />
                </Show>
                <div class="post-block__link-body">
                    <Show when={s().siteName}>
                        <span class="post-block__link-site">{s().siteName as string}</span>
                    </Show>
                    <span class="post-block__link-title">{(s().title || s().url) as string}</span>
                    <Show when={s().description}>
                        <span class="post-block__link-desc">{s().description as string}</span>
                    </Show>
                </div>
            </a>
        </Show>
    );
};

const HTMLBlock: Component<{ block: Block; }> = (props,) => (
    <div class="html-block" innerHTML={props.block.content || (props.block.settings?.content as string) || ''} />
);

const CarouselBlockRenderer: Component<{ block: Block; }> = (props,) => {
    const s = () => props.block.settings || {};
    const items = () => (s().items as HeroItem[]) || [];
    const options = () => ({
        autoScroll: false,
        autoScrollInterval: 3000,
        repeat: true,
        customHeight: false,
        height: '50vh',
        ...(s().options as Partial<HeroCarouselOptions> || {}),
    } as HeroCarouselOptions);

    // Use onMount instead of createResource to avoid Suspense jumps
    const [appearance, setAppearance,] = createSignal<any>(null,);
    onMount(async () => {
        try {
            const res = await fetchAppearance();
            if (res.success) setAppearance(res.data,);
        } catch { /* ignore */ }
    },);

    return (
        <Show when={items().length > 0} fallback={<div style={{ padding: '2rem', color: '#999', 'text-align': 'center', }}>No carousel items</div>}>
            <HeroCarousel
                items={items()}
                options={options()}
                gutterWidth={appearance()?.gutterWidth}
            />
        </Show>
    );
};
