/**
 * Pure helpers for template slots (admin UI): id validation, labels, and a
 * one-line summary of how a using block fills a slot.
 */
import { type EntityQuery, type SlotBinding, TEMPLATE_SLOT_ID_PATTERN, type TemplateSlot, } from '@sitesurge/types';

/**
 * Why `id` is not a usable slot id, or null when it is. `others` = the ids of
 * the OTHER slots in the template (uniqueness is case-insensitive, since the
 * pattern is).
 */
export function slotIdError(id: string, others: string[],): string | null {
    const v = id.trim();
    if (!v) return 'ID is required.';
    if (!TEMPLATE_SLOT_ID_PATTERN.test(v,)) {
        return 'Start with a letter; use letters, digits and _ only (40 max).';
    }
    const lower = v.toLowerCase();
    if (others.some((o,) => o.trim().toLowerCase() === lower)) return 'Another slot already uses this ID.';
    return null;
}

/** A fresh id not used by any slot: `slot1`, `slot2`, … */
export function nextSlotId(slots: Pick<TemplateSlot, 'id'>[],): string {
    const used = new Set(slots.map((s,) => s.id.toLowerCase()),);
    let n = slots.length + 1;
    while (used.has(`slot${n}`,)) n++;
    return `slot${n}`;
}

/** `post` / `gallery_item[]` — the slot's data type as shown in pickers. */
export function slotTypeLabel(slot: Pick<TemplateSlot, 'entityType' | 'array'>,): string {
    return `${slot.entityType || '?'}${slot.array ? '[]' : ''}`;
}

/** `photos (gallery_item[])` — how a slot is listed in a block's Slot select. */
export function slotOptionLabel(slot: Pick<TemplateSlot, 'id' | 'entityType' | 'array'>,): string {
    return `${slot.id} (${slotTypeLabel(slot,)})`;
}

/** Display name: the label, else the id. */
export function slotDisplayName(slot: Pick<TemplateSlot, 'id' | 'label'>,): string {
    return slot.label?.trim() || slot.id;
}

/** "newest 6", "title A→Z, 3 filters" — a short reading of a saved query. */
export function describeQuery(q: EntityQuery | undefined,): string {
    const parts: string[] = [];
    const sortBy = q?.sortBy;
    const desc = (q?.sortOrder ?? 'desc') === 'desc';
    if (!sortBy || sortBy === 'createdAt' || sortBy === 'created_at') parts.push(desc ? 'newest' : 'oldest',);
    else parts.push(`${sortBy} ${desc ? '↓' : '↑'}`,);
    if (q?.limit) parts[0] = `${parts[0]} ${q.limit}`;
    const filters = Object.keys(q?.filter ?? {},).length;
    if (filters) parts.push(`${filters} filter${filters === 1 ? '' : 's'}`,);
    if (q?.search) parts.push(`search "${q.search}"`,);
    return parts.join(', ',);
}

/** "Not set" / "1 selected" / "3 selected" / "Live query: newest 6". */
export function slotBindingSummary(b: SlotBinding | undefined,): string {
    if (!b) return 'Not set';
    if (b.mode === 'single') return b.ref ? '1 selected' : 'Not set';
    if (b.mode === 'list') return b.refs.length ? `${b.refs.length} selected` : 'Not set';
    return `Live query: ${describeQuery(b.query,)}`;
}

/** The slots of the given type, each flagged compatible or not (for selects
 *  that list every slot but only allow the right type). */
export function slotChoices(
    slots: TemplateSlot[],
    entityType: string,
): Array<{ slot: TemplateSlot; compatible: boolean; }> {
    return slots.map((slot,) => ({ slot, compatible: slot.entityType === entityType, }));
}
