import { type Component, For, type JSX, Show, } from 'solid-js';
import Button, { type ButtonVariant, } from '../../ui/Button';
import EmptyState from './EmptyState';
import LoadingState from './LoadingState';
import Pagination from './Pagination';
import SortTh from './SortTh';

/** One column of a DataTable: a header + a per-row cell renderer. When
 *  `sortField` is set, the header becomes a sortable `SortTh`. */
export interface DataTableColumn<T> {
    header: JSX.Element | string;
    cell: (row: T,) => JSX.Element;
    /** Sort key (enables a sortable header via `SortTh`). */
    sortField?: string;
    /** Fixed column width (e.g. '40px'). */
    width?: string;
    align?: 'left' | 'right' | 'center';
}

/** Selection wiring for the optional bulk-actions column + bar. Shape matches
 *  the `useBulkActions` hook so a page can pass it through directly. */
export interface DataTableBulk<T> {
    selectedCount: () => number;
    isSelected: (id: string,) => boolean;
    toggle: (id: string,) => void;
    allSelected: (items: T[],) => boolean;
    toggleAll: (items: T[],) => void;
    clear: () => void;
    /** Buttons shown in the bulk bar (rendered when ≥1 row is selected). */
    actions: Array<{ label: string; variant?: ButtonVariant; onClick: () => void; }>;
}

export interface DataTableProps<T> {
    items: T[];
    loading: boolean;
    columns: DataTableColumn<T>[];
    /** Stable row id (default: `row.id`). Used for keys + selection. */
    getRowId?: (row: T,) => string;
    /** Current sort (`field_dir`) + change handler — enables sortable headers. */
    sort?: { current: string; onSort: (sort: string,) => void; };
    /** Optional bulk selection (adds a checkbox column + a bulk bar). */
    bulk?: DataTableBulk<T>;
    /** Optional pagination footer. */
    pagination?: { page: number; totalPages: number; total?: number; limit?: number; onPageChange: (page: number,) => void; };
    emptyMessage?: string;
    loadingLabel?: string;
    /** Whole-row click (e.g. open the record). Not fired from the checkbox cell. */
    onRowClick?: (row: T,) => void;
    /** Extra class(es) for a row (e.g. a clickable-row cursor). */
    rowClass?: (row: T,) => string;
}

/**
 * The one admin list table. Presentational: it owns the loading/empty/table/
 * pagination/select-all scaffolding that every admin list page re-implemented,
 * driven by the existing `usePaginatedList` + `useBulkActions` hooks (passed in
 * via props). Columns are configured with `{ header, cell, sortField? }`, so a
 * page declares its columns + row renderers and nothing else.
 */
export function DataTable<T,>(props: DataTableProps<T>,): JSX.Element {
    const rowId = (row: T,) => (props.getRowId ? props.getRowId(row,) : (row as { id: string; }).id);
    const alignStyle = (a?: 'left' | 'right' | 'center',) => (a && a !== 'left' ? { 'text-align': a, } : undefined);

    return (
        <div class="data-table">
            <Show when={props.bulk && props.bulk.selectedCount() > 0}>
                <div class="admin-list-page__bulk-bar">
                    <span class="admin-list-page__bulk-count">{props.bulk!.selectedCount()} selected</span>
                    <For each={props.bulk!.actions}>
                        {(action,) => (
                            <Button size="sm" variant={action.variant ?? 'secondary'} onClick={action.onClick}>
                                {action.label}
                            </Button>
                        )}
                    </For>
                    <Button size="sm" variant="ghost" onClick={() => props.bulk!.clear()}>Clear</Button>
                </div>
            </Show>

            <Show when={!props.loading} fallback={<LoadingState label={props.loadingLabel} />}>
                <Show
                    when={props.items.length}
                    fallback={<EmptyState message={props.emptyMessage ?? 'Nothing found.'} />}
                >
                    <div class="admin-table-container">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <Show when={props.bulk}>
                                        <th style={{ width: '40px', }}>
                                            <input
                                                type="checkbox"
                                                checked={props.bulk!.allSelected(props.items,)}
                                                onChange={() => props.bulk!.toggleAll(props.items,)}
                                            />
                                        </th>
                                    </Show>
                                    <For each={props.columns}>
                                        {(col,) => (
                                            <Show
                                                when={col.sortField && props.sort}
                                                fallback={<th style={{ ...(col.width ? { width: col.width, } : {}), ...alignStyle(col.align,), }}>{col.header}</th>}
                                            >
                                                <SortTh
                                                    label={col.header as string}
                                                    field={col.sortField!}
                                                    current={props.sort!.current}
                                                    onSort={props.sort!.onSort}
                                                />
                                            </Show>
                                        )}
                                    </For>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={props.items}>
                                    {(row,) => (
                                        <tr
                                            class={props.rowClass ? props.rowClass(row,) : undefined}
                                            style={props.onRowClick ? { cursor: 'pointer', } : undefined}
                                            onClick={props.onRowClick ? () => props.onRowClick!(row,) : undefined}
                                        >
                                            <Show when={props.bulk}>
                                                <td onClick={(e,) => e.stopPropagation()}>
                                                    <input
                                                        type="checkbox"
                                                        checked={props.bulk!.isSelected(rowId(row,),)}
                                                        onChange={() => props.bulk!.toggle(rowId(row,),)}
                                                    />
                                                </td>
                                            </Show>
                                            <For each={props.columns}>
                                                {(col,) => <td style={alignStyle(col.align,)}>{col.cell(row,)}</td>}
                                            </For>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </div>

                    <Show when={props.pagination}>
                        <Pagination
                            page={props.pagination!.page}
                            totalPages={props.pagination!.totalPages}
                            total={props.pagination!.total}
                            limit={props.pagination!.limit}
                            onPageChange={props.pagination!.onPageChange}
                        />
                    </Show>
                </Show>
            </Show>
        </div>
    );
}

export default DataTable as <T,>(props: DataTableProps<T>,) => JSX.Element;
