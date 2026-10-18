/**
 * Pure helpers behind the ONE "Set data…" operation (`DataBindingField` +
 * `EntitySearchSelectModal mode="data"`): turn a selection or a live query into
 * a binding, and describe a binding in one line.
 *
 * Rule: ≥ 1 record selected → a specific selection (`list`, or `single` when
 * the caller allows only one); no record selected → the current filters /
 * search / sort / limit as a live `query`.
 */
import type { EntityQuery, EntityRecord, SlotBinding, } from '@sitesurge/types';

/** Best human label for a record, whatever shape the type happens to have. */
export function recordLabel(r: EntityRecord | Record<string, unknown> | null | undefined,): string {
    const rec = (r ?? {}) as Record<string, unknown>;
    for (const k of ['title', 'name', 'label', 'slug',]) {
        const v = rec[k];
        if (typeof v === 'string' && v.trim()) return v;
    }
    return String(rec.id ?? '(untitled)',);
}

const OPS: Record<string, string> = {
    eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', like: 'contains', in: 'is any of',
};

/** One filter clause as `property op value`. */
export function clauseText(field: string, raw: unknown,): string {
    if (raw && typeof raw === 'object' && 'op' in (raw as object)) {
        const { op, value, } = raw as { op: string; value: unknown; };
        const v = Array.isArray(value,) ? value.join(', ',) : String(value,);
        return `${field} ${OPS[op] ?? op} ${v}`;
    }
    return `${field} = ${String(raw,)}`;
}

/** "newest 6 · status = active · search "x"" — a short reading of a saved query. */
export function describeQuery(q: EntityQuery | undefined,): string {
    const sortBy = q?.sortBy;
    const desc = (q?.sortOrder ?? 'desc') === 'desc';
    let head = !sortBy || sortBy === 'createdAt' || sortBy === 'created_at'
        ? (desc ? 'newest' : 'oldest')
        : `${sortBy} ${desc ? '↓' : '↑'}`;
    if (q?.limit) head = `${head} ${q.limit}`;
    const parts = [head,];
    for (const [k, v,] of Object.entries(q?.filter ?? {},)) parts.push(clauseText(k, v,),);
    if (q?.search) parts.push(`search "${q.search}"`,);
    return parts.join(' · ',);
}

/** The record refs a binding names (empty for a query / nothing). */
export function bindingRefs(b: SlotBinding | null | undefined,): string[] {
    if (!b) return [];
    if (b.mode === 'single') return b.ref ? [b.ref,] : [];
    if (b.mode === 'list') return (b.refs ?? []).filter((r,) => typeof r === 'string' && r !== '');
    return [];
}

/** The binding the modal saves. */
export function bindingFromPick(opts: {
    selectedRefs: string[];
    query: EntityQuery;
    allowMultiple: boolean;
    allowQuery: boolean;
},): SlotBinding | null {
    const refs = opts.selectedRefs.filter(Boolean,);
    if (refs.length) {
        return opts.allowMultiple ? { mode: 'list', refs, } : { mode: 'single', ref: refs[0]!, };
    }
    if (!opts.allowQuery) return null;
    return { mode: 'query', query: opts.allowMultiple ? opts.query : { ...opts.query, limit: 1, }, };
}

/** Selecting a record: add/remove it, or replace when only one is allowed. */
export function toggleRef(selected: string[], ref: string, allowMultiple: boolean, max?: number,): string[] {
    if (selected.includes(ref,)) return selected.filter((r,) => r !== ref);
    if (!allowMultiple) return [ref,];
    if (max != null && selected.length >= max) return selected;
    return [...selected, ref,];
}

/** The line under the modal saying which of the two will be saved. */
export function saveLineText(selectedCount: number, query: EntityQuery, allowQuery: boolean,): string {
    if (selectedCount > 0) {
        const n = `${selectedCount} record${selectedCount === 1 ? '' : 's'} selected`;
        return allowQuery ? `${n} — the filters are not used.` : `${n}.`;
    }
    return allowQuery
        ? `No records selected — saving a live query: ${describeQuery(query,)}.`
        : 'Select at least one record.';
}

/**
 * "Not set" / "3 selected: A, B, C…" / "Live: newest 6 · status = active".
 * `names` = labels already loaded for the selection (by ref); missing ones are
 * left out of the list.
 */
export function dataBindingSummary(
    b: SlotBinding | null | undefined,
    names?: Record<string, string>,
    emptyText = 'Not set',
): string {
    if (!b) return emptyText;
    if (b.mode === 'query') return `Live: ${describeQuery(b.query,)}`;
    const refs = bindingRefs(b,);
    if (!refs.length) return emptyText;
    const shown = refs.map((r,) => names?.[r]).filter((x,): x is string => !!x).slice(0, 3,);
    const head = `${refs.length} selected`;
    if (!shown.length) return head;
    return `${head}: ${shown.join(', ',)}${refs.length > shown.length ? '…' : ''}`;
}

/**
 * Order a "Set data…" selection the way the window's list SHOWED it, so what
 * the block renders matches what the operator saw.
 *
 *  - No sort chosen (the default: newest first) → the pick order is kept.
 *  - Otherwise each ref's position under the CURRENT sort, as the server
 *    returned it (`serverRank`, id → index across loaded pages), comes first —
 *    a client re-sort can disagree with the server (equal values, server-only
 *    sort keys).
 *  - Refs not on any page loaded under this sort are compared on the sort
 *    field here, empty values last, and sit after the ranked ones.
 */
export function orderSelection(opts: {
    refs: string[];
    sortBy: string;
    sortOrder: 'asc' | 'desc';
    known: Record<string, EntityRecord | undefined>;
    serverRank: ReadonlyMap<string, number>;
},): string[] {
    const { refs, sortBy, sortOrder, known, serverRank, } = opts;
    if (!sortBy && sortOrder === 'desc') return refs;
    const field = sortBy || 'createdAt';
    const dir = sortOrder === 'asc' ? 1 : -1;
    const val = (ref: string,) => (known[ref] as Record<string, unknown> | undefined)?.[field];
    const rankOf = (ref: string,) => {
        const id = (known[ref] as { id?: unknown; } | undefined)?.id;
        return serverRank.get(String(id ?? ref,),);
    };
    return [...refs,].sort((a, b,) => {
        const ra = rankOf(a,), rb = rankOf(b,);
        if (ra !== undefined && rb !== undefined) return ra - rb;
        if (ra !== undefined) return -1;
        if (rb !== undefined) return 1;
        const va = val(a,), vb = val(b,);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va,).localeCompare(String(vb,), undefined, { numeric: true, sensitivity: 'base', },) * dir;
    },);
}

