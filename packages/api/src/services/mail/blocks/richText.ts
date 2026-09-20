import { BlockEmailRenderer, } from './index';
import { sanitize, } from '../../../utils/sanitize';
import { applyTypographyInline, } from '@sitesurge/types';

export const renderRichText: BlockEmailRenderer = (node, ctx,) => {
    const raw = String(node.settings.content ?? node.settings.html ?? '',);
    const clean = sanitize(raw,);

    /*
     * Email has no usable stylesheet, so the site's heading/paragraph rhythm
     * has to be INLINED onto each tag or the same block reads differently in
     * an inbox than it does on the page.
     *
     * `applyTypographyInline` only fills in what an element does not already
     * declare — these are defaults, and an author who styled one heading keeps
     * it. Content carrying pasted styles (Google Docs writes
     * `line-height:1.38;margin-top:12pt`) therefore keeps them too; the cure
     * for that is the editor's paste cleanup, not a fight at render time.
     */
    const typography = ctx.typography;
    const content = applyTypographyInline(clean, typography,);

    // The wrapping <td> applies padding + alignment + color from
    // block.style; we just emit the inner HTML here.
    return { content, cellStyle: { 'line-height': typography.paragraphLineHeight, }, };
};
