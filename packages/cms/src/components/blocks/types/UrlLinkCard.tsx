/**
 * URL-link block — a link preview card.
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import type { Block, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';

export const UrlLinkCard: Component<{ block: Block; }> = (props,) => {
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
