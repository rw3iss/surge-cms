/**
 * Preview-sample entity context for the content-block TEMPLATE editor.
 *
 * When editing a content-block template (`/admin/entities/:type/templates/:id`),
 * the template's blocks use `{{entity.field}}` variables that have no data to
 * resolve against in the editor. The `TemplateEditor` resolves a SAMPLE record
 * (or records) for the bound type and publishes an entity bag here; `BlockPreview`
 * reads it and forwards it to `BlockRenderer` as its `templateContext`, so the
 * admin block previews render with real values while authoring.
 *
 * It's a single global signal (only one template is edited at a time). Every
 * OTHER editor (pages/posts/mail) leaves it `undefined`, so their previews are
 * unaffected. `TemplateEditor` clears it on unmount.
 *
 * SLOTS: `templatePreviewSlotContext()` is the slot data the template editor's
 * preview renders with — the open template's slots (`stores/templateSlots`)
 * bound to each slot's `previewBinding`, else auto (first record / first 6).
 * Slot-reading blocks fall back to it when no using block provides bindings
 * (`components/blocks/slotContext.tsx`); empty outside the template editor.
 */
import { previewSlotBindings, type TemplateSlotContext, } from '@sitesurge/types';
import { createMemo, createRoot, createSignal, } from 'solid-js';
import type { TplEntities, } from '../services/entityBinding';
import { templateSlots, } from './templateSlots';

const [templatePreviewContext, setTemplatePreviewContext,] = createSignal<TplEntities | undefined>(undefined,);

const templatePreviewSlotContext = createRoot(() =>
    createMemo((): TemplateSlotContext | undefined => {
        const slots = templateSlots();
        if (!slots.length) return undefined;
        return { slots, bindings: previewSlotBindings(slots,), };
    },)
);

export { setTemplatePreviewContext, templatePreviewContext, templatePreviewSlotContext, };
