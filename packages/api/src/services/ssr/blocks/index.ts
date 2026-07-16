/**
 * Per-block-type SSR render registry — mirrors the mail renderer
 * registry shape (`services/mail/blocks/index.ts`). Each strategy
 * emits the minimal, indexable HTML a crawler needs for one block.
 *
 * A new block type registers once: add it to the `BlockType` union in
 * `@sitesurge/types`, then to `ALL_BLOCK_TYPES`; the `Record<BlockType,
 * …>` key below and the coverage test (`blocks.test.ts`) then force an
 * explicit strategy here — no consumer can silently ignore it.
 *
 * Known limitation (out of scope, follow-up): the SSR caller
 * (`ssr/routes.ts`) fetches a FLAT block list ordered by `"order"` and
 * does not run `buildBlockTree`, so a `group`'s nested children are
 * invisible to SSR today. Groups therefore emit nothing here
 * (`notRendered`). Walking group children in SSR would change the
 * emitted output and is deliberately deferred.
 */
import type { BlockType, } from '@sitesurge/types';
import { renderRichText, } from './richText';
import { renderHero, } from './hero';
import { renderImage, } from './image';
import { renderDocument, } from './document';
import { renderUrlLink, } from './urlLink';

export interface SsrBlockInput {
    type: string;
    title?: string | null;
    content?: string | null;
    settings?: Record<string, unknown> | null;
}
export type SsrBlockRenderer = (block: SsrBlockInput,) => string;

/** Dynamic blocks: emit an HTML comment naming the type (matches the
 *  old explicit `case 'form': … return '<!-- … -->'` arms). Bots can't
 *  index runtime feeds; the SPA renders them on mount. */
export const notIndexable: SsrBlockRenderer = (block,) =>
    `<!-- ${block.type} block (not server-rendered) -->`;

/** No SSR output at all (matches the old `default: return ''` fallthrough
 *  that video/group/group_item currently hit). */
export const notRendered: SsrBlockRenderer = () => '';

export const SSR_BLOCK_RENDERERS: Record<BlockType, SsrBlockRenderer> = {
    rich_text: renderRichText,
    text: renderRichText,
    html: renderRichText,
    hero: renderHero,
    image: renderImage,
    document: renderDocument,
    url_link: renderUrlLink,
    // Dynamic blocks — emit a naming comment (was the explicit case list).
    form: notIndexable,
    social: notIndexable,
    post_list: notIndexable,
    carousel: notIndexable,
    gallery: notIndexable,
    campaign: notIndexable,
    post: notIndexable,
    spacer: notIndexable,
    // No SSR output (was the `default:` fallthrough).
    video: notRendered,
    group: notRendered,
    group_item: notRendered,
};

/** Server-side block renderer for SSR. Dispatches by type; unknown
 *  types (not in the union) emit nothing, matching the old default. */
export function renderBlockForSeo(block: SsrBlockInput,): string {
    const fn = SSR_BLOCK_RENDERERS[block.type as BlockType];
    return fn ? fn(block,) : '';
}
