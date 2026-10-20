/**
 * `{{ template(...) }}` / `{{ component(...) }}` on the SERVER (SSR + email).
 *
 * The call is parsed by the shared `templateCallFor`, the template found by id
 * or name (`findForRender`), and rendered by wrapping it as a synthetic block —
 * an `entity` block carrying the passed record(s) (`__records`) or a `template`
 * block carrying the props + slot DATA (`__slotValues`) — and running it
 * through the SAME expansion + block renderers the surface already uses
 * (`render` callback). The ref returned carries the finished HTML; the
 * runtime's `onEntity` just prints it.
 *
 * Never throws: a bad call / missing template returns a ref with `error` and no
 * HTML. Nesting is bounded by an async-local depth (a component that renders
 * itself through its own text stops at MAX_TEMPLATE_DEPTH).
 */
import { AsyncLocalStorage, } from 'node:async_hooks';
import {
    COMPONENT_KIND, componentArgsFor, entityRef, MAX_TEMPLATE_DEPTH, TEMPLATE_KIND, templateCallError, templateCallFor,
    templateRecordFor, type EntityRef,
} from '@sitesurge/types';
import type { FlatMailBlock, } from '../mail/expandBlocks';
import { logger, } from '../../utils/logger';

const depth = new AsyncLocalStorage<number>();

/** Settings keys the synthetic blocks carry their data under (read by expandBlocks). */
export const INLINE_RECORDS_KEY = '__records';
export const INLINE_SLOT_VALUES_KEY = '__slotValues';

/** Render one synthetic block (with its expanded subtree) to the surface's HTML. */
export type InlineBlockRenderer = (block: FlatMailBlock,) => Promise<string>;

export async function resolveInlineTemplate(
    name: 'template' | 'component',
    args: unknown[],
    named: Record<string, unknown> | undefined,
    render: InlineBlockRenderer,
): Promise<EntityRef> {
    const call = templateCallFor(name, args, named,);
    const fail = (reason: string,) => entityRef(call.kind, { error: templateCallError(call, reason,), },);
    if (!call.ref) return fail('give the template name or id as the first argument',);
    const level = depth.getStore() ?? 0;
    if (level >= MAX_TEMPLATE_DEPTH) return fail('nested too deep (does it render itself?)',);
    try {
        const { findForRender, } = await import('../contentBlockTemplates.js');
        const found = await findForRender(call.ref, call.kind === COMPONENT_KIND ? 'component' : 'template', call.entityType,);
        if ('error' in found) return fail(found.error,);
        const t = found.template;
        let block: FlatMailBlock;
        if (call.kind === COMPONENT_KIND) {
            const { values, props, } = componentArgsFor((t.slots ?? []).map((s,) => ({ id: s.id, array: s.array === true, })), call.named,);
            block = {
                id: `inline-c-${t.id}`, parentBlockId: null, blockType: 'template', position: 0, style: {},
                settings: { templateId: t.id, props, [INLINE_SLOT_VALUES_KEY]: values, },
            };
        } else {
            const { records, } = templateRecordFor(call, t,);
            if (!records.length) return fail('no record passed — e.g. template(\'Name\', item)',);
            block = {
                id: `inline-t-${t.id}`, parentBlockId: null, blockType: 'entity', position: 0, style: {},
                settings: { entity: { entityType: t.entityTypeKey, templateId: t.id, binding: { mode: 'none', }, [INLINE_RECORDS_KEY]: records, }, },
            };
        }
        const html = await depth.run(level + 1, () => render(block,),);
        return entityRef(call.kind, { templateId: t.id, templateName: t.name, html, }, t.id,);
    } catch (e) {
        logger.warn('template(): inline render failed', { ref: call.ref, error: (e as Error).message, },);
        return fail('could not be rendered',);
    }
}

/** The HTML an inline-template ref prints (empty on error). */
export function inlineTemplateHtml(kind: string, data: Record<string, unknown> | null,): string | null {
    if (kind !== TEMPLATE_KIND && kind !== COMPONENT_KIND) return null;
    return typeof data?.html === 'string' ? data.html : '';
}
