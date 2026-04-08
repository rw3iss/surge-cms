import { Component, For, Show, } from 'solid-js';

export interface PaginationProps {
    page: number;
    totalPages: number;
    total?: number;
    limit?: number;
    onPageChange: (page: number,) => void;
    maxButtons?: number;
}

/**
 * Pagination controls with page number buttons and prev/next.
 * Renders nothing if totalPages <= 1.
 */
const Pagination: Component<PaginationProps> = (props,) => {
    const maxButtons = () => props.maxButtons || 7;

    const pageNumbers = () => {
        const total = props.totalPages;
        const current = props.page;
        const max = maxButtons();
        if (total <= max) {
            return Array.from({ length: total, }, (_, i,) => i + 1);
        }
        const half = Math.floor(max / 2,);
        let start = Math.max(1, current - half,);
        let end = start + max - 1;
        if (end > total) {
            end = total;
            start = Math.max(1, end - max + 1,);
        }
        const pages: (number | 'ellipsis-l' | 'ellipsis-r')[] = [];
        if (start > 1) {
            pages.push(1,);
            if (start > 2) pages.push('ellipsis-l',);
        }
        for (let i = start; i <= end; i++) pages.push(i,);
        if (end < total) {
            if (end < total - 1) pages.push('ellipsis-r',);
            pages.push(total,);
        }
        return pages;
    };

    return (
        <Show when={props.totalPages > 1}>
            <nav class="pagination" aria-label="Pagination">
                <button
                    class="pagination__btn"
                    disabled={props.page <= 1}
                    onClick={() => props.onPageChange(props.page - 1,)}
                    aria-label="Previous page"
                >
                    ‹
                </button>
                <For each={pageNumbers()}>
                    {(p,) =>
                        typeof p === 'number' ?
                            (
                                <button
                                    class={`pagination__btn ${p === props.page ? 'pagination__btn--active' : ''}`}
                                    onClick={() => props.onPageChange(p,)}
                                    aria-current={p === props.page ? 'page' : undefined}
                                >
                                    {p}
                                </button>
                            ) :
                            <span class="pagination__ellipsis">…</span>}
                </For>
                <button
                    class="pagination__btn"
                    disabled={props.page >= props.totalPages}
                    onClick={() => props.onPageChange(props.page + 1,)}
                    aria-label="Next page"
                >
                    ›
                </button>
                <Show when={props.total !== undefined && props.limit}>
                    <span class="pagination__info">
                        {(props.page - 1) * (props.limit || 0) + 1}-
                        {Math.min(props.page * (props.limit || 0), props.total!,)} of {props.total}
                    </span>
                </Show>
            </nav>
        </Show>
    );
};

export default Pagination;
