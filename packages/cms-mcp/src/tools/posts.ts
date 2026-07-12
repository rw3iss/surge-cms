/**
 * Post tools: post CRUD, post content-block ops, reordering, and revisions.
 *
 * Posts differ from pages in two ways that shape these tools:
 *  - FLAT / NON-NESTABLE (D5): posts have no groups. `group`/`group_item` are
 *    page-only and rejected here via assertPostBlockAllowed.
 *  - NO GRANULAR BLOCK ENDPOINTS (D4): the server sets post content blocks as a
 *    WHOLE ARRAY on create/update (delete-all + insert-all), plus a reorder. So:
 *      * `set_post_blocks` is the declarative primitive — the whole desired state
 *        in one call (no stale-id hazards).
 *      * `add_post_block` / `update_post_block` / `delete_post_block` are
 *        ergonomic single-block edits implemented as READ-MODIFY-WRITE: fetch the
 *        post, mutate its contentBlocks array, send it back via update.
 *
 * Each post block is a flat bag: { id, type, sort_order, data } where `data`
 * holds title + content + settings + style together.
 *
 * Read vs write field naming: the read shape (PostContentBlock) uses camelCase
 * `sortOrder`; the write shape (PostCreateContentBlock) uses snake_case
 * `sort_order`. read→write conversion happens in `readToWriteBlocks`.
 */
import { z, } from 'zod';
import type { PostContentBlock, PostCreateBody, PostCreateContentBlock, PostWithBlocks, } from '@sitesurge/types';
import { newBlockId, } from '../util/ids';
import { defineTool, type ToolContext, type ToolDef, } from '../tool';
import {
    assertPostBlockAllowed, blockInputShape, toPostContentBlock, type UnifiedBlock,
} from './blocks';

/** Map a unified block to a write-shape post content block. `toPostContentBlock`
 *  types `type` as string (blocks.ts is target-agnostic); the posts DTO narrows
 *  it to the block-type union, so cast at this boundary. */
function toWriteBlock(b: UnifiedBlock, sortOrder: number,): PostCreateContentBlock {
    return toPostContentBlock(b, sortOrder,) as unknown as PostCreateContentBlock;
}

/** Convert read-shape post blocks (camelCase sortOrder) to write-shape
 *  (snake_case sort_order), preserving id/type/data. */
function readToWriteBlocks(blocks: PostContentBlock[],): PostCreateContentBlock[] {
    return blocks.map((b,) => ({
        id: b.id,
        type: b.type as PostCreateContentBlock['type'],
        sort_order: b.sortOrder,
        data: b.data,
    }),);
}

/** Re-sequence sort_order 0..n over the array order (posts are flat). */
function resequence(blocks: PostCreateContentBlock[],): PostCreateContentBlock[] {
    return blocks.map((b, i,) => ({ ...b, sort_order: i, }),);
}

const postCreateShape = {
    slug: z.string().describe('URL slug (unique). e.g. "my-post" for /posts/my-post.',),
    title: z.string().describe('Post title.',),
    excerpt: z.string().optional().describe('Short summary / teaser.',),
    content: z.string().optional().describe('Legacy body HTML (prefer content blocks).',),
    featuredImage: z.string().optional().describe('Featured image URL.',),
    status: z.enum(['draft', 'published', 'scheduled', 'archived', 'deleted',],).optional().describe('Publication status (default draft).',),
    publishAt: z.string().nullable().optional().describe('ISO date-time to publish (for status="scheduled").',),
    isPrivate: z.boolean().optional().describe('Restrict access (see accessLevel).',),
    accessLevel: z.string().optional().describe('Content access level (public | members | tier).',),
    tags: z.array(z.string(),).optional().describe('Tags.',),
    categories: z.array(z.string(),).optional().describe('Categories.',),
    metaTitle: z.string().optional().describe('SEO <title>.',),
    metaDescription: z.string().optional().describe('SEO meta description.',),
    publishedAt: z.string().optional().describe('Explicit published-at ISO date-time.',),
};

/** A UnifiedBlock argument (block type + optional title/content/settings/style). */
const unifiedBlockSchema = z.object(blockInputShape,);

