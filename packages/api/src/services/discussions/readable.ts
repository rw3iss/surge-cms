/**
 * "Which of these rows may this viewer read?" — ONE helper for every list
 * that shows comments or threads away from their item (discovery, member
 * pages, later lists). Visibility is decided only by the target registry.
 *
 * Distinct `type:id` targets are resolved once each and IN PARALLEL; a target
 * that implements `accessMany` answers all of its ids in one query. Before
 * this, each list awaited `access()` per target one after another — hundreds
 * of serial queries for one signed-in page view with a discovery block.
 */
import { findTarget, type TargetAccess, } from './targets';
import type { Viewer, } from './viewer';

/** `type:id` → access (null = no such item / not visible). */
export async function accessFor(pairs: { type: string; id: string; }[], viewer: Viewer,): Promise<Map<string, TargetAccess | null>> {
    const byType = new Map<string, Set<string>>();
    for (const { type, id, } of pairs) {
        if (!byType.has(type,)) byType.set(type, new Set(),);
        byType.get(type,)!.add(id,);
    }
    const out = new Map<string, TargetAccess | null>();
    await Promise.all([...byType.entries(),].map(async ([type, idSet,],) => {
        const ids = [...idSet,];
        const t = await findTarget(type,).catch(() => null);
        if (!t) {
            for (const id of ids) out.set(`${type}:${id}`, null,);
            return;
        }
        if (t.accessMany) {
            const m = await t.accessMany(ids, viewer,).catch(() => new Map<string, TargetAccess | null>());
            for (const id of ids) out.set(`${type}:${id}`, m.get(id,) ?? null,);
            return;
        }
        const results = await Promise.all(ids.map((id,) => t.access(id, viewer,).catch(() => null)),);
        ids.forEach((id, i,) => out.set(`${type}:${id}`, results[i],),);
    },),);
    return out;
}

/** Keep the rows whose target the viewer may read (order preserved). */
export async function filterReadable<T,>(
    rows: T[],
    viewer: Viewer,
    targetOf: (row: T,) => { type: string; id: string; },
): Promise<T[]> {
    if (!rows.length) return [];
    const access = await accessFor(rows.map(targetOf,), viewer,);
    return rows.filter((r,) => {
        const { type, id, } = targetOf(r,);
        return Boolean(access.get(`${type}:${id}`,)?.canRead,);
    },);
}
