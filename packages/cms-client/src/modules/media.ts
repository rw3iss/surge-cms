import type {
    MediaUploadFields, MediaUploadResponse, MediaBlockUploadFields, MediaBlockUploadResponse,
    MediaBulkUploadResponse, MediaListQuery, MediaListResponse, MediaByIdResponse,
    MediaUpdateBody, MediaUpdateResponse, MediaDeleteResponse,
} from '@rw/cms-shared';
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
    list(query?: MediaListQuery,): Promise<MediaListResponse> {
        return this.get<MediaListResponse>('/media', { query: query as Record<string, unknown>, },);
    }

    /** GET /media/:id — the media row. */
    getById(id: string,): Promise<MediaByIdResponse> {
        return this.get<MediaByIdResponse>('/media/:id', { params: { id, }, },);
    }

    update(id: string, body: MediaUpdateBody,): Promise<MediaUpdateResponse> {
        return this.mutate<MediaUpdateResponse>('PUT', '/media/:id', { params: { id, }, body, invalidates: ['media',], },);
    }

    remove(id: string,): Promise<MediaDeleteResponse> {
        return this.mutate<MediaDeleteResponse>('DELETE', '/media/:id', { params: { id, }, invalidates: ['media',], },);
    }
}
