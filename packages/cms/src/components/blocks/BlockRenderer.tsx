import type { Block, Campaign, Form, HeroCarouselOptions, HeroItem, Post, SocialPlatform, SocialPost, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, Match, onCleanup, onMount, Show, Switch, } from 'solid-js';
import { Portal, } from 'solid-js/web';
import { cms, } from '../../services/cmsClient';
import { colorCssValue, } from '../../services/colorResolver';
import FormRenderer from '../forms/FormRenderer';
import ResolvedHeroCarousel from './ResolvedHeroCarousel';
import PostListRenderer, { type PostListSettings, } from './posts/PostListRenderer';
import SocialEmbed from './social/SocialEmbed';
import './BlockRenderer.scss';

/** Render a stored color value through the swatch resolver. Returns
 *  `undefined` when nothing should be emitted so the consumer can drop
 *  the property entirely (matches the prior `value || undefined` shape). */
function color(value: string | undefined,): string | undefined {
    return colorCssValue(value, '',) || undefined;
}

interface BlockRendererProps {
    block: Block;
}

export const BlockRenderer: Component<BlockRendererProps> = (props,) => {
    const blockStyle = () => props.block.style as Record<string, any> | undefined;
    const s = () => blockStyle() || {};

    return (
        <div
            class={`block block--${props.block.type}`}
            style={{
                'background-color': color(s().backgroundColor || (props.block.settings.backgroundColor as string),),
                color: color(s().textColor || (props.block.settings.textColor as string),),
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
                    <Match when={props.block.type === 'post_list'}>
                        <PostListRenderer settings={(props.block.settings || {}) as PostListSettings} />
                    </Match>
                    <Match when={props.block.type === 'form'}>
                        <FormBlock block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'campaign'}>
                        <CampaignBlock block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'social'}>
                        <SocialBlock block={props.block} />
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
                    <Match when={props.block.type === 'group'}>
                        <GroupBlock block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'group_item'}>
                        <GroupItemBlock block={props.block} />
                    </Match>
                    {/* Removed block types render a polite fallback on the
                        public site so an old page doesn't go blank.
                        Gallery is removed; legacy `post` blocks still
                        have a renderer (above) until Phase 4 removes them. */}
                    <Match when={props.block.type === 'gallery'}>
                        <div class="block--legacy" style={{ padding: '0.75rem', color: 'var(--site-text-muted, #6b7280)', 'font-size': '0.875rem', 'font-style': 'italic', }}>
                            (Gallery blocks are no longer supported — please update this page.)
                        </div>
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

interface PublicImageItem {
    id: string;
    url: string;
    alt?: string;
    caption?: string;
    link?: string;
    allowMaximize?: boolean;
}

/** Build the rendered image list, coalescing legacy single-image blocks
 *  (top-level `url` field) into a one-item array for a uniform render path. */
function resolvePublicImages(block: Block,): PublicImageItem[] {
    const s = (block.settings || {}) as Record<string, any>;
    if (Array.isArray(s.images,) && s.images.length > 0) {
        return s.images.map((img: any,) => ({
            id: img.id,
            url: img.url || '',
            alt: img.alt,
            caption: img.caption,
            link: img.link,
            allowMaximize: img.allowMaximize === true,
        }),).filter(i => i.url);
    }
    const legacyUrl = block.content || (s.url as string) || '';
    if (!legacyUrl) return [];
    return [{
        id: 'legacy',
        url: legacyUrl,
        alt: (s.alt as string) || block.title || '',
        caption: s.caption as string | undefined,
        allowMaximize: s.allowMaximize === true,
    },];
}

const ImageBlock: Component<{ block: Block; }> = (props,) => {
    const items = () => resolvePublicImages(props.block,);
    const s = () => (props.block.settings || {}) as Record<string, any>;
    const direction = () => (s().direction as string) || 'horizontal';
    const itemMinWidth = () => (s().itemMinWidth as string) || undefined;
    const itemMaxWidth = () => (s().itemMaxWidth as string) || undefined;
    const itemMinHeight = () => (s().itemMinHeight as string) || undefined;
    const itemMaxHeight = () => (s().itemMaxHeight as string) || undefined;

    // Legacy single-image alignment / maxWidth fields stay supported for
    // pages that haven't been re-edited since the multi-image upgrade.
    const alignment = () => s().alignment as string || 'left';
    const legacyMaxW = () => {
        const v = s().maxWidth;
        if (!v) return undefined;
        return typeof v === 'number' ? `${v}px` : String(v,);
    };
    const legacyMaxH = () => {
        const v = s().maxHeight;
        if (!v) return undefined;
        return typeof v === 'number' ? `${v}px` : String(v,);
    };
    const imgMargin = () =>
        alignment() === 'center' ?
            '0 auto' :
            alignment() === 'right' ?
            '0 0 0 auto' :
            undefined;

    const isMulti = () => items().length > 1 || Array.isArray(s().images,);
    const allowMaximizeAny = () => items().some(i => i.allowMaximize === true,);

    /** Currently-maximized image url; null when modal closed. */
    const [maximizedUrl, setMaximizedUrl,] = createSignal<string | null>(null,);

    createEffect(() => {
        if (!maximizedUrl()) return;
        const onKey = (e: KeyboardEvent,) => {
            if (e.key === 'Escape') setMaximizedUrl(null,);
        };
        document.addEventListener('keydown', onKey,);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        onCleanup(() => {
            document.removeEventListener('keydown', onKey,);
            document.body.style.overflow = prevOverflow;
        },);
    },);

    /** Container layout depends on multi vs single. Multi uses flex and
     *  flows naturally with the block style's gap; single keeps the
     *  legacy margin-based alignment behavior so old pages render
     *  identically until they're re-edited. */
    const containerStyle = (): Record<string, string | undefined> => {
        if (!isMulti()) return {};
        return {
            display: 'flex',
            'flex-direction': direction() === 'vertical' ? 'column' : 'row',
            'flex-wrap': 'wrap',
            'align-items': 'flex-start',
        };
    };

    return (
        <div class="image-block image-block--multi" style={containerStyle()}>
            <For each={items()}>
                {(item,) => {
                    const itemStyle = (): Record<string, string | undefined> => {
                        if (isMulti()) {
                            return {
                                'min-width': itemMinWidth(),
                                'max-width': itemMaxWidth(),
                                'min-height': itemMinHeight(),
                                'max-height': itemMaxHeight(),
                                flex: '0 1 auto',
                            };
                        }
                        // Single-image legacy path.
                        return {
                            'max-width': legacyMaxW() || '100%',
                            'max-height': legacyMaxH(),
                            display: 'block',
                            margin: imgMargin(),
                        };
                    };

                    const onImgClick = item.allowMaximize ?
                        () => setMaximizedUrl(item.url,) :
                        undefined;

                    const imgEl = () => (
                        <img
                            src={item.url}
                            alt={item.alt || ''}
                            class={`image-block__img ${item.allowMaximize ? 'image-block__img--maximizable' : ''}`}
                            loading="lazy"
                            style={{
                                ...itemStyle(),
                                cursor: item.allowMaximize ? 'zoom-in' : undefined,
                                'object-fit': isMulti() ? 'cover' : undefined,
                                width: isMulti() ? '100%' : undefined,
                                height: isMulti() && itemMinHeight() ? '100%' : undefined,
                            }}
                            onClick={onImgClick}
                        />
                    );

                    return (
                        <div
                            class="image-block__item"
                            data-image-id={item.id}
                            style={isMulti() ? itemStyle() : undefined}
                        >
                            <Show
                                when={item.link}
                                fallback={imgEl()}
                            >
                                <a href={item.link} target="_blank" rel="noopener noreferrer">
                                    {imgEl()}
                                </a>
                            </Show>
                            <Show when={item.caption}>
                                <p class="image-block__caption">{item.caption}</p>
                            </Show>
                        </div>
                    );
                }}
            </For>

            {/* Maximize modal — shared across all images in the block. */}
            <Show when={allowMaximizeAny() && maximizedUrl()}>
                <Portal>
                    <div
                        class="image-block-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Image preview"
                        onClick={(e,) => {
                            if (e.target === e.currentTarget) setMaximizedUrl(null,);
                        }}
                    >
                        <button
                            type="button"
                            class="image-block-modal__close"
                            onClick={() => setMaximizedUrl(null,)}
                            aria-label="Close"
                        >
                            ×
                        </button>
                        <a
                            href={maximizedUrl()!}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="image-block-modal__link"
                            onClick={(e,) => e.stopPropagation()}
                            title="Open original in a new tab"
                        >
                            <img
                                src={maximizedUrl()!}
                                alt=""
                                class="image-block-modal__img"
                            />
                        </a>
                    </div>
                </Portal>
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
        try {
            return await cms.posts.getById(id,) as Post;
        } catch {
            return null;
        }
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
                try {
                    return await cms.forms.getBySlug(slug,) as Form;
                } catch { /* fall through to id */ }
            }
            if (id) {
                try {
                    return await cms.forms.getById(id,) as Form;
                } catch { /* fall through to null */ }
            }
            return null;
        },
    );

    return (
        <Show when={form()} fallback={
            <Show when={form.loading}>
                <p style={{ color: 'var(--site-text-muted, #6b7280)', 'text-align': 'center', padding: '1rem', }}>Loading form...</p>
            </Show>
        }>
            <div class="form-block">
                <FormRenderer form={form()!} inline={true} />
            </div>
        </Show>
    );
};

