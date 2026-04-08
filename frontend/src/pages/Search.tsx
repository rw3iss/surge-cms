import { A, useSearchParams, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import SeoHead from '../components/SeoHead';
import { search, } from '../services/api';

const SearchPage: Component = () => {
    const [searchParams, setSearchParams,] = useSearchParams();
    const [query, setQuery,] = createSignal(searchParams.q || '',);

    const [results,] = createResource(() => searchParams.q, async (q,) => {
        if (!q || q.length < 2) return null;
        const response = await search(q,);
        return response.success ? response.data : null;
    },);

    const handleSearch = (e: Event,) => {
        e.preventDefault();
        setSearchParams({ q: query(), },);
    };

    return (
        <div class="search-page container">
            <SeoHead title="Search" description="Search Surge Media articles, pages, and campaigns." noindex={true} />
            <h1>Search</h1>
            <form onSubmit={handleSearch}>
                <input
                    type="search"
                    placeholder="Search..."
                    value={query()}
                    onInput={(e,) => setQuery(e.currentTarget.value,)}
                />
                <button type="submit">Search</button>
            </form>
            <Show when={results()}>
                <div class="search-results">
                    <Show when={(results() as any)?.posts?.length}>
                        <h2>Posts</h2>
                        <For each={(results() as any).posts}>
                            {(post: any,) => <A href={`/posts/${post.slug}`}>{post.title}</A>}
                        </For>
                    </Show>
                    <Show when={(results() as any)?.pages?.length}>
                        <h2>Pages</h2>
                        <For each={(results() as any).pages}>
                            {(page: any,) => <A href={`/${page.slug}`}>{page.title}</A>}
                        </For>
                    </Show>
                </div>
            </Show>
        </div>
    );
};

export default SearchPage;
