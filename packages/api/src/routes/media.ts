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
 *   DELETE /:id           — delete (removes from storage)
 *
 * Business logic lives in `services/media.ts`.
 */
import fs from 'fs/promises';
import multer from 'multer';
import { nanoid, } from '../utils/nanoid';
import path from 'path';
import { z, } from 'zod';
import type { AssertCompatible, MediaByUrlQuery, MediaListQuery, MediaUpdateBody, } from '@sitesurge/types';
import { config, } from '../config';
import { defineRoute, reply, } from '../api/defineRoute';
import { ValidationError, } from '../core/errors';
import * as media from '../services/media';
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

const listQuery = z.object({
    type: z.string().optional(),
    types: z.string().optional(),
    search: z.string().optional(),
    sort: z.string().optional(),
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(50,),
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
        summary: 'Upload a single file (multipart, field "file"; optional alt/caption).',
        pre: [upload.single('file',),],
        handler: async ({ req, audit, },) => {
            const body = req.body as { alt?: string; caption?: string; };
            const result = await media.upload(reqFile(req,), body.alt, body.caption, audit(),);
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
        summary: 'Delete a media item (removes files from storage).',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await media.remove(params.id, audit(),);
            return { message: 'Media deleted', };
        },
    },),
];
