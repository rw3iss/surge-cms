/**
 * Single source of truth for the `{{ … }}` template reference — consumed by
 * both the in-editor "Variable & Function Reference" panel and the full
 * `/admin/help/variables-and-functions` documentation page.
 */

// The machine-readable entity field catalog (`EntityField`, `EntityDoc`,
// `ENTITIES`) now lives in `@sitesurge/types` so the server shares it. Re-export
// it here so the editor panel + help page imports are unchanged. In a later
// phase `ENTITIES` becomes generated from the EntityTypeRegistry.
export type { EntityDoc, EntityField, } from '@sitesurge/types';
export { ENTITIES, } from '@sitesurge/types';

export interface SyntaxExample { title: string; code: string; desc: string; }
/**
 * One function in the reference table.
 *
 * `example` is a REAL call and the string it actually produces — every one in
 * this file was produced by running the function, not written from memory, so
 * the page cannot drift from the implementation without someone noticing.
 */
export interface FunctionDoc {
    sig: string;
    desc: string;
    example?: { code: string; result: string; };
}
export interface GlobalVariableDoc { path: string; desc: string; }

/**
 * Variables available EVERYWHERE, with no entity in scope.
 *
 * `site.*` resolves identically on the public site, in server-rendered HTML
 * and in email — one shared bag (`buildSiteVariables` in `@sitesurge/types`).
 * They were previously undocumented and built three different ways per
 * surface, so the same tag gave different output depending on where it ran.
 */
export const GLOBAL_VARIABLES: { group: string; items: GlobalVariableDoc[]; }[] = [
    {
        group: 'Site',
        items: [
            { path: '{{ site.name }}', desc: 'Site name (Settings → General).' },
            { path: '{{ site.logo }}', desc: 'Logo image URL (Settings → Site Branding → Logo). Absolute, so it also works in email. Empty when no logo is set.' },
            { path: '{{ site.favicon }}', desc: 'Favicon URL. Absolute.' },
            { path: '{{ site.url }}', desc: 'Canonical site URL, no trailing slash.' },
            { path: '{{ site.tagline }}', desc: 'Tagline, when configured.' },
            { path: '{{ site.description }}', desc: 'Site description (used for meta description).' },
            { path: '{{ site.email }}', desc: 'Public contact address, when configured.' },
        ],
    },
    {
        group: 'Current user',
        items: [
            { path: '{{ user.displayName }}', desc: 'The signed-in user. Empty for anonymous visitors and in server-rendered HTML (a crawler is anonymous).' },
            { path: '{{ user.email }}', desc: 'Signed-in user\'s email address.' },
        ],
    },
    {
        group: 'Email only',
        items: [
            { path: '{{ list.name }}', desc: 'The mailing list this email is going to. Also `description`, `slug`, `id`, `subscriberCount`, `doubleOptIn`, `registeredUsersOnly`, `isEnabled`.' },
            { path: '{{ template.name }}', desc: 'The template the email was built from, captured AT SEND TIME so it survives a later rename. Also `id`, `subject`, `preheader`, `fromName`, `fromEmail`, `replyTo`, `wasModified`.' },
            { path: '{{ user.name }}', desc: 'In an email this is the RECIPIENT, not a signed-in visitor. Also `email`, `phone`, and `custom.*` for custom subscriber fields.' },
            { path: '{{ unsubscribe_url }}', desc: 'One-click unsubscribe link. Every bulk send must carry one.' },
            { path: '{{ mail.viewUrl }}', desc: 'This email as a web page (/mail/:jobId), PERSONALISED for the recipient through a signed link that cannot be edited to show someone else. Use it for "View in browser". `{{ view_in_browser_url }}` is the same link.' },
            { path: '{{ mail.url }}', desc: 'The same web page WITHOUT personalisation — shareable. Readers who are signed in see their own details; anyone else sees reader variables blank. Open to everyone only when the list has "Public archive" on. Also `{{ mail.viewToken }}` (the signed token alone: `{{ mail.url }}?r={{ mail.viewToken }}`), `{{ mail.archiveUrl }}` (the /mail archive) and `{{ mail.id }}`.' },
        ],
    },
];

