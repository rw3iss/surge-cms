import type { FeedXmlResponse, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * /feed namespace — RSS 2.0. RAW route mounted at the site root
 * (`/feed.xml`), OUTSIDE the `/api/v1` JSON surface. The response is an
 * XML string (`application/rss+xml`), not the `ApiResponse<T>` envelope —
 * `rootMounted: true` skips the `/api/v1` prefix.
 */
export class FeedModule extends ModuleBase {
    protected readonly module = 'feed';

    /** GET /feed.xml — the raw RSS 2.0 document as an XML string. */
    xml(): Promise<FeedXmlResponse> {
        return this.rawGet('/feed.xml', { rootMounted: true, },);
    }
}
