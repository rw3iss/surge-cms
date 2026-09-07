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
import { createStore, produce, } from 'solid-js/store';
import { cms, } from '../../../services/cmsClient';
import ModalShell from '../common/ModalShell';
import SortTh from '../common/SortTh';
import EntityValueInput from './EntityValueInput';
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

/** One property/operator/value criterion. Several combine with AND. */
interface FilterClause {
    field: string;
    op: FilterOp;
    value: string;
}

const blankClause = (): FilterClause => ({ field: '', op: 'eq', value: '', });
/** The wire value stays the short token the API expects; only the LABEL is
 *  spelled out, because "ne" and "lte" are not words. */
const FILTER_OPS: { op: FilterOp; label: string; short: string; }[] = [
    // `short` is what the (now narrow) dropdown shows — the row has to fit a
    // property, an operator, a value and two buttons. `label` is kept for
    // anywhere that has room to spell it out.
    { op: 'eq', label: '== equals', short: '== equals', },
    { op: 'ne', label: '!= does not equal', short: '≠ not', },
    { op: 'gt', label: '> greater than', short: '> more than', },
    { op: 'gte', label: '>= greater than or equal to', short: '≥ at least', },
    { op: 'lt', label: '< less than', short: '< less than', },
    { op: 'lte', label: '<= less than or equal to', short: '≤ at most', },
    { op: 'like', label: '~ contains', short: '~ contains', },
    { op: 'in', label: 'in — is any of (comma-separated)', short: 'is any of', },
];

const PAGE_LIMIT = 10;

/** Render an arbitrary field value as a short string for a table cell. Rich-text
 *  fields (e.g. a product description) are stripped of HTML for the preview. */
