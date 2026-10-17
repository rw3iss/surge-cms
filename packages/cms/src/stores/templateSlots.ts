/**
 * Slots of the content-block template currently open in the TEMPLATE editor.
 *
 * Block edit panels rendered inside that editor (Gallery, Posts) read this to
 * offer a "Slot" data source — the only place it makes sense, since a slot is
 * filled by the block that USES the template. Every other editor (pages,
 * posts, mail) leaves it empty, so the option never appears there.
 *
 * One global signal: only one template is edited at a time. `TemplateEditor`
 * publishes its slots on every change and clears them on unmount.
 */
import type { TemplateSlot, } from '@sitesurge/types';
import { createSignal, } from 'solid-js';

const [templateSlots, setTemplateSlots,] = createSignal<TemplateSlot[]>([],);

export { setTemplateSlots, templateSlots, };
