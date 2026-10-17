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
 * It also carries the TEMPLATE DATA (`templatePreviewData`, the sample).
 * Slot-reading blocks fall back to it when no using block provides bindings
 * (`components/blocks/slotContext.tsx`); empty outside the template editor.
 */
import { previewSlotBindings, type TemplateDataContext, type TemplateSlotContext, } from '@sitesurge/types';
import { createMemo, createRoot, createSignal, } from 'solid-js';
import type { TplEntities, } from '../services/entityBinding';
import { templateSlots, } from './templateSlots';

const [templatePreviewContext, setTemplatePreviewContext,] = createSignal<TplEntities | undefined>(undefined,);
/** The template DATA the editor preview renders with: the preview sample —
 *  every sample record for a list template that renders `once`, else the
 *  first (the editor shows ONE render). Null outside the template editor. */
const [templatePreviewData, setTemplatePreviewData,] = createSignal<TemplateDataContext | null>(null,);

const templatePreviewSlotContext = createRoot(() =>
    createMemo((): TemplateSlotContext | undefined => {
        const slots = templateSlots();
        const data = templatePreviewData();
        if (!slots.length && !data) return undefined;
        return { slots, bindings: previewSlotBindings(slots,), templateData: data, };
    },)
);

export { setTemplatePreviewContext, setTemplatePreviewData, templatePreviewContext, templatePreviewData, templatePreviewSlotContext, };
