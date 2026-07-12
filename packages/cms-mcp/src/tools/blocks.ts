/**
 * Shared block helpers used by the page and post tools. A single "unified block
 * descriptor" is mapped to the correct wire shape per target:
 *  - pages: PageBlockBody { title, content, settings, style, parentBlockId, … }
 *  - posts: PostCreateContentBlock { id, type, sort_order, data } where `data`
 *           carries title + content + settings + style together.
 */
import { z, } from 'zod';
import type { PageBlockBody, } from '@sitesurge/types';
import { defaultBlockData, getBlockSpec, } from '../catalog/blockTypes';
import { newBlockId, } from '../util/ids';

/** Zod fragment describing a unified block. Spread into a tool's inputSchema. */
export const blockInputShape = {
    type: z.string().describe('Block type key. Call describe_block_types for the full list + each type\'s fields.',),
    title: z.string().optional().describe('Optional block title/label.',),
    content: z.string().optional().describe('HTML body — used by rich_text, text, and html blocks.',),
    settings: z.record(z.string(), z.unknown(),).optional().describe('Type-specific fields (see describe_block_types). Merged over the type defaults.',),
    style: z.union([z.record(z.string(), z.unknown(),), z.null(),],).optional().describe('Block style: inline BlockStyle fields, a template ref { "id": "<blockStyleId>" }, or null to clear.',),
};

export interface UnifiedBlock {
    id?: string;
    type: string;
    title?: string;
    content?: string;
    settings?: Record<string, unknown>;
    style?: Record<string, unknown> | null;
    parentBlockId?: string | null;
    isVisible?: boolean;
    order?: number;
}

/** Merge caller settings over the catalog defaults for the type. */
function mergedSettings(b: UnifiedBlock,): Record<string, unknown> {
    return { ...defaultBlockData(b.type,), ...(b.settings ?? {}), };
}

/** Map a unified block to a pages createBlock/updateBlock body. */
export function toPageBlockBody(b: UnifiedBlock, opts: { withId?: boolean; } = {},): PageBlockBody {
    const body: PageBlockBody = {
        type: b.type as PageBlockBody['type'],
        settings: mergedSettings(b,),
    };
    if (opts.withId) body.id = b.id ?? newBlockId();
    if (b.title !== undefined) body.title = b.title;
    if (b.content !== undefined) body.content = b.content;
    if (b.style !== undefined) body.style = b.style;
    if (b.parentBlockId !== undefined) body.parentBlockId = b.parentBlockId;
    if (b.isVisible !== undefined) body.isVisible = b.isVisible;
    if (b.order !== undefined) body.order = b.order;
    return body;
}

/** A post content block as sent on post create/update. */
export interface PostContentBlockWire {
    id: string;
    type: string;
    sort_order: number;
    data: Record<string, unknown>;
}

/** Map a unified block to a post content block (flat data bag). */
export function toPostContentBlock(b: UnifiedBlock, sortOrder: number,): PostContentBlockWire {
    const data: Record<string, unknown> = { ...mergedSettings(b,), };
    if (b.title !== undefined) data.title = b.title;
    if (b.content !== undefined) data.content = b.content;
    if (b.style !== undefined) data.style = b.style;
    return { id: b.id ?? newBlockId(), type: b.type, sort_order: sortOrder, data, };
}

/** Guard: reject page-only types (group/group_item) for post targets. */
export function assertPostBlockAllowed(type: string,): void {
    const spec = getBlockSpec(type,);
    if (spec?.pageOnly) {
        throw new Error(`Block type "${type}" is page-only (nesting). Posts do not support groups; use a page for grouped layouts.`,);
    }
    if (spec?.deprecated) {
        throw new Error(`Block type "${type}" is deprecated and cannot be created. See describe_block_types for the replacement.`,);
    }
}

/** Guard: reject deprecated types for page targets. */
export function assertPageBlockAllowed(type: string,): void {
    const spec = getBlockSpec(type,);
    if (!spec) throw new Error(`Unknown block type "${type}". Call describe_block_types for the list.`,);
    if (spec.deprecated) {
        throw new Error(`Block type "${type}" is deprecated and cannot be created. See describe_block_types for the replacement.`,);
    }
}
