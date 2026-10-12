/**
 * Gallery block (SSR): indexable figures for the items the SSR pre-pass
 * resolved for the anonymous visitor (`preResolveGalleryBlocks`, ssr/routes).
 */
import type { GalleryBlockSettings, } from '@sitesurge/types';
import { config, } from '../../../config';
import { galleryFiguresHtml, } from '../../gallery/render';
import { resolvedItemsOf, } from '../../gallery/serverRender';
import type { SsrBlockRenderer, } from './index';

export const renderGalleryBlock: SsrBlockRenderer = (block,) => {
    const s = (block.settings ?? {}) as Partial<GalleryBlockSettings> & Record<string, unknown>;
    const html = galleryFiguresHtml(resolvedItemsOf(s,), config.frontendUrl ?? '',);
    return html ? `<section class="ssr-block ssr-block--gallery">${html}</section>` : '';
};
