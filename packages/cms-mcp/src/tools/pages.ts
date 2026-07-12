/**
 * Page tools: page CRUD, page-block CRUD (with the group → group_item → child
 * nesting workflow), block reordering (scoped per parent), and revisions.
 *
 * Blocks are structured and nestable here (unlike posts). The KEY tool is
 * `add_page_block`: for a `group` it also synthesizes N `group_item` slots so
 * the agent can fill each slot with a child block via `parentBlockId`.
 */
import { z, } from 'zod';
import type { PageBlockBody, PageCreateBody, } from '@sitesurge/types';
import { defaultBlockData, } from '../catalog/blockTypes';
import { newBlockId, } from '../util/ids';
import { defineTool, type ToolDef, type ToolContext, } from '../tool';
import {
    assertPageBlockAllowed, blockInputShape, toPageBlockBody, type UnifiedBlock,
} from './blocks';

/** Clamp the requested column count into the group's valid 1..16 range. */
function clampColumns(n: unknown,): number {
    const raw = typeof n === 'number' ? n : Number(n,);
    if (!Number.isFinite(raw,)) return 2;
    return Math.min(16, Math.max(1, Math.trunc(raw,),),);
}

/** Build a Partial<PageBlockBody> with only the keys the caller provided —
 *  no catalog-default merge on update (unlike create). */
function toPageBlockUpdateBody(args: {
    title?: string;
    content?: string;
    settings?: Record<string, unknown>;
    style?: Record<string, unknown> | null;
    parentBlockId?: string | null;
    isVisible?: boolean;
    order?: number;
},): Partial<PageBlockBody> {
    const body: Partial<PageBlockBody> = {};
    if (args.title !== undefined) body.title = args.title;
    if (args.content !== undefined) body.content = args.content;
    if (args.settings !== undefined) body.settings = args.settings;
    if (args.style !== undefined) body.style = args.style;
    if (args.parentBlockId !== undefined) body.parentBlockId = args.parentBlockId;
    if (args.isVisible !== undefined) body.isVisible = args.isVisible;
    if (args.order !== undefined) body.order = args.order;
    return body;
}

const pageCreateShape = {
    slug: z.string().describe('URL slug (unique). e.g. "about" for /about.',),
    title: z.string().describe('Page title.',),
    titleAlignment: z.enum(['left', 'center', 'right',],).optional().describe('Alignment of the printed page title.',),
    description: z.string().optional().describe('Short page description.',),
    metaTitle: z.string().optional().describe('SEO <title>.',),
    metaDescription: z.string().optional().describe('SEO meta description.',),
    metaKeywords: z.array(z.string(),).optional().describe('SEO keywords.',),
    ogImage: z.string().optional().describe('Open Graph image URL.',),
    status: z.enum(['draft', 'published', 'scheduled', 'archived', 'deleted',],).optional().describe('Publication status (default draft).',),
    publishAt: z.string().nullable().optional().describe('ISO date-time to publish (for status="scheduled").',),
    isHomepage: z.boolean().optional().describe('Flag this page as the site homepage.',),
    showTitle: z.boolean().optional().describe('Whether to render the page title (default true).',),
    showInNav: z.boolean().optional().describe('Include this page in the main navigation.',),
    navOrder: z.number().optional().describe('Sort order within the navigation.',),
    isPrivate: z.boolean().optional().describe('Restrict access (see accessLevel).',),
    accessLevel: z.string().optional().describe('Content access level (public | members | tier).',),
};

/** Assemble a PageCreateBody from validated tool args (identity mapping). */
function toPageCreateBody(a: Record<string, unknown>,): PageCreateBody {
    return a as unknown as PageCreateBody;
}

