/**
 * Gallery block (email): the block's items, resolved ahead of time by
 * `expandDynamicBlocks` with the `email` audience — PUBLIC MEDIA ONLY (the
 * in-site gate does not apply in an inbox; private media never does).
 *
 * Layouts map onto what email can do (`galleryEmailPlan`): `grid` → a grid of
 * its columns, `column` → one per row, `row` / `carousel` / `stage` → a
 * centred wrapped grid. No autoplay, arrows or lightbox; every item links to
 * its gallery item page whatever the block's on-click option says.
 *
 * Block style: width / max-width (and the cell padding) size the gallery
 * (`galleryEmailWidth`); Horizontal Alignment (else Text Align, else centre)
 * places its rows; Text Align aligns titles / captions; background, radius,
 * margin and padding stay on the block cell (`cellStyleFromBlock`).
 */
import type { GalleryBlockSettings, } from '@sitesurge/types';
import { galleryEmailAlign, galleryEmailHtml, } from '../../gallery/render';
import { resolvedItemsOf, } from '../../gallery/serverRender';
import { cellStyleFromBlock, mediaBox, pxValue, } from './_util';
import type { BlockEmailRenderer, EmailBlockNode, EmailRenderCtx, } from './index';

/** Left + right of a CSS `padding` shorthand, px (non-px parts count as 0). */
export function horizontalPadding(padding: string | undefined,): number {
    const parts = String(padding ?? '',).trim().split(/\s+/,).filter(Boolean,);
    if (!parts.length) return 0;
    const right = parts[1] ?? parts[0];
    const left = parts[3] ?? right;
    return (pxValue(left,) ?? 0) + (pxValue(right,) ?? 0);
}

/** The width the gallery may use inside its block cell. */
export function galleryEmailWidth(node: EmailBlockNode, ctx: EmailRenderCtx,): number {
    return mediaBox(node,).maxWidth - horizontalPadding(cellStyleFromBlock(node, ctx,).padding,);
}

export const renderGallery: BlockEmailRenderer = (node, ctx,) => {
    const s = (node.settings ?? {}) as Partial<GalleryBlockSettings> & Record<string, unknown>;
    return galleryEmailHtml(resolvedItemsOf(s,), ctx.siteUrl, s, {
        siteRadius: ctx.siteRadius,
        textColor: ctx.textColor,
        width: galleryEmailWidth(node, ctx,),
        align: galleryEmailAlign(node.style,),
        textAlign: typeof node.style?.textAlign === 'string' ? node.style.textAlign : undefined,
    },);
};
