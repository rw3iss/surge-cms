import type {
    MediaUploadFields, MediaUploadResponse, MediaBlockUploadFields, MediaBlockUploadResponse,
    MediaBulkUploadResponse, MediaListQuery, MediaListResponse, MediaByIdResponse, MediaByUrlResponse,
    MediaUpdateBody, MediaUpdateResponse, MediaDeleteResponse, MediaDiscardResponse, MediaUploadCompleteBody,
    MediaUploadCreateBody, MediaUploadCreateResponse, MediaUploadListResponse, MediaUploadGetResponse,
    MediaUploadPartUrlsResponse, MediaUploadCompleteResponse, MediaUploadAbortResponse,
    MediaVideoInfoResponse, MediaVideoJobsQuery, MediaVideoJobsResponse, MediaVideoUpdateBody,
    MediaVideoActionResponse, MediaVideoReencodeBody, MediaPlaybackResponse, MediaVideoStatusResponse,
    SettingsVideoResponse, SettingsVideoBody, MediaVideoKeysResponse, MediaVideoKeyRotateResponse, MediaVideoShareResponse,
    MediaVideoSharesResponse, MediaVideoShareRevokeResponse,
    MediaUsageResponse, MediaBulkDeleteResponse,
} from '@sitesurge/types';
import type { Paginated, } from '@sitesurge/types';
import { ModuleBase, } from './base';
import type { MutationOptions, } from '../core/types';

/** Append a Blob/File plus optional string fields onto a FormData. */
function buildForm(field: string, file: Blob, fields?: Record<string, string | undefined>,): FormData {
    const form = new FormData();
    form.append(field, file,);
    if (fields) {
        for (const [key, value,] of Object.entries(fields,)) {
            if (value !== undefined) form.append(key, value,);
        }
    }
    return form;
}

/** /media namespace (all admin) — multipart uploads + list/get/update/delete. */
export class MediaModule extends ModuleBase {
    protected readonly module = 'media';

    /** POST /media — single multipart upload (field "file"; optional title/alt/caption fields).
     *  `options.signal` cancels the upload (an aborted request creates no media row). */
    upload(file: Blob, fields?: MediaUploadFields, options?: MutationOptions,): Promise<MediaUploadResponse> {
        return super.uploadForm<MediaUploadResponse>('/media', buildForm('file', file, fields as Record<string, string | undefined>,), { invalidates: ['media',], options, },);
    }

    /** POST /media/block-upload — single upload echoing postId/blockId back (field "file"). */
    blockUpload(file: Blob, fields?: MediaBlockUploadFields,): Promise<MediaBlockUploadResponse> {
        return super.uploadForm<MediaBlockUploadResponse>('/media/block-upload', buildForm('file', file, fields as Record<string, string | undefined>,), { invalidates: ['media',], },);
    }

    /** POST /media/bulk — multiple files (field "files", max 10). */
    bulkUpload(files: Blob[],): Promise<MediaBulkUploadResponse> {
        const form = new FormData();
        for (const file of files) form.append('files', file,);
        return super.uploadForm<MediaBulkUploadResponse>('/media/bulk', form, { invalidates: ['media',], },);
    }

    /** GET /media — paginated admin list with type/types/search/sort filters. */
    list(query?: MediaListQuery,): Promise<Paginated<MediaListResponse[number]>> {
        return this.getPaged<MediaListResponse[number]>('/media', { query: query as Record<string, unknown>, },);
    }

    /** GET /media/by-url — the library item behind a stored URL (null when
     *  the URL is not in the library). Used to preview an assigned image. */
    byUrl(url: string,): Promise<MediaByUrlResponse> {
        return this.get<MediaByUrlResponse>('/media/by-url', { query: { url, }, },);
    }

    /** GET /media/:id — the media row. `{ cache: false }` reads fresh
     *  (an editor must not start from a stale copy). */
    getById(id: string, options?: { cache?: boolean; },): Promise<MediaByIdResponse> {
        return this.get<MediaByIdResponse>('/media/:id', { params: { id, }, options, },);
    }

    update(id: string, body: MediaUpdateBody,): Promise<MediaUpdateResponse> {
        return this.mutate<MediaUpdateResponse>('PUT', '/media/:id', { params: { id, }, body, invalidates: ['media',], },);
    }

