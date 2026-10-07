/**
 * The export model shared by every source (donations, subscribers, users, any
 * entity type) and every format (CSV download, printable HTML page).
 *
 * A SOURCE never paginates for the export itself — it hands over a page
 * fetcher that calls the SAME list function the admin table uses, with the
 * same search/filter/sort, and `collectAll` walks every page. So an export is
 * by construction exactly what the table shows, just without the page limit.
 *
 * Columns are DERIVED FROM THE DATA (`deriveColumns`): every key that appears
 * in any row, in a preferred order first (the entity schema, or a source's
 * natural order). Nothing is hard-coded per entity, so a field added to an
 * entity type tomorrow appears in its export with no code change.
 */

export type Row = Record<string, unknown>;

export interface ExportColumn {
    key: string;
    label: string;
}

export interface ExportDataset {
    /** File name stem / page heading, e.g. "Winter Drive — donations". */
    title: string;
    /** One line under the heading: the active search/filter/sort. */
    subtitle?: string;
    /** Every column (CSV). */
    columns: ExportColumn[];
    /** The basic "who is this" columns for the printable page (keys that
     *  exist in `columns`); all columns when absent or `?columns=all`. */
    printColumns?: string[];
    rows: Row[];
}

/** Hard ceiling, so a mistaken export cannot pull an unbounded table into
 *  memory. Far above any table this CMS serves today. */
export const MAX_EXPORT_ROWS = 100_000;

/** Walk every page of a list function. */
export async function collectAll(
    fetchPage: (page: number, limit: number,) => Promise<{ rows: Row[]; total: number; }>,
    pageSize = 500,
): Promise<Row[]> {
    const out: Row[] = [];
    for (let page = 1; ; page += 1) {
        const { rows, total, } = await fetchPage(page, pageSize,);
        out.push(...rows,);
        if (rows.length < pageSize || out.length >= total || out.length >= MAX_EXPORT_ROWS) break;
    }
    return out.slice(0, MAX_EXPORT_ROWS,);
}

/** "firstName" / "first_name" → "First Name". */
export function humanize(key: string,): string {
    return key
        .replace(/_/g, ' ',)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2',)
        .replace(/\s+/g, ' ',)
        .trim()
        .replace(/\b\w/g, (c,) => c.toUpperCase(),)
        .replace(/\bId\b/g, 'ID',);
}

/**
 * Every key present in any row, `preferred` order first (those that occur),
 * then the rest in first-seen order. `labels` overrides a key's heading;
 * `omit` drops keys that must never leave the server (hashes, tokens).
 */
export function deriveColumns(
    rows: Row[],
    opts: { preferred?: string[]; labels?: Record<string, string>; omit?: string[]; } = {},
): ExportColumn[] {
    const omit = new Set(opts.omit ?? [],);
    const seen: string[] = [];
    const has = new Set<string>();
    for (const r of rows) {
        for (const k of Object.keys(r,)) {
            if (!has.has(k,) && !omit.has(k,)) {
                has.add(k,);
                seen.push(k,);
            }
        }
    }
    const keys = [...(opts.preferred ?? []).filter((k,) => has.has(k,)), ...seen.filter((k,) => !(opts.preferred ?? []).includes(k,)),];
    return keys.map((key,) => ({ key, label: opts.labels?.[key] ?? humanize(key,), }));
}

/** One cell as text: dates ISO, arrays/objects JSON, null/undefined empty. */
export function cellText(v: unknown,): string {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') return JSON.stringify(v,);
    return String(v,);
}
