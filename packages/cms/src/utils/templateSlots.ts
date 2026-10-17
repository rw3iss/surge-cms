/**
 * Pure helpers for template slots (admin UI): id validation and labels. The
 * one-line binding summary lives in `utils/dataBinding.ts`.
 */
import { TEMPLATE_SLOT_ID_PATTERN, type TemplateSlot, } from '@sitesurge/types';

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

/** The slots of the given type, each flagged compatible or not (for selects
 *  that list every slot but only allow the right type). */
export function slotChoices(
    slots: TemplateSlot[],
    entityType: string,
): Array<{ slot: TemplateSlot; compatible: boolean; }> {
    return slots.map((slot,) => ({ slot, compatible: slot.entityType === entityType, }));
}

/** What a block panel shows for its "Template data" source (Gallery today;
 *  Posts with `post` later). `info` = the open template (`stores/templateSlots`
 *  `templateInfo`), null outside the template editor. */
export interface TemplateDataSourceState {
    /** List the "Template data" option. */
    offer: boolean;
    /** The option is usable (the template binds `expectedType`). */
    compatible: boolean;
    /** Under the select when the block reads template data it cannot use. */
    warning: string | null;
    /** Under the select when a list template repeats per record. */
    eachHint: string | null;
}

export function templateDataSourceState(
    info: { entityType: string | null; mode: 'single' | 'list'; listRender?: 'each' | 'once'; } | null | undefined,
    expectedType: string,
    blockKey: string,
    usingTemplateSource: boolean,
): TemplateDataSourceState {
    const compatible = !!info?.entityType && info.entityType === expectedType;
    const offer = compatible || usingTemplateSource;
    const warning = usingTemplateSource && !compatible ? `Warning: '${blockKey}' expects '${expectedType}' template data.` : null;
    const eachHint = usingTemplateSource && compatible && info?.mode === 'list' && info.listRender !== 'once'
        ? `This template repeats per record, so the ${blockKey} gets ONE item each time — set Render to 'Once, with all records' to show them all together.`
        : null;
    return { offer, compatible, warning, eachHint, };
}
