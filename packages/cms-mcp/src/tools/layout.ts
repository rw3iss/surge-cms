/**
 * Site header + footer tools. Both the header and the footer are stored as ONE
 * whole settings object, so the write tools REPLACE the entire config: get it,
 * modify it, put it back.
 *
 * Header: a flat list of `items` (image / image_link / text / text_link /
 * button / menu / gap / flex_spacer), each ordered; `menu` items may carry
 * `children`. Footer: `rows` → `columns` → `items` (the same item family),
 * with an `enabled` master switch and per-row / per-column styling.
 */
import { z, } from 'zod';
import type { SiteFooterSettings, SiteHeaderSettings, } from '@rw/cms-shared';
import { defineTool, type ToolContext, type ToolDef, } from '../tool';

const ITEM_TYPES = ['image', 'image_link', 'text', 'text_link', 'button', 'menu', 'gap', 'flex_spacer',] as const;

/** One header/footer layout item. `children` (menu sub-items) is loosely typed
 *  (recursive) so the structured schema doesn't need a lazy self-reference. */
const layoutItemSchema = z.object({
    id: z.string().describe('Stable item id.',),
    type: z.enum(ITEM_TYPES,).describe('Item type: image | image_link | text | text_link | button | menu | gap | flex_spacer.',),
    text: z.string().optional().describe('Text (text / text_link / button / menu label).',),
    url: z.string().optional().describe('Link/target URL (links, buttons, image_link).',),
    imageUrl: z.string().optional().describe('Image src (image / image_link).',),
    mediaId: z.string().optional().describe('Media library id backing the image.',),
    openInNewTab: z.boolean().optional().describe('Open the link in a new tab.',),
    buttonColor: z.string().optional().describe('Button background color (hex or swatch:{id}).',),
    fontSize: z.string().optional().describe('Font size CSS value.',),
    fontWeight: z.string().optional().describe("Font-weight (numeric '100'..'900' or 'normal'/'bold'). Footer items only.",),
    textColor: z.string().optional().describe('Text color (hex or swatch:{id}).',),
    width: z.string().optional().describe('CSS width.',),
    alignment: z.string().optional().describe("Alignment: 'left' | 'center' | 'right'.",),
    verticalAlignment: z.string().optional().describe("Cross-axis alignment (footer items).",),
    margin: z.string().optional().describe('CSS margin.',),
    padding: z.string().optional().describe('CSS padding.',),
    order: z.number().describe('Sort order within its container.',),
    children: z.array(z.record(z.unknown(),),).optional().describe('Sub-items for a `menu` item (same item shape).',),
},);

const headerSchema = z.object({
    items: z.array(layoutItemSchema,).describe('Ordered header items.',),
    backgroundColor: z.string().optional().describe('Header background (hex or swatch:{id}).',),
    textColor: z.string().optional().describe('Header default text color.',),
    padding: z.string().optional().describe('Header padding.',),
    margin: z.string().optional().describe('Header margin.',),
    itemSpacing: z.string().optional().describe('Gap between items.',),
    applyGutter: z.boolean().optional().describe('Constrain the header to the site container width.',),
},);

const footerColumnSchema = z.object({
    id: z.string().describe('Stable column id.',),
    flex: z.number().optional().describe('flex-grow factor (default 1 — even split).',),
    direction: z.enum(['row', 'column',],).optional().describe('Inner item layout direction.',),
    gap: z.string().optional().describe('Spacing between items.',),
    padding: z.string().optional().describe('Column padding.',),
    margin: z.string().optional().describe('Column margin.',),
    alignment: z.enum(['start', 'center', 'end', 'space-between', 'space-around',],).optional().describe('Main-axis alignment (justify-content).',),
    verticalAlignment: z.enum(['start', 'center', 'end', 'stretch',],).optional().describe('Cross-axis alignment (align-items).',),
    items: z.array(layoutItemSchema,).describe('Ordered items in this column.',),
},);

const footerRowSchema = z.object({
    id: z.string().describe('Stable row id.',),
    useGutter: z.boolean().optional().describe('Constrain the row to the site container width.',),
    gap: z.string().optional().describe('Spacing between columns.',),
    padding: z.string().optional().describe('Row padding.',),
    margin: z.string().optional().describe('Row margin.',),
    backgroundColor: z.string().optional().describe('Row background (hex or swatch:{id}).',),
    columns: z.array(footerColumnSchema,).describe('Columns in this row (flex-split).',),
},);

const footerSchema = z.object({
    enabled: z.boolean().describe('Master switch — false hides the footer entirely.',),
    rows: z.array(footerRowSchema,).describe('Stacked footer rows (→ columns → items).',),
    backgroundColor: z.string().optional().describe('Outer footer background (hex or swatch:{id}).',),
    padding: z.string().optional().describe('Footer padding.',),
    margin: z.string().optional().describe('Footer margin.',),
},);

// Tools carry required-field input shapes, so each `defineTool(...)` returns a
// narrow `ToolDef<Shape>` whose handler param is contravariant with the erased
// `ToolDef`. The registry only needs the erased form (the server validates args
// from the Zod shape at call time), so collect them and widen at the boundary.
const tools = [
    // ─── Read ─────────────────────────────────────────────────────
    defineTool({
        name: 'get_site_header',
        description:
            'Get the site header config: { items: [{ id, type, text?, url?, imageUrl?, order, children?, … }], backgroundColor?, textColor?, padding?, margin?, itemSpacing?, applyGutter? }. Item types: image | image_link | text | text_link | button | menu | gap | flex_spacer. GLOBAL site state — get first, then modify + put back via update_site_header (whole-object replace).',
        handler: async (_args, ctx: ToolContext,) => {
            return ctx.cms.settings.getSiteHeader();
        },
    },),
    defineTool({
        name: 'get_site_footer',
        description:
            'Get the site footer config: { enabled, rows: [{ id, useGutter?, gap?, columns: [{ id, flex?, direction?, alignment?, items: [...] }] }], backgroundColor?, padding?, margin? }. Footer items share the header item shape. GLOBAL site state — get first, then modify + put back via update_site_footer (whole-object replace).',
        handler: async (_args, ctx: ToolContext,) => {
            return ctx.cms.settings.getSiteFooter();
        },
    },),

    // ─── Write ────────────────────────────────────────────────────
    defineTool({
        name: 'update_site_header',
        description:
            'REPLACE the entire site header config. This is a WHOLE-OBJECT replace (the header is one settings row): call get_site_header first, modify the returned object, and pass it back as `header`. `header.items` is the full ordered item list (each { id, type, order, ... }); a `menu` item may carry `children`. Colors accept hex or `swatch:{id}`. Returns a confirmation message.',
        write: true,
        inputSchema: {
            header: headerSchema.describe('The complete replacement header settings object.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.settings.siteHeader(args.header as unknown as SiteHeaderSettings,);
        },
    },),
    defineTool({
        name: 'update_site_footer',
        description:
            'REPLACE the entire site footer config. This is a WHOLE-OBJECT replace (the footer is one settings row): call get_site_footer first, modify the returned object, and pass it back as `footer`. `footer.enabled` toggles rendering; `footer.rows` → `columns` → `items` is the full layout. Colors accept hex or `swatch:{id}`. Returns a confirmation message.',
        write: true,
        inputSchema: {
            footer: footerSchema.describe('The complete replacement footer settings object.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.settings.siteFooter(args.footer as unknown as SiteFooterSettings,);
        },
    },),
];

export const layoutTools: ToolDef[] = tools as unknown as ToolDef[];
