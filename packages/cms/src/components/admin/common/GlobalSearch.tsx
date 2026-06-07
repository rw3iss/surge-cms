import { useNavigate, } from '@solidjs/router';
import { Component, createSignal, For, onCleanup, onMount, Show, } from 'solid-js';
import { useKeyboardShortcuts, } from '../../../hooks/useKeyboardShortcuts';
import { api, } from '../../../services/api';

interface SearchResultItem {
    id: string;
    type: 'page' | 'post' | 'campaign' | 'form' | 'user' | 'message';
    title: string;
    slug?: string;
    snippet?: string;
}

/**
 * Global admin search — opens with Cmd/Ctrl+K, searches across
 * pages, posts, campaigns, forms, users, and messages.
 */
const GlobalSearch: Component = () => {
    const navigate = useNavigate();
    const [open, setOpen,] = createSignal(false,);
    const [query, setQuery,] = createSignal('',);
    const [results, setResults,] = createSignal<SearchResultItem[]>([],);
    const [loading, setLoading,] = createSignal(false,);
    const [selectedIdx, setSelectedIdx,] = createSignal(0,);

    let inputRef: HTMLInputElement | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    useKeyboardShortcuts([
        {
            key: 'k',
            ctrl: true,
            handler: () => {
                setOpen(true,);
                setTimeout(() => inputRef?.focus(), 0,);
            },
        },
        {
            key: 'Escape',
            handler: () => setOpen(false,),
        },
    ],);

    const handleSearch = async (q: string,) => {
        if (debounceTimer) clearTimeout(debounceTimer,);
        if (!q || q.length < 2) {
            setResults([],);
            return;
        }
        debounceTimer = setTimeout(async () => {
            setLoading(true,);
            try {
                const res = await api.get(`/search?q=${encodeURIComponent(q,)}`,);
                if (res.success && (res as any).data) {
                    const data = (res as any).data;
                    const all: SearchResultItem[] = [
                        ...(data.pages || []).map((p: any,) => ({
                            id: p.id,
                            type: 'page' as const,
                            title: p.title,
                            slug: p.slug,
                            snippet: p.description,
                        }),),
                        ...(data.posts || []).map((p: any,) => ({
                            id: p.id,
                            type: 'post' as const,
                            title: p.title,
                            slug: p.slug,
                            snippet: p.excerpt,
                        }),),
                    ];
                    setResults(all.slice(0, 10,),);
                }
            } catch {
                setResults([],);
            } finally {
                setLoading(false,);
            }
        }, 200,);
    };

    const handleSelect = (item: SearchResultItem,) => {
        setOpen(false,);
        setQuery('',);
        setResults([],);
        switch (item.type) {
            case 'page':
                navigate(`/admin/pages/${item.id}`,);
                break;
            case 'post':
                navigate(`/admin/posts/${item.id}`,);
                break;
            case 'campaign':
                navigate(`/admin/campaigns/${item.id}`,);
                break;
            case 'form':
                navigate(`/admin/forms/${item.id}`,);
                break;
            case 'user':
                navigate(`/admin/users/${item.id}`,);
                break;
            case 'message':
                navigate(`/admin/messages/${item.id}`,);
                break;
        }
    };

    const handleKeyDown = (e: KeyboardEvent,) => {
        const r = results();
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIdx((i,) => Math.min(i + 1, r.length - 1,),);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIdx((i,) => Math.max(i - 1, 0,),);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const item = r[selectedIdx()];
            if (item) handleSelect(item,);
        }
    };

    const typeLabel = (type: string,) => {
        const map: Record<string, string> = {
            page: 'Page',
            post: 'Post',
            campaign: 'Campaign',
            form: 'Form',
            user: 'User',
            message: 'Message',
        };
        return map[type] || type;
    };

    return (
        <Show when={open()}>
            <div class="global-search-overlay" onClick={() => setOpen(false,)}>
                <div class="global-search" onClick={(e,) => e.stopPropagation()}>
                    <div class="global-search__input-wrap">
                        <input
                            ref={inputRef}
                            type="text"
                            class="global-search__input"
                            placeholder="Search pages, posts, campaigns..."
                            value={query()}
                            onInput={(e,) => {
                                setQuery(e.currentTarget.value,);
                                setSelectedIdx(0,);
                                handleSearch(e.currentTarget.value,);
                            }}
                            onKeyDown={handleKeyDown}
                        />
                        <span class="global-search__hint">ESC to close</span>
                    </div>

                    <Show when={loading()}>
                        <div class="global-search__loading">Searching...</div>
                    </Show>

                    <Show when={!loading() && query().length >= 2 && results().length === 0}>
                        <div class="global-search__empty">No results for "{query()}"</div>
                    </Show>

                    <Show when={!loading() && results().length > 0}>
                        <div class="global-search__results">
                            <For each={results()}>
                                {(item, idx,) => (
                                    <button
                                        type="button"
                                        class={`global-search__item ${
                                            idx() === selectedIdx() ? 'global-search__item--active' : ''
                                        }`}
                                        onClick={() => handleSelect(item,)}
                                        onMouseEnter={() => setSelectedIdx(idx(),)}
                                    >
                                        <span class="global-search__item-type">{typeLabel(item.type,)}</span>
                                        <div class="global-search__item-content">
                                            <div class="global-search__item-title">{item.title}</div>
                                            <Show when={item.snippet}>
                                                <div class="global-search__item-snippet">{item.snippet}</div>
                                            </Show>
                                        </div>
                                    </button>
                                )}
                            </For>
                        </div>
                    </Show>

                    <div class="global-search__footer">
                        <span>↑↓ to navigate</span>
                        <span>⏎ to select</span>
                        <span>Esc to close</span>
                    </div>
                </div>
            </div>
        </Show>
    );
};

export default GlobalSearch;
