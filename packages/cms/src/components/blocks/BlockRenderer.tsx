/**
 * The public block renderer: the wrapper every block shares (cascade-layer
 * style emission, background compositing, group-slot sizing) plus the dispatch
 * to a per-type renderer.
 *
 * Each block type lives in `types/`. They used to be here — all sixteen, in one
 * 1,332-line file — which made the shared wrapper hard to find among them.
 *
 * The recursive types (group, group_item, template, entity, carousel) import
 * this module back. That cycle is intentional and safe: the binding is read
 * when a component RENDERS, never while the module evaluates.
 */
import type { Block, } from '@sitesurge/types';
import { Component, Match, Show, Switch, } from 'solid-js';
import { fontStack, } from '../../utils/appearanceStyle';
import { blockCss, type CascadeLayer, carouselPropTargets, } from '../../utils/blockResponsiveCss';
import { siteSettings, } from '../../stores/siteSettings';
import { toFlexAlign, } from '../../utils/cssAlign';
import { groupSlotItemStyle, } from '../../utils/groupStyle';
import PostListRenderer, { type PostListSettings, } from './posts/PostListRenderer';
import { color, type TplCtx, } from './types/shared';
import { HeroBlock, } from './types/HeroBlock';
import { RichTextBlock, } from './types/RichTextBlock';
import { ImageBlock, } from './types/ImageBlock';
import { VideoBlock, } from './types/VideoBlock';
import { PostBlock, } from './types/PostBlock';
import { FormBlock, } from './types/FormBlock';
import { CampaignBlock, } from './types/CampaignBlock';
import { SocialBlock, } from './types/SocialBlock';
import { DocumentLink, } from './types/DocumentLink';
import { UrlLinkCard, } from './types/UrlLinkCard';
import { HTMLBlock, } from './types/HTMLBlock';
import { CarouselBlockRenderer, } from './types/CarouselBlock';
import { TemplateBlock, } from './types/TemplateBlock';
import { EntityBlock, } from './types/EntityBlock';
import { GroupBlock, GroupItemBlock, } from './types/GroupBlock';
import './BlockRenderer.scss';

// Re-exported for the carousel's entity slides, which the resolver injects to
// avoid importing this module (see ResolvedHeroCarousel).
export { renderEntityTemplateSlide, } from './types/TemplateBlock';

interface BlockRendererProps {
    block: Block;
    /** In the admin block-editor preview, disabled blocks still render (greyed
     *  out by the surrounding editor) so operators can see them. On the public
     *  site (default), a disabled block is skipped entirely. */
    preview?: boolean;
    /** Page-entity variables (e.g. `{ post: {kind,data,id} }`) exposed to this
     *  block's `{{ … }}` template resolution — the containing post/campaign/page. */
    templateContext?: TplCtx;
    /** Set by group containers on their children so nested blocks don't each
     *  re-apply the site's default block padding (which cascades level-by-level
     *  through a group tree). Explicit style/settings padding still applies. */
    noDefaultPadding?: boolean;
    /** Cascade layer this block's DEFAULT style is emitted into. Defaults to
     *  `block`. A block TEMPLATE's inner blocks pass `tpl`, one layer earlier,
     *  so the style set on the block USING the template wins — without relying
     *  on document order, which favours the template (its `<style>` is nested
     *  inside the using block's wrapper). Breakpoints always stay in `block-bp`. */
    styleLayer?: CascadeLayer;
    /** Template ids already being rendered above this block. A `template` block
     *  whose component contains a `template` block referencing itself would
     *  otherwise recurse until the tab dies. */
    templateAncestry?: readonly string[];
}

