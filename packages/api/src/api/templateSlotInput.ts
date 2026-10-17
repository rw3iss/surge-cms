/**
 * Request shape for a template's `slots`. Structural only — the service
 * (`contentBlockTemplates.validateSlots`) checks id format/uniqueness, that
 * the entity type is registered, and the slot cap, and normalises the list.
 */
import { MAX_TEMPLATE_SLOTS, type SlotBinding, type TemplateSlot, } from '@sitesurge/types';
import { z, } from 'zod';

const slotBinding = z.union([
    z.object({ mode: z.literal('single',), ref: z.string(), },),
    z.object({ mode: z.literal('list',), refs: z.array(z.string(),).max(200,), },),
    z.object({ mode: z.literal('query',), query: z.record(z.string(), z.unknown(),), },),
],) as unknown as z.ZodType<SlotBinding>;

export const templateSlotsInput = z.array(
    z.object({
        id: z.string().max(40,),
        label: z.string().max(120,).optional(),
        entityType: z.string().max(100,),
        array: z.boolean(),
        previewBinding: slotBinding.optional(),
    },),
).max(MAX_TEMPLATE_SLOTS,) satisfies z.ZodType<TemplateSlot[]>;
