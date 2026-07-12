import type { UtilsUrlPreviewBody, UtilsUrlPreviewResponse, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/** /utils namespace — admin editor helper endpoints. */
export class UtilsModule extends ModuleBase {
    protected readonly module = 'utils';

    /** POST /utils/url-preview — SSRF-guarded link unfurl. Returns the
     *  page's OpenGraph/basic meta (every field optional). Admin-only. */
    urlPreview(body: UtilsUrlPreviewBody,): Promise<UtilsUrlPreviewResponse> {
        return this.mutate<UtilsUrlPreviewResponse>('POST', '/utils/url-preview', { body, },);
    }
}
