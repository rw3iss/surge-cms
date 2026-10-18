/**
 * Server-side event CARD HTML — shared by the Events block and the
 * `{{event()}}` / `{{events()}}` template functions, in both server renderers:
 *
 *   SSR    `eventCardsSsrHtml`: semantic, indexable markup — an <article> per
 *          event with a linked title, <time>, location, description and the
 *          ticket list. Crawlers care about words and links, not layout.
 *   Email  `eventCardsEmailHtml`: tables + inline styles only. `grid` → N
 *          columns (≤ 3 in a 600px body), `row` → the same wrapped grid
 *          (an inbox has no carousel), `column` → one card per row. The image
 *          carries explicit width/height-free sizing Outlook understands
 *          (`width` attribute + `max-width`), the button is a link to the
 *          event page, and the access badge becomes a small pill above the title.
 *
 * Records arrive already filtered for the audience (anonymous: public-view
 * events only) and fully enriched (`EventRecord`), so this file only formats.
 * Every value is HTML-escaped here; `description` (rendered Markdown, safe) is
 * not used — cards show the plain-text excerpt, cut to `descriptionLength`.
 */
import {
    eventTierAvailabilityLabel, truncateEventText,
    type EventCardDisplay, type EventRecord, type EventsBlockLayout,
} from '@sitesurge/types';
import { escapeHtml, } from '../../utils/html';
import { EMAIL_CONTENT_WIDTH, } from '../mail/blocks/_util';

const esc = (v: unknown,): string => escapeHtml(String(v ?? '',),);

export interface EventCardsOptions extends EventCardDisplay {
    layout?: EventsBlockLayout;
    /** Grid columns (row: cards per page). */
    columns?: number;
    heading?: string;
    /** Shown when there is no event; empty = render nothing. */
    emptyText?: string;
}

/** "$25.00" (USD) / "25.00 EUR"; whole numbers keep their cents. */
export function formatEventPrice(priceCents: number, currency = 'USD',): string {
    const amount = (priceCents / 100).toFixed(2,);
    return currency.toUpperCase() === 'USD' ? `$${amount}` : `${amount} ${currency.toUpperCase()}`;
}

/** One tier line: "General — $25.00 · 12 left" / "Free". */
function tierLine(t: EventRecord['tiers'][number],): string {
    const price = t.isFree ? 'Free' : formatEventPrice(t.priceCents, t.currency,);
    const left = eventTierAvailabilityLabel(t,);
    return `${t.name} — ${price}${left ? ` · ${left}` : ''}`;
}

/** "Sat, Oct 18, 2026 · 7:00 PM – 9:00 PM EDT" per the date/time toggles. */
function whenLine(e: EventRecord, o: EventCardDisplay,): string {
    return [o.showDate ? e.dateLabel : '', o.showTime ? e.timeLabel : '',].filter(Boolean,).join(' · ',);
}

/** "Sign in to register" under a PUBLIC event whose registration needs an account. */
function signInLine(e: EventRecord,): string {
    return e.isPublic && e.requiresSignIn && e.registrationOpen ? 'Sign in to register' : '';
}

// ─── SSR ───────────────────────────────────────────────────────────────────

function ssrCard(e: EventRecord, o: EventCardDisplay,): string {
    const url = esc(e.url || e.path,);
    const when = whenLine(e, o,);
    const desc = o.showDescription ? truncateEventText(e.descriptionText || e.excerpt, o.descriptionLength,) : '';
    const signIn = signInLine(e,);
    return '<article class="ssr-event-card">'
        + (o.showAccessBadge ? `<p class="ssr-event-card__badge">${esc(e.access?.badgeLabel,)}</p>` : '')
        + (o.showImage && e.featuredImage ? `<a href="${url}"><img src="${esc(e.featuredImage,)}" alt="${esc(e.title,)}" loading="lazy" /></a>` : '')
        + `<h3 class="ssr-event-card__title"><a href="${url}">${esc(e.title,)}</a></h3>`
        + (when ? `<p class="ssr-event-card__when"><time datetime="${esc(e.nextOccurrence,)}">${esc(when,)}</time></p>` : '')
        + (o.showLocation && e.location ? `<p class="ssr-event-card__where">${esc(e.location,)}</p>` : '')
        + (desc ? `<p class="ssr-event-card__desc">${esc(desc,)}</p>` : '')
        + (o.showTickets && e.tiers?.length ? `<ul class="ssr-event-card__tiers">${e.tiers.map((t,) => `<li>${esc(tierLine(t,),)}</li>`).join('',)}</ul>` : '')
        + (signIn ? `<p class="ssr-event-card__signin">${esc(signIn,)}</p>` : '')
        + (o.showButton ? `<p><a class="ssr-event-card__button" href="${url}">${esc(o.buttonLabel || 'View event',)}</a></p>` : '')
        + '</article>';
}

/** Indexable cards for SSR (heading + one article per event). */
export function eventCardsSsrHtml(records: EventRecord[] | null | undefined, o: EventCardsOptions,): string {
    const list = (records ?? []).filter(Boolean,);
    const heading = o.heading ? `<h2>${esc(o.heading,)}</h2>` : '';
    if (!list.length) return o.emptyText ? `<section class="ssr-events">${heading}<p>${esc(o.emptyText,)}</p></section>` : '';
    return `<section class="ssr-events">${heading}${list.map((e,) => ssrCard(e, o,)).join('',)}</section>`;
}