export const OVERVIEW =
    'Anywhere inside a content block you can embed `{{ … }}` to pull in live data. '
    + 'The parser resolves variables, nested properties, entity lookups, and if/for logic, '
    + 'then substitutes the result in place. If something can\'t be resolved, the tag is '
    + 'ignored (and a warning is logged to the browser console).';

export const SYNTAX_EXAMPLES: SyntaxExample[] = [
    { title: 'Variable', code: '{{ user.name }}', desc: 'A variable and its properties (dot access, any depth).' },
    { title: 'Nested property', code: '{{ post.author }}', desc: 'Reads a sub-property off an entity in scope.' },
    { title: 'Page entity', code: '{{ post.title }}', desc: 'On a post page, `post` is the current post; on a campaign page, `campaign` is the current campaign.' },
    { title: 'Entity by id — property', code: "{{ campaign('the-id').title }}", desc: 'Fetch an entity by id (or slug) and read a property.' },
    { title: 'Media properties', code: '<img src="{{ post.featuredImage.path }}" alt="{{ post.featuredImage.alt }}">\n<small>{{ post.featuredImage.credits }}</small>', desc: 'An image field (a post’s, campaign’s or event’s `featuredImage`) is the full MEDIA item: `.path` (the URL), `.title`, `.description`, `.credits`, `.alt`, `.thumbnailUrl`. On its own, `{{ post.featuredImage }}` still prints the path, so existing templates keep working. Credits and descriptions are edited in Admin → Media.' },
    { title: 'Entity by id — whole', code: "{{ form('the-id') }}", desc: 'No property → renders the whole entity (an interactive form, a post card, or — for `campaign` — the FULL campaign with its donation form; use `campaignLink(...)` for just the teaser card, `campaignStatus(...)` for the raised/goal panel, `campaignForm(...)` for the form alone).' },
    { title: 'Render options (keyword args)', code: "{{ form('newsletter', title=false, columns=2, gap=16px) }}", desc: 'Whole-entity calls take optional keyword args (any order) that tweak the output. Forms: `title` (false / "" to hide, or a string to override), `columns` (1–8), and `gap` (any CSS length, e.g. `10px`, sets the space between fields). With `columns`, each field\'s own width still applies — a Full-width field spans all columns (its own row); Half-width fields take one column and pack side by side. Single column on mobile.' },
    { title: 'Product inventory', code: '{{ product.inventory }} in stock\n{{ product.variants[0].inventory }} left in {{ product.variants[0].option1 }}', desc: 'Units in stock: `product.inventory` is the total across every variant; each variant has its own `inventory`. Pair with `if` for an out-of-stock note: `{{ if product.inventory == 0 }}Sold out{{ endif }}`.' },
    { title: 'Utility function', code: '{{ formatCurrency(product.variants[0].price) }}', desc: 'Call a convenience function on a value — e.g. 55 → $55.00.' },
];

export const LOGIC_EXAMPLES: SyntaxExample[] = [
    {
        title: 'if / else if / else',
        code: '{{ if campaign.status == "active" }}\n  Open for donations!\n{{ else if campaign.status == "completed" }}\n  Thank you — goal reached.\n{{ else }}\n  Coming soon.\n{{ endif }}',
        desc: 'Conditionals. Operators: == != > < >= <=, and, or, not.',
    },
    {
        title: 'for loop',
        code: '{{ for posts as post }}\n  <li>{{ post.title }}</li>\n{{ endfor }}',
        desc: 'Iterate a collection. Optional index: `{{ for posts as post, i }}`.',
    },
];

