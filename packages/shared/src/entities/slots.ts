/**
 * Template slots — pure helpers shared by the web renderer, the admin preview
 * and the server (email, validation). ONE rule for every surface:
 *
 *   slot-reading block (Gallery `source:'slot'`, Posts `source:'slot'`)
 *     → `slotFor(ctx, slotId, expectedType)` → the slot + its binding
 *     → the same resolver the entity block uses for its own binding
 *     → records.
 */
import type { SlotBinding, } from './entityBlock';
import type { TemplateDataContext, } from './templateData';
import { MAX_TEMPLATE_SLOTS, TEMPLATE_SLOT_ID_PATTERN, type TemplateSlot, } from './templates';

/** Slot data handed down while a template renders. */
export interface TemplateSlotContext {
    /** The template's slot definitions. */
    slots?: TemplateSlot[];
    /** The using block's bindings (`EntityBlockSettings.slots`). */
    bindings?: Record<string, SlotBinding>;
    /** The record(s) the template is rendering right now (see `templateData.ts`). */
    templateData?: TemplateDataContext | null;
}

/** Records shown for an auto (no preview binding) slot in the template editor. */
export const SLOT_AUTO_PREVIEW_ARRAY = 6;

export type SlotLookup =
    | { ok: true; slot: TemplateSlot; binding: SlotBinding; }
    | { ok: false; reason: 'missing' | 'unfilled' | 'incompatible'; slot?: TemplateSlot; };

/** Clamp a binding to what the slot accepts: a non-array slot takes ≤ 1 record. */
export function capSlotBinding(binding: SlotBinding, array: boolean,): SlotBinding {
    if (array) return binding;
    if (binding.mode === 'list') return { mode: 'list', refs: binding.refs.slice(0, 1,), };
    if (binding.mode === 'query') return { mode: 'query', query: { ...binding.query, limit: 1, page: 1, }, };
    return binding;
}

/** True when a binding names at least one record (or is a query). */
export function isSlotBindingFilled(b: SlotBinding | null | undefined,): b is SlotBinding {
    if (!b || typeof b !== 'object') return false;
    if (b.mode === 'single') return typeof b.ref === 'string' && b.ref.trim() !== '';
    if (b.mode === 'list') return Array.isArray(b.refs,) && b.refs.some(r => typeof r === 'string' && r.trim() !== '');
    if (b.mode === 'query') return !!b.query && typeof b.query === 'object';
    return false;
}

/** The auto preview binding: newest first N records of the slot's type. */
export function autoSlotBinding(slot: TemplateSlot,): SlotBinding {
    return { mode: 'query', query: { limit: slot.array ? SLOT_AUTO_PREVIEW_ARRAY : 1, }, };
}

/**
 * Find slot `slotId` and its (capped) binding. `expectedType` = the entity type
 * the reading block understands (`gallery_item`, `post`).
 */
export function slotFor(ctx: TemplateSlotContext | null | undefined, slotId: string | undefined, expectedType: string,): SlotLookup {
    const slot = slotId ? ctx?.slots?.find(s => s.id === slotId) : undefined;
    if (!slot) return { ok: false, reason: 'missing', };
    if (slot.entityType !== expectedType) return { ok: false, reason: 'incompatible', slot, };
    const binding = ctx?.bindings?.[slot.id];
    if (!isSlotBindingFilled(binding,)) return { ok: false, reason: 'unfilled', slot, };
    return { ok: true, slot, binding: capSlotBinding(binding, slot.array,), };
}

/** Admin-preview text for a slot that cannot render. */
export function slotPlaceholderText(slotId: string | undefined, reason: 'missing' | 'unfilled' | 'incompatible',): string {
    const id = slotId || '(none)';
    if (reason === 'missing') return `Slot \`${id}\` does not exist on this template`;
    if (reason === 'incompatible') return `Slot \`${id}\` holds a different data type`;
    return `Slot \`${id}\` is not filled by the block using this template`;
}

/** Bindings for the template EDITOR preview: each slot's previewBinding, else auto. */
export function previewSlotBindings(slots: TemplateSlot[] | null | undefined,): Record<string, SlotBinding> {
    const out: Record<string, SlotBinding> = {};
    for (const s of slots ?? []) {
        out[s.id] = isSlotBindingFilled(s.previewBinding,) ? s.previewBinding : autoSlotBinding(s,);
    }
    return out;
}

/**
 * Validate + normalise a template's slot list. Returns the cleaned slots or
 * the list of problems. `isEntityType` answers whether a type key is registered.
 */
export function normalizeTemplateSlots(
    input: unknown,
    isEntityType: (key: string,) => boolean,
): { slots: TemplateSlot[]; errors: string[]; } {
    const errors: string[] = [];
    const slots: TemplateSlot[] = [];
    if (input == null) return { slots, errors, };
    if (!Array.isArray(input,)) return { slots, errors: ['slots must be an array',], };
    if (input.length > MAX_TEMPLATE_SLOTS) errors.push(`a template may declare at most ${MAX_TEMPLATE_SLOTS} slots`,);
    const seen = new Set<string>();
    input.forEach((raw, i,) => {
        const r = (raw ?? {}) as Record<string, unknown>;
        const id = typeof r.id === 'string' ? r.id.trim() : '';
        const where = `slot ${i + 1}${id ? ` (${id})` : ''}`;
        if (!TEMPLATE_SLOT_ID_PATTERN.test(id,)) {
            errors.push(`${where}: id must start with a letter and use only letters, digits and _ (max 40)`,);
            return;
        }
        const key = id.toLowerCase();
        if (seen.has(key,)) {
            errors.push(`${where}: duplicate id`,);
            return;
        }
        seen.add(key,);
        const entityType = typeof r.entityType === 'string' ? r.entityType.trim() : '';
        if (!entityType || !isEntityType(entityType,)) {
            errors.push(`${where}: unknown entity type "${entityType}"`,);
            return;
        }
        const slot: TemplateSlot = { id, entityType, array: r.array === true, };
        if (typeof r.label === 'string' && r.label.trim()) slot.label = r.label.trim().slice(0, 120,);
        const pb = r.previewBinding as SlotBinding | undefined;
        if (pb != null) {
            if (!isSlotBindingFilled(pb,)) errors.push(`${where}: previewBinding is not a valid binding`,);
            else slot.previewBinding = capSlotBinding(pb, slot.array,);
        }
        slots.push(slot,);
    },);
    return { slots, errors, };
}
