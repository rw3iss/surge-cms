/**
 * SSR emitter for the `event` block.
 *
 * Emits real, indexable markup — an events block is exactly the sort of content
 * a search engine should see (title, date, location), so rendering it as an
 * empty shell would waste the page's strongest local-relevance signal.
 */
import { escapeHtml, } from './_util';
import type { SsrBlockRenderer, } from './index';

interface EventBlockSettings {
    eventId?: string;
    showDescription?: boolean;
    showLocation?: boolean;
    showTicketPrices?: boolean;
    showRegistrantCount?: boolean;
    heading?: string;
}

export const renderEventBlock: SsrBlockRenderer = (block,) => {
    const s = (block.settings ?? {}) as EventBlockSettings;
    // The block stores only a reference; the resolved event is attached to
    // `content` by the renderer when available. With no event bound there is
    // nothing meaningful to index, so emit the heading alone rather than a
    // misleading empty card.
    const heading = s.heading ? `<h2>${escapeHtml(s.heading,)}</h2>` : '';
    const body = block.content ? String(block.content,) : '';
    if (!heading && !body) return '';
    return `<section class="ssr-event-block">${heading}${body}</section>`;
};