export const FUNCTIONS: { group: string; items: FunctionDoc[] }[] = [
    {
        group: 'Entity lookups (whole entity, or add .property)',
        items: [
            { sig: "post(idOrSlug)", desc: 'A post by id or slug.' },
            { sig: "event(idOrSlug)", desc: 'An event by id or slug — see the Events group below for every property, the display arguments and examples.' },
            { sig: "campaign(idOrSlug, title?, slug?, shortDescription?, fullDescription?)", desc: 'A campaign by id or slug. Whole (no property) renders the FULL campaign — image, title, slug, descriptions, the status panel (campaignStatus: raised/goal + Recent Donors) and the donation form (campaignForm). Also takes image=false, raised=false, donors=true/false and form=false to drop a section, and statusPosition=\'above\'|\'below\' to place the status panel relative to the form (default: the campaign’s own Status position setting). Each field arg takes a boolean (false hides it) OR a string (overrides + shows it); omitted = the campaign’s own value — EXCEPT slug, which is opt-in (hidden unless slug=true or a string). E.g. campaign(\'x\', title=false, slug=true, shortDescription=\'Give today\').' },
            { sig: "campaignStatus(idOrSlug, raised?, donors?)", desc: 'Just the campaign\'s status panel — amount raised, goal + progress bar, donor count and dates, plus the Recent Donors list (most recent first, scrolls and loads more) when the campaign has "Show donors listing" on. raised=false / donors=true|false override the campaign\'s own settings. Donors appear by their chosen visibility: public → name, anonymous → "Anonymous", hidden → not listed (still counted in the total). E.g. campaignStatus(\'spring-drive\').' },
            { sig: "campaignForm(idOrSlug, title?, slug?, shortDescription?, fullDescription?)", desc: 'Just the campaign\'s donation form (the built-in card form, or GiveButter when the campaign uses it). The text fields are OPT-IN here: pass true to show the campaign\'s own value or a string to override, e.g. campaignForm(\'x\', title=true, shortDescription=\'Every dollar helps\'). In an email it becomes a "Donate to …" link.' },
            { sig: "campaignLink(idOrSlug)", desc: 'A campaign teaser CARD linking to its page (title, blurb, raised/goal) — the same block the `campaign` content block shows. Use when you want just a link, not the full form.' },
            { sig: "form(idOrSlug, title?, columns?, gap?)", desc: 'A form by id or slug (whole = interactive form). Keyword args: title=false/"" hides the title (or a string overrides it); columns=N lays fields out in N columns; gap=<len> sets the space between fields (e.g. 10px).' },
            { sig: "page(slug)", desc: 'A CMS page by slug.' },
            { sig: "media(id)", desc: 'A media asset by id (admin only).' },
            { sig: "user()", desc: 'The current signed-in user.' },
        ],
    },
    {
        group: 'Collections (arrays — use in a for loop)',
        items: [
            { sig: 'posts(limit?)', desc: 'Published posts (default 20).' },
            { sig: 'campaigns(limit?)', desc: 'Active campaigns.' },
            { sig: 'forms(limit?)', desc: 'Published forms.' },
        ],
    },
    {
        group: 'Counts & convenience',
        items: [
            { sig: 'postCount', desc: 'Total published posts (no parentheses needed).' },
            { sig: 'campaignCount', desc: 'Total campaigns.' },
            { sig: 'formCount', desc: 'Total forms.' },
            { sig: 'now', desc: 'The current date (a raw date — use formatDate() for a formatted one).' },
            { sig: 'year', desc: 'The current year.' },
        ],
    },
    {
        group: 'Discussions (comments + forum)',
        items: [
            { sig: 'latestComments(limit?, …)', desc: 'Newest comments site-wide. Use in a for loop ({{ for latestComments(5) as c }}{{ c.author.name }}: {{ c.excerpt }}{{ endfor }}) or alone for a ready-made list. Each item: author.name / author.handle, excerpt, url (links to the comment), target.title / target.url, createdAt, replyCount, reactions. Keyword args (all lists): targetType=\'post\'|\'event\'|\'forum_thread\', targetId=, category=\'<forum category slug>\', author=\'<handle>\', window=\'24h\'|\'7d\'|\'30d\'|\'all\', minReactions=N, includeReplies=false.' },
            { sig: 'hotComments(limit?, …)', desc: 'The most active comments right now — replies and reactions, weighted by age (default window 7 days).' },
            { sig: 'latestThreads(limit?, category?)', desc: 'Forum threads with the newest activity. Each item: title, url, category.name / category.slug, author.name, excerpt (opening post), replyCount, viewCount, reactionCount, lastReplyAt.' },
            { sig: "hotThreads(limit?, window='7d', category?)", desc: 'The hottest forum threads — replies, reactions and views weighted by age. E.g. hotThreads(5, window=\'7d\', category=\'general\').' },
            { sig: "discussions(sort=, kind=, window=, limit=)", desc: 'The general form: sort=\'latest\'|\'hot\'|\'top\' (top = most replies + reactions in the window), kind=\'comment\'|\'thread\'|\'both\'. E.g. discussions(sort=\'top\', kind=\'both\', window=\'30d\', limit=10).' },
            { sig: 'commentCount(item)', desc: 'Number of visible comments on a post or event: commentCount(post), or commentCount(\'<id>\', type=\'event\').' },
            { sig: "forumThread(slugOrId)", desc: 'One forum thread: forumThread(\'welcome\').replyCount, .title, .url. Alone, renders a link with its reply count.' },
            { sig: '(visibility)', desc: 'Every list shows only what the viewer may read (gated posts, private forum categories). In server-rendered HTML and in email the viewer is anonymous, so only public discussions appear there.' },
        ],
    },
    {
        group: 'Gallery',
        items: [
            { sig: "gallery('<item id>')", desc: 'One gallery item. Alone it renders the media (image, or the video player); with a property it reads it: .title, .caption, .url (the item page), .media.url, .media.thumbnailUrl, .mediaType (image|video; same as .media.type), .media.width / .height, .media.credits, .media.durationMs, .tags, .commentCount, .publishedAt, .collectionId. Add title=true to show the title under it, caption=false to hide the caption.' },
            { sig: 'gallery(limit?, …)', desc: 'A list of gallery items (default 12) — alone it renders a gallery; in a loop: {{ for gallery(tag=\'events\', limit=6) as g }}<img src="{{ g.media.thumbnailUrl }}">{{ endfor }}. Query: type=\'image\'|\'video\', tag=\'a,b\' (any of), search=, sort=\'order\'|\'newest\'|\'oldest\'|\'title\'|\'random\', limit=, page=, ids=\'<id>,<id>\'. Positional shortcuts: gallery(\'video\', 4).' },
            { sig: "gallery(layout='grid', …)", desc: 'Render options: layout=\'grid\'|\'row\'|\'column\'|\'carousel\'|\'stage\'|\'masonry\' (masonry = columns of items at their natural height, each in the shortest column), columns=, itemsPerPage=, scrollBy=, rows=, gap=\'8px\', itemWidth=, itemHeight=, aspect=\'square\'|\'4:3\'|\'3:2\'|\'16:9\'|\'original\', fit=\'cover\'|\'contain\', autoplay=true, interval=5 (seconds), loop=, arrows=, dots=, titles=true, captions=true, open=\'lightbox\'|\'page\'|\'none\', thumbs=true (thumbnail strip in the lightbox), itemRadius=\'0\' (item corners; empty = the site Border Radius; radius= also works). In email: grid/column stay a grid, row/carousel/stage become a centred wrapped grid, masonry stays masonry (at most 4 columns), and every item links to its gallery page. Prefix a layout option with mobile for ≤768px: mobileLayout=\'column\', mobileColumns=1, mobileItemsPerPage=1. E.g. gallery(type=\'image\', layout=\'row\', itemsPerPage=3, autoplay=true).' },
            { sig: '(visibility)', desc: 'On the site, gallery() shows only items the viewer may see (the gallery access rule and each item\'s visibility). In email only items whose MEDIA is public are used — by their CDN URL — whatever the gallery page\'s access.' },
        ],
    },
    {
        group: 'Events',
        items: [
            { sig: "event('idOrSlug')", desc: 'One event. Alone it renders the event card (image, title linked to the event page, date + time, location, description, access badge, View event button); with a property it reads that field: event(\'summer-gala\').when, .dateLabel, .timeLabel, .location, .url, .priceFrom, .remaining, .tiers[0].name. Display arguments: image=, date=, time=, location=, description=, descriptionLength=200, tickets=true (ticket types with price + "N left"), badge=, button=, buttonLabel=\'Get tickets\'.' },
            { sig: 'events(limit?, …)', desc: 'A list of events (default 6, at most 50) — alone it renders cards in a grid; in a loop: {{ for events(4) as e }}<a href="{{ e.url }}">{{ e.title }}</a> {{ e.dateLabel }}{{ endfor }}. Query: upcoming=true (default; false = past events too), sort=\'startsAt\' (next date — default) | \'title\' | \'createdAt\', order=\'asc\'|\'desc\', access=\'public\'|\'members\'|\'tier\', search=, limit=, ids=\'summer-gala,winter-ball\' (these events in this order; ids or slugs). Layout: layout=\'grid\'|\'column\', columns=3, gap=\'16px\', plus every event() display argument.' },
            { sig: '(visibility)', desc: 'On the site only events the viewer may SEE are returned (Settings → Events and each event\'s "Who can see"); in server-rendered HTML and in email the reader is anonymous, so only public events appear. A public event whose registration needs an account shows "Sign in to register" on its card.' },
        ],
    },
    {
        group: 'Value utilities',
        items: [
            {
                sig: 'formatCurrency(value, showDecimals?, currency?)',
                desc:
                    'Money. `value` is in MAJOR units (55 means fifty-five dollars, not 55 cents). '
                    + '`showDecimals` defaults to true — pass false for whole amounts. `currency` is any '
                    + 'ISO 4217 code (USD, EUR, GBP, CAD, AUD, JPY…), default USD; the symbol and digit '
                    + 'grouping follow the code. An unrecognised code falls back to USD rather than failing.',
                example: {
                    code: '{{ formatCurrency(55) }} · {{ formatCurrency(55, false) }} · '
                        + "{{ formatCurrency(1234.5) }} · {{ formatCurrency(55, true, 'EUR') }}",
                    result: '$55.00 · $55 · $1,234.50 · €55.00',
                },
            },
            {
                sig: 'formatDate(value?, format?)',
                desc:
                    'A date. With no arguments it gives today; with just a format it gives today in that '
                    + 'format; with a date it formats that date, defaulting to "Mon D, YYYY". '
                    + 'Tokens: YYYY YY · MMMM MMM MM M · DD D · dddd ddd · HH H hh h · mm · ss · A a. '
                    + 'Put words in [square brackets] to keep them literal. A date that is supplied but '
                    + 'empty renders NOTHING even with a format — an undated post shows a blank, never '
                    + "today, so there is no formatDate(null, 'YYYY') shortcut.",
                example: {
                    code: "{{ formatDate('YYYY') }} · {{ formatDate() }} · "
                        + "{{ formatDate(post.publishedAt, 'YYYY-MM-DD') }} · {{ formatDate('[on] MMM D') }}",
                    result: '2026 · Sep 24, 2026 · 2026-09-24 · on Sep 24',
                },
            },
            {
                sig: 'formatNumber(n)',
                desc:
                    'Thousands separators, en-US. No options; decimals are kept as given and never padded, '
                    + 'so use formatCurrency for money.',
                example: {
                    code: '{{ formatNumber(1234567) }} · {{ formatNumber(1234.5) }}',
                    result: '1,234,567 · 1,234.5',
                },
            },
            {
                sig: 'upper(text) / lower(text) / trim(text)',
                desc: 'Change case, or strip leading and trailing whitespace.',
                example: {
                    code: "{{ upper('surge media') }} · {{ lower('Surge Media') }}",
                    result: 'SURGE MEDIA · surge media',
                },
            },
            {
                sig: 'truncate(text, length?)',
                desc:
                    'Shorten to `length` characters (default 100), appending "…". The ellipsis counts '
                    + 'toward the length, so the result is never longer than asked. Text already within '
                    + 'the limit is returned untouched, with no ellipsis.',
                example: {
                    code: "{{ truncate('The quick brown fox jumps over the lazy dog', 20) }}",
                    result: 'The quick brown f...',
                },
            },
            {
                sig: 'default(value, fallback)',
                desc: 'Use `fallback` when `value` is null, undefined or an empty string. Zero and false are kept.',
                example: {
                    code: "{{ default(user.name, 'there') }}",
                    result: 'there — when no one is signed in',
                },
            },
        ],
    },
];

