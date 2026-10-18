/**
 * Email renderer for the `events` block (and the legacy `event` name).
 *
 * Records are resolved ahead of time by `expandDynamicBlocks` (the emitter is
 * synchronous) as the anonymous reader — public-view events only — and read
 * from `settings[EVENTS_RESOLVED_KEY]`. Layouts map onto what email can do:
 * `grid` → N columns (≤ 3), `row` → the same wrapped grid (no carousel in an
 * inbox), `column` → one card per row. Table markup + inline styles only.
 */
import { normalizeEventsBlockSettings, } from '@sitesurge/types';
import { eventCardsEmailHtml, } from '../../events/render';
import { resolvedEventsOf, } from '../../events/serverRender';
import { galleryEmailWidth, } from './gallery';
import type { BlockEmailRenderer, } from './index';

export const renderEvent: BlockEmailRenderer = (node, ctx,) => {
    const s = normalizeEventsBlockSettings(node.settings,);
    return eventCardsEmailHtml(resolvedEventsOf(node.settings,), {
        ...s,
        columns: s.layout === 'row' ? s.itemsPerPage : s.columns,
    }, {
        linkColor: ctx.linkColor,
        textColor: ctx.textColor,
        radius: ctx.siteRadius,
        width: galleryEmailWidth(node, ctx,),
    },);
};
