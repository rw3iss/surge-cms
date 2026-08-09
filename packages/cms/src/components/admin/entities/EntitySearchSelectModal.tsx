/**
 * EntitySearchSelectModal — a reusable, self-contained modal for picking
 * entity records of a given type. Three modes:
 *
 *   'single'   → pick ONE record; `onSelect(record)` fires on click.
 *   'multiple' → pick many (≤ `max`); `onSelect(records[])` on confirm.
 *   'query'    → build an `EntityQuery` (filter/sort/limit); `onSelect(query)`.
 *
 * Renders a search box + a sortable results table over `cms.entities.list`.
 * Fetches the type definition to derive display columns + sortable fields.
 * Portal-mounted via the shared `ModalShell`. Kept dependency-light so the
 * entity block editor can reuse it verbatim.
 */
import type {
    EntityFilterValue,
    EntityQuery,
    EntityRecord,
    EntityTypeDef,
} from '@sitesurge/types';
import { Component, createEffect, createSignal, For, onMount, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import ModalShell from '../common/ModalShell';
import SortTh from '../common/SortTh';
import '../../../pages/admin/entities/EntitiesList.scss';

export type EntitySearchResult = EntityRecord | EntityRecord[] | EntityQuery;

export interface EntitySearchSelectModalProps {
    entityType: string;
    mode: 'single' | 'multiple' | 'query';
    /** Multiple mode: cap on how many records may be selected. */
    max?: number;
    onSelect: (result: EntitySearchResult,) => void;
    onClose: () => void;
}

type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in';
const FILTER_OPS: FilterOp[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'like', 'in',];

const PAGE_LIMIT = 10;

/** Render an arbitrary field value as a short string for a table cell. */
function cell(value: unknown,): string {
    if (value == null) return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') return Array.isArray(value,) ? `[${value.length}]` : '{…}';
    const s = String(value,);
    return s.length > 60 ? `${s.slice(0, 57,)}…` : s;
}

const EntitySearchSelectModal: Component<EntitySearchSelectModalProps> = (props,) => {
    const [typeDef, setTypeDef,] = createSignal<EntityTypeDef | null>(null,);
    const [items, setItems,] = createSignal<EntityRecord[]>([],);
    const [totalPages, setTotalPages,] = createSignal(1,);
    const [total, setTotal,] = createSignal(0,);
    const [loading, setLoading,] = createSignal(false,);
    const [error, setError,] = createSignal<string | null>(null,);

    const [search, setSearch,] = createSignal('',);
    const [sortBy, setSortBy,] = createSignal<string>('',);
    const [sortOrder, setSortOrder,] = createSignal<'asc' | 'desc'>('desc',);
    const [page, setPage,] = createSignal(1,);
    const [limit, setLimit,] = createSignal(20,);

    const [selected, setSelected,] = createSignal<EntityRecord[]>([],);

    // Query-mode filter draft (single optional clause).
    const [filterField, setFilterField,] = createSignal('',);
    const [filterOp, setFilterOp,] = createSignal<FilterOp>('eq',);
    const [filterValue, setFilterValue,] = createSignal('',);

    let searchTimer: ReturnType<typeof setTimeout>;

    /** Column-backed, non-blocks fields, capped for width. */
    const columns = () => {
        const def = typeDef();
        if (!def) return [] as { key: string; label: string; }[];
        const cols = def.fields
            .filter((f,) => f.type !== 'blocks')
            .slice(0, 5,)
            .map((f,) => ({ key: f.key, label: f.label || f.key, }));
        return cols;
    };

    const sortableFields = () => {
        const def = typeDef();
        if (!def) return [] as string[];
        return def.fields.filter((f,) => f.type !== 'blocks' && f.type !== 'json').map((f,) => f.key);
    };

    const currentSort = () => (sortBy() ? `${sortBy()}_${sortOrder()}` : '');

    const handleSort = (value: string,) => {
        const idx = value.lastIndexOf('_',);
        const field = value.slice(0, idx,);
        const dir = value.slice(idx + 1,) as 'asc' | 'desc';
        setSortBy(field,);
        setSortOrder(dir,);
        setPage(1,);
    };

    const buildFilter = (): Record<string, EntityFilterValue> | undefined => {
        if (props.mode !== 'query' || !filterField() || filterValue() === '') return undefined;
        const raw = filterValue();
        const value: unknown = filterOp() === 'in' ?
            raw.split(',',).map((v,) => v.trim()) :
            /^-?\d+(\.\d+)?$/.test(raw,) ?
            Number(raw,) :
            raw;
        return { [filterField()]: { op: filterOp(), value, }, };
    };

    const buildQuery = (): EntityQuery => ({
        ...(search() ? { search: search(), } : {}),
        ...(sortBy() ? { sortBy: sortBy(), sortOrder: sortOrder(), } : {}),
        ...(props.mode === 'query' ? { limit: limit(), } : {}),
        ...(() => {
            const filter = buildFilter();
            return filter ? { filter, } : {};
        })(),
    });

    const fetchRecords = async () => {
        setLoading(true,);
        setError(null,);
        try {
            const query: EntityQuery = {
                page: page(),
                limit: PAGE_LIMIT,
                ...(search() ? { search: search(), } : {}),
                ...(sortBy() ? { sortBy: sortBy(), sortOrder: sortOrder(), } : {}),
            };
            const filter = buildFilter();
            if (filter) query.filter = filter;
            const res = await cms.entities.list(props.entityType, query,);
            setItems(res.data ?? [],);
            setTotalPages(res.meta?.totalPages ?? 1,);
            setTotal(res.meta?.total ?? 0,);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load records',);
            setItems([],);
        }
        setLoading(false,);
    };

    onMount(async () => {
        try {
            setTypeDef(await cms.entityTypes.getOne(props.entityType,),);
        } catch {
            /* type def is best-effort — the table still works with id-only columns */
        }
    },);

    // Refetch whenever page/sort/filter change; debounce search input.
    createEffect(() => {
        page();
        sortBy();
        sortOrder();
        filterField();
        filterOp();
        void fetchRecords();
    },);

    const onSearchInput = (value: string,) => {
        setSearch(value,);
        clearTimeout(searchTimer,);
        searchTimer = setTimeout(() => {
            setPage(1,);
            void fetchRecords();
        }, 300,);
    };

    const isSelected = (rec: EntityRecord,) => selected().some((r,) => r.id === rec.id);
    const atMax = () => props.max != null && selected().length >= props.max;

    const toggleSelect = (rec: EntityRecord,) => {
        if (isSelected(rec,)) {
            setSelected(selected().filter((r,) => r.id !== rec.id),);
        } else if (!atMax()) {
            setSelected([...selected(), rec,],);
        }
    };

    const confirmMultiple = () => props.onSelect(selected(),);
    const confirmQuery = () => props.onSelect(buildQuery(),);

    const title = () => {
        const label = typeDef()?.labelPlural || props.entityType;
        if (props.mode === 'query') return `Query ${label}`;
        if (props.mode === 'multiple') return `Select ${label}`;
        return `Select ${typeDef()?.label || props.entityType}`;
    };

    return (
        <ModalShell open onClose={props.onClose} size="lg" ariaLabel={title()}>
            <div class="entity-search-modal">
                <div class="entity-search-modal__header">
                    <h2>{title()}</h2>
                    <button type="button" class="btn btn--small btn--ghost" onClick={props.onClose}>Close</button>
                </div>

                <div class="entity-search-modal__toolbar">
                    <input
                        type="search"
                        placeholder="Search…"
                        value={search()}
                        onInput={(e,) => onSearchInput(e.currentTarget.value,)}
                    />
                    <Show when={props.mode === 'query'}>
                        <label class="form-help-muted">
                            Limit
                            <input
                                type="number"
                                min="1"
                                style={{ width: '80px', 'margin-left': '6px', }}
                                value={limit()}
                                onInput={(e,) => setLimit(Math.max(1, Number(e.currentTarget.value,) || 1,),)}
                            />
                        </label>
                    </Show>
                </div>

                <Show when={props.mode === 'query'}>
                    <div class="entity-search-modal__query">
                        <select value={filterField()} onChange={(e,) => setFilterField(e.currentTarget.value,)}>
                            <option value="">Filter field…</option>
                            <For each={sortableFields()}>
                                {(f,) => <option value={f}>{f}</option>}
                            </For>
                        </select>
                        <select value={filterOp()} onChange={(e,) => setFilterOp(e.currentTarget.value as FilterOp,)}>
                            <For each={FILTER_OPS}>
                                {(op,) => <option value={op}>{op}</option>}
                            </For>
                        </select>
                        <input
                            type="text"
                            placeholder="Value (comma-separated for 'in')"
                            value={filterValue()}
                            onInput={(e,) => setFilterValue(e.currentTarget.value,)}
                        />
                    </div>
                </Show>

                <div class="entity-search-modal__body">
                    <Show when={error()}>
                        <div class="alert alert--error">{error()}</div>
                    </Show>
                    <Show
                        when={!loading()}
                        fallback={<div class="empty-state empty-state--plain">Loading…</div>}
                    >
                        <Show
                            when={items().length}
                            fallback={<div class="empty-state empty-state--plain">No records found.</div>}
                        >
                            <table class="admin-table">
                                <thead>
                                    <tr>
                                        <Show when={props.mode === 'multiple'}>
                                            <th style={{ width: '40px', }} />
                                        </Show>
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
                                        <Show when={props.mode !== 'query'}>
                                            <th style={{ width: '90px', }} />
                                        </Show>
                                    </tr>
                                </thead>
                                <tbody>
                                    <For each={items()}>
                                        {(rec,) => (
                                            <tr class={isSelected(rec,) ? 'is-selected' : ''}>
                                                <Show when={props.mode === 'multiple'}>
                                                    <td onClick={(e,) => e.stopPropagation()}>
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected(rec,)}
                                                            disabled={!isSelected(rec,) && atMax()}
                                                            onChange={() => toggleSelect(rec,)}
                                                        />
                                                    </td>
                                                </Show>
                                                <For each={columns()}>
                                                    {(col,) => <td>{cell(rec[col.key],)}</td>}
                                                </For>
                                                <Show when={props.mode === 'single'}>
                                                    <td>
                                                        <button
                                                            type="button"
                                                            class="btn btn--small btn--primary"
                                                            onClick={() => props.onSelect(rec,)}
                                                        >
                                                            Select
                                                        </button>
                                                    </td>
                                                </Show>
                                                <Show when={props.mode === 'multiple'}>
                                                    <td>
                                                        <button
                                                            type="button"
                                                            class="btn btn--small btn--ghost"
                                                            disabled={!isSelected(rec,) && atMax()}
                                                            onClick={() => toggleSelect(rec,)}
                                                        >
                                                            {isSelected(rec,) ? 'Remove' : 'Add'}
                                                        </button>
                                                    </td>
                                                </Show>
                                            </tr>
                                        )}
                                    </For>
                                </tbody>
                            </table>
                        </Show>
                    </Show>
                </div>

                <div class="entity-search-modal__footer">
                    <span class="entity-search-modal__selected-count">
                        <Show when={props.mode === 'multiple'} fallback={`${total()} record(s)`}>
                            {selected().length} selected{props.max ? ` / ${props.max}` : ''}
                        </Show>
                    </span>
                    <div style={{ display: 'flex', gap: '8px', 'align-items': 'center', }}>
                        <div style={{ display: 'flex', gap: '4px', }}>
                            <button
                                type="button"
                                class="btn btn--small btn--ghost"
                                disabled={page() <= 1}
                                onClick={() => setPage(page() - 1,)}
                            >
                                ‹
                            </button>
                            <span class="form-help-muted" style={{ padding: '0 6px', }}>
                                {page()} / {totalPages()}
                            </span>
                            <button
                                type="button"
                                class="btn btn--small btn--ghost"
                                disabled={page() >= totalPages()}
                                onClick={() => setPage(page() + 1,)}
                            >
                                ›
                            </button>
                        </div>
                        <Show when={props.mode === 'multiple'}>
                            <button
                                type="button"
                                class="btn btn--primary btn--small"
                                disabled={selected().length === 0}
                                onClick={confirmMultiple}
                            >
                                Use selection
                            </button>
                        </Show>
                        <Show when={props.mode === 'query'}>
                            <button type="button" class="btn btn--primary btn--small" onClick={confirmQuery}>
                                Use query
                            </button>
                        </Show>
                    </div>
                </div>
            </div>
        </ModalShell>
    );
};

export default EntitySearchSelectModal;