export const BlockRenderer: Component<BlockRendererProps> = (props,) => {
    // A disabled block keeps its content in the DB but never renders on the
    // public site (editors can toggle it back on). The flag lives in the
    // block's settings JSON. In preview mode it still renders (greyed).
    const isHidden = () => !props.preview
        && Boolean((props.block.settings as Record<string, unknown> | undefined)?.disabled);
    const blockStyle = () => props.block.style as Record<string, any> | undefined;
    const s = () => blockStyle() || {};
    // Carousel routes its padding to the slide *content* (see
    // CarouselBlockRenderer) so the background media stays full-bleed —
    // hence the outer wrapper skips block-style padding for this type.
    const isCarousel = () => props.block.type === 'carousel';
    // A "content" carousel shows entity/posts items (e.g. a products list) rather
    // than media backdrops. It has no `.hero-carousel__content` text overlay, so
    // its padding/margin belong on the carousel ELEMENT (inset the items / center
    // the whole thing) — unlike a media hero, whose padding insets the overlay.
    const isContentCarousel = () =>
        isCarousel()
        && (((props.block.settings?.items as Array<{ type?: string; }> | undefined) ?? [])
            .some((i,) => i.type === 'entity' || i.type === 'posts'));
    // A carousel owns its height on the INNER `.hero-carousel` element — from its
    // block `style.height` (default) + per-breakpoint overrides, or the "Custom
    // Height" content setting. So the outer `.block` wrapper never takes an inline
    // height for this type (avoids a duplicate/among-elements height).
    const suppressCarouselHeight = () => isCarousel();

    // Background resolution. A block style may carry a color/gradient (any CSS
    // value, resolved through the swatch helper) and/or an image:
    //   - color only        → the color/gradient is the background.
    //   - image only         → the image is the background.
    //   - both color + image → the image is the backdrop and the color/gradient
    //     renders as an absolutely-positioned overlay ON TOP of it (use a
    //     translucent color/gradient to tint the image for readability).
    const bgColorValue = () => color(s().backgroundColor || (props.block.settings.backgroundColor as string),);
    // An image block renders its picture as an inner <img>, never as the wrapper
    // background — a stale style.backgroundImage (e.g. a previously-set/copied
    // background) would otherwise ghost above the image once the block is padded.
    const bgImageValue = () =>
        props.block.type === 'image' ? undefined : ((s().backgroundImage as string | undefined) || undefined);
    const hasBgOverlay = () => Boolean(bgColorValue() && bgImageValue());

    // A group_item's wrapper IS the flex/grid item of its parent group, so the
    // slot's sizing (flex + width/min/max) must live on THIS element — not on
    // GroupItemBlock's inner div (the parent flex container can't see that far
    // down). Otherwise the wrapper keeps the default `width: 100%` and every
    // slot wraps to its own row. `settings` already carries the parent's item
    // defaults (merged via withSlotDefaults).
    const isGroupItem = () => props.block.type === 'group_item';

    // ALL of this block's CSS — its default style AND its per-breakpoint
    // overrides — as one layered stylesheet scoped to `[data-block-id]`.
    //
    // The default used to be an inline `style={}`. That had two costs: the
    // default and its override could drift onto different elements (the
    // carousel `margin` bug), and every override needed `!important` purely to
    // outrank the inline default. Emitting both through ONE function, routed
    // through the same target map, removes both problems — precedence is now
    // cascade-layer order (`@layer theme, tpl, block, block-bp`, declared in
    // index.html), which beats specificity outright.
    /**
     * The style bag actually rendered: the block's `style` plus the legacy
     * `settings`-level fallbacks for background / text colour / padding.
     *
     * These MUST be merged in here rather than left inline. An inline
     * declaration outranks every cascade layer, so a settings-level fallback
     * left inline would beat the `style` value it is supposed to defer to —
     * inverting `style || settings` into `settings || style`.
     */
    const effectiveStyle = () => {
        const st = { ...s(), } as Record<string, unknown>;
        const set = (props.block.settings || {}) as Record<string, unknown>;
        if (!st.backgroundColor && set.backgroundColor) st.backgroundColor = set.backgroundColor;
        if (!st.textColor && set.textColor) st.textColor = set.textColor;
        if (!st.padding && set.padding) st.padding = set.padding;
        // An image block paints its picture as an inner <img>, never as the
        // wrapper background; a stale style.backgroundImage would ghost above it.
        if (props.block.type === 'image') delete st.backgroundImage;
        // When a colour AND an image are both set the colour becomes a separate
        // overlay element (see .block__bg-overlay below), so drop it here.
        if (hasBgOverlay()) delete st.backgroundColor;
        return st;
    };

    const blockCssText = () => blockCss(
        props.block.id,
        effectiveStyle(),
        siteSettings()?.appearance?.breakpoints,
        {
            resolveFont: fontStack,
            resolveHAlign: (v,) => toFlexAlign(v, 'flex-start',),
            resolveColor: color,
            suppressBox: isGroupItem(),
            // A carousel's height is owned by its "Custom Height" setting; a
            // stale style.height must not force a fixed height here. Passed to
            // the emitter now that height is no longer filtered inline.
            suppressHeight: suppressCarouselHeight(),
        },
        // A carousel spreads its style over three elements, so each property
        // must land on the element that owns it (see carouselPropTargets).
        // Every other block keeps everything on the wrapper.
        isCarousel() ? carouselPropTargets(isContentCarousel(),) : undefined,
        // A template's inner blocks render one layer earlier, so a using
        // block's own style wins without depending on document order.
        props.styleLayer,
    );
    const slotStyle = () =>
        isGroupItem() ? groupSlotItemStyle(props.block.settings as Record<string, unknown>, {},) : {};

    // Inner wrapper's content-column class. An explicit `settings.layout` wins
    // (legacy control); otherwise carousel/hero are full-bleed, and a block
    // whose STYLE makes it full-width opts OUT of the default 1200px content
    // column (`block__inner--contained`) so its content can fill the block —
    // otherwise a `width: full` / `max-width: 100%` block would still have its
    // inner content capped at 1200px, which contradicts the operator's intent.
    const innerLayout = (): string => {
        const explicit = props.block.settings.layout as string | undefined;
        if (explicit) return explicit;
        // A group_item slot is sized by its parent group (slot width/flex on the
        // outer wrapper) — its content must FILL that slot, never get re-capped at
        // the site content column (--site-max-width) or centered with side gutters.
        // Otherwise a wide slot (e.g. holding a carousel) shows gaps instead of
        // reaching the slot's edges.
        if (props.block.type === 'group_item') return 'full';
        if (['carousel', 'hero',].includes(props.block.type,)) return 'full';
        // NOTE: '100%' is the DEFAULT width (BLOCK_STYLE_DEFAULTS.width), not a
        // full-bleed intent — treating it as one made a block with the default
        // saved render differently from an unstyled block. So only a literal
        // 'full'/'none' width counts as a full-width signal here.
        const fullish = (v: unknown,) => {
            const t = String(v ?? '',).trim().toLowerCase();
            return t === 'full' || t === 'none';
        };
        // A literal full width, OR any explicit style max-width (the operator's
        // own cap is then authoritative), suppresses the default content column.
        const mw = s().maxWidth;
        if (fullish(s().width,) || (mw != null && String(mw,).trim() !== '')) {
            return 'full';
        }
        return 'contained';
    };

    // The site-default block padding is now a global CSS rule
    // (`.block--default-pad` in the appearance stylesheet) — DRY + overridable by
    // the per-breakpoint layout @media rules. We add the class only when that
    // default would apply: not a carousel, no explicit style/settings padding,
    // and not suppressed (group / group_item / nested / opted out). Explicit
    // padding still wins inline below.
    const usesDefaultPad = () => !isCarousel()
        && !s().padding
        && !(props.block.settings.padding as string | undefined)
        && !props.noDefaultPadding
        && props.block.type !== 'group'
        && props.block.type !== 'group_item'
        && props.block.settings.useDefaultPadding !== false;

    return (
        <Show when={!isHidden()}>
        <div
            class={`block block--${props.block.type}${s().height ? ' block--has-height' : ''}${
                hasBgOverlay() ? ' block--has-bg-overlay' : ''
            }${usesDefaultPad() ? ' block--default-pad' : ''}`}
            data-block-id={props.block.id}
            style={{
                // Everything the block's own style controls now lives in the
                // `block` cascade layer (see blockCssText below). Only genuinely
                // per-instance runtime values remain inline.
                //
                // group_item slot sizing (flex + width/min/max/align-self) is
                // derived from the PARENT group's settings, not this block's
                // style, and must win over the block's own box — which it does,
                // since an inline declaration outranks every layer.
                ...slotStyle(),
            }}
        >
            {/* This block's complete style: defaults in `@layer block`,
                per-breakpoint overrides in `@layer block-bp`. Scoped to
                `[data-block-id]`, so position in the document is irrelevant. */}
            <Show when={blockCssText()}>
                <style>{blockCssText()}</style>
            </Show>
            {/* Color/gradient overlay painted on top of the background image
                (only when BOTH are set). Sits behind the content via CSS. */}
            <Show when={hasBgOverlay()}>
                <div class="block__bg-overlay" style={{ background: bgColorValue(), }} aria-hidden="true" />
            </Show>
            <div
                class={`block__inner block__inner--${innerLayout()}`}
                style={{
                    ...(s().gap ? { display: 'flex', 'flex-direction': 'column', gap: s().gap, } : {}),
                    ...(s().overflowX ? { 'overflow-x': s().overflowX, 'max-width': '100%', } : {}),
                    ...(s().overflowY ? { 'overflow-y': s().overflowY, } : {}),
                }}
            >
                <Switch>
                    <Match when={props.block.type === 'hero'}>
                        <HeroBlock block={props.block} ctx={props.templateContext} />
                    </Match>
                    <Match when={props.block.type === 'rich_text'}>
                        <RichTextBlock block={props.block} ctx={props.templateContext} />
                    </Match>
                    <Match when={props.block.type === 'image'}>
                        <ImageBlock block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'video'}>
                        <VideoBlock block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'post'}>
                        <PostBlock block={props.block} ctx={props.templateContext} />
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
                        <RichTextBlock block={props.block} ctx={props.templateContext} />
                    </Match>
                    <Match when={props.block.type === 'document'}>
                        <DocumentLink block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'url_link'}>
                        <UrlLinkCard block={props.block} />
                    </Match>
                    <Match when={props.block.type === 'html'}>
                        <HTMLBlock block={props.block} ctx={props.templateContext} />
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
                    <Match when={props.block.type === 'entity'}>
                        <EntityBlock block={props.block} ctx={props.templateContext} />
                    </Match>
                    <Match when={props.block.type === 'template'}>
                        <TemplateBlock
                            block={props.block}
                            ctx={props.templateContext}
                            ancestry={props.templateAncestry}
                        />
                    </Match>
                    <Match when={props.block.type === 'group'}>
                        <GroupBlock block={props.block} ctx={props.templateContext} />
                    </Match>
                    <Match when={props.block.type === 'group_item'}>
                        <GroupItemBlock block={props.block} ctx={props.templateContext} />
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
        </Show>
    );
};
