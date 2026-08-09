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
 * Nested blocks: the SSR caller now assembles a block TREE
 * (`assembleSsrBlockTree`) before rendering, so container blocks
 * (`group`/`group_item`) recurse into their `children` and nested text
 * blocks are indexable. A childless group still emits nothing.
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
    /** Assembly fields (present when built from a flat DB fetch). */
    id?: string;
    parentBlockId?: string | null;
    /** Nested children (populated by `assembleSsrBlockTree`). */
    children?: SsrBlockInput[];
}
export type SsrBlockRenderer = (block: SsrBlockInput,) => string;

/**
 * Assemble a flat SSR block list (ordered `parent_block_id NULLS FIRST,
 * "order"`) into a tree: roots (no parent) each carry their `children`.
 * Mirrors `buildBlockTree` in `@sitesurge/types` but on the lean
 * `SsrBlockInput` shape. Mutates each node's `children` and returns roots.
 */
export function assembleSsrBlockTree(flat: SsrBlockInput[],): SsrBlockInput[] {
    const byId = new Map<string, SsrBlockInput>();
    for (const b of flat) {
        b.children = [];
        if (b.id) byId.set(b.id, b,);
    }
    const roots: SsrBlockInput[] = [];
    for (const b of flat) {
        const parent = b.parentBlockId ? byId.get(b.parentBlockId,) : undefined;
        if (parent) parent.children!.push(b,);
        else roots.push(b,);
    }
    return roots;
}

/** Container blocks recurse into their assembled children so nested text
 *  is indexable. A childless container emits nothing (parity with the prior
 *  `notRendered` behavior for groups without a walked subtree). */
export const renderChildren: SsrBlockRenderer = (block,) =>
    (block.children ?? []).map((c,) => renderBlockForSeo(c,)).join('');

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
    // Containers recurse into their children (assembled into a tree by the
    // caller). Childless containers emit nothing.
    group: renderChildren,
    group_item: renderChildren,
};

/** Server-side block renderer for SSR. Dispatches by type; unknown
 *  types (not in the union) emit nothing, matching the old default. */
export function renderBlockForSeo(block: SsrBlockInput,): string {
    const fn = SSR_BLOCK_RENDERERS[block.type as BlockType];
    return fn ? fn(block,) : '';
}