// ─── Events (the help page's Events section) ────────────────────────────────

/** One named argument of `event()` / `events()`. */
export interface EventArgDoc { name: string; appliesTo: 'event' | 'events' | 'both'; values: string; desc: string; }

/**
 * Every named argument of `{{ event(...) }}` / `{{ events(...) }}` — the
 * mapping lives in `@sitesurge/types` (`eventsCallFor` + `eventDisplayFrom`),
 * shared by the site, server-rendered HTML and email.
 */
export const EVENT_FUNCTION_ARGS: EventArgDoc[] = [
    { name: 'limit', appliesTo: 'events', values: '1–50 (default 6)', desc: 'How many events. Also the first positional number: events(3).' },
    { name: 'upcoming', appliesTo: 'events', values: 'true (default) | false', desc: 'Only events that are not over (a recurring series counts while it repeats). false includes past events.' },
    { name: 'sort', appliesTo: 'events', values: "'startsAt' (default) | 'title' | 'createdAt'", desc: 'startsAt orders by each event\'s NEXT date, so a weekly series sorts by next week.' },
    { name: 'order', appliesTo: 'events', values: "'asc' (default) | 'desc'", desc: 'Sort direction.' },
    { name: 'access', appliesTo: 'events', values: "'public' | 'members' | 'tier'", desc: 'Only events with this "Who can see" rule (inherit → the Settings → Events default).' },
    { name: 'ids', appliesTo: 'events', values: "'a,b,c'", desc: 'These events in this order (ids or slugs). Ignores the query arguments.' },
    { name: 'search', appliesTo: 'events', values: 'text', desc: 'Title / description / location contains.' },
    { name: 'layout', appliesTo: 'events', values: "'grid' (default) | 'column'", desc: 'How the cards are laid out when the list renders alone.' },
    { name: 'columns', appliesTo: 'events', values: '1–6 (default 3)', desc: 'Grid columns (email: at most 3).' },
    { name: 'gap', appliesTo: 'events', values: "CSS length (default '16px')", desc: 'Space between cards.' },
    { name: 'image', appliesTo: 'both', values: 'true | false', desc: 'Show the event image (default on).' },
    { name: 'date', appliesTo: 'both', values: 'true | false', desc: 'Show the date (default on).' },
    { name: 'time', appliesTo: 'both', values: 'true | false', desc: 'Show the time (default on).' },
    { name: 'location', appliesTo: 'both', values: 'true | false', desc: 'Show the location (default on).' },
    { name: 'description', appliesTo: 'both', values: 'true | false', desc: 'Show the description, as plain text (default on).' },
    { name: 'descriptionLength', appliesTo: 'both', values: 'characters (default 200)', desc: 'Cut the description at a word boundary with "…". 0 = no cut.' },
    { name: 'tickets', appliesTo: 'both', values: 'true | false', desc: 'List the ticket types with price and "N left" when a capacity is set (default off).' },
    { name: 'badge', appliesTo: 'both', values: 'true | false', desc: 'The Public / Members / Subscribers badge in the top-right corner (default on).' },
    { name: 'button', appliesTo: 'both', values: 'true | false', desc: 'The button linking to the event page (default on).' },
    { name: 'buttonLabel', appliesTo: 'both', values: 'text', desc: "Button text (default 'View event')." },
];

