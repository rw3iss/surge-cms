/**
 * Media library tools: list/get/update/delete, plus upload-from-path-or-URL.
 *
 * The SDK upload takes a Blob; an agent has a local path or a remote URL. Like
 * upload_font, `upload_media` reads the file (node fs) or fetches the URL
 * (global fetch) into a Blob, then uploads via the multipart `file` field. It
 * returns the created media id + url so the agent can wire the asset into image
 * / video / document / hero blocks (see describe_block_types).
 */
import { open, readFile, stat, } from 'node:fs/promises';
import { basename, extname, } from 'node:path';
import { z, } from 'zod';
import type { Media, MediaUpdateBody, MediaUploadFields, } from '@sitesurge/types';
import { defineTool, type ToolContext, type ToolDef, } from '../tool';

/** Above this (or for any video), a local file goes through the direct
 *  multipart path (`video` feature) — the single-request upload is capped by
 *  the proxy (≈ 50 MB). */
const DIRECT_THRESHOLD = 50 * 1024 * 1024;

const VIDEO_TYPES: Record<string, string> = {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
};

/**
 * Direct multipart upload of a local file: create/resume a session, PUT each
 * missing part to its presigned URL, complete. Resumable — re-running with the
 * same file continues where it stopped.
 */
async function directUpload(
    ctx: ToolContext,
    path: string,
    options: { title?: string; alt?: string; caption?: string; accessLevel?: 'public' | 'private'; },
): Promise<Media> {
    const info = await stat(path,);
    const name = basename(path,);
    const mimeType = VIDEO_TYPES[extname(name,).toLowerCase()] ?? 'application/octet-stream';
    const session = await ctx.cms.media.uploads.create({
        filename: name, mimeType, size: info.size,
        fingerprint: `${name}:${info.size}:${Math.round(info.mtimeMs,)}`.slice(0, 128,),
        options,
    },);
    const done = new Set(session.uploadedParts,);
    const todo = Array.from({ length: session.partCount, }, (_, i,) => i + 1,).filter((n,) => !done.has(n,));
    const fh = await open(path, 'r',);
    try {
        for (let i = 0; i < todo.length; i += 20) {
            const batch = todo.slice(i, i + 20,);
            const { urls, } = await ctx.cms.media.uploads.partUrls(session.id, batch,);
            for (const { partNumber, url, } of urls) {
                const start = (partNumber - 1) * session.partSize;
                const length = Math.min(session.partSize, session.size - start,);
                const buf = Buffer.alloc(length,);
                await fh.read(buf, 0, length, start,);
                let lastErr: unknown;
                for (let attempt = 0; attempt < 5; attempt++) {
                    try {
                        const res = await fetch(url, { method: 'PUT', body: buf, },);
                        if (res.ok) { lastErr = undefined; break; }
                        lastErr = new Error(`part ${partNumber}: HTTP ${res.status}`,);
                    } catch (e) {
                        lastErr = e;
                    }
                    await new Promise((r,) => setTimeout(r, 1000 * 2 ** attempt,));
                }
                if (lastErr) throw lastErr;
            }
        }
    } finally {
        await fh.close();
    }
    return ctx.cms.media.uploads.complete(session.id,);
}

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
            'Upload a media asset from a local file path OR a remote URL. Provide EXACTLY ONE of `path` (a local file — image/video/document) or `url` (a remote file to fetch). Optionally set `alt` and `caption`. A local VIDEO (or any file > 50 MB) goes through the resumable direct upload (video feature) and is then encoded to HLS in the background — check progress with get_video. Returns the created media (id + url) so you can immediately wire it into a block (see describe_block_types for image/video/document/hero).',
        write: true,
        inputSchema: {
            path: z.string().optional().describe('Local filesystem path to the file. Provide this OR url.',),
            url: z.string().optional().describe('Remote URL of the file to fetch. Provide this OR path.',),
            alt: z.string().optional().describe('Alt text (accessibility).',),
            caption: z.string().optional().describe('Caption text.',),
            title: z.string().optional().describe('Title (used for videos).',),
            accessLevel: z.enum(['public', 'private',],).optional()
                .describe('Videos only: "private" = encrypted, full video only for media.private:view (others get the teaser).',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const hasPath = args.path !== undefined && args.path !== '';
            const hasUrl = args.url !== undefined && args.url !== '';
            if (hasPath === hasUrl) {
                throw new Error('Provide exactly one of `path` or `url`.',);
            }
            // Large files and videos: direct multipart upload to object storage
            // (needs the `video` feature); a video is then encoded to HLS.
            if (hasPath) {
                const info = await stat(args.path as string,);
                const isVideo = !!VIDEO_TYPES[extname(args.path as string,).toLowerCase()];
                if (isVideo || info.size > DIRECT_THRESHOLD) {
                    return directUpload(ctx, args.path as string, {
                        title: args.title, alt: args.alt, caption: args.caption, accessLevel: args.accessLevel,
                    },);
                }
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
        name: 'get_video',
        description:
            'Encode status of an uploaded video (video feature): status, access level, renditions (quality, status, %), teaser, job progress, poster. Use after upload_media to wait until it is playable (status "ready").',
        inputSchema: {
            id: z.string().describe('Media id of the video.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.media.video.info(args.id,);
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
