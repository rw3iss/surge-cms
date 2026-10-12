/**
 * Gallery block (email): a table grid of the block's items, resolved ahead of
 * time by `expandDynamicBlocks` with the `email` audience — PUBLIC MEDIA ONLY
 * (the in-site gate does not apply in an inbox; private media never does).
 *
 * Layouts map onto the one thing email can do — a grid: `grid` uses its
 * columns, `row`/`carousel` show their items-per-page side by side, and
 * `column`/`stage` stack one per row. No autoplay, arrows or lightbox.
 */
import type { GalleryBlockSettings, } from '@sitesurge/types';
import { galleryEmailHtml, } from '../../gallery/render';
import { resolvedItemsOf, } from '../../gallery/serverRender';
import type { BlockEmailRenderer, } from './index';

/** Columns an email grid gets for a block's desktop layout (1–4: inboxes are ~600px). */
export function emailColumns(s: Partial<GalleryBlockSettings>,): number {
    const d = s.desktop ?? {};
    const n = d.layout === 'column' || d.layout === 'stage'
        ? 1
        : d.layout === 'row' || d.layout === 'carousel'
            ? (d.itemsPerPage ?? 3)
            : (d.columns ?? 3);
    return Math.min(4, Math.max(1, Math.round(n,),),);
}

export const renderGallery: BlockEmailRenderer = (node, ctx,) => {
    const s = (node.settings ?? {}) as Partial<GalleryBlockSettings> & Record<string, unknown>;
    return galleryEmailHtml(resolvedItemsOf(s,), ctx.siteUrl, {
        columns: emailColumns(s,),
        showTitles: s.showTitles,
        showCaptions: s.showCaptions,
        radius: s.radius,
        textColor: ctx.textColor,
        linkColor: ctx.linkColor,
    },);
};
