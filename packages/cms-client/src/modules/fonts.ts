import type {
    FontListResponse, FontUploadBody, FontUploadResponse, FontDeleteResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/** /fonts namespace — list (public) + multipart upload + delete (admin). */
export class FontsModule extends ModuleBase {
    protected readonly module = 'fonts';

    /** GET /fonts — all fonts enriched with their @font-face source URL. */
    list(): Promise<FontListResponse> {
        return this.get<FontListResponse>('/fonts',);
    }

    /** POST /fonts — multipart upload (field "file"; optional text fields). */
    upload(file: Blob, fields?: FontUploadBody,): Promise<FontUploadResponse> {
        const form = new FormData();
        form.append('file', file,);
        if (fields) {
            for (const [key, value,] of Object.entries(fields,)) {
                if (value !== undefined) form.append(key, value,);
            }
        }
        return super.uploadForm<FontUploadResponse>('/fonts', form, { invalidates: ['fonts',], },);
    }

    /** DELETE /fonts/:id — removes the file + row. */
    remove(id: string,): Promise<FontDeleteResponse> {
        return this.mutate<FontDeleteResponse>('DELETE', '/fonts/:id', { params: { id, }, invalidates: ['fonts',], },);
    }
}
