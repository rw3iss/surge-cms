/**
 * Carousel block — media / entity / legacy post slides.
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import type { Block, HeroCarouselOptions, HeroItem, } from '@sitesurge/types';
import { Component, Show, createResource, createSignal, onMount, } from 'solid-js';
import { A, } from '@solidjs/router';
import { cms, } from '../../../services/cmsClient';
import ResolvedHeroCarousel from '../ResolvedHeroCarousel';
import { color, } from './shared';
import { BlockRenderer, } from '../BlockRenderer';
import { renderEntityTemplateSlide, } from './TemplateBlock';

export const CarouselBlockRenderer: Component<{ block: Block; }> = (props,) => {
    const s = () => props.block.settings || {};
    const items = () => (s().items as HeroItem[]) || [];
    // Block style alignment (set via the block's Style settings) flows into
    // the carousel slides so items honor Text/Vertical Alignment instead of
    // always centering.
    const style = () => (props.block.style as Record<string, any> | undefined) || {};
    const options = () => ({
        autoScroll: false,
        autoScrollInterval: 3000,
        repeat: true,
        customHeight: false,
        height: '50vh',
        ...(s().options as Partial<HeroCarouselOptions> || {}),
    } as HeroCarouselOptions);

    // The block's effective padding is routed to the slide *content* (not the
    // whole carousel) so the background media stays full-bleed. Mirrors the
    // non-carousel padding precedence in BlockRenderer: explicit style padding
    // → settings padding → the site default (unless default padding is off).
    const contentPadding = () =>
        (style().padding as string)
        || (s().padding as string)
        || (s().useDefaultPadding === false ? undefined : 'var(--site-block-padding, 0)');
    const contentMargin = () => (style().margin as string) || undefined;

    // Block-style background color/gradient (swatch-resolved) is applied to each
    // slide by HeroCarousel: as a readability overlay over a media backdrop, or
    // as the slide's own background when the slide has no media.
    const itemBackground = () => color(style().backgroundColor || (s().backgroundColor as string),);

    // Use onMount instead of createResource to avoid Suspense jumps
    const [appearance, setAppearance,] = createSignal<any>(null,);
    onMount(async () => {
        try {
            setAppearance(await cms.settings.getAppearance(),);
        } catch { /* ignore */ }
    },);

    return (
        <Show when={items().length > 0} fallback={<div class="block-message block-message--lg">No carousel items</div>}>
            <ResolvedHeroCarousel
                items={items()}
                options={options()}
                // Block style.height drives the carousel height (lands on the
                // inner .hero-carousel); undefined → the carousel's own default.
                // Per-breakpoint height overrides come via the scoped @media CSS.
                height={style().height as string | undefined}
                minHeight={style().minHeight as string | undefined}
                gutterWidth={appearance()?.gutterWidth}
                align={style().textAlign}
                valign={style().verticalAlign}
                contentPadding={contentPadding()}
                contentMargin={contentMargin()}
                itemBackground={itemBackground()}
                renderEntitySlide={renderEntityTemplateSlide}
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
// `align` / `justify` accept short keywords (start/center/end/stretch) mapped
// to flexbox values by the shared groupContainerStyle util.

// ─── Entity (template) block ─────────────────────────────────────────
//
// Renders a content-block template with an entity (or list) bound in. The
// template's block subtree is fetched, its records resolved from the binding,
// and the subtree rendered ONCE PER record with the entity bound under its
// singular variable (so template blocks use `{{post.title}}` etc.). List
// bindings therefore render the template per item — the card/carousel pattern.
/**
 * Render a content-block template (`roots`) with a single entity record bound
 * under its singular variable, so template blocks resolve `{{post.title}}` etc.
 * Shared by the `entity` block (per-record) and the carousel's entity items
 * (one slide per record) — injected into ResolvedHeroCarousel to keep that
 * module free of a BlockRenderer import (no cycle).
 */
/**
 * A `template` block: renders a reusable component's block subtree in place.
 *
 * A REFERENCE, not a copy — the subtree is fetched at render time, so editing
 * the component updates every block that uses it.
 *
 * The component's own blocks emit their styles into the `tpl` cascade layer,
 * one layer BELOW `block`. That is what lets the style set on this block win
 * over the component's own, without depending on document order — which would
 * favour the component, since its <style> elements are nested inside this
 * block's wrapper.
 */
