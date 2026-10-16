/**
 * Media library routes (all admin tier). Uploads stage to disk via a
 * multer `pre` middleware (preserving the local-dir vs temp-dir logic),
 * then the service pushes to the storage provider, generates thumbnails,
 * inserts the row, and cleans up temp files.
 *
 *   POST   /              — single upload (field "file"; alt/caption)
 *   POST   /block-upload  — content-block upload (field "file"; postId/blockId)
 *   POST   /bulk          — multi upload (field "files", max 10)
 *   GET    /              — paginated list (type/types/search/sort)
 *   GET    /:id           — fetch one
 *   PUT    /:id           — update metadata (title/alt/caption)
 *   GET    /usage         — where each media id is used (pages, posts, …)
 *   DELETE /:id           — delete (removes from storage); 409 MEDIA_IN_USE
 *                            while used somewhere, unless ?force=true
 *   POST   /bulk-delete   — delete several (same in-use rule, `force`)
 *   POST   /:id/discard   — cancel an upload/encode: delete the media, its
 *                            files and any gallery item created from it
 *
 * Business logic lives in `services/media.ts`.
 */
import fs from 'fs/promises';
import multer from 'multer';
import { nanoid, } from '../utils/nanoid';
import path from 'path';
import { z, } from 'zod';
import type {
    AssertCompatible, MediaBulkDeleteBody, MediaBulkDeleteResponse, MediaByUrlQuery, MediaDeleteQuery, MediaDiscardBody, MediaListQuery,
    MediaUpdateBody, MediaUsageQuery, MediaUsageResponse,
} from '@sitesurge/types';
import { config, } from '../config';
import { defineRoute, reply, } from '../api/defineRoute';
import { ValidationError, } from '../core/errors';
import * as media from '../services/media';
import { assertNotInUse, findMediaUsage, } from '../services/mediaUsage';
import { requirePermission, } from '../services/permissions';
import type { UploadFile, } from '../services/media';

const multerDestDir = media.multerDestDir;

const storage = multer.diskStorage({
    destination: async (_req, _file, cb,) => {
        try {
            await fs.mkdir(multerDestDir, { recursive: true, },);
            cb(null, multerDestDir,);
        } catch (error) {
            cb(error as Error, multerDestDir,);
        }
    },
    filename: (_req, file, cb,) => {
        const uniqueId = nanoid(12,);
        const ext = path.extname(file.originalname,);
        cb(null, `${uniqueId}${ext}`,);
    },
},);

/**
 * `ALLOWED_FILE_TYPES` is enforced only when the operator sets it explicitly:
 * its built-in default omits common types (SVG, AVIF, MP3 variants) that
 * existing sites already upload, and starting to refuse them would be a
 * regression. Entries may end in `/*` (e.g. `image/*`).
 */
const allowList = process.env.ALLOWED_FILE_TYPES ? config.upload.allowedTypes.map((t,) => t.trim().toLowerCase()).filter(Boolean,) : null;
function isAllowedType(mime: string,): boolean {
    if (!allowList) return true;
    const m = mime.toLowerCase();
    return allowList.some((t,) => (t.endsWith('/*',) ? m.startsWith(t.slice(0, -1,),) : m === t));
}

const upload = multer({
    storage,
    limits: { fileSize: config.upload.maxSizeMb * 1024 * 1024, },
    fileFilter: (_req, file, cb,) => {
        if (isAllowedType(file.mimetype,)) return cb(null, true,);
        cb(new ValidationError(`File type not allowed: ${file.mimetype}`,),);
    },
},);

const idParams = z.object({ id: z.string(), },);

/** Comma-separated media ids → a de-duplicated list (≤ 100). */
const usageQuery = z.object({ ids: z.string().min(1,).max(4000,), },) satisfies z.ZodType<MediaUsageQuery>;
const splitIds = (raw: string,): string[] => [...new Set(raw.split(',',).map((s,) => s.trim(),).filter(Boolean,),),].slice(0, 100,);

const deleteQuery = z.object({ force: z.enum(['true', 'false',],).optional(), },) satisfies z.ZodType<MediaDeleteQuery>;
const bulkDeleteBody = z.object({
    ids: z.array(z.string().uuid(),).min(1,).max(200,),
    force: z.boolean().optional(),
},) satisfies z.ZodType<MediaBulkDeleteBody>;
const discardBody = z.object({ force: z.boolean().optional(), },) satisfies z.ZodType<MediaDiscardBody>;

const listQuery = z.object({
    type: z.string().optional(),
    types: z.string().optional(),
    search: z.string().optional(),
    sort: z.string().optional(),
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(200,).default(50,),
},);

const updateMetaSchema = z.object({
    title: z.string().optional(),
    alt: z.string().optional(),
    caption: z.string().optional(),
    credits: z.string().max(1000,).optional(),
},) satisfies z.ZodType<MediaUpdateBody>;

// Query coerces (string → number), so assert z.infer compatibility.
type _AssertMediaListQuery = AssertCompatible<z.infer<typeof listQuery>, MediaListQuery>;

function reqFile(req: { file?: Express.Multer.File; },): UploadFile | undefined {
    const f = req.file;
    return f ? {
        path: f.path, filename: f.filename, originalname: f.originalname,
        mimetype: f.mimetype, size: f.size,
    } : undefined;
}

