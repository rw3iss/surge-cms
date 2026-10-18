/**
 * SSR emitter for the `events` block (and the legacy `event` name).
 *
 * Emits real, indexable markup — an events block is exactly the sort of content
 * a search engine should see (title, date, location), so rendering it as an
 * empty shell would waste the page's strongest local-relevance signal.
 *
 * The block stores only a binding; its records are resolved for the ANONYMOUS
 * visitor (public-view events only) by the SSR pre-pass
 * (`ssr/expandBlocks.ts` → the mail expansion) and stashed on the settings.
 */
import { normalizeEventsBlockSettings, } from '@sitesurge/types';
import { eventCardsSsrHtml, } from '../../events/render';
import { resolvedEventsOf, } from '../../events/serverRender';
import type { SsrBlockRenderer, } from './index';

export const renderEventBlock: SsrBlockRenderer = (block,) => {
    const s = normalizeEventsBlockSettings(block.settings,);
    return eventCardsSsrHtml(resolvedEventsOf(block.settings,), s,);
};
