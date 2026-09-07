/**
 * Rich-text / text block — templated HTML content.
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import type { Block, } from '@sitesurge/types';
import { Component, } from 'solid-js';
import TemplatedContent from '../TemplatedContent';
import { type TplCtx, } from './shared';

export const RichTextBlock: Component<{ block: Block; ctx?: TplCtx; }> = (props,) => (
    <div class="rich-text-block">
        <TemplatedContent
            class="rich-text"
            html={props.block.content || (props.block.settings?.content as string) || ''}
            entities={props.ctx}
        />
    </div>
);


/** Build the rendered image list, coalescing legacy single-image blocks
 *  (top-level `url` field) into a one-item array for a uniform render path. */
