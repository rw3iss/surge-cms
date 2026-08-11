/**
 * EntityDataTable — the "Data" tab of an entity type: a paginated, sortable,
 * searchable table of that type's records over `cms.entities.list`. Every
 * column header toggles sort; a search box filters; each row's Edit button
 * routes to the type's bespoke `adminEditRoute` (core types) or the generic
 * record editor.
 */
import type { EntityFilterValue, EntityQuery, EntityRecord, EntityTypeDef, } from '@sitesurge/types';
import { useNavigate, } from '@solidjs/router';
import { Component, createEffect, createMemo, createSignal, For, Show, } from 'solid-js';
import { usePaginatedList, } from '../../../hooks/usePaginatedList';
import { cms, } from '../../../services/cmsClient';
import Pagination from '../common/Pagination';
import SortTh from '../common/SortTh';
import EntityFilterBar from './EntityFilterBar';
import '../../../pages/admin/entities/EntitiesList.scss';

export interface EntityDataTableProps {
    type: EntityTypeDef;
}

interface Column {
    key: string;
    label: string;
}

type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in';
const FILTER_OPS: FilterOp[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'like', 'in',];

/** Render an arbitrary field value as a short string for a table cell. */
function cell(value: unknown,): string {
    if (value == null) return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') return Array.isArray(value,) ? `[${value.length}]` : '{…}';
    const s = String(value,);
    return s.length > 60 ? `${s.slice(0, 57,)}…` : s;
}

