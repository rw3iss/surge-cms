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
            { sig: "event(idOrSlug)", desc: 'An event by id or slug. Whole (no property) renders a compact event card — title, when, where, and a View Event link. With a property, reads that field: event(\'town-hall\').title, .startsAt, .location, .description. Only PUBLISHED events resolve.' },
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

