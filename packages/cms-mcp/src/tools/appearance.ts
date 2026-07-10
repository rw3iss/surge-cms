/**
 * Appearance tools: the public appearance settings (colors / typography /
 * layout — these map to the site-wide `--site-*` CSS custom properties), the
 * reusable color swatch palette, and custom @font-face fonts.
 *
 * Swatches: anywhere a color appears, the value may be a raw hex OR the
 * reference string `swatch:{id}` (so editing a swatch cascades to every
 * consumer). `set_swatches` REPLACES the whole palette — list_swatches first
 * and include every swatch you want to keep.
 *
 * Fonts: the SDK upload takes a Blob; an agent has a local path or a URL. This
 * reads the file (node fs) or fetches the URL (global fetch) into a Blob, then
 * uploads via the multipart `file` field.
 */
import { readFile, } from 'node:fs/promises';
import { basename, } from 'node:path';
import { z, } from 'zod';
import type { AppearanceSettings, FontUploadBody, SiteSwatch, } from '@rw/cms-shared';
import { defineTool, type ToolContext, type ToolDef, } from '../tool';

/** The AppearanceSettings fields as an optional zod fragment. */
const appearanceShape = {
    backgroundColor: z.string().optional().describe('Site background (hex or swatch:{id}). → --site-bg.',),
    textColor: z.string().optional().describe('Body text color. → --site-text.',),
    primaryColor: z.string().optional().describe('Primary/brand color. → --site-primary.',),
    linkColor: z.string().optional().describe('Link color. → --site-link.',),
    headingColor: z.string().optional().describe('Heading color. → --site-heading.',),
    borderColor: z.string().optional().describe('Border color. → --site-border.',),
    fontFamily: z.string().optional().describe('Body font family. → --site-font.',),
    headingFontFamily: z.string().optional().describe('Heading font family. → --site-heading-font.',),
    fontSize: z.number().optional().describe('Base font size (number, px). → --site font sizing.',),
    headingWeight: z.string().optional().describe('Heading font-weight. → --site-heading-weight.',),
    lineHeight: z.string().optional().describe('Base line-height. → --site-line-height.',),
    gutterWidth: z.string().optional().describe('Page gutter. → --site-gutter.',),
    borderRadius: z.string().optional().describe('Corner radius. → --site-radius.',),
    maxContentWidth: z.string().optional().describe('Max content width. → --site-max-width.',),
    blockPadding: z.string().optional().describe('Default block padding. → --site-block-padding.',),
};