const EntityDataTable: Component<EntityDataTableProps> = (props,) => {
    const navigate = useNavigate();
    const [search, setSearch,] = createSignal('',);
    const [sortBy, setSortBy,] = createSignal('',);
    const [sortOrder, setSortOrder,] = createSignal<'asc' | 'desc'>('desc',);
    const [filters, setFilters,] = createSignal<Record<string, string>>({},);
    // Field / op / value clause (matches the entity query modal), applied on top
    // of the filterable-field dropdowns.
    const [filterField, setFilterField,] = createSignal('',);
    const [filterOp, setFilterOp,] = createSignal<FilterOp>('eq',);
    const [filterValue, setFilterValue,] = createSignal('',);
    let searchTimer: ReturnType<typeof setTimeout>;
    let filterTimer: ReturnType<typeof setTimeout>;

    /** Fields offered in the "Filter field" dropdown: standard columns
     *  (status/slug) first, then the type's non-blocks/json schema fields — so
     *  you can filter e.g. `status = active`. Mirrors the entity search modal. */
    const filterFields = createMemo<string[]>(() => {
        const std: string[] = [];
        if (props.type.hasStatus) std.push('status',);
        if (props.type.hasSlug) std.push('slug',);
        const schema = props.type.fields
            .filter((f,) => f.type !== 'blocks' && f.type !== 'json' && f.key !== 'status' && f.key !== 'slug')
            .map((f,) => f.key);
        return [...std, ...schema,];
    },);

    /** Merge the filterable-field dropdowns (bare equality) with the field/op/value
     *  clause into a single `EntityQuery.filter`. */
    const buildFilter = (): Record<string, EntityFilterValue> | undefined => {
        const merged: Record<string, EntityFilterValue> = { ...filters(), };
        if (filterField() && filterValue() !== '') {
            const raw = filterValue();
            const value: unknown = filterOp() === 'in'
                ? raw.split(',',).map((v,) => v.trim())
                : /^-?\d+(\.\d+)?$/.test(raw,)
                ? Number(raw,)
                : raw;
            merged[filterField()] = { op: filterOp(), value, };
        }
        return Object.keys(merged,).length ? merged : undefined;
    };

    const onFilterValueInput = (value: string,) => {
        clearTimeout(filterTimer,);
        filterTimer = setTimeout(() => setFilterValue(value,), 300,);
    };

    const columns = createMemo<Column[]>(() => {
        const cols: Column[] = [];
        if (props.type.hasSlug) cols.push({ key: 'slug', label: 'Slug', },);
        if (props.type.hasStatus) cols.push({ key: 'status', label: 'Status', },);
        for (const f of props.type.fields) {
            if (cols.length >= 6) break;
            if (f.type === 'blocks') continue;
            cols.push({ key: f.key, label: f.label || f.key, },);
        }
        return cols;
    },);

    const list = usePaginatedList<EntityRecord>({
        fetch: (p,) => cms.entities.list(props.type.key, p as EntityQuery,),
        initialLimit: 20,
        params: () => ({
            search: search(),
            sortBy: sortBy() || undefined,
            sortOrder: sortBy() ? sortOrder() : undefined,
            filter: buildFilter(),
        }),
    },);

    createEffect(() => {
        search();
        sortBy();
        sortOrder();
        filters();
        filterField();
        filterOp();
        filterValue();
        list.resetPage();
    },);

    const currentSort = () => (sortBy() ? `${sortBy()}_${sortOrder()}` : '');
    const handleSort = (value: string,) => {
        const idx = value.lastIndexOf('_',);
        setSortBy(value.slice(0, idx,),);
        setSortOrder(value.slice(idx + 1,) as 'asc' | 'desc',);
    };

    const onSearchInput = (value: string,) => {
        clearTimeout(searchTimer,);
        searchTimer = setTimeout(() => setSearch(value,), 300,);
    };

    const editRecord = (rec: EntityRecord,) => {
        if (props.type.adminEditRoute) {
            navigate(props.type.adminEditRoute.replace(':id', rec.id,),);
        } else {
            navigate(`/admin/entities/${props.type.key}/${rec.id}/edit`,);
        }
    };

    return (
        <div>
            <div class="admin-filter-bar">
                <input
                    class="admin-filter-bar__search"
                    type="search"
                    placeholder={`Search ${props.type.labelPlural.toLowerCase()}…`}
                    onInput={(e,) => onSearchInput(e.currentTarget.value,)}
                />
                <Show when={!props.type.adminEditRoute}>
                    <button
                        class="btn btn--primary"
                        style={{ 'margin-left': 'auto', }}
                        onClick={() => navigate(`/admin/entities/${props.type.key}/new/edit`,)}
                    >
                        New {props.type.label}
                    </button>
                </Show>
            </div>

            <EntityFilterBar typeDef={props.type} value={filters()} onChange={setFilters} />

            {/* Field / op / value clause — narrow records by any built-in or
                schema field, e.g. `status = active`. Mirrors the entity query modal. */}
            <Show when={filterFields().length > 0}>
                <div class="entity-search-modal__query">
                    <select
                        value={filterField()}
                        onChange={(e,) => setFilterField(e.currentTarget.value,)}
                    >
                        <option value="">Filter field…</option>
                        <For each={filterFields()}>
                            {(f,) => <option value={f}>{f}</option>}
                        </For>
                    </select>
                    <select
                        value={filterOp()}
                        onChange={(e,) => setFilterOp(e.currentTarget.value as FilterOp,)}
                    >
                        <For each={FILTER_OPS}>
                            {(op,) => <option value={op}>{op}</option>}
                        </For>
                    </select>
                    <input
                        type="text"
                        placeholder="Value (comma-separated for 'in')"
                        onInput={(e,) => onFilterValueInput(e.currentTarget.value,)}
                    />
                </div>
            </Show>

            <Show when={!list.loading()} fallback={<div class="empty-state">Loading…</div>}>
                <Show
                    when={list.items().length}
                    fallback={<div class="empty-state">No {props.type.labelPlural.toLowerCase()} found.</div>}
                >
                    <div class="admin-table-container">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <For each={columns()}>
                                        {(col,) => (
                                            <SortTh
                                                label={col.label}
                                                field={col.key}
                                                current={currentSort()}
                                                onSort={handleSort}
                                            />
                                        )}
                                    </For>
                                    <th>ID</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={list.items()}>
                                    {(rec,) => (
                                        <tr>
                                            <For each={columns()}>
                                                {(col,) => <td>{cell(rec[col.key],)}</td>}
                                            </For>
                                            <td>
                                                <code class="schema-field__key">{String(rec.id,).slice(0, 8,)}</code>
                                            </td>
                                            <td>
                                                <button
                                                    class="btn btn--small btn--secondary"
                                                    onClick={() => editRecord(rec,)}
                                                >
                                                    Edit
                                                </button>
                                            </td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
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

export default EntityDataTable;
