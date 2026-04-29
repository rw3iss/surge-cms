import { Title, } from '@solidjs/meta';
import { A, useNavigate, } from '@solidjs/router';
import { Component, For, JSX, Show, } from 'solid-js';

export interface AdminListColumn<T = any,> {
    /** Column header label */
    label: string;
    /** Field key or custom render function */
    field?: keyof T | string;
    /** Custom cell renderer */
    render?: (item: T,) => JSX.Element;
    /** Optional column width */
    width?: string;
}

export interface AdminListPageProps<T = any,> {
    title: string;
    /** Browser tab title (defaults to title + " - Admin - RW") */
    documentTitle?: string;
    /** Header action button */
    newItemHref?: string;
    newItemLabel?: string;
    /** Extra header action slot */
    headerActions?: JSX.Element;
    /** Filter bar content (search, dropdowns, etc.) */
    filterBar?: JSX.Element;
    /** Columns definition */
    columns: AdminListColumn<T>[];
    /** Data accessor */
    items: T[] | undefined;
    /** Loading state */
    loading?: boolean;
    /** Empty state message */
    emptyMessage?: string;
    /** Row click handler — navigates to this URL */
    rowHref?: (item: T,) => string;
    /** Unique row key extractor */
    rowKey?: (item: T,) => string;
    /** Bulk selection state (optional) */
    selectable?: boolean;
    selectedIds?: Set<string>;
    onToggleSelect?: (id: string,) => void;
    onToggleSelectAll?: () => void;
    /** Bulk action bar shown when items are selected */
    bulkActions?: JSX.Element;
}

/**
 * Shared admin list page layout.
 * Handles the title, new-item button, filter bar, table rendering,
 * loading state, empty state, and optional bulk selection.
 */
function AdminListPage<T = any,>(props: AdminListPageProps<T>,) {
    const navigate = useNavigate();

    const keyFor = (item: T,): string => {
        if (props.rowKey) return props.rowKey(item,);
        return (item as any).id as string;
    };

    const renderCell = (item: T, col: AdminListColumn<T>,): JSX.Element => {
        if (col.render) return col.render(item,);
        if (col.field) return (item as any)[col.field];
        return null;
    };

    const allSelected = () => {
        if (!props.items || !props.selectedIds) return false;
        return props.items.length > 0 && props.items.every((item,) =>
            props.selectedIds!.has(keyFor(item,),)
        );
    };

    return (
        <div class="admin-list-page">
            <Title>{props.documentTitle || `${props.title} - Admin - RW`}</Title>

            <div class="admin-header">
                <h1>{props.title}</h1>
                <div class="admin-header__actions">
                    {props.headerActions}
                    <Show when={props.newItemHref}>
                        <A href={props.newItemHref!} class="btn btn--primary">
                            {props.newItemLabel || 'New'}
                        </A>
                    </Show>
                </div>
            </div>

            <Show when={props.filterBar}>
                {props.filterBar}
            </Show>

            <Show when={props.selectable && (props.selectedIds?.size || 0) > 0}>
                <div class="admin-list-page__bulk-bar">
                    <span class="admin-list-page__bulk-count">
                        {props.selectedIds?.size} selected
                    </span>
                    {props.bulkActions}
                </div>
            </Show>

            <Show
                when={!props.loading}
                fallback={
                    <div class="admin-list-page__skeleton">
                        <For each={[1, 2, 3, 4, 5,]}>
                            {() => <div class="skeleton skeleton--row" />}
                        </For>
                    </div>
                }
            >
                <Show
                    when={props.items && props.items.length > 0}
                    fallback={
                        <div class="admin-list-page__empty">
                            {props.emptyMessage || 'No items found.'}
                        </div>
                    }
                >
                    <div class="admin-table-container">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <Show when={props.selectable}>
                                        <th style={{ width: '40px', }}>
                                            <input
                                                type="checkbox"
                                                checked={allSelected()}
                                                onChange={() => props.onToggleSelectAll?.()}
                                            />
                                        </th>
                                    </Show>
                                    <For each={props.columns}>
                                        {(col,) => (
                                            <th style={col.width ? { width: col.width, } : undefined}>
                                                {col.label}
                                            </th>
                                        )}
                                    </For>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={props.items}>
                                    {(item,) => (
                                        <tr
                                            class={props.rowHref ? 'admin-table__row--clickable' : ''}
                                            onClick={(e,) => {
                                                // Don't navigate if clicking a checkbox, button, or link inside the row
                                                const target = e.target as HTMLElement;
                                                if (target.closest('input, button, a',)) return;
                                                if (props.rowHref) navigate(props.rowHref(item,),);
                                            }}
                                        >
                                            <Show when={props.selectable}>
                                                <td onClick={(e,) => e.stopPropagation()}>
                                                    <input
                                                        type="checkbox"
                                                        checked={props.selectedIds?.has(keyFor(item,),) || false}
                                                        onChange={() =>
                                                            props.onToggleSelect?.(keyFor(item,),)}
                                                    />
                                                </td>
                                            </Show>
                                            <For each={props.columns}>
                                                {(col,) => <td>{renderCell(item, col,)}</td>}
                                            </For>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </div>
                </Show>
            </Show>
        </div>
    );
}

export default AdminListPage;
