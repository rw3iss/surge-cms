/**
 * Direct (multipart) uploads: the browser PUTs parts straight to the object
 * store with presigned URLs; this service owns the session lifecycle —
 * create/resume, part URLs, complete (→ a `media` row, and for video the
 * encode pipeline), abort, and the expiry sweep.
 *
 * `listParts` is the authority on what was uploaded: client-reported ETags are
 * never trusted, and `complete` verifies the assembled object's size.
 */
import crypto from 'crypto';
import path from 'path';
import { z, } from 'zod';
import type { Media, MediaUploadCreateBody, UploadSession, UploadSessionOptions, } from '@sitesurge/types';
import { transaction, } from '../../db';
import { NotFoundError, ValidationError, } from '../../core/errors';
import * as repo from '../../repositories/uploadSessions.repo';
import type { UploadSessionRow, } from '../../repositories/uploadSessions.repo';
import { IMMUTABLE_CACHE, isObjectStore, resolveStorageProvider, type ObjectStore, type UploadedPart, } from '../storage';
import { logAudit, } from '../audit';
import type { AuditContext, } from '../types';
import { logger, } from '../../utils/logger';
import { mapRow, } from '../../utils/mapRow';
import { nanoid, } from '../../utils/nanoid';
import { uuidOrNull, } from '../../utils/uuid';
import { incomingKey, masterUrl, } from './paths';
import { isVideoMime, registerVideo, } from './register';
import { getVideoSettings, } from './settings';
import { planParts, } from './uploadMath';

export const PART_URL_TTL = 3600;
export const MAX_PART_URLS = 50;
const GIB = 1024 * 1024 * 1024;

const STORAGE_MSG = 'Direct uploads need S3-compatible storage (Settings → Media → Storage).';

const optionsSchema = z.object({
    title: z.string().max(1000,).optional(),
    alt: z.string().max(1000,).optional(),
    caption: z.string().max(1000,).optional(),
    credits: z.string().max(1000,).optional(),
    accessLevel: z.enum(['public', 'private',],).optional(),
    keepOriginal: z.boolean().optional(),
    teaser: z.boolean().optional(),
    teaserStartSeconds: z.number().finite().min(0,).optional(),
    teaserSeconds: z.number().finite().min(5,).max(600,).optional(),
},).strict();

export function validateOptions(raw: unknown,): UploadSessionOptions {
    if (raw === undefined || raw === null) return {};
    const r = optionsSchema.safeParse(raw,);
    if (!r.success) {
        const issue = r.error.issues[0];
        throw new ValidationError(`Invalid upload options: ${issue?.path.join('.',) || 'options'} ${issue?.message ?? ''}`.trim(),);
    }
    return r.data;
}

async function store(): Promise<ObjectStore> {
    const p = await resolveStorageProvider();
    if (!isObjectStore(p,)) throw new ValidationError(STORAGE_MSG,);
    return p;
}

/** Best-effort cleanup: never masks the real outcome. */
async function quietly(fn: () => Promise<unknown>,): Promise<void> {
    try {
        await fn();
    } catch (e) {
        logger.warn('Upload cleanup step failed', { error: (e as Error).message, },);
    }
}

const iso = (d: Date | string,): string => (d instanceof Date ? d : new Date(d,)).toISOString();

export function toSession(row: UploadSessionRow, parts: UploadedPart[] = [],): UploadSession {
    return {
        id: row.id,
        filename: row.filename,
        mimeType: row.mime_type,
        size: Number(row.size,),
        fingerprint: row.fingerprint,
        partSize: Number(row.part_size,),
        partCount: Number(row.part_count,),
        status: row.status,
        options: (row.options ?? {}) as UploadSessionOptions,
        mediaId: row.media_id,
        uploadedParts: parts.map((p,) => p.partNumber).sort((a, b,) => a - b),
        uploadedBytes: parts.reduce((s, p,) => s + (Number(p.size,) || 0), 0,),
        createdAt: iso(row.created_at,),
        expiresAt: iso(row.expires_at,),
    };
}

async function safeListParts(s: ObjectStore, row: UploadSessionRow,): Promise<UploadedPart[]> {
    try {
        return await s.listParts(row.object_key, row.upload_id,);
    } catch (e) {
        logger.warn('listParts failed', { sessionId: row.id, error: (e as Error).message, },);
        return [];
    }
}

const isExpired = (row: UploadSessionRow,): boolean => new Date(row.expires_at,).getTime() <= Date.now();

/** Owner (or admin) only; a foreign session reads as missing so ids can't be probed. */
async function loadOwned(userId: string | null, id: string, isAdmin = false,): Promise<UploadSessionRow> {
    const row = await repo.findById(id,);
    if (!row || (!isAdmin && row.user_id !== uuidOrNull(userId,))) throw new NotFoundError('Upload session',);
    return row;
}

function assertOpen(row: UploadSessionRow,): void {
    if (row.status !== 'uploading') throw new ValidationError(`Upload session is ${row.status}`,);
    if (isExpired(row,)) throw new ValidationError('Upload session has expired',);
}

