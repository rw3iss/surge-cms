/**
 * Block-style tools: shared style-template CRUD, plus `apply_block_style` which
 * sets a page or post block's `style`.
 *
 * A block references a template via `style: { id }`, styles inline via
 * `style: { ...fields }`, or clears via `style: null`. Templates themselves are
 * reusable named BlockStyle rows (`cms.blockStyles.*`).
 *
 * `apply_block_style` handles the two block systems differently (mirroring the
 * page vs post asymmetry from Phases B/C):
 *  - page: granular endpoint — `pages.updateBlock(pageId, blockId, { style })`.
 *  - post: NO granular endpoint — READ-MODIFY-WRITE the post's contentBlocks
 *    array (get → find by id → set data.style → update), converting the read
 *    shape (camelCase sortOrder) to the write shape (snake_case sort_order).
 */
import { z, } from 'zod';
import type {
    BlockStyleCreateBody, PostContentBlock, PostCreateContentBlock, PostWithBlocks,
} from '@sitesurge/types';
import { defineTool, type ToolContext, type ToolDef, } from '../tool';

/** The visual BlockStyle fields, as an optional zod fragment (nullable to allow
 *  explicit clears). `name` is added separately (required on create). */
const styleFieldShape = {
    isDefault: z.boolean().optional().describe('Mark this template as the site default (only one can be).',),
    backgroundColor: z.string().nullable().optional().describe('Background color (hex or swatch:{id}).',),
    textColor: z.string().nullable().optional().describe('Text color (hex or swatch:{id}).',),
    textAlign: z.string().nullable().optional().describe("Text alignment: 'left' | 'center' | 'right' | 'justify'.",),
    verticalAlign: z.string().nullable().optional().describe("Vertical alignment: 'top' | 'center' | 'bottom'.",),
    fontSize: z.string().nullable().optional().describe("Font size CSS value, e.g. '16px'.",),
    width: z.string().nullable().optional().describe('CSS width value.',),
    height: z.string().nullable().optional().describe('CSS height value.',),
    padding: z.string().nullable().optional().describe('CSS padding value.',),
    margin: z.string().nullable().optional().describe('CSS margin value.',),
    gap: z.string().nullable().optional().describe('CSS gap value (flex/grid containers).',),
    overflowX: z.string().nullable().optional().describe('CSS overflow-x value.',),
    overflowY: z.string().nullable().optional().describe('CSS overflow-y value.',),
};

/** Assemble a BlockStyleCreateBody from validated tool args (identity mapping). */
function toCreateBody(a: Record<string, unknown>,): BlockStyleCreateBody {
    return a as unknown as BlockStyleCreateBody;
}

/** Convert read-shape post blocks (camelCase sortOrder) to write-shape
 *  (snake_case sort_order), preserving id/type/data. Mirrors posts.ts. */
function readToWriteBlocks(blocks: PostContentBlock[],): PostCreateContentBlock[] {
    return blocks.map((b,) => ({
        id: b.id,
        type: b.type as PostCreateContentBlock['type'],
        sort_order: b.sortOrder,
        data: b.data,
    }),);
}

