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
