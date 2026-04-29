import type { Media, } from '@rw/shared';
import { Router, } from 'express';
import fs from 'fs/promises';
import multer from 'multer';
import { nanoid, } from 'nanoid';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { config, } from '../config';
import { query, } from '../db';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import { ValidationError, } from '../middleware/error';
import { getStorageProvider, } from '../services/storage';
import { logger, } from '../utils/logger';
import { mapRow, mapRows, } from '../utils/mapRow';
import { handleRouteError, sendCreated, sendPaginated, sendSuccess, } from '../utils/response';

const router = Router();

// When using local storage, write directly to uploads dir.
// For remote providers (S3, etc.), use a temp directory.
const multerDestDir = config.upload.storageProvider === 'local' ?
    config.upload.dir :
    path.join(os.tmpdir(), 'rw-uploads',);

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
    limits: {
        fileSize: config.upload.maxSizeMb * 1024 * 1024,
    },
},);

async function createThumbnail(
    filePath: string,
    thumbnailPath: string,
    width = 300,
): Promise<void> {
    await sharp(filePath,)
        .resize(width, null, { withoutEnlargement: true, },)
        .jpeg({ quality: 80, },)
        .toFile(thumbnailPath,);
}

async function cleanupTemp(filePath: string,): Promise<void> {
    try {
        await fs.unlink(filePath,);
    } catch {
        // ignore cleanup failures
    }
}

