/**
 * Paged gallery items for a public listing (the gallery root, a collection):
 * the first page loads whenever `key` changes (null = don't load yet), then
 * `loadMore` appends the next. `query` supplies the filter (e.g. the
 * collection id) — `limit`/`page` are set here, and `listing: true` (items
 * hidden from the gallery are not listed; the totals agree).
 *
 * - A random order is SEEDED once per hook, so every page shares one shuffle
 *   (no repeats, no skipped items across "Load more").
 * - A failed load sets `error()` (the page shows "Couldn't load — Retry")
 *   instead of looking like an empty gallery.
 * - A generation counter drops a `loadMore` that resolves after `key` changed
 *   (viewer signed in, collection switched), so old results are never appended.
 */
import type { GalleryItem, GalleryQuery, } from '@sitesurge/types';
import { createResource, createSignal, } from 'solid-js';
import { cms, } from '../../services/cmsClient';

export function useGalleryItems(key: () => string | null, query: () => Omit<GalleryQuery, 'limit' | 'page'>, perPage: () => number,) {
    const [items, setItems,] = createSignal<GalleryItem[]>([],);
    const [total, setTotal,] = createSignal(0,);
    const [page, setPage,] = createSignal(1,);
    const [loadingMore, setLoadingMore,] = createSignal(false,);
    const [error, setError,] = createSignal<string | null>(null,);
    const seed = Math.random().toString(36,).slice(2, 10,);
    let generation = 0;

    const params = (p: number,): GalleryQuery => {
        const q = query();
        return { ...q, ...(q.sort === 'random' ? { seed, } : {}), listing: true, limit: perPage(), page: p, };
    };

    const [firstPage, { refetch, },] = createResource(key, async () => {
        const gen = ++generation;
        setError(null,);
        try {
            const r = await cms.gallery.list(params(1,),);
            if (gen !== generation) return true;
            setItems(r.items,);
            setTotal(r.total,);
        } catch (e) {
            if (gen !== generation) return true;
            setItems([],);
            setTotal(0,);
            setError((e as Error)?.message || 'Could not load the gallery.',);
        }
        setPage(1,);
        return true;
    },);

    const loadMore = async () => {
        if (loadingMore()) return;
        const gen = generation;
        setLoadingMore(true,);
        setError(null,);
        try {
            const r = await cms.gallery.list(params(page() + 1,),);
            if (gen !== generation) return;
            setItems((cur,) => [...cur, ...r.items,],);
            setTotal(r.total,);
            setPage((p,) => p + 1,);
        } catch (e) {
            if (gen === generation) setError((e as Error)?.message || 'Could not load more items.',);
        } finally {
            setLoadingMore(false,);
        }
    };

    /** Retry whatever failed: the first page when nothing loaded, else the next page. */
    const retry = () => (items().length ? loadMore() : refetch());

    return {
        items,
        total,
        loadingMore,
        loadMore,
        refetch,
        error,
        retry,
        /** True once the first page has resolved. */
        loaded: () => firstPage() !== undefined,
        hasMore: () => items().length < total(),
    };
}
