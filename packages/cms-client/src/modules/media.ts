import type {
    MediaUploadFields, MediaUploadResponse, MediaBlockUploadFields, MediaBlockUploadResponse,
    MediaBulkUploadResponse, MediaListQuery, MediaListResponse, MediaByIdResponse,
    MediaUpdateBody, MediaUpdateResponse, MediaDeleteResponse,
    MediaUploadCreateBody, MediaUploadCreateResponse, MediaUploadListResponse, MediaUploadGetResponse,
    MediaUploadPartUrlsResponse, MediaUploadCompleteResponse, MediaUploadAbortResponse,
    MediaVideoInfoResponse, MediaVideoJobsQuery, MediaVideoJobsResponse, MediaVideoUpdateBody,
    MediaVideoActionResponse, MediaVideoReencodeBody, MediaPlaybackResponse, MediaVideoStatusResponse,
    SettingsVideoResponse, SettingsVideoBody, MediaVideoKeysResponse, MediaVideoKeyRotateResponse,
} from '@sitesurge/types';
import type { Paginated, } from '@sitesurge/types';
import { ModuleBase, } from './base';

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

    /** POST /media — single multipart upload (field "file"; optional alt/caption fields). */
    upload(file: Blob, fields?: MediaUploadFields,): Promise<MediaUploadResponse> {
        return super.uploadForm<MediaUploadResponse>('/media', buildForm('file', file, fields as Record<string, string | undefined>,), { invalidates: ['media',], },);
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

    /** GET /media/:id — the media row. `{ cache: false }` reads fresh
     *  (an editor must not start from a stale copy). */
    getById(id: string, options?: { cache?: boolean; },): Promise<MediaByIdResponse> {
        return this.get<MediaByIdResponse>('/media/:id', { params: { id, }, options, },);
    }

    update(id: string, body: MediaUpdateBody,): Promise<MediaUpdateResponse> {
        return this.mutate<MediaUpdateResponse>('PUT', '/media/:id', { params: { id, }, body, invalidates: ['media',], },);
    }

    remove(id: string,): Promise<MediaDeleteResponse> {
        return this.mutate<MediaDeleteResponse>('DELETE', '/media/:id', { params: { id, }, invalidates: ['media',], },);
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
        /** POST /video/uploads/:id/complete — finish; creates the media row (+ encode job for video). */
        complete: (id: string,): Promise<MediaUploadCompleteResponse> =>
            this.mutate<MediaUploadCompleteResponse>('POST', '/video/uploads/:id/complete', { params: { id, }, invalidates: ['media',], },),
        /** DELETE /video/uploads/:id — abort and discard the stored parts. */
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