const ALL_CAMPAIGNS_ID = '__all-campaigns__';

const CampaignCard: Component<{ campaign: Campaign; }> = (props,) => {
    // Whether to surface any monetary info at all (operator toggle).
    const showAmount = () => props.campaign.showRaisedAmount !== false;
    // A goal is set only when goalAmountCents is a positive number; a
    // null/0 goal is an open/unlimited fund (no goal, no progress bar).
    const hasGoal = () => !!props.campaign.goalAmountCents && props.campaign.goalAmountCents > 0;
    const raised = () => `$${(props.campaign.currentAmountCents / 100).toLocaleString()}`;

    return (
        <A href={`/campaigns/${props.campaign.slug}`} class="campaign-block" style={{ 'text-decoration': 'none', color: 'inherit', display: 'block', }}>
            <h2 class="campaign-block__title">{props.campaign.title}</h2>
            <p class="campaign-block__desc">{props.campaign.shortDescription}</p>
            <Show when={showAmount()}>
                <Show when={hasGoal()}>
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
                </Show>
                <p class="campaign-block__stats">
                    <Show
                        when={hasGoal()}
                        fallback={<>{raised()} raised so far</>}
                    >
                        {raised()} of ${(props.campaign.goalAmountCents / 100).toLocaleString()}
                    </Show>
                </p>
            </Show>
        </A>
    );
};

