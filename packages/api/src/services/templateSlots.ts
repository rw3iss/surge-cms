/**
 * Reads go through the entities service WITHOUT `admin`, so they follow the
 * public read rules (entities/publicRead.ts): no draft/archived records, and
 * posts pass the subscription gate as an anonymous reader. An email is public
 * — a newsletter bound to "newest 5 posts" must never send a draft.
 *
 * Server side of template SLOTS (see `@sitesurge/types` `entities/slots.ts`).
 *
 * ONE resolver for a binding → records, used both by the `entity` block's own
 * binding (mail `expandBlocks`) and by every slot-reading block (Gallery,
 * Posts), so a slot resolves exactly like an entity block would.
 */
import {
    bindingQueryLimit, slotFor, type EntityQuery, type EntityRecord, type SlotBinding, type TemplateSlotContext,
} from '@sitesurge/types';
import { logger, } from '../utils/logger';
import * as entitiesService from './entities';
import type { EntityReadOpts, } from './entities';
import { UUID_RE, } from '../utils/uuid';

/** Default record cap for a server-rendered binding (an inbox can't scroll forever). */
export const MAX_BINDING_RECORDS = 25;

/** Settings key the mail pre-pass stashes a block's enclosing slot context under. */
export const SLOT_CONTEXT_KEY = '__slotContext';

/** Resolve a `single` / `list` / `query` binding of `type` to records (≤ `max`). Never throws. */
export async function resolveBindingRecords(
    type: string,
    binding: SlotBinding,
    max = MAX_BINDING_RECORDS,
    /** Read hint for a provider (`audience: 'email'`); never `admin`. */
    readOpts: Pick<EntityReadOpts, 'audience'> = {},
): Promise<EntityRecord[]> {
    try {
        switch (binding.mode) {
            case 'single': {
                if (!binding.ref) return [];
                const rec = await entitiesService.get(type, binding.ref,).catch(() => null);
                return rec ? [rec,] : [];
            }
            case 'list': {
                // Capped BEFORE the fetch, then ONE list read (`id in refs`)
                // instead of one read per record; a ref it did not return (a
                // slug, or a provider-backed type ignoring the id filter) falls
                // back to a single read. Order follows `refs`.
                const refs = (binding.refs ?? []).filter(Boolean,).slice(0, max,);
                if (refs.length === 0) return [];
                const byId = new Map<string, EntityRecord>();
                const uuids = refs.filter((r,) => UUID_RE.test(r,),);
                if (uuids.length > 0) {
                    const res = await entitiesService.list(type, { filter: { id: { op: 'in', value: uuids, }, }, limit: uuids.length, } as EntityQuery, readOpts,)
                        .catch(() => null);
                    for (const r of res?.items ?? []) byId.set(String(r.id,), r,);
                }
                const recs = await Promise.all(refs.map((r,) => byId.get(r,) ?? entitiesService.get(type, r,).catch(() => null)),);
                return recs.filter((r,): r is EntityRecord => r !== null && r !== undefined);
            }
            case 'query': {
                const q: EntityQuery = { ...(binding.query ?? {}), };
                // The shared rule (also the web's): the query's own limit, capped.
                const limit = bindingQueryLimit(max, Number(q.limit,) || undefined,);
                const res = await entitiesService.list(type, { ...q, limit, }, readOpts,);
                return (res.items ?? []).slice(0, limit,);
            }
            default:
                return [];
        }
    } catch (e) {
        logger.warn('Entity binding failed', { type, mode: (binding as { mode?: string; }).mode, error: (e as Error).message, },);
        return [];
    }
}

/**
 * Records for slot `slotId` of the enclosing template, when it holds
 * `expectedType`. Missing / unfilled / incompatible → [] (renders nothing).
 */
export async function resolveSlotRecords(
    ctx: TemplateSlotContext | null | undefined,
    slotId: string | undefined,
    expectedType: string,
    max = MAX_BINDING_RECORDS,
    readOpts: Pick<EntityReadOpts, 'audience'> = {},
): Promise<EntityRecord[]> {
    // Data handed in directly (`{{ component('x', events=list) }}`) wins: no fetch.
    if (ctx?.values && slotId && slotId in ctx.values) {
        const v = ctx.values[slotId];
        return (Array.isArray(v,) ? v : v ? [v,] : []) as EntityRecord[];
    }
    const found = slotFor(ctx, slotId, expectedType,);
    if (!found.ok) return [];
    return resolveBindingRecords(found.slot.entityType, found.binding, found.slot.array ? max : 1, readOpts,);
}

/** Record ids, in order. */
export function recordIds(records: EntityRecord[],): string[] {
    return records.map((r,) => String((r as { id?: unknown; }).id ?? '',)).filter(Boolean,);
}