// ─── Email ─────────────────────────────────────────────────────────────────

export interface EventEmailEnv {
    /** Button background + link colour (the site link colour). */
    linkColor?: string;
    textColor?: string;
    /** Card corner radius (the site's border radius). */
    radius?: string;
    /** Width available to the cards, px (default the email body width). */
    width?: number;
}

/** Most cards per row in an inbox (600px). */
export const EVENT_EMAIL_MAX_COLUMNS = 3;
const GAP = 16;

function emailCard(e: EventRecord, o: EventCardDisplay, cellWidth: number, env: Required<Omit<EventEmailEnv, 'width'>>,): string {
    const url = esc(e.url || e.path,);
    const muted = 'color:#6b7280;';
    const when = whenLine(e, o,);
    const desc = o.showDescription ? truncateEventText(e.descriptionText || e.excerpt, o.descriptionLength,) : '';
    const signIn = signInLine(e,);
    const rows: string[] = [];
    if (o.showImage && e.featuredImage) {
        rows.push(`<tr><td style="padding:0;line-height:0;font-size:0"><a href="${url}"><img src="${esc(e.featuredImage,)}" width="${cellWidth}" alt="${esc(e.title,)}" `
            + `style="display:block;width:100%;max-width:${cellWidth}px;height:auto;border:0;border-radius:${esc(env.radius,)} ${esc(env.radius,)} 0 0" /></a></td></tr>`,);
    }
    const body: string[] = [];
    if (o.showAccessBadge && e.access?.badgeLabel) {
        body.push(`<p style="margin:0 0 8px"><span style="display:inline-block;padding:2px 8px;border:1px solid #d1d5db;border-radius:999px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;${muted}">${esc(e.access.badgeLabel,)}</span></p>`,);
    }
    body.push(`<p style="margin:0 0 6px;font-size:18px;line-height:1.3;font-weight:700"><a href="${url}" style="color:${esc(env.textColor,)};text-decoration:none">${esc(e.title,)}</a></p>`,);
    if (when) body.push(`<p style="margin:0 0 4px;font-size:14px;${muted}">${esc(when,)}</p>`,);
    if (o.showLocation && e.location) body.push(`<p style="margin:0 0 4px;font-size:14px;${muted}">${esc(e.location,)}</p>`,);
    if (desc) body.push(`<p style="margin:8px 0 0;font-size:14px;line-height:1.5">${esc(desc,)}</p>`,);
    if (o.showTickets && e.tiers?.length) {
        body.push(`<p style="margin:8px 0 0;font-size:13px;line-height:1.6">${e.tiers.map((t,) => esc(tierLine(t,),)).join('<br>',)}</p>`,);
    }
    if (signIn) body.push(`<p style="margin:8px 0 0;font-size:13px;${muted}">${esc(signIn,)}</p>`,);
    if (o.showButton) {
        body.push(`<p style="margin:12px 0 0"><a href="${url}" style="display:inline-block;padding:10px 18px;background:${esc(env.linkColor,)};color:#ffffff;`
            + `text-decoration:none;border-radius:${esc(env.radius,)};font-size:14px;font-weight:600">${esc(o.buttonLabel || 'View event',)}</a></p>`,);
    }
    rows.push(`<tr><td style="padding:16px">${body.join('',)}</td></tr>`,);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:${esc(env.radius,)};border-collapse:separate">${rows.join('',)}</table>`;
}

/** Email-safe cards (tables only). */
export function eventCardsEmailHtml(records: EventRecord[] | null | undefined, o: EventCardsOptions, envIn: EventEmailEnv = {},): string {
    const list = (records ?? []).filter(Boolean,);
    const env = {
        linkColor: envIn.linkColor || '#1d4ed8',
        textColor: envIn.textColor || '#111827',
        radius: envIn.radius || '8px',
    };
    const heading = o.heading ? `<p style="margin:0 0 12px;font-size:20px;font-weight:700">${esc(o.heading,)}</p>` : '';
    if (!list.length) return o.emptyText ? `${heading}<p style="margin:0">${esc(o.emptyText,)}</p>` : '';
    const width = Math.max(200, Math.round(envIn.width ?? EMAIL_CONTENT_WIDTH,),);
    const cols = o.layout === 'column' ? 1 : Math.max(1, Math.min(EVENT_EMAIL_MAX_COLUMNS, Math.round(o.columns ?? 3,), list.length,),);
    const cellWidth = Math.floor((width - GAP * (cols - 1)) / cols,);
    const rows: string[] = [];
    for (let i = 0; i < list.length; i += cols) {
        const chunk = list.slice(i, i + cols,);
        const cells = chunk.map((e, j,) => `<td width="${cellWidth}" valign="top" style="width:${cellWidth}px;padding:0 ${j < cols - 1 ? GAP : 0}px 0 0">${emailCard(e, o, cellWidth, env,)}</td>`,);
        // Pad a short last row so its cards keep the column width.
        for (let k = chunk.length; k < cols; k++) cells.push(`<td width="${cellWidth}" style="width:${cellWidth}px"></td>`,);
        rows.push(`<tr>${cells.join('',)}</tr>`,);
        if (i + cols < list.length) rows.push(`<tr><td colspan="${cols}" style="height:${GAP}px;line-height:${GAP}px;font-size:0">&nbsp;</td></tr>`,);
    }
    return `${heading}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('',)}</table>`;
}