const CampaignBlock: Component<{ block: Block; }> = (props,) => {
    const campaignId = () => props.block.settings.campaignId as string;
    const isAllCampaigns = () => campaignId() === ALL_CAMPAIGNS_ID;

    const [campaign,] = createResource(
        () => isAllCampaigns() ? null : campaignId(),
        async (id,) => {
            if (!id) return null;
            try {
                return await cms.campaigns.getById(id,) as Campaign;
            } catch {
                return null;
            }
        },
    );

    const [allCampaigns,] = createResource(
        () => isAllCampaigns() ? 'active' : null,
        async () => {
            const sortBy = (props.block.settings.sortBy as string) || 'created_at';
            const sortOrder = (props.block.settings.sortOrder as string) || 'desc';
            try {
                return await cms.campaigns.listPublic({
                    includePast: 'false',
                    activeOnly: 'true',
                    sortBy,
                    sortOrder,
                },) as Campaign[];
            } catch {
                return [];
            }
        },
    );

    const gap = () => {
        const style = props.block.style as Record<string, unknown> | undefined;
        return (style?.gap as string | undefined) || '1rem';
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
                    <p style={{ color: 'var(--site-text-muted, #6b7280)', 'text-align': 'center', padding: '1rem', }}>Loading campaigns...</p>
                </Show>
                <Show when={!allCampaigns.loading && allCampaigns()?.length === 0}>
                    <p style={{ color: 'var(--site-text-muted, #6b7280)', 'text-align': 'center', padding: '1rem', }}>No active campaigns.</p>
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
    'grid': 'social-block__grid',
    '2-col': 'social-block__grid social-block__grid--2col',
    '1-col': 'social-block__grid social-block__grid--1col',
    'row': 'social-block__grid social-block__grid--row',
};

interface SocialBlockItem {
    id?: string;
    postId?: string;
    postUrl?: string;
    thumbnailUrl?: string;
    content?: string;
    authorName?: string;
}

const SocialBlock: Component<{ block: Block; }> = (props,) => {
    const settings = () => (props.block.settings || {}) as Record<string, any>;
    const provider = (): SocialPlatform | undefined =>
        settings().provider as SocialPlatform | undefined;
    const items = (): SocialBlockItem[] => {
        const list = settings().items;
        return Array.isArray(list,) ? (list as SocialBlockItem[]) : [];
    };
    const filledItems = () => items().filter(i => i.postId || i.postUrl,);
    const count = (): number => Number(settings().count ?? items().length ?? 0);
    const limit = () => (settings().limit as number) || count() || 6;
    const layout = () => (settings().layout as string) || 'grid';
    const snapScroll = () => settings().snapScroll as boolean ?? false;
    const rowHeight = () => (settings().rowHeight as string) || undefined;
    const blockStyle = () => props.block.style as Record<string, any> | undefined;

    // Auto-feed only fires when no slots are pinned. If the operator
    // hand-picked posts, render those exclusively (no API fetch).
    const useAutoFeed = () => filledItems().length === 0;

    const [posts,] = createResource(
        () => useAutoFeed() ? `${provider()}:${limit()}` : '',
        async (key,) => {
            if (!key) return [];
            const p = provider();
            if (!p) return [];
            try {
                const { data, } = await cms.social.listPosts({ platform: p, limit: limit(), },);
                return (data ?? []) as SocialPost[];
            } catch {
                return [];
            }
        },
    );

    return (
        <div class="social-block">
            <Show
                when={useAutoFeed() ? (posts()?.length ?? 0) > 0 : filledItems().length > 0}
                fallback={
                    <Show when={!posts.loading}>
                        <p class="social-block__empty">No social posts available.</p>
                    </Show>
                }
            >
                <div
                    class={`${FEED_LAYOUT_CLASS[layout()] || FEED_LAYOUT_CLASS.grid}${
                        !snapScroll() ? ' social-block__grid--no-snap' : ''
                    }`}
                    style={{
                        ...(blockStyle()?.padding ? { padding: blockStyle()!.padding, } : {}),
                        ...(blockStyle()?.gap ? { gap: blockStyle()!.gap, } : {}),
                        // rowHeight only constrains card height in the row layout;
                        // the outer block dimensions are left to the block style system.
                        ...(layout() === 'row' && rowHeight() ? { '--social-row-height': rowHeight(), } : {}),
                    }}
                >
                    <Show
                        when={useAutoFeed()}
                        fallback={
                            <For each={filledItems()}>
                                {(item,) => (
                                    <SocialEmbed
                                        platform={provider()!}
                                        externalId={item.postId || ''}
                                        mediaUrl={item.postUrl || ''}
                                        content={item.content || ''}
                                        thumbnailUrl={item.thumbnailUrl}
                                        authorName={item.authorName}
                                    />
                                )}
                            </For>
                        }
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
                    </Show>
                </div>
            </Show>
        </div>
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
            setAppearance(await cms.settings.getAppearance(),);
        } catch { /* ignore */ }
    },);

    return (
        <Show when={items().length > 0} fallback={<div style={{ padding: '2rem', color: 'var(--site-text-muted, #6b7280)', 'text-align': 'center', }}>No carousel items</div>}>
            <ResolvedHeroCarousel
                items={items()}
                options={options()}
                gutterWidth={appearance()?.gutterWidth}
            />
        </Show>
    );
};