function reqFiles(req: { files?: unknown; },): UploadFile[] | undefined {
    const files = req.files as Express.Multer.File[] | undefined;
    return files?.map((f,) => ({
        path: f.path, filename: f.filename, originalname: f.originalname,
        mimetype: f.mimetype, size: f.size,
    }),);
}

export const mediaRoutes = [

    defineRoute({
        method: 'post', path: '/', auth: 'staff',
        summary: 'Upload a single file (multipart, field "file"; optional title/alt/caption).',
        pre: [upload.single('file',),],
        handler: async ({ req, audit, },) => {
            const body = req.body as { alt?: string; caption?: string; title?: string; };
            const title = typeof body.title === 'string' ? body.title : undefined;
            const result = await media.upload(reqFile(req,), body.alt, body.caption, audit(), title,);
            return reply(result, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'post', path: '/block-upload', auth: 'staff',
        summary: 'Upload a file for a content block (multipart, field "file"; postId/blockId).',
        pre: [upload.single('file',),],
        handler: async ({ req, audit, },) => {
            const body = req.body as { postId?: string; blockId?: string; };
            const result = await media.blockUpload(reqFile(req,), body.postId, body.blockId, audit(),);
            return reply(result, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'post', path: '/bulk', auth: 'staff',
        summary: 'Upload multiple files (multipart, field "files", max 10).',
        pre: [upload.array('files', 10,),],
        handler: async ({ req, audit, },) => {
            const result = await media.bulkUpload(reqFiles(req,), audit(),);
            return reply(result, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/', auth: 'staff',
        summary: 'Paginated media list (type/types/search/sort filters).',
        input: { query: listQuery, },
        handler: async ({ query, },) => {
            const result = await media.list(query,);
            return reply(result.data, {
                meta: {
                    page: result.page,
                    limit: result.limit,
                    total: result.total,
                    totalPages: Math.ceil(result.total / result.limit,),
                },
            },);
        },
    },),

    defineRoute({
        method: 'get', path: '/by-url', auth: 'staff',
        summary: 'The library item behind a stored URL (null when not in the library).',
        input: { query: z.object({ url: z.string().min(1,).max(2048,), },) satisfies z.ZodType<MediaByUrlQuery>, },
        handler: ({ query, },) => media.findByUrl(query.url,),
    },),

    defineRoute({
        method: 'get', path: '/usage', auth: 'staff',
        summary: 'Where media is used — pages, posts, blocks, templates, settings, gallery, products, … (`ids` comma-separated, ≤ 100; ≤ 20 usages each).',
        input: { query: usageQuery, },
        handler: async ({ query, user, },): Promise<MediaUsageResponse> => {
            await requirePermission({ id: user?.id, role: user?.role, }, 'media:read',);
            return findMediaUsage(splitIds(query.ids,),);
        },
    },),

    defineRoute({
        method: 'post', path: '/bulk-delete', auth: 'staff',
        summary: 'Delete several media items. Without `force`, nothing is deleted when any is still in use (409 MEDIA_IN_USE, details.usage).',
        input: { body: bulkDeleteBody, },
        handler: async ({ body, user, audit, },): Promise<MediaBulkDeleteResponse> => {
            await requirePermission({ id: user?.id, role: user?.role, }, 'media:write',);
            const ids = [...new Set(body.ids,),];
            if (!body.force) await assertNotInUse(ids,);
            const deleted: string[] = [];
            const failed: string[] = [];
            for (const id of ids) {
                try {
                    await media.remove(id, audit(),);
                    deleted.push(id,);
                } catch {
                    failed.push(id,);
                }
            }
            return { deleted, failed, };
        },
    },),

    defineRoute({
        method: 'get', path: '/:id', auth: 'staff',
        summary: 'Fetch a media item by id.',
        input: { params: idParams, },
        handler: ({ params, },) => media.getById(params.id,),
    },),

    defineRoute({
        method: 'put', path: '/:id', auth: 'staff',
        summary: 'Update media metadata (title/alt/caption/credits).',
        input: { params: idParams, body: updateMetaSchema, },
        handler: ({ params, body, audit, },) => media.updateMeta(params.id, body, audit(),),
    },),

    defineRoute({
        method: 'delete', path: '/:id', auth: 'staff',
        summary: 'Delete a media item (removes files from storage). Refused with 409 MEDIA_IN_USE (details.usage) while it is used somewhere, unless `?force=true`.',
        input: { params: idParams, query: deleteQuery, },
        handler: async ({ params, query, audit, },) => {
            if (query.force !== 'true') await assertNotInUse([params.id,],);
            await media.remove(params.id, audit(),);
            return { message: 'Media deleted', };
        },
    },),

    defineRoute({
        method: 'post', path: '/:id/discard', auth: 'staff',
        summary: 'Cancel an upload or a running encode: stop the job, delete every stored file, the media row and gallery items made from it. 409 MEDIA_IN_USE when used outside the gallery, unless `force`.',
        input: { params: idParams, body: discardBody, },
        handler: async ({ params, body, user, audit, },) => {
            await requirePermission({ id: user?.id, role: user?.role, }, 'media:write',);
            // Gallery items made from the upload are removed by the discard itself.
            if (!body.force) await assertNotInUse([params.id,], { excludeKinds: ['gallery_item',], },);
            return media.discard(params.id, audit(),);
        },
    },),
];