// Tools carry required-field input shapes, so each `defineTool(...)` returns a
// narrow `ToolDef<Shape>` whose handler param is contravariant with the erased
// `ToolDef`. The registry only needs the erased form (the server validates args
// from the Zod shape at call time), so collect them and widen at the boundary.
const tools = [
    // ─── Read ─────────────────────────────────────────────────────
    defineTool({
        name: 'list_posts',
        description:
            'List blog posts, paginated. Anonymous scope sees published only; passing status/sort switches to the admin all-statuses view. Filter by tag/category/search/before/after/ids and set withBlocks to hydrate content blocks in each item. Returns { data, meta } where meta has { page, limit, total, totalPages }. Use get_post for one post with its blocks.',
        inputSchema: {
            status: z.string().optional().describe('Filter by status (draft | published | scheduled | archived | deleted). Presence switches to the admin all-statuses view.',),
            sort: z.string().optional().describe('Sort key (e.g. published_at, title).',),
            tag: z.string().optional().describe('Filter by tag.',),
            category: z.string().optional().describe('Filter by category.',),
            search: z.string().optional().describe('Free-text search over title/content.',),
            before: z.string().optional().describe('ISO date — published before.',),
            after: z.string().optional().describe('ISO date — published after.',),
            ids: z.string().optional().describe('Comma-separated post ids (pinned feeds).',),
            withBlocks: z.string().optional().describe('"1"|"true" to include content blocks in each list item.',),
            page: z.number().optional().describe('1-based page number.',),
            limit: z.number().optional().describe('Items per page.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.posts.list(args,);
        },
    },),
    defineTool({
        name: 'search_posts',
        description:
            'Full-text search over published posts. Returns { data, meta } with pagination on meta. Use list_posts for filtered/admin listings.',
        inputSchema: {
            q: z.string().describe('Search query.',),
            page: z.number().optional().describe('1-based page number.',),
            limit: z.number().optional().describe('Items per page.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.posts.search(args,);
        },
    },),
    defineTool({
        name: 'get_post',
        description:
            'Fetch one post WITH its content blocks. Provide exactly one of `id` or `slug`. Posts are FLAT (no nesting): each block is { id, type, sortOrder, data } where `data` holds title + content + settings + style together — use the ids for update_post_block / delete_post_block / reorder_post_blocks. `preview="admin"` (slug fetch) reveals unpublished posts.',
        inputSchema: {
            id: z.string().optional().describe('Post id. Provide this OR slug (not both).',),
            slug: z.string().optional().describe('Post slug. Provide this OR id (not both).',),
            preview: z.string().optional().describe('Slug fetch only: "admin" to see unpublished posts.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const hasId = args.id !== undefined && args.id !== '';
            const hasSlug = args.slug !== undefined && args.slug !== '';
            if (hasId === hasSlug) {
                throw new Error('Provide exactly one of `id` or `slug`.',);
            }
            if (hasId) return ctx.cms.posts.getById(args.id as string,);
            return ctx.cms.posts.getBySlug(args.slug as string, args.preview ? { preview: args.preview, } : undefined,);
        },
    },),
    defineTool({
        name: 'list_post_revisions',
        description:
            'List saved revisions for a post (newest first). Each revision has a `version` number; pass it to restore_post_revision to roll back.',
        inputSchema: {
            id: z.string().describe('Post id.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.posts.listRevisions(args.id,);
        },
    },),

    // ─── Write: post CRUD ─────────────────────────────────────────
    defineTool({
        name: 'create_post',
        description:
            'Create a post. Set slug + title; optionally excerpt, featuredImage, status, publishAt, access (isPrivate/accessLevel), tags/categories, SEO (metaTitle/metaDescription). '
            + 'Pass `blocks` (an array of block descriptors: { type, title?, content?, settings?, style? }) to author the body — they are stored in order as content blocks. Posts are FLAT: group/group_item are rejected. Returns the created post with its content blocks.',
        write: true,
        inputSchema: {
            ...postCreateShape,
            blocks: z.array(unifiedBlockSchema,).optional().describe('Ordered block descriptors for the post body. Each: { type, title?, content?, settings?, style? }. Call describe_block_types for each type\'s fields.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const { blocks, ...fields } = args as Record<string, unknown> & { blocks?: UnifiedBlock[]; };
            const body = fields as unknown as PostCreateBody;
            if (blocks) {
                body.contentBlocks = blocks.map((b, i,) => {
                    assertPostBlockAllowed(b.type,);
                    return toWriteBlock(b, i,);
                },);
            }
            return ctx.cms.posts.create(body,);
        },
    },),
    defineTool({
        name: 'update_post',
        description:
            'Update a post (partial — only provided fields change). Does NOT touch content blocks unless you pass a `blocks` array, in which case it REPLACES the whole set (delete-all + insert-all). For single-block edits prefer add_post_block / update_post_block / delete_post_block. Returns the updated post with blocks.',
        write: true,
        inputSchema: {
            id: z.string().describe('Post id.',),
            ...Object.fromEntries(
                Object.entries(postCreateShape,).map(([k, v,],) => [k, (v as z.ZodType).optional(),],),
            ),
            blocks: z.array(unifiedBlockSchema,).optional().describe('If provided, REPLACES all content blocks with this ordered set. Omit to leave blocks untouched.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const { id, blocks, ...rest } = args as Record<string, unknown> & { id: string; blocks?: UnifiedBlock[]; };
            const body = rest as Partial<PostCreateBody>;
            if (blocks) {
                body.contentBlocks = blocks.map((b, i,) => {
                    assertPostBlockAllowed(b.type,);
                    return toWriteBlock(b, i,);
                },);
            }
            return ctx.cms.posts.update(id, body,);
        },
    },),
    defineTool({
        name: 'delete_post',
        description: 'Delete a post (and its content blocks). Returns a confirmation message.',
        write: true,
        inputSchema: {
            id: z.string().describe('Post id.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.posts.remove(args.id,);
        },
    },),
    defineTool({
        name: 'bulk_posts',
        description:
            'Bulk action over post ids: action="delete" removes them; action="status" sets each to `value` (e.g. "published"). Returns the count affected.',
        write: true,
        inputSchema: {
            ids: z.array(z.string(),).describe('Post ids to act on.',),
            action: z.enum(['delete', 'status',],).describe('The bulk action.',),
            value: z.string().optional().describe('New status when action="status".',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.posts.bulk({ ids: args.ids, action: args.action, value: args.value, },);
        },
    },),

    // ─── Write: post content blocks ───────────────────────────────
    defineTool({
        name: 'set_post_blocks',
        description:
            'DECLARATIVE whole-array replace: set the post\'s content blocks to exactly this ordered list (delete-all + insert-all). Best for agent-driven generation — express the full desired state in one call, no stale ids. Each block is { type, title?, content?, settings?, style? }; posts are FLAT (group/group_item rejected). data holds content + settings + style together. Returns the updated post.',
        write: true,
        inputSchema: {
            id: z.string().describe('Post id.',),
            blocks: z.array(unifiedBlockSchema,).describe('Full ordered set of block descriptors. Replaces ALL existing content blocks.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const contentBlocks = args.blocks.map((b, i,) => {
                assertPostBlockAllowed(b.type,);
                return toWriteBlock(b as UnifiedBlock, i,);
            },);
            return ctx.cms.posts.update(args.id, { contentBlocks, },);
        },
    },),
    defineTool({
        name: 'add_post_block',
        description:
            'Add one content block to a post (ergonomic). READ-MODIFY-WRITE: fetches the post, inserts the block at `index` (default end), re-sequences, and re-sends the whole array. The new block is { type, title?, content?, settings?, style? }; posts are FLAT (group/group_item rejected). data holds content + settings + style together. Returns the updated post.',
        write: true,
        inputSchema: {
            id: z.string().describe('Post id.',),
            block: unifiedBlockSchema.describe('The block to add: { type, title?, content?, settings?, style? }.',),
            index: z.number().optional().describe('0-based insert position. Omit to append at the end.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            assertPostBlockAllowed(args.block.type,);
            const post = await ctx.cms.posts.getById(args.id,) as PostWithBlocks;
            const existing = readToWriteBlocks(post.contentBlocks ?? [],);

            const created = toWriteBlock({ ...(args.block as UnifiedBlock), id: newBlockId(), }, 0,);
            const at = args.index === undefined
                ? existing.length
                : Math.min(Math.max(0, Math.trunc(args.index,),), existing.length,);
            existing.splice(at, 0, created,);

            const contentBlocks = resequence(existing,);
            return ctx.cms.posts.update(args.id, { contentBlocks, },);
        },
    },),
    defineTool({
        name: 'update_post_block',
        description:
            'Update one content block of a post (ergonomic). READ-MODIFY-WRITE: fetches the post, finds the block by id, merges the provided fields into its `data` (title/content/style replace; settings shallow-merge — only provided keys change), keeps sibling blocks intact, and re-sends the array. Errors if blockId is not found. Returns the updated post.',
        write: true,
        inputSchema: {
            id: z.string().describe('Post id.',),
            blockId: z.string().describe('Content-block id (from get_post).',),
            title: z.string().optional().describe('New block title.',),
            content: z.string().optional().describe('New HTML body (rich_text/text/html).',),
            settings: z.record(z.string(), z.unknown(),).optional().describe('Type-specific fields to shallow-merge into data (only provided keys change).',),
            style: z.union([z.record(z.string(), z.unknown(),), z.null(),],).optional().describe('Inline BlockStyle fields, { "id": "<blockStyleId>" } template ref, or null to clear.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const post = await ctx.cms.posts.getById(args.id,) as PostWithBlocks;
            const existing = readToWriteBlocks(post.contentBlocks ?? [],);
            const target = existing.find((b,) => b.id === args.blockId,);
            if (!target) {
                throw new Error(`Block "${args.blockId}" not found on post "${args.id}".`,);
            }
            const data: Record<string, unknown> = { ...(target.data ?? {}), };
            if (args.title !== undefined) data.title = args.title;
            if (args.content !== undefined) data.content = args.content;
            if (args.style !== undefined) data.style = args.style;
            if (args.settings !== undefined) Object.assign(data, args.settings,);
            target.data = data;

            return ctx.cms.posts.update(args.id, { contentBlocks: existing, },);
        },
    },),
    defineTool({
        name: 'delete_post_block',
        description:
            'Delete one content block from a post (ergonomic). READ-MODIFY-WRITE: fetches the post, drops the block by id, re-sequences the remainder, and re-sends the array. Returns the updated post.',
        write: true,
        inputSchema: {
            id: z.string().describe('Post id.',),
            blockId: z.string().describe('Content-block id to delete.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const post = await ctx.cms.posts.getById(args.id,) as PostWithBlocks;
            const existing = readToWriteBlocks(post.contentBlocks ?? [],);
            const remaining = existing.filter((b,) => b.id !== args.blockId,);
            if (remaining.length === existing.length) {
                throw new Error(`Block "${args.blockId}" not found on post "${args.id}".`,);
            }
            const contentBlocks = resequence(remaining,);
            return ctx.cms.posts.update(args.id, { contentBlocks, },);
        },
    },),
    defineTool({
        name: 'reorder_post_blocks',
        description:
            'Reorder a post\'s content blocks. `blockIds` is the full ordered id list (posts are flat — no parent scope, unlike pages). Returns a confirmation message.',
        write: true,
        inputSchema: {
            id: z.string().describe('Post id.',),
            blockIds: z.array(z.string(),).describe('Full ordered list of content-block ids.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.posts.reorderBlocks(args.id, { blockIds: args.blockIds, },);
        },
    },),

    // ─── Write: revisions ─────────────────────────────────────────
    defineTool({
        name: 'restore_post_revision',
        description:
            'Restore a post to a saved revision `version` (from list_post_revisions). Returns the restored post with its content blocks.',
        write: true,
        inputSchema: {
            id: z.string().describe('Post id.',),
            version: z.number().describe('Revision version number to restore.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.posts.restoreRevision(args.id, args.version,);
        },
    },),
];

export const postTools: ToolDef[] = tools as unknown as ToolDef[];
