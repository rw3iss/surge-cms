/**
 * Custom HTML block — templated, rendered via innerHTML.
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import type { Block, } from '@sitesurge/types';
import { Component, } from 'solid-js';
import TemplatedContent from '../TemplatedContent';
import { type TplCtx, } from './shared';

export const HTMLBlock: Component<{ block: Block; ctx?: TplCtx; }> = (props,) => (
    <TemplatedContent
        class="html-block"
        html={props.block.content || (props.block.settings?.content as string) || ''}
        entities={props.ctx}
    />
);
