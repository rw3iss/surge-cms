/**
 * Self-hosted video (`video` feature) — mounted at /api/v1/video, separate
 * from /media so the feature's 404 guard can never shadow the media routes.
 *
 *   Uploads (direct to object storage, resumable)
 *     POST   /uploads                 create or resume a session
 *     GET    /uploads                 my unfinished sessions
 *     GET    /uploads/:id             session + uploaded parts
 *     POST   /uploads/:id/part-urls   presigned PUT URLs
 *     POST   /uploads/:id/complete    finish → media row (+ encode job)
 *     DELETE /uploads/:id             abort
 *   Management (staff)
 *     GET    /jobs  GET /status  GET|PUT /settings  GET /keys  POST /keys/rotate
 *     GET    /:id   PUT /:id   POST /:id/cancel|retry|reencode
 *   Playback (public, role-shaped)
 *     GET    /:id/playback  /:id/master.m3u8  /:id/teaser.m3u8  /:id/download
 *     GET    /hls-key/:version        AES-128 key, `media.private:view`
 */
import { z, } from 'zod';
import type {
    MediaUploadCreateBody, MediaVideoUpdateBody, SettingsVideoBody,
} from '@sitesurge/types';
import { defineRoute, } from '../api/defineRoute';
import { requirePermission, } from '../services/permissions';
import * as uploads from '../services/video/uploads';
import * as manage from '../services/video/manage';
import * as play from '../services/video/playback';
import { videoToolingStatus, } from '../services/video/tooling';
import { getVideoSettings, updateVideoSettings, } from '../services/video/settings';
import { listKeys, } from '../services/video/keys';
import * as repo from '../repositories/video.repo';
import { isAdminRole, } from '@sitesurge/types';

type U = { id?: string; role?: string; } | undefined;
const viewer = (u: U,) => (u?.id ? { id: u.id, role: u.role ?? null, } : null);
const need = (u: U, key: string,) => requirePermission({ id: u?.id, role: u?.role, }, key,);

const idParams = z.object({ id: z.string().uuid(), },);

const sessionOptions = z.object({
    title: z.string().max(500,).optional(),
    alt: z.string().max(1000,).optional(),
    caption: z.string().max(1000,).optional(),
    credits: z.string().max(1000,).optional(),
    accessLevel: z.enum(['public', 'private',],).optional(),
    keepOriginal: z.boolean().optional(),
    teaser: z.boolean().optional(),
    teaserStartSeconds: z.number().min(0,).max(86400,).optional(),
    teaserSeconds: z.number().min(5,).max(600,).optional(),
},);

const createBody = z.object({
    filename: z.string().min(1,).max(255,),
    mimeType: z.string().min(1,).max(100,),
    size: z.number().int().positive(),
    fingerprint: z.string().min(1,).max(1024,),
    options: sessionOptions.optional(),
},) satisfies z.ZodType<MediaUploadCreateBody>;

const partUrlsBody = z.object({ partNumbers: z.array(z.number().int().min(1,).max(10000,),).min(1,).max(50,), },);

const updateBody = z.object({
    accessLevel: z.enum(['public', 'private',],).optional(),
    teaserEnabled: z.boolean().optional(),
    teaserStartMs: z.number().int().min(0,).optional(),
    teaserDurationMs: z.number().int().min(1000,).max(600_000,).optional(),
    originalExpiresAt: z.string().datetime().nullable().optional(),
},) satisfies z.ZodType<MediaVideoUpdateBody>;

const ladderRung = z.object({
    name: z.string().min(1,).max(16,), height: z.number(), maxrateKbps: z.number(), audioKbps: z.number(), enabled: z.boolean(),
},);
const settingsBody = z.object({
    encodeThreads: z.number().optional(),
    preset: z.enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium',],).optional(),
    crf: z.number().optional(),
    segmentSeconds: z.number().optional(),
    ladder: z.array(ladderRung,).max(8,).optional(),
    encodeOrder: z.enum(['fast-first', 'top-down',],).optional(),
    defaultQuality: z.union([z.literal('auto',), z.literal('highest',), z.number(),],).optional(),
    maxUploadGb: z.number().optional(),
    partSizeMb: z.number().optional(),
    keepOriginal: z.boolean().optional(),
    originalRetentionDays: z.number().optional(),
    teaserEnabled: z.boolean().optional(),
    teaserSeconds: z.number().optional(),
    teaserStartSeconds: z.number().optional(),
    teaserMaxHeight: z.number().optional(),
    downloadsEnabled: z.boolean().optional(),
    posterAtPercent: z.number().optional(),
    sprites: z.boolean().optional(),
    minFreeDiskGb: z.number().optional(),
    keyBaseUrl: z.string().max(300,).optional(),
},) satisfies z.ZodType<SettingsVideoBody>;