// Tools carry required-field input shapes, so each `defineTool(...)` returns a
// narrow `ToolDef<Shape>` whose handler param is contravariant with the erased
// `ToolDef`. The registry only needs the erased form (the server validates args
// from the Zod shape at call time), so collect them and widen at the boundary.
const tools = [
    // ─── Read ─────────────────────────────────────────────────────
    defineTool({
        name: 'list_block_styles',
        description:
            'List all shared block-style templates. Each is a named BlockStyle { id, name, isDefault?, backgroundColor, textColor, textAlign, verticalAlign, fontSize, width, height, padding, margin, gap, overflowX, overflowY }. Reference a template from a block via its style = { "id": "<blockStyleId>" }.',
        handler: async (_args, ctx: ToolContext,) => {
            return ctx.cms.blockStyles.list();
        },
    },),
    defineTool({
        name: 'get_block_style',
        description: 'Fetch one block-style template by id.',
        inputSchema: {
            id: z.string().describe('Block-style template id.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.blockStyles.getById(args.id,);
        },
    },),

    // ─── Write: template CRUD ─────────────────────────────────────
    defineTool({
        name: 'create_block_style',
        description:
            'Create a reusable block-style template. `name` is required; all visual fields are optional (hex or swatch:{id} for colors). Set isDefault=true to make it the site default (only one can be). Returns the created template with its id — reference it from a block via style = { "id": "<id>" } (see apply_block_style).',
        write: true,
        inputSchema: {
            name: z.string().describe('Template name (required).',),
            ...styleFieldShape,
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.blockStyles.create(toCreateBody(args,),);
        },
    },),
    defineTool({
        name: 'update_block_style',
        description:
            'Update a block-style template (partial — only provided fields change). Pass null for a field to clear it. Updating a template cascades to every block that references it via { "id": "<id>" }. Returns the updated template.',
        write: true,
        inputSchema: {
            id: z.string().describe('Block-style template id.',),
            name: z.string().optional().describe('New template name.',),
            ...styleFieldShape,
        },
        handler: async (args, ctx: ToolContext,) => {
            const { id, ...rest } = args as Record<string, unknown> & { id: string; };
            return ctx.cms.blockStyles.update(id, rest as Partial<BlockStyleCreateBody>,);
        },
    },),
    defineTool({
        name: 'delete_block_style',
        description:
            'Delete a block-style template. Blocks that referenced it fall back to their inherited/inline style. Returns a confirmation message.',
        write: true,
        inputSchema: {
            id: z.string().describe('Block-style template id.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.blockStyles.remove(args.id,);
        },
    },),

    // ─── Write: apply to a block ──────────────────────────────────
    defineTool({
        name: 'apply_block_style',
        description:
            "Set a page or post block's `style`. `style` is one of: a TEMPLATE ref { \"id\": \"<blockStyleId>\" }; an INLINE BlockStyle fields object (backgroundColor/textColor/padding/…); or null to CLEAR. "
            + "For target='page' this uses the granular endpoint (pages.updateBlock with { style }). "
            + "For target='post' there is no granular endpoint, so this READ-MODIFY-WRITEs the post: fetches it, finds the content block by id, sets data.style, and re-sends the whole contentBlocks array (siblings intact). Errors if blockId is not found on a post. Returns the updated block (page) or post (post).",
        write: true,
        inputSchema: {
            target: z.enum(['page', 'post',],).describe("Which block system the block lives in: 'page' (structured) or 'post' (flat).",),
            pageOrPostId: z.string().describe('The page id (target=page) or post id (target=post).',),
            blockId: z.string().describe('The block id to style (from get_page / get_post).',),
            style: z.union([z.record(z.string(), z.unknown(),), z.null(),],).describe('Template ref { "id": "<blockStyleId>" }, inline BlockStyle fields object, or null to clear.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const { target, pageOrPostId, blockId, style, } = args;
            if (target === 'page') {
                return ctx.cms.pages.updateBlock(pageOrPostId, blockId, { style, },);
            }
            // Post: read-modify-write over the flat contentBlocks array.
            const post = await ctx.cms.posts.getById(pageOrPostId,) as PostWithBlocks;
            const existing = readToWriteBlocks(post.contentBlocks ?? [],);
            const targetBlock = existing.find((b,) => b.id === blockId,);
            if (!targetBlock) {
                throw new Error(`Block "${blockId}" not found on post "${pageOrPostId}".`,);
            }
            targetBlock.data = { ...(targetBlock.data ?? {}), style, };
            return ctx.cms.posts.update(pageOrPostId, { contentBlocks: existing, },);
        },
    },),
];

export const blockStyleTools: ToolDef[] = tools as unknown as ToolDef[];
