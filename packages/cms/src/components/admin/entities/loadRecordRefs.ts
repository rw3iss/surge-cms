/**
 * Load the records a binding names, by ref (an id, or a slug for older
 * single bindings). One `id in (…)` list call first, then a per-ref `getOne`
 * for anything that list did not return (slugs, or a type whose provider
 * ignores the id filter) — capped, since this only feeds labels.
 */
import type { EntityRecord, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';

const MAX_SINGLE_FETCHES = 30;

/** ref → record, for every ref that resolved. */
export async function loadRecordRefs(entityType: string, refs: string[],): Promise<Map<string, EntityRecord>> {
    const out = new Map<string, EntityRecord>();
    const wanted = [...new Set(refs.filter(Boolean,),),];
    if (!entityType || !wanted.length) return out;
    const match = (rec: EntityRecord,) => {
        const r = rec as unknown as { id?: unknown; slug?: unknown; };
        for (const ref of wanted) {
            if (String(r.id,) === ref || (r.slug != null && String(r.slug,) === ref)) out.set(ref, rec,);
        }
    };
    try {
        const res = await cms.entities.list(entityType, {
            filter: { id: { op: 'in', value: wanted, }, },
            limit: Math.min(wanted.length, 200,),
            page: 1,
        }, { cache: false, },);
        for (const rec of res.data ?? []) match(rec,);
    } catch {
        /* fall through to per-ref reads */
    }
    const missing = wanted.filter((r,) => !out.has(r,)).slice(0, MAX_SINGLE_FETCHES,);
    await Promise.all(missing.map(async (ref,) => {
        try {
            const rec = await cms.entities.getOne(entityType, ref,);
            if (rec) out.set(ref, rec,);
        } catch {
            /* unavailable — the caller shows the ref */
        }
    }),);
    return out;
}