// Upload file (admin)
router.post('/', authenticate(), requireAdmin, upload.single('file',), async (req: AuthenticatedRequest, res,) => {
    let tempFilePath: string | undefined;
    let tempThumbPath: string | undefined;

    try {
        if (!req.file) {
            throw new ValidationError('No file provided',);
        }

        const { alt, caption, } = req.body;
        const file = req.file;
        tempFilePath = file.path;

        const storageProvider = getStorageProvider();
        const uploadOptions = {
            filename: file.filename,
            mimeType: file.mimetype,
            originalName: file.originalname,
        };

        // Upload main file to storage
        const url = await storageProvider.upload(file.path, uploadOptions,);

        // Create and upload thumbnail for images
        let thumbnailUrl: string | undefined;
        if (file.mimetype.startsWith('image/',) && !file.mimetype.includes('gif',) && !file.mimetype.includes('svg',)) {
            tempThumbPath = path.join(multerDestDir, `thumb_${file.filename}`,);
            try {
                await createThumbnail(file.path, tempThumbPath,);
                thumbnailUrl = await storageProvider.uploadThumbnail(tempThumbPath, uploadOptions,);
            } catch (thumbError) {
                logger.warn('Failed to create thumbnail', { error: thumbError, },);
            }
        }

        const result = await query(
            `INSERT INTO media (filename, original_name, mime_type, size, url, thumbnail_url, alt, caption, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
            [
                file.filename,
                file.originalname,
                file.mimetype,
                file.size,
                url,
                thumbnailUrl,
                alt,
                caption,
                req.userId,
            ],
        );

        const media = mapRow<Media>(result.rows[0],);

        // Cleanup temp files if using non-local storage
        if (config.upload.storageProvider !== 'local') {
            if (tempFilePath) await cleanupTemp(tempFilePath,);
            if (tempThumbPath) await cleanupTemp(tempThumbPath,);
        }

        sendCreated(res, media,);
    } catch (error) {
        // Cleanup temp files on error
        if (tempFilePath) await cleanupTemp(tempFilePath,);
        if (tempThumbPath) await cleanupTemp(tempThumbPath,);

        handleRouteError(res, error, 'upload file',);
    }
},);

// Upload file for content block (admin)
router.post(
    '/block-upload',
    authenticate(),
    requireAdmin,
    upload.single('file',),
    async (req: AuthenticatedRequest, res,) => {
        let tempFilePath: string | undefined;
        let tempThumbPath: string | undefined;

        try {
            if (!req.file) {
                throw new ValidationError('No file provided',);
            }

            const { postId, blockId, } = req.body;
            const file = req.file;
            tempFilePath = file.path;

            const storageProvider = getStorageProvider();
            const uploadOptions = {
                filename: file.filename,
                mimeType: file.mimetype,
                originalName: file.originalname,
            };

            // Upload main file to storage
            const url = await storageProvider.upload(file.path, uploadOptions,);

            // Create and upload thumbnail for images
            let thumbnailUrl: string | undefined;
            if (
                file.mimetype.startsWith('image/',) && !file.mimetype.includes('gif',) &&
                !file.mimetype.includes('svg',)
            ) {
                tempThumbPath = path.join(multerDestDir, `thumb_${file.filename}`,);
                try {
                    await createThumbnail(file.path, tempThumbPath,);
                    thumbnailUrl = await storageProvider.uploadThumbnail(tempThumbPath, uploadOptions,);
                } catch (thumbError) {
                    logger.warn('Failed to create thumbnail', { error: thumbError, },);
                }
            }

            // Store in media table with optional block association
            const result = await query(
                `INSERT INTO media (filename, original_name, mime_type, size, url, thumbnail_url, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
                [
                    file.filename,
                    file.originalname,
                    file.mimetype,
                    file.size,
                    url,
                    thumbnailUrl,
                    req.userId,
                ],
            );

            const media = mapRow<Media>(result.rows[0],);

            // Cleanup temp files if using non-local storage
            if (config.upload.storageProvider !== 'local') {
                if (tempFilePath) await cleanupTemp(tempFilePath,);
                if (tempThumbPath) await cleanupTemp(tempThumbPath,);
            }

            sendCreated(res, {
                ...media,
                postId: postId || null,
                blockId: blockId || null,
            },);
        } catch (error) {
            if (tempFilePath) await cleanupTemp(tempFilePath,);
            if (tempThumbPath) await cleanupTemp(tempThumbPath,);

            handleRouteError(res, error, 'upload block file',);
        }
    },
);

// Upload multiple files (admin)
router.post(
    '/bulk',
    authenticate(),
    requireAdmin,
    upload.array('files', 10,),
    async (req: AuthenticatedRequest, res,) => {
        const tempFiles: string[] = [];

        try {
            const files = req.files as Express.Multer.File[];

            if (!files || files.length === 0) {
                throw new ValidationError('No files provided',);
            }

            const storageProvider = getStorageProvider();
            const mediaItems: Media[] = [];

            for (const file of files) {
                tempFiles.push(file.path,);
                const uploadOptions = {
                    filename: file.filename,
                    mimeType: file.mimetype,
                    originalName: file.originalname,
                };

                const url = await storageProvider.upload(file.path, uploadOptions,);

                let thumbnailUrl: string | undefined;
                if (
                    file.mimetype.startsWith('image/',) && !file.mimetype.includes('gif',) &&
                    !file.mimetype.includes('svg',)
                ) {
                    const tempThumbPath = path.join(multerDestDir, `thumb_${file.filename}`,);
                    tempFiles.push(tempThumbPath,);
                    try {
                        await createThumbnail(file.path, tempThumbPath,);
                        thumbnailUrl = await storageProvider.uploadThumbnail(tempThumbPath, uploadOptions,);
                    } catch {
                        // Continue without thumbnail
                    }
                }

                const result = await query(
                    `INSERT INTO media (filename, original_name, mime_type, size, url, thumbnail_url, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
                    [file.filename, file.originalname, file.mimetype, file.size, url, thumbnailUrl, req.userId,],
                );

                mediaItems.push(mapRow<Media>(result.rows[0],),);
            }

            // Cleanup temp files if using non-local storage
            if (config.upload.storageProvider !== 'local') {
                for (const f of tempFiles) await cleanupTemp(f,);
            }

            sendCreated(res, mediaItems,);
        } catch (error) {
            if (config.upload.storageProvider !== 'local') {
                for (const f of tempFiles) await cleanupTemp(f,);
            }
            handleRouteError(res, error, 'upload files',);
        }
    },
);

// Get all media (admin)
router.get('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { type, types, search, sort, page = 1, limit = 50, } = req.query;
        const offset = (Number(page,) - 1) * Number(limit,);

        let whereClause = 'WHERE 1=1';
        const params: unknown[] = [];

        if (types) {
            // Support comma-separated types, e.g. ?types=image,video
            const typeList = (types as string).split(',',).map(t => t.trim()).filter(Boolean,);
            if (typeList.length > 0) {
                const orConditions = typeList.map(t => {
                    if (t === 'document') {
                        return `(mime_type NOT LIKE 'image/%' AND mime_type NOT LIKE 'video/%' AND mime_type NOT LIKE 'audio/%')`;
                    }
                    params.push(`${t}/%`,);
                    return `mime_type LIKE $${params.length}`;
                },);
                whereClause += ` AND (${orConditions.join(' OR ',)})`;
            }
        } else if (type) {
            if (type === 'document') {
                whereClause +=
                    ` AND mime_type NOT LIKE 'image/%' AND mime_type NOT LIKE 'video/%' AND mime_type NOT LIKE 'audio/%'`;
            } else {
                params.push(`${type}/%`,);
                whereClause += ` AND mime_type LIKE $${params.length}`;
            }
        }

        if (search) {
            params.push(`%${search}%`,);
            whereClause +=
                ` AND (original_name ILIKE $${params.length} OR COALESCE(title, '') ILIKE $${params.length} OR COALESCE(caption, '') ILIKE $${params.length})`;
        }

        let orderClause = 'ORDER BY created_at DESC';
        if (sort === 'title_asc') orderClause = 'ORDER BY COALESCE(title, original_name) ASC';
        else if (sort === 'title_desc') orderClause = 'ORDER BY COALESCE(title, original_name) DESC';
        else if (sort === 'date_asc') orderClause = 'ORDER BY created_at ASC';
        else if (sort === 'date_desc') orderClause = 'ORDER BY created_at DESC';
        else if (sort === 'size_desc') orderClause = 'ORDER BY size DESC';
        else if (sort === 'size_asc') orderClause = 'ORDER BY size ASC';
        else if (sort === 'updated_asc') orderClause = 'ORDER BY COALESCE(updated_at, created_at) ASC';
        else if (sort === 'updated_desc') orderClause = 'ORDER BY COALESCE(updated_at, created_at) DESC';

        const countResult = await query(`SELECT COUNT(*) FROM media ${whereClause}`, params,);
        const total = parseInt(countResult.rows[0].count, 10,);

        params.push(Number(limit,), offset,);
        const result = await query(
            `SELECT * FROM media ${whereClause}
       ${orderClause}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params,
        );

        const media = mapRows<Media>(result.rows,);

        sendPaginated(res, media, Number(page,), Number(limit,), total,);
    } catch (error) {
        handleRouteError(res, error, 'fetch media',);
    }
},);

// Get media by ID (admin)
router.get('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { id, } = req.params;

        const result = await query('SELECT * FROM media WHERE id = $1', [id,],);

        if (result.rows.length === 0) {
            return res.status(404,).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Media not found', },
            },);
        }

        const media = mapRow<Media>(result.rows[0],);

        sendSuccess(res, media,);
    } catch (error) {
        handleRouteError(res, error, 'fetch media',);
    }
},);