    /** GET /media/usage — where each media item is used (pages, posts, blocks,
     *  templates, settings, gallery, products, …): `{ [mediaId]: MediaUsage[] }`,
     *  ≤ 20 per item, `[]` when unused. Always read fresh. */
    usage(ids: string[],): Promise<MediaUsageResponse> {
        return this.get<MediaUsageResponse>('/media/usage', { query: { ids: ids.join(',',), }, options: { cache: false, }, },);
    }

    /** DELETE /media/:id. A media item still in use is refused with a
     *  `ConflictError` (code `MEDIA_IN_USE`, `details.usage`) unless `force`. */
    remove(id: string, opts: { force?: boolean; } = {},): Promise<MediaDeleteResponse> {
        return this.mutate<MediaDeleteResponse>('DELETE', '/media/:id', {
            params: { id, }, query: opts.force ? { force: 'true', } : undefined, invalidates: ['media',],
        },);
    }

    /** POST /media/bulk-delete — delete several. Without `force`, NOTHING is
     *  deleted when any is in use (`ConflictError`, `MEDIA_IN_USE`). */
    bulkRemove(ids: string[], opts: { force?: boolean; } = {},): Promise<MediaBulkDeleteResponse> {
        return this.mutate<MediaBulkDeleteResponse>('POST', '/media/bulk-delete', { body: { ids, force: opts.force, }, invalidates: ['media',], },);
    }

    /** POST /media/:id/discard — CANCEL an upload that already made a media
     *  row (e.g. a video still encoding): stops the encode (a running ffmpeg
     *  is killed), deletes every stored file, the row and any gallery item
     *  made from it. Needs `media:write`. Refused (`MEDIA_IN_USE`) when the
     *  media is already used outside the gallery, unless `force`. */
    discard(id: string, opts: { force?: boolean; } = {},): Promise<MediaDiscardResponse> {
        return this.mutate<MediaDiscardResponse>('POST', '/media/:id/discard', {
            params: { id, }, body: opts.force ? { force: true, } : {}, invalidates: ['media', 'gallery',],
        },);
    }

    /**
     * Direct (multipart) uploads — the browser sends the bytes straight to
     * object storage with presigned part URLs; the API only signs and records.
     * Requires the `video` feature (routes under /video/uploads). Used for
     * videos and any large file. A session is resumable: `create` with the
     * same fingerprint returns the existing session and its uploaded parts.
     */
    readonly uploads = {
        /** POST /video/uploads — create or resume a session. */
        create: (body: MediaUploadCreateBody,): Promise<MediaUploadCreateResponse> =>
            this.mutate<MediaUploadCreateResponse>('POST', '/video/uploads', { body, },),
        /** GET /video/uploads — the caller's unfinished sessions. */
        list: (): Promise<MediaUploadListResponse> =>
            this.get<MediaUploadListResponse>('/video/uploads', { options: { cache: false, }, },),
        /** GET /video/uploads/:id — session + uploaded parts. */
        get: (id: string,): Promise<MediaUploadGetResponse> =>
            this.get<MediaUploadGetResponse>('/video/uploads/:id', { params: { id, }, options: { cache: false, }, },),
        /** POST /video/uploads/:id/part-urls — presigned PUT URLs (≤ 50 parts per call). */
        partUrls: (id: string, partNumbers: number[],): Promise<MediaUploadPartUrlsResponse> =>
            this.mutate<MediaUploadPartUrlsResponse>('POST', '/video/uploads/:id/part-urls', { params: { id, }, body: { partNumbers, }, },),
        /** POST /video/uploads/:id/complete — finish; creates the media row (+ encode job for video).
         *  `body.title` (optional) wins over the title sent at create. */
        complete: (id: string, body?: MediaUploadCompleteBody,): Promise<MediaUploadCompleteResponse> =>
            this.mutate<MediaUploadCompleteResponse>('POST', '/video/uploads/:id/complete', { params: { id, }, body: body ?? {}, invalidates: ['media',], },),
        /** DELETE /video/uploads/:id — cancel: abort the multipart upload, discard its parts, delete the session. */
        abort: (id: string,): Promise<MediaUploadAbortResponse> =>
            this.mutate<MediaUploadAbortResponse>('DELETE', '/video/uploads/:id', { params: { id, }, },),
    };