// ─── Group + group_item ─────────────────────────────────────────────
//
// Group blocks are flex containers. Children are group_item slots that
// each hold one content block. Item min/max width/height defaults set
// on the group flow down to slots that don't override.
//
// `align` / `justify` accept short keywords (start/center/end/stretch);
// we map "start" / "end" → "flex-start" / "flex-end" for the appropriate
// CSS property.

const flexAlign = (v?: string,): string | undefined => {
    if (!v) return undefined;
    if (v === 'start') return 'flex-start';
    if (v === 'end') return 'flex-end';
    return v;
};

const GroupBlock: Component<{ block: Block; }> = (props,) => {
    const children = () => (props.block.children || []) as Block[];
    const data = () => (props.block.settings || {}) as Record<string, any>;
    const direction = () => (data().direction as string) || 'horizontal';
    const containerStyle = (): Record<string, string | undefined> => ({
        display: 'flex',
        'flex-direction': direction() === 'vertical' ? 'column' : 'row',
        'flex-wrap': (data().wrap as string) || 'wrap',
        gap: (data().gap as string) || undefined,
        'align-items': flexAlign(data().align as string,),
        'justify-content': flexAlign(data().justify as string,),
    });

    return (
        <div class="block--group" style={containerStyle()}>
            <For each={children()}>
                {(child,) => (
                    <Show when={child.isVisible !== false}>
                        <BlockRenderer block={withSlotDefaults(child, data(),)} />
                    </Show>
                )}
            </For>
        </div>
    );
};

