/**
 * The content-block template currently open in the TEMPLATE editor: its slots
 * and its binding (`templateInfo`: entity type, mode, list render).
 *
 * Block edit panels rendered inside that editor (Gallery, Posts) read this to
 * offer a "Slot" data source (a slot is filled by the block that USES the
 * template) and a "Template data" source (the record(s) the template renders —
 * only when the template's entity type is one the block understands). Every
 * other editor (pages, posts, mail) leaves both empty, so neither option
 * appears there.
 *
 * One global signal each: only one template is edited at a time.
 * `TemplateEditor` publishes on every change and clears them on unmount.
 */
import type { TemplateListRender, TemplateSlot, } from '@sitesurge/types';
import { createSignal, } from 'solid-js';

/** The open template's binding. `entityType` null = a global component. */
export interface TemplateEditorInfo {
    entityType: string | null;
    mode: 'single' | 'list';
    listRender: TemplateListRender;
}

const [templateSlots, setTemplateSlots,] = createSignal<TemplateSlot[]>([],);
const [templateInfo, setTemplateInfo,] = createSignal<TemplateEditorInfo | null>(null,);

export { setTemplateInfo, setTemplateSlots, templateInfo, templateSlots, };