    /** Encoded video: status, jobs, actions, settings and keys (`video` feature). */
    readonly video = {
        /** GET /video/:id — encode status, renditions, teaser, job (staff). */
        info: (id: string,): Promise<MediaVideoInfoResponse> =>
            this.get<MediaVideoInfoResponse>('/video/:id', { params: { id, }, options: { cache: false, }, },),
        /** PUT /video/:id — access level, teaser window, original expiry. */
        update: (id: string, body: MediaVideoUpdateBody,): Promise<MediaVideoActionResponse> =>
            this.mutate<MediaVideoActionResponse>('PUT', '/video/:id', { params: { id, }, body, invalidates: ['media',], },),
        /** POST /video/:id/cancel — stop the running/queued job. */
        cancel: (id: string,): Promise<MediaVideoActionResponse> =>
            this.mutate<MediaVideoActionResponse>('POST', '/video/:id/cancel', { params: { id, }, invalidates: ['media',], },),
        /** POST /video/:id/retry — re-queue failed renditions. */
        retry: (id: string,): Promise<MediaVideoActionResponse> =>
            this.mutate<MediaVideoActionResponse>('POST', '/video/:id/retry', { params: { id, }, invalidates: ['media',], },),
        /** POST /video/:id/reencode — full encode from the original, or a cheap re-package. */
        reencode: (id: string, body: MediaVideoReencodeBody = {},): Promise<MediaVideoActionResponse> =>
            this.mutate<MediaVideoActionResponse>('POST', '/video/:id/reencode', { params: { id, }, body, invalidates: ['media',], },),
        /** POST /video/:id/share — a time-limited direct link that skips the access check (default 7 days). */
        share: (id: string, days?: number,): Promise<MediaVideoShareResponse> =>
            this.mutate<MediaVideoShareResponse>('POST', '/video/:id/share', { params: { id, }, body: { days, }, },),
        /** GET /video/:id/shares — share links issued for the video (from the audit log), with revoked / expired flags. */
        shares: (id: string,): Promise<MediaVideoSharesResponse> =>
            this.get<MediaVideoSharesResponse>('/video/:id/shares', { params: { id, }, options: { cache: false, }, },),
        /** POST /video/:id/share/revoke — invalidate every share link issued so far for this video. */
        revokeShares: (id: string,): Promise<MediaVideoShareRevokeResponse> =>
            this.mutate<MediaVideoShareRevokeResponse>('POST', '/video/:id/share/revoke', { params: { id, }, },),
        /** GET /video/jobs — the encode queue (`active: true` = running/queued only). */
        jobs: (query?: MediaVideoJobsQuery,): Promise<MediaVideoJobsResponse> =>
            this.get<MediaVideoJobsResponse>('/video/jobs', { query: query as Record<string, unknown>, options: { cache: false, }, },),
        /** GET /video/status — ffmpeg / disk / storage readiness. */
        status: (): Promise<MediaVideoStatusResponse> =>
            this.get<MediaVideoStatusResponse>('/video/status', { options: { cache: false, }, },),
        /** GET /video/settings */
        settings: (): Promise<SettingsVideoResponse> =>
            this.get<SettingsVideoResponse>('/video/settings', { options: { cache: false, }, },),
        /** PUT /video/settings — partial patch. */
        updateSettings: (body: SettingsVideoBody,): Promise<SettingsVideoResponse> =>
            this.mutate<SettingsVideoResponse>('PUT', '/video/settings', { body, },),
        /** GET /video/keys — shared encryption key versions (no key bytes). */
        keys: (): Promise<MediaVideoKeysResponse> =>
            this.get<MediaVideoKeysResponse>('/video/keys', { options: { cache: false, }, },),
        /** POST /video/keys/rotate — new key; private videos are re-packaged onto it. */
        rotateKey: (): Promise<MediaVideoKeyRotateResponse> =>
            this.mutate<MediaVideoKeyRotateResponse>('POST', '/video/keys/rotate', { invalidates: ['media',], },),
    };

    /**
     * GET /video/:id/playback — everything a player needs, shaped for the
     * caller: `src` (the full video) only when they may watch it, `teaserSrc`
     * always when a teaser exists. Also works for plain uploaded video files
     * (`fileSrc`).
     */
    playback(id: string,): Promise<MediaPlaybackResponse> {
        return this.get<MediaPlaybackResponse>('/video/:id/playback', { params: { id, }, options: { cache: false, }, },);
    }

    /** The teaser's master playlist URL, or null when the video has none. */
    async teaserUrl(id: string,): Promise<string | null> {
        return (await this.playback(id,)).teaserSrc;
    }
}