/** Apply parent group's `itemMin/Max...` defaults to a group_item child
 *  unless the slot has its own override. Returns a shallow clone so the
 *  source block isn't mutated. */
function withSlotDefaults(child: Block, parentData: Record<string, any>,): Block {
    if (child.type !== 'group_item') return child;
    const slot = (child.settings || {}) as Record<string, any>;
    const merged = {
        ...slot,
        minWidth: slot.minWidth ?? parentData.itemMinWidth,
        maxWidth: slot.maxWidth ?? parentData.itemMaxWidth,
        minHeight: slot.minHeight ?? parentData.itemMinHeight,
        maxHeight: slot.maxHeight ?? parentData.itemMaxHeight,
    };
    return { ...child, settings: merged as any, };
}

const GroupItemBlock: Component<{ block: Block; }> = (props,) => {
    const children = () => (props.block.children || []) as Block[];
    const data = () => (props.block.settings || {}) as Record<string, any>;
    const slotStyle = (): Record<string, string | undefined> => ({
        flex: data().width ? '0 0 auto' : '1 1 0',
        width: (data().width as string) || undefined,
        'min-width': (data().minWidth as string) || undefined,
        'max-width': (data().maxWidth as string) || undefined,
        height: (data().height as string) || undefined,
        'min-height': (data().minHeight as string) || undefined,
        'max-height': (data().maxHeight as string) || undefined,
        'align-self': flexAlign(data().alignSelf as string,),
    });
    // Empty group_items render nothing on the public site (placeholder
    // picker is admin-only, in the editor BlockPreview).
    return (
        <Show when={children().length > 0}>
            <div class="block--group_item" style={slotStyle()}>
                <For each={children()}>
                    {(child,) => (
                        <Show when={child.isVisible !== false}>
                            <BlockRenderer block={child} />
                        </Show>
                    )}
                </For>
            </div>
        </Show>
    );
};
