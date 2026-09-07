/**
 * Document block — a download link.
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import type { Block, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';

export const DocumentLink: Component<{ block: Block; }> = (props,) => {
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
