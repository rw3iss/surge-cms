/**
 * Forum block (SSR): the threads the SSR pre-pass resolved for the anonymous
 * visitor (`expandSsrDynamicBlocks`, ssr/expandBlocks.ts) as indexable links.
 * The live widget (posting, replies, polling) renders client-side on mount.
 */
import { normalizeForumBlockSettings, } from '@sitesurge/types';
import { forumListHtml, } from '../../forum/render';
import { resolvedForumItemsOf, } from '../../forum/serverRender';
import type { SsrBlockRenderer, } from './index';

export const renderForumBlock: SsrBlockRenderer = (block,) => {
    const html = forumListHtml(resolvedForumItemsOf(block.settings,), normalizeForumBlockSettings(block.settings,),);
    return html ? `<section class="ssr-block ssr-block--forum">${html}</section>` : '';
};
