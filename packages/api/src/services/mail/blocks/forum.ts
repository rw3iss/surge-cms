/**
 * Email renderer for the `forum` block: the threads (resolved ahead of time
 * by `expandDynamicBlocks` as the anonymous reader) as a list of absolute
 * links, then "Join the discussion →" (the first thread's category, else the
 * forum index). No posting / replies in an inbox.
 */
import { normalizeForumBlockSettings, } from '@sitesurge/types';
import { forumListHtml, } from '../../forum/render';
import { resolvedForumItemsOf, } from '../../forum/serverRender';
import type { BlockEmailRenderer, } from './index';

export const renderForum: BlockEmailRenderer = (node, ctx,) =>
    forumListHtml(resolvedForumItemsOf(node.settings,), normalizeForumBlockSettings(node.settings,), {
        base: ctx.siteUrl.replace(/\/+$/, '',),
        email: true,
        linkColor: ctx.linkColor,
        textColor: ctx.textColor,
    },);
