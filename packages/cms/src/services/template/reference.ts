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
export interface FunctionDoc { sig: string; desc: string; }

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
    { title: 'Entity by id — whole', code: "{{ form('the-id') }}", desc: 'No property → renders the whole entity (an interactive form, a post card, or — for `campaign` — the FULL campaign with its donation form; use `campaignLink(...)` for just the teaser card).' },
    { title: 'Render options (keyword args)', code: "{{ form('newsletter', title=false, columns=2, gap=16px) }}", desc: 'Whole-entity calls take optional keyword args (any order) that tweak the output. Forms: `title` (false / "" to hide, or a string to override), `columns` (1–8), and `gap` (any CSS length, e.g. `10px`, sets the space between fields). With `columns`, each field\'s own width still applies — a Full-width field spans all columns (its own row); Half-width fields take one column and pack side by side. Single column on mobile.' },
    { title: 'Utility function', code: '{{ formatCurrency(campaign.goalAmountCents) }}', desc: 'Call a convenience function on a value.' },
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
            { sig: "campaign(idOrSlug, title?, slug?, shortDescription?, fullDescription?)", desc: 'A campaign by id or slug. Whole (no property) renders the FULL campaign — image, title, slug, descriptions, raised/goal, and the donation form. Each field arg takes a boolean (false hides it) OR a string (overrides + shows it); omitted = the campaign’s own value — EXCEPT slug, which is opt-in (hidden unless slug=true or a string). E.g. campaign(\'x\', title=false, slug=true, shortDescription=\'Give today\').' },
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
            { sig: 'now', desc: 'The current date.' },
            { sig: 'year', desc: 'The current year.' },
        ],
    },
    {
        group: 'Value utilities',
        items: [
            { sig: 'formatCurrency(cents, currency?)', desc: 'e.g. 100000 → $1,000.00.' },
            { sig: 'formatDate(value)', desc: 'Localized date.' },
            { sig: 'formatNumber(n)', desc: 'Thousands-separated number.' },
            { sig: 'upper(text) / lower(text)', desc: 'Change case.' },
            { sig: 'truncate(text, length?)', desc: 'Shorten with an ellipsis (default 100).' },
            { sig: 'default(value, fallback)', desc: 'Use `fallback` when `value` is empty/null.' },
        ],
    },
];

