/**
 * Posts block ↔ "Set data…" mapping (pure). The Posts block (and the legacy
 * carousel Posts item) keep their settings shape — `pinnedPostIds` +
 * `queryEnabled` / `count` / `query` — which the web renderer, the carousel
 * resolver and email read; this maps it to and from a `SlotBinding`.
 *
 * The post renderer's live query supports search + count only (plus its own
 * date window, edited beside the field), so the modal hides filters and sort
 * for posts.
 */
import type { SlotBinding, } from '@sitesurge/types';

export interface PostDataSettings {
    pinnedPostIds?: string[];
    queryEnabled?: boolean;
    count?: number;
    query?: string;
}

export const DEFAULT_POST_COUNT = 5;

/** The binding the settings describe: pinned posts win (they render first). */
export function postDataBinding(v: PostDataSettings,): SlotBinding | null {
    const pinned = Array.isArray(v.pinnedPostIds,) ? v.pinnedPostIds.filter(Boolean,) : [];
    if (pinned.length) return { mode: 'list', refs: pinned, };
    if (v.queryEnabled !== false) {
        return {
            mode: 'query',
            query: { limit: v.count ?? DEFAULT_POST_COUNT, ...(v.query ? { search: v.query, } : {}), },
        };
    }
    return null;
}

/** The settings patch for a saved binding (`null` = cleared). */
export function postSettingsFromBinding(b: SlotBinding | null,): Required<Pick<PostDataSettings, 'pinnedPostIds' | 'queryEnabled'>> & PostDataSettings {
    if (!b) return { pinnedPostIds: [], queryEnabled: false, };
    if (b.mode === 'query') {
        return {
            pinnedPostIds: [],
            queryEnabled: true,
            count: b.query.limit ?? DEFAULT_POST_COUNT,
            query: b.query.search?.trim() || undefined,
        };
    }
    return { pinnedPostIds: b.mode === 'list' ? [...b.refs,] : [b.ref,], queryEnabled: false, };
}

/** True when an older block holds BOTH pinned posts and a live query (they
 *  render pinned first, then the query); Set data… saves one or the other. */
export function hasPinnedAndQuery(v: PostDataSettings,): boolean {
    return (v.pinnedPostIds?.length ?? 0) > 0 && v.queryEnabled !== false;
}