export async function createOrResume(userId: string | null, body: MediaUploadCreateBody, ctx: AuditContext,): Promise<UploadSession> {
    const filename = typeof body?.filename === 'string' ? body.filename.trim() : '';
    const mimeType = typeof body?.mimeType === 'string' ? body.mimeType.trim() : '';
    // Stored as VARCHAR(128): a longer client value is reduced to its SHA-256,
    // which keeps it stable (the same file maps to the same session) and short.
    const rawFingerprint = typeof body?.fingerprint === 'string' ? body.fingerprint.trim() : '';
    const fingerprint = rawFingerprint.length > 128
        ? crypto.createHash('sha256',).update(rawFingerprint,).digest('hex',)
        : rawFingerprint;
    const size = Number(body?.size,);
    if (!filename) throw new ValidationError('filename is required',);
    if (filename.length > 255) throw new ValidationError('filename is too long (max 255 characters)',);
    if (!mimeType) throw new ValidationError('mimeType is required',);
    if (mimeType.length > 100 || !/^[\w.+-]+\/[\w.+-]+/.test(mimeType,)) throw new ValidationError('mimeType is invalid',);
    if (!fingerprint) throw new ValidationError('fingerprint is required',);
    if (!Number.isSafeInteger(size,) || size <= 0) throw new ValidationError('size must be a positive integer',);
    const options = validateOptions(body.options,);

    const settings = await getVideoSettings();
    if (size > settings.maxUploadGb * GIB) {
        throw new ValidationError(`File is larger than the ${settings.maxUploadGb} GB upload limit`,);
    }
    const s = await store();
    const owner = uuidOrNull(userId,);

    const existing = await repo.findOpenByFingerprint(owner, fingerprint, size,);
    if (existing) return toSession(existing, await safeListParts(s, existing,),);

    const { partSize, partCount, } = planParts(size, settings.partSizeMb,);
    const id = crypto.randomUUID();
    const objectKey = incomingKey(id, filename,);
    const uploadId = await s.createMultipart(objectKey, mimeType,);
    let row: UploadSessionRow;
    try {
        row = await repo.insertSession({
            id, userId: owner, filename, mimeType, size, fingerprint, objectKey, uploadId, partSize, partCount,
            options: options as Record<string, unknown>,
        },);
    } catch (e) {
        await quietly(() => s.abortMultipart(objectKey, uploadId,));
        throw e;
    }
    await logAudit({
        userId: ctx.userId, action: 'create', entityType: 'media_upload', entityId: id,
        newValues: { filename, mimeType, size, partCount, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
    return toSession(row, [],);
}

/** The caller's unfinished sessions, newest first (≤ 20, each with its parts). */
export async function listOpen(userId: string | null,): Promise<UploadSession[]> {
    const rows = await repo.listOpenByUser(uuidOrNull(userId,), 20,);
    if (rows.length === 0) return [];
    const s = await store();
    return Promise.all(rows.map(async (r,) => toSession(r, await safeListParts(s, r,),)),);
}

export async function getSession(userId: string | null, id: string, opts: { isAdmin?: boolean; } = {},): Promise<UploadSession> {
    const row = await loadOwned(userId, id, opts.isAdmin,);
    if (row.status !== 'uploading') return toSession(row, [],);
    return toSession(row, await safeListParts(await store(), row,),);
}

export async function partUrls(
    userId: string | null,
    id: string,
    partNumbers: number[],
): Promise<{ urls: { partNumber: number; url: string; }[]; expiresIn: number; }> {
    if (!Array.isArray(partNumbers,) || partNumbers.length === 0) throw new ValidationError('partNumbers is required',);
    if (partNumbers.length > MAX_PART_URLS) throw new ValidationError(`At most ${MAX_PART_URLS} part numbers per request`,);
    const row = await loadOwned(userId, id,);
    assertOpen(row,);
    const unique = [...new Set(partNumbers,),];
    for (const n of unique) {
        if (!Number.isInteger(n,) || n < 1 || n > row.part_count) {
            throw new ValidationError(`Part number ${String(n,)} is out of range (1–${row.part_count})`,);
        }
    }
    const s = await store();
    const urls = await Promise.all(unique.map(async (partNumber,) => ({
        partNumber,
        url: await s.presignPart(row.object_key, row.upload_id, partNumber, PART_URL_TTL,),
    })),);
    return { urls, expiresIn: PART_URL_TTL, };
}

function extOf(filename: string,): string {
    const ext = path.extname(filename,).toLowerCase();
    return /^\.[a-z0-9]{1,8}$/.test(ext,) ? ext : '';
}

export async function complete(userId: string | null, id: string, ctx: AuditContext,): Promise<Media> {
    const row = await loadOwned(userId, id,);
    assertOpen(row,);
    const s = await store();
    const size = Number(row.size,);

    // Server's own list — client ETags are never trusted.
    const parts = await s.listParts(row.object_key, row.upload_id,);
    const have = new Set(parts.map((p,) => p.partNumber),);
    const missing: number[] = [];
    for (let n = 1; n <= row.part_count; n++) if (!have.has(n,)) missing.push(n,);
    if (missing.length > 0) {
        throw new ValidationError(`Upload is incomplete: ${missing.length} part(s) missing`, { missing: missing.slice(0, 100,), },);
    }
    const used = parts.filter((p,) => p.partNumber >= 1 && p.partNumber <= row.part_count);
    await s.completeMultipart(row.object_key, row.upload_id, used,);

    const head = await s.head(row.object_key,);
    if (!head || Number(head.size,) !== size) {
        await quietly(() => s.abortMultipart(row.object_key, row.upload_id,));
        await quietly(() => s.deleteObject(row.object_key,));
        await repo.setStatus(row.id, 'aborted',);
        throw new ValidationError(`Uploaded size ${head ? head.size : 0} does not match the declared ${size} bytes`,);
    }

    const options = (row.options ?? {}) as UploadSessionOptions;
    const uploadedBy = uuidOrNull(ctx.userId,) ?? row.user_id;
    const mediaId = crypto.randomUUID();
    const video = isVideoMime(row.mime_type,);

    // Non-video: move to the media library's normal key layout first (outside
    // the transaction — object copies cannot roll back; on failure the
    // incoming object stays for the sweep/a retry).
    let fileKey = row.object_key;
    let url = masterUrl(mediaId,);
    if (!video) {
        fileKey = `uploads/${nanoid(12,)}${extOf(row.filename,)}`;
        await s.copyObject(row.object_key, fileKey, { contentType: row.mime_type, cacheControl: IMMUTABLE_CACHE, },);
        url = s.publicUrl(fileKey,);
    }
    const storedName = path.posix.basename(fileKey,);

    let inserted: Record<string, unknown>;
    try {
        inserted = await transaction(async (client,) => {
            if (!(await repo.markCompleted(row.id, client,))) {
                throw new ValidationError('Upload session is no longer open',);
            }
            const r = await client.query(
                `INSERT INTO media (id, filename, original_name, mime_type, size, url, thumbnail_url,
                                    title, alt, caption, credits, uploaded_by, status, access_level, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, $10, $11, $12, $13, NOW())
                 RETURNING *`,
                [
                    mediaId, storedName, row.filename, row.mime_type, size, url,
                    options.title ?? null, options.alt ?? null, options.caption ?? null, options.credits ?? null,
                    uploadedBy, video ? 'processing' : 'ready', options.accessLevel ?? 'public',
                ],
            );
            // media_id FK: set after the media row exists.
            await repo.setMediaId(row.id, mediaId, client,);
            if (video) {
                await registerVideo({
                    mediaId,
                    sourceKey: row.object_key,
                    sourceSize: size,
                    accessLevel: options.accessLevel ?? 'public',
                    keepOriginal: options.keepOriginal,
                    teaser: options.teaser,
                    teaserStartSeconds: options.teaserStartSeconds,
                    teaserSeconds: options.teaserSeconds,
                    createdBy: uploadedBy,
                }, client,);
            }
            return r.rows[0] as Record<string, unknown>;
        },);
    } catch (e) {
        if (!video) await quietly(() => s.deleteObject(fileKey,));
        throw e;
    }
    if (!video) await quietly(() => s.deleteObject(row.object_key,));

    const media = mapRow<Media>(inserted,);
    (media as { size: number; }).size = Number(inserted.size,);
    await logAudit({
        userId: ctx.userId, action: 'create', entityType: 'media_upload', entityId: mediaId,
        newValues: { sessionId: row.id, filename: row.filename, mimeType: row.mime_type, size, video, },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
    return media;
}

export async function abort(userId: string | null, id: string, opts: { isAdmin?: boolean; } = {},): Promise<void> {
    const row = await loadOwned(userId, id, opts.isAdmin,);
    if (row.status !== 'uploading') return;
    try {
        const s = await store();
        await s.abortMultipart(row.object_key, row.upload_id,);
    } catch (e) {
        // NoSuchUpload / storage changed: the row still closes.
        logger.warn('abortMultipart failed', { sessionId: row.id, error: (e as Error).message, },);
    }
    await repo.setStatus(row.id, 'aborted',);
}

/** Abort + expire uploading sessions past `expires_at`. Returns the count. */
export async function sweepExpiredUploadSessions(): Promise<number> {
    const rows = await repo.listExpired();
    if (rows.length === 0) return 0;
    let s: ObjectStore | null = null;
    try {
        const p = await resolveStorageProvider();
        s = isObjectStore(p,) ? p : null;
    } catch { /* storage unreadable — still expire the rows */ }
    let n = 0;
    for (const row of rows) {
        if (s) {
            try {
                await s.abortMultipart(row.object_key, row.upload_id,);
            } catch { /* ignore */ }
        }
        await repo.setStatus(row.id, 'expired',);
        n++;
    }
    if (n > 0) logger.info('Expired abandoned upload sessions', { count: n, },);
    return n;
}