// Tools carry required-field input shapes, so each `defineTool(...)` returns a
// narrow `ToolDef<Shape>` whose handler param is contravariant with the erased
// `ToolDef`. The registry only needs the erased form (the server validates args
// from the Zod shape at call time), so collect them and widen at the boundary.
const tools = [
    // ─── Read ─────────────────────────────────────────────────────
    defineTool({
        name: 'get_appearance',
        description:
            'Get the public appearance settings — colors (background/text/primary/link/heading/border), typography (font families, size, weight, line-height), and layout (gutter, radius, max width, block padding). These map to the site-wide `--site-*` CSS variables. GLOBAL site state.',
        handler: async (_args, ctx: ToolContext,) => {
            return ctx.cms.settings.getAppearance();
        },
    },),
    defineTool({
        name: 'list_swatches',
        description:
            'List the site color-swatch palette (a bare array of { id, hex, name? }). Colors elsewhere may reference a swatch as the string `swatch:{id}` so edits cascade. To modify the palette, list here first, then pass the full desired list to set_swatches (it REPLACES the whole palette).',
        handler: async (_args, ctx: ToolContext,) => {
            return ctx.cms.settings.listSwatches();
        },
    },),
    defineTool({
        name: 'swatch_usages',
        description:
            'Count how many things reference a swatch (`swatch:{id}`) across the DB, broken down by source. Returns { total, breakdown: [{ source, count }] }. Check before deleting a swatch from the palette.',
        inputSchema: {
            id: z.string().describe('Swatch id.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.settings.swatchUsages(args.id,);
        },
    },),
    defineTool({
        name: 'list_fonts',
        description:
            'List custom uploaded fonts, each enriched with its @font-face source URL: { id, customId, familyName, originalName, format, sizeBytes, url }. Use a font family in update_appearance (fontFamily / headingFontFamily).',
        handler: async (_args, ctx: ToolContext,) => {
            return ctx.cms.fonts.list();
        },
    },),

    // ─── Write ────────────────────────────────────────────────────
    defineTool({
        name: 'update_appearance',
        description:
            'Update the public appearance settings (partial — only provided fields change). Colors accept hex or `swatch:{id}`. These map to the site-wide `--site-*` CSS variables. GLOBAL site state — read get_appearance first if you intend to preserve/restore. Returns a confirmation message.',
        write: true,
        inputSchema: appearanceShape,
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.settings.appearance(args as AppearanceSettings,);
        },
    },),
    defineTool({
        name: 'set_swatches',
        description:
            'REPLACE the entire color-swatch palette with this list. Each swatch is { id, hex, name? } (hex 3/6 chars; invalid entries dropped, missing ids reallocated server-side). This is a WHOLE-PALETTE replace: call list_swatches first and INCLUDE every existing swatch you want to keep, plus any new ones. Returns the persisted palette.',
        write: true,
        inputSchema: {
            swatches: z.array(z.object({
                id: z.string().optional().describe('Swatch id (stable slug). Omit to have one allocated.',),
                hex: z.string().describe('Hex color (3 or 6 chars, with or without #).',),
                name: z.string().optional().describe('Optional human label (e.g. "Brand Red").',),
            }),).describe('The full replacement palette. Existing swatches NOT included here are removed.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.settings.replaceSwatches(args.swatches as Array<Partial<SiteSwatch>>,);
        },
    },),
    defineTool({
        name: 'upload_font',
        description:
            'Upload a custom font (@font-face). Provide EXACTLY ONE of `path` (a local font file — woff2/woff/ttf/otf) or `url` (a remote font file to fetch). Optionally set `familyName` (the CSS font-family name to reference in update_appearance) and `customId` (a stable slug). The MCP reads/fetches the file into a Blob and uploads it. Returns the created font with its source URL.',
        write: true,
        inputSchema: {
            path: z.string().optional().describe('Local filesystem path to the font file. Provide this OR url.',),
            url: z.string().optional().describe('Remote URL of the font file to fetch. Provide this OR path.',),
            familyName: z.string().optional().describe('CSS font-family name to expose (referenced in appearance fontFamily).',),
            customId: z.string().optional().describe('Stable slug id for the font.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const hasPath = args.path !== undefined && args.path !== '';
            const hasUrl = args.url !== undefined && args.url !== '';
            if (hasPath === hasUrl) {
                throw new Error('Provide exactly one of `path` or `url`.',);
            }

            let blob: Blob;
            let name: string;
            if (hasPath) {
                const buf = await readFile(args.path as string,);
                blob = new Blob([buf],);
                name = basename(args.path as string,);
            } else {
                const res = await fetch(args.url as string,);
                if (!res.ok) {
                    throw new Error(`Failed to fetch font from ${args.url}: ${res.status} ${res.statusText}`,);
                }
                blob = await res.blob();
                name = basename(new URL(args.url as string,).pathname,) || 'font';
            }

            // The SDK's multipart `file` field is a Blob; give it a filename so
            // the backend can read the extension/format. `File` is global in
            // Node 20 and extends Blob.
            const file = new File([blob], name,);
            const fields: FontUploadBody = {};
            if (args.familyName !== undefined) fields.familyName = args.familyName;
            if (args.customId !== undefined) fields.customId = args.customId;
            return ctx.cms.fonts.upload(file, fields,);
        },
    },),
    defineTool({
        name: 'delete_font',
        description: 'Delete a custom font (removes the file + row). Returns the deleted font row.',
        write: true,
        inputSchema: {
            id: z.string().describe('Font id.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.fonts.remove(args.id,);
        },
    },),
];

export const appearanceTools: ToolDef[] = tools as unknown as ToolDef[];
