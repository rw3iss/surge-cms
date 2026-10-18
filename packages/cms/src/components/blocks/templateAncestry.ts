/**
 * Template ANCESTRY — the template / component ids already being rendered above
 * a block, carried through a Solid context so it survives every container in
 * between (groups, group items, carousel slides, entity templates).
 *
 * A `template` block whose component contains itself, or an `entity` block
 * inside template T bound to T, would otherwise recurse without limit: fetch,
 * render, fetch again — and hang the tab and every admin editor that shows it.
 * Passing ancestry as a prop lost it at the first group, so it lives here.
 */
import { createContext, useContext, } from 'solid-js';

export const TemplateAncestryContext = createContext<readonly string[]>([],);

/** The ids already rendering above this point. */
export function useTemplateAncestry(): readonly string[] {
    return useContext(TemplateAncestryContext,);
}

/** True when rendering `templateId` here would recurse. */
export function isTemplateCycle(ancestry: readonly string[], templateId: string | null | undefined,): boolean {
    return Boolean(templateId,) && ancestry.includes(templateId as string,);
}
