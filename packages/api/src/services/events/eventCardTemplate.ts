/**
 * The seeded "Event Card" entity template (type `event`, list mode, one card
 * per record). Seeded by `npm run seed:event-template`
 * (`scripts/seed-event-card-template.ts`, idempotent by name).
 *
 * ONE `html` block whose markup is resolved through the `{{ }}` engine with
 * the record bound as `event` (an `EventRecord`: see `@sitesurge/types`
 * `types/eventsBlock.ts`). Operators edit it like any other template — it is a
 * starting point, not a code path. Kept here (not inline in the script) so a
 * test can render it through the real engine.
 *
 * Styling rules for the markup:
 *  - only site CSS variables (Settings → Appearance), each with a fallback,
 *    so the card follows the theme;
 *  - every rule is scoped under `.ss-event-card` and wrapped in
 *    `@layer theme`, so the block's own style panel (a later layer) still
 *    wins — an unlayered `<style>` would outrank every block style;
 *  - the description is cut twice: `truncate(…, 180)` for the text itself
 *    (email has no line clamp) and a CSS line clamp of
 *    `--event-card-desc-lines` (default 3) for the layout.
 */

export const EVENT_CARD_TEMPLATE_NAME = 'Event Card';
export const EVENT_CARD_TEMPLATE_DESCRIPTION =
    'Default event card: linked title, image, date + time, location, a short description, ticket types with what is left, '
    + 'a View event button and the access badge (top-right). Edit freely — re-running the seed script restores it.';

/** Globe (public) and padlock (members / subscribers) icons, inline so they work in email too. */
const GLOBE_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>';
const LOCK_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

export const EVENT_CARD_TEMPLATE_HTML = `<style>
/*
 * Event Card (seeded template). Theme colours/fonts come from the site
 * variables; change a variable in Settings → Appearance, or override here.
 * Wrapped in @layer theme so the block style panel can still override it.
 */
@layer theme {
    .ss-event-card {
        --event-card-desc-lines: 3;          /* description line clamp */
        position: relative;                  /* anchors the access badge */
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        border: 1px solid var(--site-border, #e5e7eb);
        border-radius: var(--site-radius, 8px);
        background: var(--site-bg, #ffffff);
        color: var(--site-text, #111827);
        font-family: var(--site-font, inherit);
    }
    /* Image: a fixed 16:9 frame, cropped to fill. */
    .ss-event-card__media {
        display: block;
        aspect-ratio: 16 / 9;
        overflow: hidden;
        background: var(--site-border, #e5e7eb);
    }
    .ss-event-card__media img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    /* Access badge, floating top-right over the image. */
    .ss-event-card__badge {
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 1;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 9px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.92);
        color: var(--site-text, #111827);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        line-height: 1.4;
    }
    .ss-event-card__body {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 6px;
        padding: 16px;
    }
    .ss-event-card__title {
        margin: 0;
        padding-right: 84px;                 /* keep clear of the badge when there is no image */
        font-family: var(--site-heading-font, inherit);
        font-weight: var(--site-heading-weight, 700);
        font-size: 1.15rem;
        line-height: 1.25;
    }
    .ss-event-card--has-image .ss-event-card__title { padding-right: 0; }
    .ss-event-card__title a {
        color: var(--site-heading, inherit);
        text-decoration: none;
    }
    .ss-event-card__title a:hover { text-decoration: underline; }
    .ss-event-card__meta {
        margin: 0;
        font-size: 0.9rem;
        color: var(--site-text-muted, #6b7280);
    }
    .ss-event-card__desc {
        display: -webkit-box;
        margin: 4px 0 0;
        overflow: hidden;
        font-size: 0.95rem;
        line-height: 1.5;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: var(--event-card-desc-lines);
    }
    /* Ticket types: name on the left, price + what is left on the right. */
    .ss-event-card__tiers {
        margin: 8px 0 0;
        padding: 0;
        list-style: none;
        border-top: 1px solid var(--site-border, #e5e7eb);
        font-size: 0.88rem;
    }
    .ss-event-card__tiers li {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 0;
        border-bottom: 1px dashed var(--site-border, #e5e7eb);
    }
    .ss-event-card__tier-left {
        color: var(--site-text-muted, #6b7280);
        font-size: 0.8rem;
    }
    .ss-event-card__tier--soldout { opacity: 0.55; }
    .ss-event-card__signin {
        margin: 4px 0 0;
        font-size: 0.85rem;
        color: var(--site-text-muted, #6b7280);
    }
    .ss-event-card__actions {
        margin-top: auto;                    /* pins the button to the card bottom */
        padding-top: 12px;
    }
    .ss-event-card__button {
        display: inline-block;
        padding: 0.55em 1.1em;
        border-radius: var(--site-button-radius, var(--site-radius, 6px));
        background: var(--site-primary, #1d4ed8);
        color: var(--site-button-text, #ffffff);
        font-weight: 600;
        text-decoration: none;
    }
    .ss-event-card__button:hover { filter: brightness(1.08); }
}
</style>
<article class="ss-event-card{{ if event.featuredImage }} ss-event-card--has-image{{ endif }}">
    {{ if event.featuredImage }}
    <a class="ss-event-card__media" href="{{ event.url }}" tabindex="-1">
        <img src="{{ event.featuredImage }}" alt="{{ default(event.featuredImage.alt, event.title) }}" loading="lazy">
    </a>
    {{ endif }}

    <!-- Access badge: who can see this event. -->
    <span class="ss-event-card__badge">{{ if event.isPublic }}${GLOBE_ICON} Public{{ else }}${LOCK_ICON} {{ event.access.badgeLabel }}{{ endif }}</span>

    <div class="ss-event-card__body">
        <h3 class="ss-event-card__title"><a href="{{ event.url }}">{{ event.title }}</a></h3>

        <p class="ss-event-card__meta">
            <time datetime="{{ event.nextOccurrence }}">{{ event.dateLabel }} · {{ event.timeLabel }}</time>
            {{ if event.recurrenceLabel }}<br>{{ event.recurrenceLabel }}{{ endif }}
        </p>
        {{ if event.locationText }}<p class="ss-event-card__meta">{{ event.locationText }}</p>{{ endif }}

        {{ if event.descriptionText }}<p class="ss-event-card__desc">{{ truncate(event.descriptionText, 180) }}</p>{{ endif }}

        <!-- Ticket types (only when ticketing is on): price + how many are left. -->
        {{ if event.tiers }}
        <ul class="ss-event-card__tiers">
            {{ for event.tiers as t }}
            <li class="{{ if t.soldOut }}ss-event-card__tier--soldout{{ endif }}">
                <span>{{ t.name }}</span>
                <span>
                    {{ if t.isFree }}Free{{ else }}{{ formatCurrency(t.price) }}{{ endif }}
                    {{ if t.soldOut }}<span class="ss-event-card__tier-left">· Sold out</span>{{ else if t.remaining != null }}<span class="ss-event-card__tier-left">· {{ t.remaining }} left</span>{{ endif }}
                </span>
            </li>
            {{ endfor }}
        </ul>
        {{ endif }}

        {{ if event.isPublic && event.requiresSignIn && event.registrationOpen }}
        <p class="ss-event-card__signin">Sign in to register</p>
        {{ endif }}

        <div class="ss-event-card__actions">
            <a class="ss-event-card__button" href="{{ event.url }}">View event</a>
        </div>
    </div>
</article>`;
