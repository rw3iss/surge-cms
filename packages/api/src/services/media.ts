/**
 * Media service.
 *
 * Owns the upload pipeline (multer-staged temp file → storage provider →
 * sharp thumbnail → DB row), the paginated admin list, metadata update,
 * and delete (removes from storage). The route layer in `routes/media.ts`
 * thinly wraps this module; multer disk-staging runs as a `pre` middleware
 * declared in the route file.
 *
 * Temp-file cleanup is owned here: every upload path runs its cleanup in
 * a `finally`/`catch` so a thrown error never leaks staged files.
 */
import type { Media, } from '@rw/cms-shared';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { config, } from '../config';
import { query, } from '../db';
import { NotFoundError, ValidationError, } from '../core/errors';
import { getStorageProvider, } from './storage';
import { logger, } from '../utils/logger';
import { mapRow, mapRows, } from '../utils/mapRow';
import { uuidOrNull, } from '../utils/uuid';

// When using local storage, write directly to uploads dir. For remote
// providers (S3, etc.), use a temp directory.
export const multerDestDir = config.upload.storageProvider === 'local' ?
    config.upload.dir :
    path.join(os.tmpdir(), 'rw-uploads',);

async function createThumbnail(filePath: string, thumbnailPath: string, width = 300,): Promise<void> {
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

function isThumbnailable(mimeType: string,): boolean {
    return mimeType.startsWith('image/',) && !mimeType.includes('gif',) && !mimeType.includes('svg',);
}

export interface UploadFile {
    path: string;
    filename: string;
    originalname: string;
    mimetype: string;
    size: number;
}

/**
 * Upload a single staged file: push to storage, generate + push a
 * thumbnail for images, insert the media row. `extra.alt`/`extra.caption`
 * persist on the main upload path; pass nothing for the block-upload path.
 * Temp files are cleaned up in finally — both on success (remote storage)
 * and on error (always).
 */
async function uploadOne(
    file: UploadFile,
    actorUserId: string | undefined,
    extra: { alt?: string; caption?: string; } = {},
): Promise<Media> {
    const tempFilePath = file.path;
    let tempThumbPath: string | undefined;
    let inserted = false;

    try {
        const storageProvider = getStorageProvider();
        const uploadOptions = {
            filename: file.filename,
            mimeType: file.mimetype,
            originalName: file.originalname,
        };

        const url = await storageProvider.upload(file.path, uploadOptions,);

        let thumbnailUrl: string | undefined;
        if (isThumbnailable(file.mimetype,)) {
            tempThumbPath = path.join(multerDestDir, `thumb_${file.filename}`,);
            try {
                await createThumbnail(file.path, tempThumbPath,);
                thumbnailUrl = await storageProvider.uploadThumbnail(tempThumbPath, uploadOptions,);
            } catch (thumbError) {
                logger.warn('Failed to create thumbnail', { error: thumbError, },);
            }
        }

        // uploaded_by is a UUID FK — synthetic actors (API keys / system)
        // become NULL rather than violating the column type.
        const uploadedBy = uuidOrNull(actorUserId,);
        const hasMeta = extra.alt !== undefined || extra.caption !== undefined;
        const result = hasMeta
            ? await query(
                `INSERT INTO media (filename, original_name, mime_type, size, url, thumbnail_url, alt, caption, uploaded_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING *`,
                [
                    file.filename, file.originalname, file.mimetype, file.size,
                    url, thumbnailUrl, extra.alt, extra.caption, uploadedBy,
                ],
            )
            : await query(
                `INSERT INTO media (filename, original_name, mime_type, size, url, thumbnail_url, uploaded_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
                [file.filename, file.originalname, file.mimetype, file.size, url, thumbnailUrl, uploadedBy,],
            );

        inserted = true;
        return mapRow<Media>(result.rows[0],);
    } finally {
        // Remote storage: temp staging files are always disposable once
        // the work is done. Local storage: the staged file IS the served
        // file — only clean it up if the insert never landed (error path).
        const remote = config.upload.storageProvider !== 'local';
        if (remote || !inserted) {
            await cleanupTemp(tempFilePath,);
            if (tempThumbPath) await cleanupTemp(tempThumbPath,);
        }
    }
}

/** Main upload (POST /). Persists alt/caption. */
export async function upload(file: UploadFile | undefined, alt: string | undefined, caption: string | undefined, actorUserId: string | undefined,): Promise<Media> {
    if (!file) throw new ValidationError('No file provided',);
    return uploadOne(file, actorUserId, { alt, caption, },);
}

/** Content-block upload (POST /block-upload). Echoes postId/blockId back. */
export async function blockUpload(
    file: UploadFile | undefined,
    postId: string | undefined,
    blockId: string | undefined,
    actorUserId: string | undefined,
): Promise<Media & { postId: string | null; blockId: string | null; }> {
    if (!file) throw new ValidationError('No file provided',);
    const media = await uploadOne(file, actorUserId,);
    return { ...media, postId: postId || null, blockId: blockId || null, };
}

/** Bulk upload (POST /bulk). Each file is processed (and cleaned up) in turn. */
export async function bulkUpload(files: UploadFile[] | undefined, actorUserId: string | undefined,): Promise<Media[]> {
    if (!files || files.length === 0) throw new ValidationError('No files provided',);
    const mediaItems: Media[] = [];
    for (const file of files) {
        mediaItems.push(await uploadOne(file, actorUserId,),);
    }
    return mediaItems;
}

export interface MediaListQuery {
    type?: string;
    types?: string;
    search?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

export interface MediaListResult {
    data: Media[];
    page: number;
    limit: number;
    total: number;
}

/** Paginated admin list with type/types filters, search, and sorting. */
export async function list(q: MediaListQuery,): Promise<MediaListResult> {
    const page = Number(q.page ?? 1,);
    const limit = Number(q.limit ?? 50,);
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (q.types) {
        // Support comma-separated types, e.g. ?types=image,video
        const typeList = q.types.split(',',).map((t,) => t.trim(),).filter(Boolean,);
        if (typeList.length > 0) {
            const orConditions = typeList.map((t,) => {
                if (t === 'document') {
                    return `(mime_type NOT LIKE 'image/%' AND mime_type NOT LIKE 'video/%' AND mime_type NOT LIKE 'audio/%')`;
                }
                params.push(`${t}/%`,);
                return `mime_type LIKE $${params.length}`;
            },);
            whereClause += ` AND (${orConditions.join(' OR ',)})`;
        }
    } else if (q.type) {
        if (q.type === 'document') {
            whereClause +=
                ` AND mime_type NOT LIKE 'image/%' AND mime_type NOT LIKE 'video/%' AND mime_type NOT LIKE 'audio/%'`;
        } else {
            params.push(`${q.type}/%`,);
            whereClause += ` AND mime_type LIKE $${params.length}`;
        }
    }

    if (q.search) {
        params.push(`%${q.search}%`,);
        whereClause +=
            ` AND (original_name ILIKE $${params.length} OR COALESCE(title, '') ILIKE $${params.length} OR COALESCE(caption, '') ILIKE $${params.length})`;
    }

    let orderClause = 'ORDER BY created_at DESC';
    if (q.sort === 'title_asc') orderClause = 'ORDER BY COALESCE(title, original_name) ASC';
    else if (q.sort === 'title_desc') orderClause = 'ORDER BY COALESCE(title, original_name) DESC';
    else if (q.sort === 'date_asc') orderClause = 'ORDER BY created_at ASC';
    else if (q.sort === 'date_desc') orderClause = 'ORDER BY created_at DESC';
    else if (q.sort === 'size_desc') orderClause = 'ORDER BY size DESC';
    else if (q.sort === 'size_asc') orderClause = 'ORDER BY size ASC';
    else if (q.sort === 'updated_asc') orderClause = 'ORDER BY COALESCE(updated_at, created_at) ASC';
    else if (q.sort === 'updated_desc') orderClause = 'ORDER BY COALESCE(updated_at, created_at) DESC';

    const countResult = await query(`SELECT COUNT(*) FROM media ${whereClause}`, params,);
    const total = parseInt(countResult.rows[0].count, 10,);

    params.push(limit, offset,);
    const result = await query(
        `SELECT * FROM media ${whereClause}
         ${orderClause}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );

    return { data: mapRows<Media>(result.rows,), page, limit, total, };
}

export async function getById(id: string,): Promise<Media> {
    const result = await query('SELECT * FROM media WHERE id = $1', [id,],);
    if (result.rows.length === 0) throw new NotFoundError('Media',);
    return mapRow<Media>(result.rows[0],);
}

export interface MediaMetaPatch {
    title?: string;
    alt?: string;
    caption?: string;
}

/** Update metadata (title/alt/caption). Only supplied fields change. */
export async function updateMeta(id: string, patch: MediaMetaPatch,): Promise<Media> {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (patch.title !== undefined) {
        values.push(patch.title || null,);
        updates.push(`title = $${values.length}`,);
    }
    if (patch.alt !== undefined) {
        values.push(patch.alt,);
        updates.push(`alt = $${values.length}`,);
    }
    if (patch.caption !== undefined) {
        values.push(patch.caption,);
        updates.push(`caption = $${values.length}`,);
    }

    if (updates.length === 0) throw new ValidationError('No fields to update',);

    values.push(id,);
    const result = await query(
        `UPDATE media SET ${updates.join(', ',)} WHERE id = $${values.length} RETURNING *`,
        values,
    );
    if (result.rows.length === 0) throw new NotFoundError('Media',);
    return mapRow<Media>(result.rows[0],);
}

/** Delete a media row and its files from storage. */
export async function remove(id: string,): Promise<void> {
    const result = await query(
        'DELETE FROM media WHERE id = $1 RETURNING filename, thumbnail_url',
        [id,],
    );
    if (result.rows.length === 0) throw new NotFoundError('Media',);

    const { filename, thumbnail_url, } = result.rows[0];
    const storageProvider = getStorageProvider();
    await storageProvider.delete(filename,);
    if (thumbnail_url) {
        await storageProvider.deleteThumbnail(filename,);
    }
}
