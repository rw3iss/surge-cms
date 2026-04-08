import { createResource, createSignal, } from 'solid-js';
import { api, } from '../services/api';

export interface UsePaginatedListOptions {
    endpoint: string;
    initialLimit?: number;
    /** Extra query params - accessor so changes trigger refetch */
    params?: () => Record<string, string | undefined>;
}

/**
 * Reusable paginated list state for admin list pages.
 * Wraps a createResource with page state, fetches `{endpoint}?page=...&limit=...`,
 * and parses the standard `{ data, meta: { total, totalPages } }` response.
 */
export function usePaginatedList<T = any,>(opts: UsePaginatedListOptions,) {
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
        const urlParams = new URLSearchParams();
        urlParams.set('page', String(page(),),);
        urlParams.set('limit', String(limit(),),);
        for (const [k, v,] of Object.entries(extra,)) {
            if (v !== undefined && v !== '') urlParams.set(k, v,);
        }
        const response = await api.get(`${opts.endpoint}?${urlParams.toString()}`,);
        if (!response.success) return { items: [] as T[], total: 0, totalPages: 0, };
        const meta = (response as any).meta || {};
        return {
            items: ((response as any).data || []) as T[],
            total: meta.total || 0,
            totalPages: meta.totalPages || 1,
        };
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
