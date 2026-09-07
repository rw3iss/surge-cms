/**
 * Video block.
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import type { Block, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';

export const VideoBlock: Component<{ block: Block; }> = (props,) => (
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