const isAdmin = (u: U,) => isAdminRole(u?.role ?? '',);

export const videoRoutes = [
    // ─── Uploads ──────────────────────────────────────────────────────
    defineRoute({
        method: 'post', path: '/uploads', auth: 'staff',
        summary: 'Create (or resume) a direct multipart upload session.',
        input: { body: createBody, },
        handler: async ({ body, user, audit, },) => {
            await need(user, body.mimeType.startsWith('video/',) ? 'media.video:upload' : 'media:write',);
            return uploads.createOrResume(user?.id ?? null, body, audit(),);
        },
    },),
    defineRoute({
        method: 'get', path: '/uploads', auth: 'staff',
        summary: 'The caller\'s unfinished upload sessions.',
        handler: ({ user, },) => uploads.listOpen(user?.id ?? '',),
    },),
    defineRoute({
        method: 'get', path: '/uploads/:id', auth: 'staff',
        summary: 'An upload session with its uploaded parts.',
        input: { params: idParams, },
        handler: ({ params, user, },) => uploads.getSession(user?.id ?? '', params.id, { isAdmin: isAdmin(user,), },),
    },),
    defineRoute({
        method: 'post', path: '/uploads/:id/part-urls', auth: 'staff',
        summary: 'Presigned PUT URLs for up to 50 parts.',
        input: { params: idParams, body: partUrlsBody, },
        handler: ({ params, body, user, },) => uploads.partUrls(user?.id ?? '', params.id, body.partNumbers,),
    },),
    defineRoute({
        method: 'post', path: '/uploads/:id/complete', auth: 'staff',
        summary: 'Complete an upload: creates the media row (and the encode job for a video).',
        input: { params: idParams, },
        handler: ({ params, user, audit, },) => uploads.complete(user?.id ?? '', params.id, audit(),),
    },),
    defineRoute({
        method: 'delete', path: '/uploads/:id', auth: 'staff',
        summary: 'Abort an upload session and discard its parts.',
        input: { params: idParams, },
        handler: async ({ params, user, },) => {
            await uploads.abort(user?.id ?? '', params.id, { isAdmin: isAdmin(user,), },);
            return { message: 'Upload aborted', };
        },
    },),

    // ─── Management ───────────────────────────────────────────────────
    defineRoute({
        method: 'get', path: '/jobs', auth: 'staff',
        summary: 'The encode queue (newest first; active=true for running/queued only).',
        input: { query: z.object({ active: z.coerce.boolean().optional(), limit: z.coerce.number().int().min(1,).max(200,).optional(), },), },
        handler: ({ query, },) => repo.listJobs(query,),
    },),
    defineRoute({
        method: 'get', path: '/status', auth: 'staff',
        summary: 'Can this server encode? ffmpeg, libx264, disk, storage.',
        handler: () => videoToolingStatus({ refresh: true, },),
    },),
    defineRoute({
        method: 'get', path: '/settings', auth: 'staff',
        summary: 'Effective video settings.',
        handler: () => getVideoSettings(),
    },),
    defineRoute({
        method: 'put', path: '/settings', auth: 'admin',
        summary: 'Update video settings (partial).',
        input: { body: settingsBody, },
        handler: async ({ body, user, audit, },) => {
            await need(user, 'media.video:settings',);
            return updateVideoSettings(body as SettingsVideoBody, audit(),);
        },
    },),
    defineRoute({
        method: 'get', path: '/keys', auth: 'admin',
        summary: 'Shared encryption key versions (no key bytes).',
        handler: async ({ user, },) => {
            await need(user, 'media.video:settings',);
            return listKeys();
        },
    },),
    defineRoute({
        method: 'post', path: '/keys/rotate', auth: 'admin',
        summary: 'Rotate the shared private-video key; private videos are re-packaged onto it.',
        handler: async ({ user, audit, },) => {
            await need(user, 'media.video:settings',);
            return manage.rotateKey(audit(),);
        },
    },),

    // ─── Key (before /:id so "hls-key" is never read as an id) ─────────
    defineRoute({
        method: 'get', path: '/hls-key/:version', auth: 'optional', raw: true,
        summary: 'AES-128 key for private videos (media.private:view). 16 raw bytes, never cached.',
        input: { params: z.object({ version: z.coerce.number().int().positive(), },), },
        handler: async ({ params, user, res, },) => {
            const bytes = await play.hlsKey(params.version, viewer(user,),);
            res.set('Content-Type', 'application/octet-stream',);
            res.set('Cache-Control', 'private, no-store',);
            res.send(bytes,);
        },
    },),

    // ─── Per video ────────────────────────────────────────────────────
    defineRoute({
        method: 'get', path: '/:id', auth: 'staff',
        summary: 'Encode status, renditions, teaser and job of a video.',
        input: { params: idParams, },
        handler: ({ params, },) => manage.info(params.id,),
    },),
    defineRoute({
        method: 'put', path: '/:id', auth: 'staff',
        summary: 'Change access level, teaser window or original expiry.',
        input: { params: idParams, body: updateBody, },
        handler: async ({ params, body, user, audit, },) => {
            await need(user, 'media.video:manage',);
            return manage.update(params.id, body, audit(),);
        },
    },),
    defineRoute({
        method: 'post', path: '/:id/cancel', auth: 'staff',
        summary: 'Cancel the running or queued job.',
        input: { params: idParams, },
        handler: async ({ params, user, audit, },) => {
            await need(user, 'media.video:manage',);
            return manage.cancel(params.id, audit(),);
        },
    },),
    defineRoute({
        method: 'post', path: '/:id/retry', auth: 'staff',
        summary: 'Retry failed renditions.',
        input: { params: idParams, },
        handler: async ({ params, user, audit, },) => {
            await need(user, 'media.video:manage',);
            return manage.retry(params.id, audit(),);
        },
    },),
    defineRoute({
        method: 'post', path: '/:id/reencode', auth: 'staff',
        summary: 'Encode again from the original, or re-package the stored MP4s.',
        input: { params: idParams, body: z.object({ kind: z.enum(['encode', 'repackage',],).optional(), },), },
        handler: async ({ params, body, user, audit, },) => {
            await need(user, 'media.video:manage',);
            return manage.reencode(params.id, body.kind ?? 'encode', audit(),);
        },
    },),
    defineRoute({
        method: 'get', path: '/:id/playback', auth: 'optional',
        summary: 'What a player needs; the full stream only for viewers who may watch it.',
        input: { params: idParams, },
        handler: ({ params, user, },) => play.playback(params.id, viewer(user,),),
    },),
    defineRoute({
        method: 'get', path: '/:id/master.m3u8', auth: 'optional', raw: true,
        summary: 'HLS master playlist of the full video (ready renditions only).',
        input: { params: idParams, },
        handler: async ({ params, user, res, },) => {
            const r = await play.masterPlaylist(params.id, 'full', viewer(user,),);
            res.set('Content-Type', 'application/vnd.apple.mpegurl',);
            res.set('Cache-Control', play.masterCacheControl(r,),);
            res.send(r.body,);
        },
    },),
    defineRoute({
        method: 'get', path: '/:id/teaser.m3u8', auth: 'public', raw: true,
        summary: 'HLS master playlist of the public teaser.',
        input: { params: idParams, },
        handler: async ({ params, res, },) => {
            const r = await play.masterPlaylist(params.id, 'teaser', null,);
            res.set('Content-Type', 'application/vnd.apple.mpegurl',);
            res.set('Cache-Control', play.masterCacheControl(r,),);
            res.send(r.body,);
        },
    },),
    defineRoute({
        method: 'get', path: '/:id/download', auth: 'optional', raw: true,
        summary: 'Redirect to a short-lived signed MP4 download (?quality=720p; default highest).',
        input: { params: idParams, query: z.object({ quality: z.string().max(16,).optional(), },), },
        handler: async ({ params, query, user, res, },) => {
            const url = await play.downloadLink(params.id, query.quality, viewer(user,),);
            res.set('Cache-Control', 'private, no-store',);
            res.redirect(302, url,);
        },
    },),
];
