import { useSearchParams, } from '@solidjs/router';
import { createSignal, onCleanup, } from 'solid-js';

interface UseSearchFilterOptions {
    paramKey?: string;
    debounceMs?: number;
}

/**
 * Debounced search input that syncs with URL query params.
 * Returns the current display value, a handler for input events,
 * and the searchParams/setSearchParams pair for additional filters.
 */
export function useSearchFilter(options: UseSearchFilterOptions = {},) {
    const paramKey = options.paramKey || 'search';
    const debounceMs = options.debounceMs ?? 300;

    const [searchParams, setSearchParams,] = useSearchParams();
    const [searchInput, setSearchInput,] = createSignal((searchParams[paramKey] as string) || '',);

    let timer: ReturnType<typeof setTimeout> | undefined;

    const handleSearchInput = (value: string,) => {
        setSearchInput(value,);
        if (timer) clearTimeout(timer,);
        timer = setTimeout(() => {
            setSearchParams({ [paramKey]: value || undefined, } as Record<string, string | undefined>,);
        }, debounceMs,);
    };

    onCleanup(() => {
        if (timer) clearTimeout(timer,);
    },);

    return {
        searchInput,
        handleSearchInput,
        searchParams,
        setSearchParams,
    };
}