// Update media metadata (admin)
router.put('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { id, } = req.params;
        const { title, alt, caption, } = req.body;

        const updates: string[] = [];
        const values: unknown[] = [];

        if (title !== undefined) {
            values.push(title || null,);
            updates.push(`title = $${values.length}`,);
        }
        if (alt !== undefined) {
            values.push(alt,);
            updates.push(`alt = $${values.length}`,);
        }
        if (caption !== undefined) {
            values.push(caption,);
            updates.push(`caption = $${values.length}`,);
        }

        if (updates.length === 0) {
            return res.status(400,).json({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'No fields to update', },
            },);
        }

        values.push(id,);
        const result = await query(
            `UPDATE media SET ${updates.join(', ',)} WHERE id = $${values.length} RETURNING *`,
            values,
        );

        if (result.rows.length === 0) {
            return res.status(404,).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Media not found', },
            },);
        }

        const media = mapRow<Media>(result.rows[0],);

        sendSuccess(res, media,);
    } catch (error) {
        handleRouteError(res, error, 'update media',);
    }
},);

// Delete media (admin)
router.delete('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { id, } = req.params;

        const result = await query(
            'DELETE FROM media WHERE id = $1 RETURNING filename, thumbnail_url',
            [id,],
        );

        if (result.rows.length === 0) {
            return res.status(404,).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Media not found', },
            },);
        }

        const { filename, thumbnail_url, } = result.rows[0];
        const storageProvider = getStorageProvider();

        await storageProvider.delete(filename,);
        if (thumbnail_url) {
            await storageProvider.deleteThumbnail(filename,);
        }

        sendSuccess(res, { message: 'Media deleted', },);
    } catch (error) {
        handleRouteError(res, error, 'delete media',);
    }
},);

export default router;