function cell(value: unknown,): string {
    if (value == null) return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') return Array.isArray(value,) ? `[${value.length}]` : '{…}';
    let s = String(value,);
    if (/<[a-z][\s\S]*>/i.test(s,)) s = s.replace(/<[^>]+>/g, ' ',).replace(/\s+/g, ' ',).trim();
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

    /**
     * The filter clauses, as a LIST.
     *
     * Was a single field/op/value triple plus a separate row of per-field
     * dropdowns above it — two ways to say the same thing, and the dropdown row
     * couldn't express anything but equality. One list of clauses covers both:
     * every filterable field is just another property to pick, and a second
     * criterion is another row rather than a different control.
     *
     * Always at least one row, so the controls are visible without a
     * "add a filter" step for the common single-clause case.
     */
    /**
     * A STORE, not a signal of an array — deliberately.
     *
     * As a signal, editing one clause replaced the whole array with fresh object
     * identities, so `<For>` (which keys by reference) tore down and rebuilt
     * every row. The row holding the caret was one of them, so the value input
     * lost focus on the first keystroke. A store patches the row in place: the
     * array and the untouched rows keep their identity and the DOM survives.
     */
    const [clauses, setClauses,] = createStore<FilterClause[]>([blankClause(),],);

    const patchClause = (i: number, change: Partial<FilterClause>,) =>
        setClauses(i, change,);
    const addClause = () => setClauses(produce((list,) => { list.push(blankClause(),); }),);
    const removeClause = (i: number,) =>
        // Never drop the last row — an empty list would hide the controls
        // entirely and leave no way to add one back.
        setClauses(produce((list,) => {
            if (list.length <= 1) list[0] = blankClause();
            else list.splice(i, 1,);
        }),);

    let searchTimer: ReturnType<typeof setTimeout>;

    /**
     * Commit a clause's value. Called on BLUR (and Enter), not per keystroke —
     * the input keeps its own draft while you type, so nothing above it
     * re-renders mid-word. Refetching here is therefore immediate: by the time
     * it runs, the operator has finished typing.
     */
    const onFilterValueCommit = (i: number, value: string,) => {
        if (clauses[i]?.value === value) return;
        patchClause(i, { value, },);
        setPage(1,);
    };

    /** Column-backed, non-blocks fields, capped for width, PLUS the standard
     *  columns the type carries (status / slug) — which aren't schema fields but
     *  every record has them, so they belong in the picker (visible + sortable,
     *  matching the Data tab). */
    const columns = () => {
        const def = typeDef();
        if (!def) return [] as { key: string; label: string; }[];
        const cols = def.fields
            .filter((f,) => f.type !== 'blocks')
            .slice(0, 4,)
            .map((f,) => ({ key: f.key, label: f.label || f.key, }));
        if (def.hasStatus && !cols.some((c,) => c.key === 'status')) cols.push({ key: 'status', label: 'Status', });
        if (def.hasSlug && !cols.some((c,) => c.key === 'slug')) cols.push({ key: 'slug', label: 'Slug', });
        return cols;
    };

    const sortableFields = () => {
        const def = typeDef();
        if (!def) return [] as string[];
        return def.fields.filter((f,) => f.type !== 'blocks' && f.type !== 'json').map((f,) => f.key);
    };

    /** Fields offered in the "Filter field" dropdown: the standard columns the
     *  type carries (status/slug) first, then its schema fields — so you can
     *  filter e.g. `status = active`. */
    /** Human label for a field key — the schema's own label when it has one,
     *  else the raw key. `is_featured` reads better as "Is featured". */
    const fieldLabel = (key: string,): string => {
        const f = typeDef()?.fields.find((x,) => x.key === key,);
        return f?.label && f.label !== f.key ? f.label : key;
    };

    const filterFields = () => {
        const def = typeDef();
        if (!def) return [] as string[];
        const std: string[] = [];
        if (def.hasStatus) std.push('status',);
        if (def.hasSlug) std.push('slug',);
        return [...std, ...sortableFields().filter((k,) => k !== 'slug' && k !== 'status'),];
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

    /**
     * Fold the complete clauses into one filter object. Applied in EVERY mode:
     * in single/multiple it narrows the pickable records; in query mode it is
     * also what gets saved.
     *
     * Incomplete rows (no field, or an empty value) are skipped rather than
     * treated as an error — a half-typed row shouldn't blank the results while
     * you're still filling it in.
     *
     * NOTE the shape's limit: the filter is keyed BY FIELD, so two clauses on
     * the same field can't both survive — the later one wins. Expressing
     * "price > 10 AND price < 20" needs a filter format that carries a list,
     * which is a backend change; the UI is honest about it by letting you see
     * both rows rather than silently dropping one.
     */
    const buildFilter = (): Record<string, EntityFilterValue> | undefined => {
        const coerce = (v: string,): unknown => {
            const t = v.trim();
            if (t === 'true') return true;
            if (t === 'false') return false;
            return /^-?\d+(\.\d+)?$/.test(t,) ? Number(t,) : t;
        };
        const merged: Record<string, EntityFilterValue> = {};
        for (const c of clauses) {
            if (!c.field || c.value === '') continue;
            merged[c.field] = {
                op: c.op,
                value: c.op === 'in' ? c.value.split(',',).map(coerce,) : coerce(c.value,),
            };
        }
        return Object.keys(merged,).length ? merged : undefined;
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
        // Serialising the filter registers a dependency on every clause field,
        // so committing any field/op/value refetches — and an edit that doesn't
        // change the resulting filter (a half-typed row) doesn't.
        JSON.stringify(buildFilter() ?? null,);
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
                    <button type="button" class="ui-button ui-button--sm ui-button--ghost" onClick={props.onClose}>Close</button>
                </div>

                <div class="entity-search-modal__toolbar">
                    <input
                        type="search"
                        placeholder="Search…"
                        value={search()}
                        onInput={(e,) => onSearchInput(e.currentTarget.value,)}
                    />
                    <Show when={props.mode === 'query'}>
                        <label class="entity-search-modal__limit">
                            Limit
                            <input
                                type="number"
                                min="1"
                                value={limit()}
                                onInput={(e,) => setLimit(Math.max(1, Number(e.currentTarget.value,) || 1,),)}
                            />
                        </label>
                    </Show>
                </div>

                {/* Filter criteria: one property / operator / value row each,
                    combining with AND. Every filterable field is just another
                    property here — there is no separate row of per-field
                    dropdowns, which could only ever express equality. */}
                <Show when={filterFields().length > 0}>
                    <div class="entity-search-modal__clauses">
                        <For each={clauses}>
                            {(c, i,) => (
                                <div class="entity-search-modal__query">
                                    <select
                                        value={c.field}
                                        onChange={(e,) => {
                                            // Changing the property invalidates the
                                            // value: it was picked from a different
                                            // field's suggestions.
                                            patchClause(i(), { field: e.currentTarget.value, value: '', },);
                                            setPage(1,);
                                        }}
                                    >
                                        <option value="">Property…</option>
                                        <For each={filterFields()}>
                                            {(f,) => <option value={f}>{fieldLabel(f,)}</option>}
                                        </For>
                                    </select>
                                    <select
                                        class="entity-search-modal__op"
                                        value={c.op}
                                        onChange={(e,) => {
                                            patchClause(i(), { op: e.currentTarget.value as FilterOp, },);
                                            setPage(1,);
                                        }}
                                    >
                                        <For each={FILTER_OPS}>
                                            {(o,) => <option value={o.op}>{o.short}</option>}
                                        </For>
                                    </select>
                                    <EntityValueInput
                                        typeKey={props.entityType}
                                        field={c.field}
                                        value={c.value}
                                        onCommit={(v,) => onFilterValueCommit(i(), v,)}
                                        placeholder="Value (comma-separated for 'is any of')"
                                    />
                                    <Show when={clauses.length > 1}>
                                        <button
                                            type="button"
                                            class="entity-search-modal__clause-remove"
                                            aria-label="Remove this criterion"
                                            title="Remove"
                                            onClick={() => { removeClause(i(),); setPage(1,); }}
                                        >
                                            ×
                                        </button>
                                    </Show>
                                    <Show when={i() === clauses.length - 1}>
                                        <button
                                            type="button"
                                            class="ui-button ui-button--sm ui-button--secondary"
                                            onClick={addClause}
                                        >
                                            + Add another
                                        </button>
                                    </Show>
                                </div>
                            )}
                        </For>
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
                                                            class="ui-button ui-button--sm ui-button--primary"
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
                                                            class="ui-button ui-button--sm ui-button--ghost"
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
                                class="ui-button ui-button--sm ui-button--ghost"
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
                                class="ui-button ui-button--sm ui-button--ghost"
                                disabled={page() >= totalPages()}
                                onClick={() => setPage(page() + 1,)}
                            >
                                ›
                            </button>
                        </div>
                        <Show when={props.mode === 'multiple'}>
                            <button
                                type="button"
                                class="ui-button ui-button--primary ui-button--sm"
                                disabled={selected().length === 0}
                                onClick={confirmMultiple}
                            >
                                Use selection
                            </button>
                        </Show>
                        <Show when={props.mode === 'query'}>
                            <button type="button" class="ui-button ui-button--primary ui-button--sm" onClick={confirmQuery}>
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
