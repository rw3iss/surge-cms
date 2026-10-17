/**
 * Server side of template SLOTS (see `@sitesurge/types` `entities/slots.ts`).
 *
 * ONE resolver for a binding → records, used both by the `entity` block's own
 * binding (mail `expandBlocks`) and by every slot-reading block (Gallery,
 * Posts), so a slot resolves exactly like an entity block would.
 */
import {
    slotFor, type EntityQuery, type EntityRecord, type SlotBinding, type TemplateSlotContext,
} from '@sitesurge/types';
import { logger, } from '../utils/logger';
import * as entitiesService from './entities';

/** Default record cap for a server-rendered binding (an inbox can't scroll forever). */
export const MAX_BINDING_RECORDS = 25;

/** Settings key the mail pre-pass stashes a block's enclosing slot context under. */
export const SLOT_CONTEXT_KEY = '__slotContext';

/** Resolve a `single` / `list` / `query` binding of `type` to records (≤ `max`). Never throws. */
export async function resolveBindingRecords(
    type: string,
    binding: SlotBinding,
    max = MAX_BINDING_RECORDS,
): Promise<EntityRecord[]> {
    try {
        switch (binding.mode) {
            case 'single': {
                if (!binding.ref) return [];
                const rec = await entitiesService.get(type, binding.ref,).catch(() => null);
                return rec ? [rec,] : [];
            }
            case 'list': {
                const refs = (binding.refs ?? []).filter(Boolean,).slice(0, max,);
                const recs = await Promise.all(refs.map((r,) => entitiesService.get(type, r,).catch(() => null)),);
                return recs.filter((r,): r is EntityRecord => r !== null);
            }
            case 'query': {
                const q: EntityQuery = { ...(binding.query ?? {}), };
                const limit = Math.min(max, Number(q.limit ?? max,) || max,);
                const res = await entitiesService.list(type, { ...q, limit, },);
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
): Promise<EntityRecord[]> {
    const found = slotFor(ctx, slotId, expectedType,);
    if (!found.ok) return [];
    return resolveBindingRecords(found.slot.entityType, found.binding, found.slot.array ? max : 1,);
}

/** Record ids, in order. */
export function recordIds(records: EntityRecord[],): string[] {
    return records.map((r,) => String((r as { id?: unknown; }).id ?? '',)).filter(Boolean,);
}
