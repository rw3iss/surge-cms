import { Title, } from '@solidjs/meta';
import { Component, createEffect, For, Show, } from 'solid-js';
import type { ShopReview, } from '@rw/cms-shared';
import Pagination from '../../../components/admin/common/Pagination';
import { usePaginatedList, } from '../../../hooks/usePaginatedList';
import { useSearchFilter, } from '../../../hooks/useSearchFilter';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import ShopGuard from './ShopGuard';
import { formatDate, } from './shopUtils';

const ShopReviewsInner: Component = () => {
    const toast = useToast();
    const { searchParams, setSearchParams, } = useSearchFilter();
    const statusFilter = () => (searchParams.status as string) || 'pending';

    const list = usePaginatedList<ShopReview>({
        fetch: (p,) => cms.shop.reviews.adminList(p,),
        initialLimit: 20,
        params: () => ({ status: statusFilter(), }),
    },);

    createEffect(() => {
        searchParams.status;
        list.resetPage();
    },);

    const moderate = async (r: ShopReview, status: 'approved' | 'rejected',) => {
        try {
            await cms.shop.reviews.moderate(r.id, { status, },);
            toast.success(`Review ${status}.`,);
            list.refetch();
        } catch {
            /* error bus */
        }
    };

    const remove = async (r: ShopReview,) => {
        if (!confirm('Delete this review?',)) return;
        try {
            await cms.shop.reviews.remove(r.id,);
            toast.success('Review deleted.',);
            list.refetch();
        } catch {
            /* error bus */
        }
    };

    return (
        <div class="shop-admin">
            <Title>Shop Reviews - Admin - RW</Title>
            <div class="admin-header">
                <h1>Reviews</h1>
            </div>
            <div class="admin-filter-bar">
                <select
                    class="admin-filter-bar__select"
                    value={statusFilter()}
                    onChange={(e,) => setSearchParams({ status: e.currentTarget.value, },)}
                >
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                </select>
            </div>
            <Show when={!list.loading()} fallback={<div class="empty-state">Loading...</div>}>
                <Show
                    when={list.items().length}
                    fallback={<div class="empty-state">No reviews.</div>}
                >
                    <div class="shop-admin__reviews">
                        <For each={list.items()}>
                            {(r,) => (
                                <div class="shop-admin__review">
                                    <div class="shop-admin__review-head">
                                        <span class="shop-admin__review-rating">
                                            {'★'.repeat(r.rating,)}{'☆'.repeat(Math.max(0, 5 - r.rating,),)}
                                        </span>
                                        <Show when={r.verifiedPurchase}>
                                            <span class="badge badge--success">Verified</span>
                                        </Show>
                                        <span class="form-help-muted">{formatDate(r.createdAt,)}</span>
                                    </div>
                                    <Show when={r.title}><strong>{r.title}</strong></Show>
                                    <Show when={r.body}><p>{r.body}</p></Show>
                                    <div class="shop-admin__review-actions">
                                        <Show when={r.status !== 'approved'}>
                                            <button class="btn btn--small btn--secondary" onClick={() => moderate(r, 'approved',)}>Approve</button>
                                        </Show>
                                        <Show when={r.status !== 'rejected'}>
                                            <button class="btn btn--small btn--secondary" onClick={() => moderate(r, 'rejected',)}>Reject</button>
                                        </Show>
                                        <button class="btn btn--small btn--danger" onClick={() => remove(r,)}>Delete</button>
                                    </div>
                                </div>
                            )}
                        </For>
                    </div>
                    <Pagination
                        page={list.page()}
                        totalPages={list.totalPages()}
                        total={list.total()}
                        limit={list.limit()}
                        onPageChange={list.setPage}
                    />
                </Show>
            </Show>
        </div>
    );
};

const ShopReviews: Component = () => (
    <ShopGuard>
        <ShopReviewsInner />
    </ShopGuard>
);

export default ShopReviews;
