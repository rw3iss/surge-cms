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
 */
import { createSignal, } from 'solid-js';
import type { TplEntities, } from '../services/entityBinding';

const [templatePreviewContext, setTemplatePreviewContext,] = createSignal<TplEntities | undefined>(undefined,);

export { setTemplatePreviewContext, templatePreviewContext, };
