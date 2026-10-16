/**
 * Paged gallery items for a public listing (the gallery root, a collection):
 * the first page loads whenever `key` changes (null = don't load yet), then
 * `loadMore` appends the next. `query` supplies the filter (e.g. the
 * collection id) — `limit`/`page` are set here, and `listing: true` (items
 * hidden from the gallery are not listed; the totals agree).
 */
import type { GalleryItem, GalleryQuery, } from '@sitesurge/types';
import { createResource, createSignal, } from 'solid-js';
import { cms, } from '../../services/cmsClient';

export function useGalleryItems(key: () => string | null, query: () => Omit<GalleryQuery, 'limit' | 'page'>, perPage: () => number,) {
    const [items, setItems,] = createSignal<GalleryItem[]>([],);
    const [total, setTotal,] = createSignal(0,);
    const [page, setPage,] = createSignal(1,);
    const [loadingMore, setLoadingMore,] = createSignal(false,);

    const [firstPage, { refetch, },] = createResource(key, async () => {
        const r = await cms.gallery.list({ ...query(), listing: true, limit: perPage(), page: 1, },).catch(() => null);
        setItems(r?.items ?? [],);
        setTotal(r?.total ?? 0,);
        setPage(1,);
        return true;
    },);

    const loadMore = async () => {
        setLoadingMore(true,);
        try {
            const r = await cms.gallery.list({ ...query(), listing: true, limit: perPage(), page: page() + 1, },);
            setItems((cur,) => [...cur, ...r.items,],);
            setTotal(r.total,);
            setPage((p,) => p + 1,);
        } finally {
            setLoadingMore(false,);
        }
    };

    return {
        items,
        total,
        loadingMore,
        loadMore,
        refetch,
        /** True once the first page has resolved. */
        loaded: () => firstPage() !== undefined,
        hasMore: () => items().length < total(),
    };
}
