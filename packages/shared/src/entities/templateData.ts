/**
 * Template DATA — the record(s) a content-block template is rendering right
 * now, handed to the blocks inside it (Gallery `source:'template'`; Posts can
 * follow with type `post`). ONE rule for the web renderer, the admin preview
 * and email:
 *
 *   using entity block → records → `templateRenderGroups` (each | once)
 *     → per render: `templateDataOf(entityType, group)`
 *     → a reading block asks `templateDataFor(ctx, expectedType)`.
 *
 * `each` (default) renders the template once per record, so the data is that
 * ONE record; `once` renders it one time with ALL records. A `none`/`context`
 * binding that resolves to nothing carries an empty stub record (no id) — it
 * counts as no data.
 */
import type { ContentBlockTemplate, TemplateListRender, } from './templates';

/** A record as far as template data cares: anything with an id. */
type AnyRecord = Record<string, unknown>;

export interface TemplateDataContext {
    /** The template's bound entity type. */
    entityType: string;
    /** Records in render order (only those with an id). */
    records: AnyRecord[];
}

export type TemplateDataLookup =
    | { ok: true; entityType: string; records: AnyRecord[]; }
    | { ok: false; reason: 'none' | 'incompatible'; expected: string; actual?: string; };

/** A stored/sent value → a valid `listRender` (anything else = `each`). */
export function templateListRenderOf(raw: unknown,): TemplateListRender {
    return raw === 'once' ? 'once' : 'each';
}

/** True when a template renders ONE time with all its records. */
export function rendersOnce(tpl: Pick<ContentBlockTemplate, 'mode' | 'listRender'> | null | undefined,): boolean {
    return tpl?.mode === 'list' && templateListRenderOf(tpl.listRender,) === 'once';
}

/**
 * Split resolved records into renders: `once` (list template) → one render
 * with every record; otherwise one render per record. No records → no render.
 */
export function templateRenderGroups<T,>(
    records: T[],
    tpl: Pick<ContentBlockTemplate, 'mode' | 'listRender'> | null | undefined,
): T[][] {
    if (records.length === 0) return [];
    return rendersOnce(tpl,) ? [records,] : records.map((r,) => [r,]);
}

function hasId(r: unknown,): r is AnyRecord {
    if (!r || typeof r !== 'object') return false;
    const id = (r as { id?: unknown; }).id;
    return id != null && String(id,) !== '';
}

/** Template data for one render (records without an id are dropped). */
export function templateDataOf(entityType: string | null | undefined, records: unknown[],): TemplateDataContext | null {
    if (!entityType) return null;
    return { entityType, records: records.filter(hasId,), };
}

/** The template data a block that understands `expectedType` may read. */
export function templateDataFor(ctx: TemplateDataContext | null | undefined, expectedType: string,): TemplateDataLookup {
    if (!ctx?.entityType) return { ok: false, reason: 'none', expected: expectedType, };
    if (ctx.entityType !== expectedType) {
        return { ok: false, reason: 'incompatible', expected: expectedType, actual: ctx.entityType, };
    }
    const records = (ctx.records ?? []).filter(hasId,);
    if (!records.length) return { ok: false, reason: 'none', expected: expectedType, actual: ctx.entityType, };
    return { ok: true, entityType: ctx.entityType, records, };
}

/** Record ids in order. */
export function templateDataIds(records: AnyRecord[],): string[] {
    return records.filter(hasId,).map((r,) => String(r.id,));
}

/** Admin-preview text for a block whose template data is unusable. */
export function templateDataPlaceholderText(blockLabel: string, lookup: Extract<TemplateDataLookup, { ok: false; }>,): string {
    const head = `${blockLabel} expects ${lookup.expected} template data`;
    if (lookup.reason === 'incompatible') return `${head} (this template binds ${lookup.actual})`;
    if (lookup.actual) return `${head} (no ${lookup.actual} records are bound here)`;
    return `${head} (this block is not inside an entity template)`;
}