/** Worked examples for the Events section. */
export const EVENT_EXAMPLES: SyntaxExample[] = [
    { title: 'One event card', code: "{{ event('summer-gala') }}", desc: 'The default card: image, linked title, date + time, location, description, access badge and a View event button.' },
    { title: 'Card with tickets', code: "{{ event('summer-gala', tickets=true, description=false, buttonLabel='Get tickets') }}", desc: 'Ticket types with price and how many are left; no description.' },
    { title: 'Read properties', code: "<a href=\"{{ event('summer-gala').url }}\">{{ event('summer-gala').title }}</a> — {{ event('summer-gala').when }}", desc: 'Any property of the event, e.g. a sentence with a link.' },
    { title: 'Upcoming events', code: "{{ events(3, layout='column') }}", desc: 'The next three events, stacked.' },
    { title: 'Your own markup', code: "<ul>\n{{ for events(5) as e }}\n  <li><a href=\"{{ e.url }}\">{{ e.title }}</a> · {{ e.dateLabel }}{{ if e.soldOut }} · Sold out{{ endif }}</li>\n{{ endfor }}\n</ul>", desc: 'Loop the list and write the HTML yourself.' },
    { title: 'Ticket types', code: "{{ for event.tiers as t }}\n  {{ t.name }}: {{ if t.isFree }}Free{{ else }}{{ formatCurrency(t.price) }}{{ endif }}{{ if t.remaining != null }} ({{ t.remaining }} left){{ endif }}\n{{ endfor }}", desc: 'Inside an event template (or with event(\'x\') in place of event): one line per ticket type.' },
    { title: 'Access badge', code: "{{ if event.isPublic }}Public{{ else }}{{ event.access.badgeLabel }}{{ endif }}{{ if event.requiresSignIn }} · Sign in to register{{ endif }}", desc: 'Who can see the event, and whether registering needs an account.' },
];
