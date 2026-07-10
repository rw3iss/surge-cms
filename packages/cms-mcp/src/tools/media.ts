/**
 * Media library tools: list/get/update/delete, plus upload-from-path-or-URL.
 *
 * The SDK upload takes a Blob; an agent has a local path or a remote URL. Like
 * upload_font, `upload_media` reads the file (node fs) or fetches the URL
 * (global fetch) into a Blob, then uploads via the multipart `file` field. It
 * returns the created media id + url so the agent can wire the asset into image
 * / video / document / hero blocks (see describe_block_types).
 */
import { readFile, } from 'node:fs/promises';
import { basename, } from 'node:path';
import { z, } from 'zod';
import type { MediaUpdateBody, MediaUploadFields, } from '@rw/cms-shared';
import { defineTool, type ToolContext, type ToolDef, } from '../tool';

const tools = [
    // ─── Read ─────────────────────────────────────────────────────
    defineTool({
        name: 'list_media',
        description:
            'List media library assets (paginated). Filter by `type` (e.g. "image", "video", "document"), `search` (filename/title), and `sort`. Returns { data: [media rows], meta: pagination }. Each row has id, url, type, title, alt, caption, dimensions/size. Use ids/urls to wire blocks.',
        inputSchema: {
            type: z.string().optional().describe('MIME-family filter, e.g. "image", "video", "document".',),
            search: z.string().optional().describe('Search filename / title.',),
            sort: z.string().optional().describe('Sort order (server-defined keys).',),
            page: z.number().optional().describe('Page number (1-based).',),
            limit: z.number().optional().describe('Page size.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.media.list(args as Record<string, unknown>,);
        },
    },),
    defineTool({
        name: 'get_media',
        description:
            'Get one media asset by id: url, type, title, alt, caption, dimensions, size, thumbnails. Use the id/url to wire an image/video/document/hero block.',
        inputSchema: {
            id: z.string().describe('Media id.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.media.getById(args.id,);
        },
    },),

    // ─── Write ────────────────────────────────────────────────────
    defineTool({
        name: 'upload_media',
        description:
            'Upload a media asset from a local file path OR a remote URL. Provide EXACTLY ONE of `path` (a local file — image/video/document) or `url` (a remote file to fetch). Optionally set `alt` and `caption`. The MCP reads/fetches the file into a Blob and uploads it. Returns the created media (id + url) so you can immediately wire it into a block (see describe_block_types for image/video/document/hero).',
        write: true,
        inputSchema: {
            path: z.string().optional().describe('Local filesystem path to the file. Provide this OR url.',),
            url: z.string().optional().describe('Remote URL of the file to fetch. Provide this OR path.',),
            alt: z.string().optional().describe('Alt text (accessibility).',),
            caption: z.string().optional().describe('Caption text.',),
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
                    throw new Error(`Failed to fetch media from ${args.url}: ${res.status} ${res.statusText}`,);
                }
                blob = await res.blob();
                name = basename(new URL(args.url as string,).pathname,) || 'upload';
            }

            // The SDK's multipart `file` field is a Blob; give it a filename so
            // the backend can read the extension/type. `File` is global in
            // Node 20 and extends Blob.
            const file = new File([blob], name,);
            const fields: MediaUploadFields = {};
            if (args.alt !== undefined) fields.alt = args.alt;
            if (args.caption !== undefined) fields.caption = args.caption;
            return ctx.cms.media.upload(file, fields,);
        },
    },),
    defineTool({
        name: 'update_media',
        description:
            'Update a media asset\'s metadata (partial): title, alt, caption. Does not replace the file. Returns the updated media row.',
        write: true,
        inputSchema: {
            id: z.string().describe('Media id.',),
            title: z.string().optional().describe('Title.',),
            alt: z.string().optional().describe('Alt text.',),
            caption: z.string().optional().describe('Caption.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const body: MediaUpdateBody = {};
            if (args.title !== undefined) body.title = args.title;
            if (args.alt !== undefined) body.alt = args.alt;
            if (args.caption !== undefined) body.caption = args.caption;
            return ctx.cms.media.update(args.id, body,);
        },
    },),
    defineTool({
        name: 'delete_media',
        description: 'Delete a media asset (removes the file + row). Blocks referencing it will lose their asset. Returns a confirmation message.',
        write: true,
        inputSchema: {
            id: z.string().describe('Media id.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.media.remove(args.id,);
        },
    },),
];

export const mediaTools: ToolDef[] = tools as unknown as ToolDef[];
