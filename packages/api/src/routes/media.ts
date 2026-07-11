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
import type { AssertCompatible, MediaListQuery, MediaUpdateBody, } from '@rw/cms-shared';
import { config, } from '../config';
import { defineRoute, reply, } from '../api/defineRoute';
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

const upload = multer({
    storage,
    limits: { fileSize: config.upload.maxSizeMb * 1024 * 1024, },
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
        method: 'post', path: '/', auth: 'admin',
        summary: 'Upload a single file (multipart, field "file"; optional alt/caption).',
        pre: [upload.single('file',),],
        handler: async ({ req, userId, },) => {
            const body = req.body as { alt?: string; caption?: string; };
            const result = await media.upload(reqFile(req,), body.alt, body.caption, userId,);
            return reply(result, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'post', path: '/block-upload', auth: 'admin',
        summary: 'Upload a file for a content block (multipart, field "file"; postId/blockId).',
        pre: [upload.single('file',),],
        handler: async ({ req, userId, },) => {
            const body = req.body as { postId?: string; blockId?: string; };
            const result = await media.blockUpload(reqFile(req,), body.postId, body.blockId, userId,);
            return reply(result, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'post', path: '/bulk', auth: 'admin',
        summary: 'Upload multiple files (multipart, field "files", max 10).',
        pre: [upload.array('files', 10,),],
        handler: async ({ req, userId, },) => {
            const result = await media.bulkUpload(reqFiles(req,), userId,);
            return reply(result, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/', auth: 'admin',
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
        method: 'get', path: '/:id', auth: 'admin',
        summary: 'Fetch a media item by id.',
        input: { params: idParams, },
        handler: ({ params, },) => media.getById(params.id,),
    },),

    defineRoute({
        method: 'put', path: '/:id', auth: 'admin',
        summary: 'Update media metadata (title/alt/caption).',
        input: { params: idParams, body: updateMetaSchema, },
        handler: ({ params, body, },) => media.updateMeta(params.id, body,),
    },),

    defineRoute({
        method: 'delete', path: '/:id', auth: 'admin',
        summary: 'Delete a media item (removes files from storage).',
        input: { params: idParams, },
        handler: async ({ params, },) => {
            await media.remove(params.id,);
            return { message: 'Media deleted', };
        },
    },),
];