// Tools carry required-field input shapes, so each `defineTool(...)` returns a
// narrow `ToolDef<Shape>` whose handler param is contravariant with the erased
// `ToolDef`. The registry only needs the erased form (the server validates args
// from the Zod shape at call time), so collect them and widen at the boundary.
const tools = [
    // ─── Read ─────────────────────────────────────────────────────
    defineTool({
        name: 'list_pages',
        description:
            'List CMS pages (any status), paginated. Filter by status/search and sort. Returns { data, meta } where meta has { page, limit, total, totalPages }. Use get_page for a single page with its block tree.',
        inputSchema: {
            status: z.string().optional().describe('Filter by status (draft | published | scheduled | archived | deleted).',),
            search: z.string().optional().describe('Free-text search over title/slug.',),
            sort: z.string().optional().describe('Sort key (e.g. created_at, title).',),
            page: z.number().optional().describe('1-based page number.',),
            limit: z.number().optional().describe('Items per page.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.pages.list(args,);
        },
    },),
    defineTool({
        name: 'get_page',
        description:
            'Fetch one page WITH its full hydrated block tree. Provide exactly one of `id` or `slug`. Each block carries { id, parentBlockId, order, type, title, content, settings, style, isVisible } — use those ids for update/delete/reorder/nesting. `preview="admin"` (slug fetch) reveals unpublished pages.',
        inputSchema: {
            id: z.string().optional().describe('Page id. Provide this OR slug (not both).',),
            slug: z.string().optional().describe('Page slug. Provide this OR id (not both).',),
            preview: z.string().optional().describe('Slug fetch only: "admin" to see unpublished pages.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const hasId = args.id !== undefined && args.id !== '';
            const hasSlug = args.slug !== undefined && args.slug !== '';
            if (hasId === hasSlug) {
                throw new Error('Provide exactly one of `id` or `slug`.',);
            }
            if (hasId) return ctx.cms.pages.getById(args.id as string,);
            return ctx.cms.pages.getBySlug(args.slug as string, args.preview ? { preview: args.preview, } : undefined,);
        },
    },),
    defineTool({
        name: 'list_page_revisions',
        description:
            'List saved revisions for a page (newest first). Each revision has a `version` number; pass it to restore_page_revision to roll back.',
        inputSchema: {
            id: z.string().describe('Page id.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.pages.listRevisions(args.id,);
        },
    },),

    // ─── Write: page CRUD ─────────────────────────────────────────
    defineTool({
        name: 'create_page',
        description:
            'Create a page (no blocks yet — add them with add_page_block). Set slug + title; optionally SEO (metaTitle/metaDescription/metaKeywords/ogImage), status, publishAt, isHomepage, showTitle, navigation (showInNav/navOrder), and access (isPrivate/accessLevel). Returns the created page with an empty block tree.',
        write: true,
        inputSchema: pageCreateShape,
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.pages.create(toPageCreateBody(args,),);
        },
    },),
    defineTool({
        name: 'update_page',
        description:
            'Update a page (partial). Only the fields you pass change. Manages navigation membership/order via showInNav/navOrder/isHomepage. Returns the updated page with blocks.',
        write: true,
        inputSchema: {
            id: z.string().describe('Page id.',),
            ...Object.fromEntries(
                Object.entries(pageCreateShape,).map(([k, v,],) => [k, (v as z.ZodType).optional(),],),
            ),
        },
        handler: async (args, ctx: ToolContext,) => {
            const { id, ...rest } = args as Record<string, unknown> & { id: string; };
            return ctx.cms.pages.update(id, rest as Partial<PageCreateBody>,);
        },
    },),
    defineTool({
        name: 'delete_page',
        description: 'Delete a page (and its blocks). Returns a confirmation message.',
        write: true,
        inputSchema: {
            id: z.string().describe('Page id.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.pages.remove(args.id,);
        },
    },),
    defineTool({
        name: 'bulk_pages',
        description:
            'Bulk action over page ids: action="delete" removes them; action="status" sets each to `value` (e.g. "published"). Returns the count affected.',
        write: true,
        inputSchema: {
            ids: z.array(z.string(),).describe('Page ids to act on.',),
            action: z.enum(['delete', 'status',],).describe('The bulk action.',),
            value: z.string().optional().describe('New status when action="status".',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.pages.bulk({ ids: args.ids, action: args.action, value: args.value, },);
        },
    },),

    // ─── Write: page-block CRUD + nesting ─────────────────────────
    defineTool({
        name: 'add_page_block',
        description:
            'Add a block to a page. Pass the block\'s `type` plus optional title/content/settings/style (call describe_block_types for each type\'s fields). Settings are merged over the type defaults. '
            + 'NESTING: to place a block inside a group slot, set `parentBlockId` to a group_item id. '
            + 'GROUP WORKFLOW: when type="group", this ALSO creates N group_item slots (N = settings.columns, default 2, clamped 1..16) and returns { group, slots: [{ id, block }] }. '
            + 'Then call add_page_block again for each child with parentBlockId = a slot id (each slot holds ONE child). For non-group blocks the created block is returned directly.',
        write: true,
        inputSchema: {
            pageId: z.string().describe('Target page id.',),
            ...blockInputShape,
            parentBlockId: z.string().nullable().optional().describe('Place this block inside a group slot: the group_item id. Omit for a top-level block.',),
            isVisible: z.boolean().optional().describe('Whether the block renders (default true).',),
            order: z.number().optional().describe('Sort order within its parent.',),
            id: z.string().optional().describe('Client-supplied block id (v4 UUID). Auto-generated if omitted.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const { pageId, } = args;
            assertPageBlockAllowed(args.type,);

            const unified: UnifiedBlock = {
                id: args.id,
                type: args.type,
                title: args.title,
                content: args.content,
                settings: args.settings,
                style: args.style,
                parentBlockId: args.parentBlockId,
                isVisible: args.isVisible,
                order: args.order,
            };
            const body = toPageBlockBody(unified, { withId: true, },);
            const group = await ctx.cms.pages.createBlock(pageId, body,);

            if (args.type !== 'group') return group;

            // Group nesting (D3): auto-create N group_item slots under the group.
            const columns = clampColumns((args.settings as Record<string, unknown> | undefined)?.columns,);
            const slots: Array<{ id: string; block: unknown; }> = [];
            for (let i = 0; i < columns; i++) {
                const slotBody: PageBlockBody = {
                    id: newBlockId(),
                    parentBlockId: body.id,
                    type: 'group_item',
                    settings: defaultBlockData('group_item',),
                    order: i,
                };
                const created = await ctx.cms.pages.createBlock(pageId, slotBody,);
                slots.push({ id: slotBody.id as string, block: created, },);
            }
            return { group, slots, };
        },
    },),
    defineTool({
        name: 'update_page_block',
        description:
            'Update one page block (partial — only provided keys change; no catalog defaults are merged). '
            + 'MOVE a block by setting `parentBlockId` (a group_item id, or null for top-level). '
            + 'RESTYLE via `style`: inline BlockStyle fields, a template ref { "id": "<blockStyleId>" }, or null to clear. '
            + 'Reorder with reorder_page_blocks instead of `order` when moving many blocks.',
        write: true,
        inputSchema: {
            pageId: z.string().describe('Page id.',),
            blockId: z.string().describe('Block id (from get_page).',),
            title: z.string().optional().describe('New block title.',),
            content: z.string().optional().describe('New HTML body (rich_text/text/html).',),
            settings: z.record(z.string(), z.unknown(),).optional().describe('Replacement settings object (sent as-is, no default merge).',),
            style: z.union([z.record(z.string(), z.unknown(),), z.null(),],).optional().describe('Inline BlockStyle fields, { "id": "<blockStyleId>" } template ref, or null to clear.',),
            parentBlockId: z.string().nullable().optional().describe('Move: a group_item id, or null for top-level.',),
            isVisible: z.boolean().optional().describe('Show/hide the block.',),
            order: z.number().optional().describe('Sort order within its parent.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const { pageId, blockId, ...rest } = args;
            const body = toPageBlockUpdateBody(rest,);
            return ctx.cms.pages.updateBlock(pageId, blockId, body,);
        },
    },),
    defineTool({
        name: 'delete_page_block',
        description:
            'Delete a page block. Deleting a group removes its group_items (and their children); deleting a group_item removes its held child. Returns a confirmation message.',
        write: true,
        inputSchema: {
            pageId: z.string().describe('Page id.',),
            blockId: z.string().describe('Block id to delete.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.pages.deleteBlock(args.pageId, args.blockId,);
        },
    },),
    defineTool({
        name: 'reorder_page_blocks',
        description:
            'Reorder blocks WITHIN one parent. `blockIds` is the full ordered id list for that parent. Reorder is SCOPED per parent: pass `parentBlockId` (a group_item id) to reorder that slot\'s children, or omit/null to reorder top-level blocks. Does not move blocks between parents (use update_page_block for that).',
        write: true,
        inputSchema: {
            pageId: z.string().describe('Page id.',),
            blockIds: z.array(z.string(),).describe('Full ordered list of block ids for the target parent.',),
            parentBlockId: z.string().nullable().optional().describe('Scope: the parent group_item id, or null/omit for top-level.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.pages.reorderBlocks(args.pageId, {
                blockIds: args.blockIds,
                parentBlockId: args.parentBlockId ?? null,
            },);
        },
    },),

    // ─── Write: revisions ─────────────────────────────────────────
    defineTool({
        name: 'restore_page_revision',
        description:
            'Restore a page to a saved revision `version` (from list_page_revisions). Returns the restored page with its block tree.',
        write: true,
        inputSchema: {
            id: z.string().describe('Page id.',),
            version: z.number().describe('Revision version number to restore.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.pages.restoreRevision(args.id, args.version,);
        },
    },),
];

export const pageTools: ToolDef[] = tools as unknown as ToolDef[];
