/**
 * Hero block — full-bleed banner with an optional background image and CTA.
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import type { Block, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';
import TemplatedContent from '../TemplatedContent';
import { type TplCtx, } from './shared';

export const HeroBlock: Component<{ block: Block; ctx?: TplCtx; }> = (props,) => {
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
                <TemplatedContent class="hero-block__content rich-text" html={props.block.content} entities={props.ctx} />
            </Show>
        </section>
    );
};
