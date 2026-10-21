import { A, } from '@solidjs/router';
import { Component, createEffect, createSignal, Show, } from 'solid-js';
import { formatDateShort as formatDate, } from '@sitesurge/types';
import DataTable from '../../components/admin/common/DataTable';
import { usePaginatedList, } from '../../hooks/usePaginatedList';
import { useSearchFilter, } from '../../hooks/useSearchFilter';
import { cms, } from '../../services/cmsClient';
import { getStatusBadgeClass, } from '../../utils/badges';
import AdminTitle from '../../components/admin/common/AdminTitle';
import ConfirmModal from '../../components/admin/common/ConfirmModal';
import { useToast, } from '../../components/common/toast/Toast';

const TrashIcon = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6" />
        <path d="M10 11v6M14 11v6" />
    </svg>
);

/** Move to trash (status `deleted`, restorable) or delete for good (row + every block). */
type PendingDelete = { page: { id: string; title: string; }; permanent: boolean; };

const AdminPages: Component = () => {
    const { searchInput, handleSearchInput, searchParams, setSearchParams, } = useSearchFilter();
    const currentSort = () => searchParams.sort || 'updated_desc';

    const list = usePaginatedList<any>({
        fetch: (p,) => cms.pages.list(p,),
        initialLimit: 20,
        params: () => ({
            status: searchParams.status,
            search: searchParams.search,
            sort: currentSort(),
        }),
    },);

    createEffect(() => {
        searchParams.status;
        searchParams.search;
        searchParams.sort;
        list.resetPage();
    },);

    const toast = useToast();
    const [pending, setPending,] = createSignal<PendingDelete | null>(null,);
    const [deleting, setDeleting,] = createSignal(false,);
    const confirmDelete = async () => {
        const p = pending();
        if (!p) return;
        setDeleting(true,);
        try {
            if (p.permanent) {
                await cms.pages.remove(p.page.id,);
                toast.success(`"${p.page.title}" was deleted permanently.`,);
            } else {
                // The bulk 'delete' action is the trash (soft delete).
                await cms.pages.bulk({ ids: [p.page.id,], action: 'delete', },);
                toast.success(`"${p.page.title}" was moved to the trash.`,);
            }
            setPending(null,);
            list.refetch();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not delete the page.',);
        } finally {
            setDeleting(false,);
        }
    };

    // Out of the trash: back to a draft (it was taken off the site when trashed).
    const [restoring, setRestoring,] = createSignal<string | null>(null,);
    const restore = async (page: { id: string; title: string; },) => {
        setRestoring(page.id,);
        try {
            await cms.pages.bulk({ ids: [page.id,], action: 'status', value: 'draft', },);
            toast.success(`"${page.title}" was restored as a draft.`,);
            list.refetch();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not restore the page.',);
        } finally {
            setRestoring(null,);
        }
    };

    const handleSort = (sort: string,) => {
        setSearchParams({ sort, },);
    };

    return (
        <div>
            <AdminTitle>Pages</AdminTitle>
            <div class="admin-header">
                <h1>Pages</h1>
                <A href="/admin/pages/new" class="ui-button ui-button--primary">New Page</A>
            </div>
            <div class="admin-filter-bar">
                <input
                    class="admin-filter-bar__search"
                    type="text"
                    placeholder="Search pages..."
                    value={searchInput()}
                    onInput={(e,) => handleSearchInput(e.currentTarget.value,)}
                />
                <select
                    class="admin-filter-bar__select"
                    value={searchParams.status || ''}
                    onChange={(e,) => setSearchParams({ status: e.currentTarget.value || undefined, },)}
                >
                    <option value="">All</option>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                    <option value="deleted">Deleted</option>
                </select>
            </div>
            <DataTable
                items={list.items()}
                loading={list.loading()}
                emptyMessage="No pages found."
                sort={{ current: currentSort(), onSort: handleSort, }}
                pagination={{ page: list.page(), totalPages: list.totalPages(), total: list.total(), limit: list.limit(), onPageChange: list.setPage, }}
                columns={[
                    { header: 'Title', sortField: 'title', cell: (page: any,) => <A href={`/admin/pages/${page.id}`} class="table-link">{page.title}</A>, },
                    { header: 'Slug', cell: (page: any,) => `/${page.slug}`, },
                    { header: 'Status', sortField: 'status', cell: (page: any,) => <span class={`badge ${getStatusBadgeClass(page.status,)}`}>{page.status}</span>, },
                    // `field="date"` maps to the backend's date_asc / date_desc sort
                    // tokens, which order by created_at. The Modified column uses
                    // field="updated" → updated_at.
                    { header: 'Created', sortField: 'date', cell: (page: any,) => formatDate(page.createdAt,), },
                    { header: 'Modified', sortField: 'updated', cell: (page: any,) => formatDate(page.updatedAt,), },
                    {
                        header: 'Actions',
                        cell: (page: any,) => (
                            <div class="admin-row-actions">
                                <A href={`/admin/pages/${page.id}`} class="ui-button ui-button--sm ui-button--secondary">Edit</A>
                                <a
                                    href={page.status === 'published' ? `/${page.slug}` : `/${page.slug}?preview=admin`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="ui-button ui-button--sm ui-button--ghost"
                                >
                                    View
                                </a>
                                <Show
                                    when={page.status === 'deleted'}
                                    fallback={
                                        <button
                                            type="button"
                                            class="admin-row-icon-btn"
                                            title="Move to trash"
                                            aria-label={`Move "${page.title}" to trash`}
                                            onClick={() => setPending({ page, permanent: false, },)}
                                        >
                                            <TrashIcon />
                                        </button>
                                    }
                                >
                                    <button
                                        type="button"
                                        class="ui-button ui-button--sm ui-button--secondary"
                                        title="Take it out of the trash as a draft"
                                        disabled={restoring() === page.id}
                                        onClick={() => restore(page,)}
                                    >
                                        {restoring() === page.id ? 'Restoring…' : 'Restore'}
                                    </button>
                                    <button
                                        type="button"
                                        class="ui-button ui-button--sm ui-button--danger"
                                        onClick={() => setPending({ page, permanent: true, },)}
                                    >
                                        Delete permanently
                                    </button>
                                </Show>
                            </div>
                        ),
                    },
                ]}
            />
            <ConfirmModal
                open={Boolean(pending(),)}
                danger
                title={pending()?.permanent ? 'Delete page permanently?' : 'Move page to trash?'}
                message={pending()?.permanent
                    ? `"${pending()?.page.title}" and all of its blocks will be deleted for good. This cannot be undone.`
                    : `"${pending()?.page.title}" will be taken off the site and moved to the trash (the Deleted filter).`}
                confirmLabel={pending()?.permanent ? 'Delete permanently' : 'Move to trash'}
                busyLabel="Deleting…"
                loading={deleting()}
                onConfirm={confirmDelete}
                onCancel={() => setPending(null,)}
            />
        </div>
    );
};

export default AdminPages;
