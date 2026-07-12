import { createResource, createSignal, } from 'solid-js';
import type { Paginated, } from '@sitesurge/types';

export interface UsePaginatedListOptions<T,> {
    /**
     * Typed fetcher bound to a `cms.<module>.list` method. Receives the
     * assembled query params (page, limit, plus anything from `params()`)
     * and returns a `Paginated<T>` envelope.
     */
    fetch: (params: Record<string, unknown>,) => Promise<Paginated<T>>;
    initialLimit?: number;
    /** Extra query params - accessor so changes trigger refetch */
    params?: () => Record<string, unknown>;
}

/**
 * Reusable paginated list state for admin list pages.
 * Wraps a createResource with page state, calls the typed `fetch` with
 * `{ page, limit, ...params() }`, and reads `{ data, meta }` off the result.
 * Errors surface via the client's error bus (toast); the hook returns empty.
 */
export function usePaginatedList<T = unknown,>(opts: UsePaginatedListOptions<T>,) {
    const [page, setPage,] = createSignal(1,);
    const [limit, setLimit,] = createSignal(opts.initialLimit || 20,);

    const fetchKey = () => {
        const extra = opts.params ? opts.params() : {};
        const flat = Object.entries(extra,)
            .filter(([, v,],) => v !== undefined && v !== '')
            .map(([k, v,],) => `${k}=${v}`)
            .join('&',);
        return `p=${page()}&l=${limit()}${flat ? '&' + flat : ''}`;
    };

    const [resource, { refetch, mutate, },] = createResource(fetchKey, async () => {
        const extra = opts.params ? opts.params() : {};
        const params: Record<string, unknown> = { page: page(), limit: limit(), };
        for (const [k, v,] of Object.entries(extra,)) {
            if (v !== undefined && v !== '') params[k] = v;
        }
        try {
            const result = await opts.fetch(params,);
            return {
                items: result.data || [],
                total: result.meta?.total ?? 0,
                totalPages: result.meta?.totalPages ?? 1,
            };
        } catch {
            // The cms.onError bus surfaces the error/toast.
            return { items: [] as T[], total: 0, totalPages: 0, };
        }
    },);

    /** Reset to page 1 (use after filters change) */
    const resetPage = () => setPage(1,);

    return {
        page,
        setPage,
        limit,
        setLimit,
        items: () => resource()?.items || [],
        total: () => resource()?.total || 0,
        totalPages: () => resource()?.totalPages || 1,
        loading: () => resource.loading,
        refetch,
        mutate,
        resetPage,
    };
}
