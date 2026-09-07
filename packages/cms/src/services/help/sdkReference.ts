/**
 * Content for the in-admin SDK documentation (`/admin/help/sdk/*`).
 *
 * Data rather than JSX so the three pages share one renderer, and so the prose
 * lives next to the other reference data (`services/template/reference.ts`)
 * rather than being buried in a component.
 *
 * These mirror `docs/sdk/*.md` in the repo. When you change one, change both —
 * the markdown is what a developer reading the source finds, this is what an
 * operator reading the admin finds.
 */

export interface DocBlock {
    /** Paragraph of prose. */
    p?: string;
    /** Fenced code sample. */
    code?: string;
    /** Bullet list. */
    list?: string[];
    /** A simple table: first row is the header. */
    table?: string[][];
    /** Callout — rendered with emphasis; use for the things that bite. */
    note?: string;
}

export interface DocSection {
    heading: string;
    blocks: DocBlock[];
}

export interface SdkDoc {
    id: string;
    /** Render the generated SDK module browser after the sections. Only the
     *  Component JavaScript doc sets it — the reference is what a script author
     *  needs at hand, and it is 365 methods long. */
    showModuleReference?: boolean;
    path: string;
    title: string;
    lead: string;
    sections: DocSection[];
}

export const HEADLESS_DOC: SdkDoc = {
    id: 'headless',
    path: '/admin/help/sdk',
    title: 'Headless usage',
    lead:
        'SiteSurge ships an admin UI, but every one of its routes is a plain JSON API. '
        + '"Headless" is not a switch you flip — it is what you get when you stop using the '
        + 'bundled SPA and talk to the API yourself.',
    sections: [
        {
            heading: 'Three ways in',
            blocks: [
                {
                    table: [
                        ['Approach', 'What it is', 'Use when',],
                        ['REST', 'GET /api/v1/posts, etc.', 'Any language; a one-off script',],
                        ['@sitesurge/client', 'Typed TS client, 36 module namespaces', 'A TS/JS app — this is the SDK',],
                        ['@sitesurge/mcp', 'MCP server wrapping the client', 'An AI agent should author the site',],
                    ],
                },
            ],
        },
        {
            heading: 'Connecting',
            blocks: [
                {
                    code: `import { createClient } from '@sitesurge/client';

const cms = createClient({
  baseUrl: 'https://your-site.com',
  auth: { apiKey: process.env.CMS_API_KEY },   // ssk_…
});

const { data, meta } = await cms.posts.list({ limit: 10 });`,
                },
                {
                    note:
                        'baseUrl is the SITE origin, not the API path — the client appends /api/v1 '
                        + 'itself. Getting this wrong produces a 404 on every call.',
                },
            ],
        },
        {
            heading: 'Auth modes',
            blocks: [
                {
                    list: [
                        'apiKey — server-to-server. Issue a scoped ssk_ key in Settings → API Keys. '
                        + 'Shown once. Scopes are read < write < admin; GET/HEAD needs read, mutations need write.',
                        'bearer — a user\'s JWT, for an app that signs people in.',
                        'cookie — the browser session used by the bundled admin. Keeps the httpOnly + '
                        + 'CSRF session intact, so it only works same-origin.',
                    ],
                },
                {
                    note:
                        'An API key cannot manage API keys — that requires a real admin login, so a '
                        + 'leaked key cannot mint more of itself.',
                },
            ],
        },
        {
            heading: 'What you get back',
            blocks: [
                {
                    p:
                        'Paginated lists return { data, meta } where meta carries page / limit / total / '
                        + 'totalPages. Single reads return the entity directly. Errors are typed and also '
                        + 'emitted on a bus:',
                },
                {
                    code: `cms.onError((e) => {
  if (e instanceof UnauthorizedError) redirectToLogin();
});`,
                },
                {
                    p:
                        'Reads are cached (stale-while-revalidate). Pass { cache: false } for anything '
                        + 'that changes underneath you — an inbox, a payment status — or you will show '
                        + 'stale data that looks like a bug.',
                },
            ],
        },
        {
            heading: 'Rendering your own front end',
            blocks: [
                {
                    p:
                        'The API is the only thing the bundled SPA uses, so anything it renders you can '
                        + 'render. The pieces you will want:',
                },
                {
                    list: [
                        'cms.pages.getBySlug(slug) — the page and its block tree',
                        'cms.posts.list() / cms.posts.getBySlug(slug)',
                        'cms.settings.getPublic() — site name, appearance tokens, enabled features',
                        'cms.navigation.get() — the menu',
                    ],
                },
                {
                    p:
                        'Blocks arrive as a flat list with parentBlockId; buildBlockTree(flat) from '
                        + '@sitesurge/types assembles them. Rendering is yours.',
                },
            ],
        },
    ],
};

export const MODULES_DOC: SdkDoc = {
    id: 'modules',
    path: '/admin/help/sdk/modules',
    title: 'Creating a feature module',
    lead:
        'A feature is an installable slice of the CMS — Shop, Events, Mailing Lists. It owns '
        + 'tables, routes, settings and permissions, can be toggled in Settings → Features, and '
        + '404s cleanly when off.',
    sections: [
        {
            heading: '1. Declare it in the registry',
            blocks: [
                { p: 'packages/api/src/features/registry.ts:', },
                {
                    code: `recipes: {
  key: 'recipes',
  label: 'Recipes',
  defaultEnabled: false,
  requires: ['posts'],                 // the dependency planner enforces this
  migrations: ['095_create_recipes.sql'],
  tables: ['recipe_steps', 'recipes'], // CREATION order; uninstall drops in reverse
  settingsKeys: ['recipes_*'],
  onEnable: async (client) => { /* idempotent seed, inside the txn */ },
  onUninstall: async (client) => { /* idempotent cleanup, before the drop */ },
},`,
                },
                {
                    note:
                        'A feature with no `tables` is NOT uninstallable — its schema is treated as part '
                        + 'of the base install.',
                },
            ],
        },
        {
            heading: '2. Tag the migrations',
            blocks: [
                { code: `-- @feature recipes\nCREATE TABLE IF NOT EXISTS recipes ( … );`, },
                {
                    p:
                        'The runner skips tagged migrations while the feature is disabled, and a guard '
                        + 'test fails the build if a tagged migration is missing from the registry '
                        + 'entry. A migration against a BASE table stays untagged so it always runs.',
                },
            ],
        },
        {
            heading: '3. Repository → service → routes',
            blocks: [
                { p: 'The layering is what keeps a module testable:', },
                {
                    list: [
                        'repositories/recipes.repo.ts — SQL only, mapRow to camelCase.',
                        'services/recipes.ts — business rules, audit logging, cache invalidation.',
                        'routes/recipes.ts — thin defineRoute manifests. No SQL, no res.json, no try/catch.',
                    ],
                },
                {
                    code: `export const recipesRoutes = [
  defineRoute({
    method: 'get', path: '/', auth: 'optional',
    summary: 'List recipes.',
    input: { query: listQuery },
    handler: ({ query, user }) =>
      recipes.list(query, { isAdmin: isAdminRole(user?.role) }),
  }),
];`,
                },
                { p: 'Mount it feature-gated, so every route 404s when the feature is off:', },
                {
                    code: `router.use('/recipes', registerModule('recipes', recipesRoutes, {
  mountPath: '/api/v1/recipes',
  feature: 'recipes',
}));`,
                },
            ],
        },
        {
            heading: '4. Share the wire types',
            blocks: [
                {
                    p:
                        'DTOs go in packages/shared/src/api/routes/recipes.ts and the zod schemas bind '
                        + 'to them (satisfies z.ZodType<RecipeCreateBody>), so DTO drift is a compile '
                        + 'error rather than a runtime surprise.',
                },
            ],
        },
        {
            heading: '5. Declare permissions',
            blocks: [
                {
                    note:
                        'Required. Any read or write that should be gated needs a permission. Add the '
                        + 'set to FEATURE_PERMISSIONS.recipes in services/permissions/catalog.ts — boot '
                        + 'registers it when the feature is enabled. See the Permissions page.',
                },
            ],
        },
        {
            heading: '6. Regenerate the docs',
            blocks: [
                {
                    p:
                        'npm run docs:api rewrites docs/API.md and docs/api-manifest.json from the live '
                        + 'route manifest. Do not hand-edit those two.',
                },
            ],
        },
        {
            heading: 'Checklist',
            blocks: [
                {
                    list: [
                        'Registry entry with tables + settingsKeys (or it is not uninstallable)',
                        '-- @feature header on every owned migration',
                        'repository / service / routes split',
                        'DTOs in @sitesurge/types',
                        'Permissions declared and checked',
                        'registerModule(..., { feature }) so it 404s when off',
                        'npm run docs:api',
                    ],
                },
            ],
        },
    ],
};

export const PERMISSIONS_DOC: SdkDoc = {
    id: 'permissions',
    path: '/admin/help/sdk/permissions',
    title: 'Permissions in a module',
    lead:
        'Permissions sit on top of roles. A route keeps its auth tier (staff, admin, …) as the '
        + 'floor; a permission narrows who may act within it. They do not replace the tier — '
        + 'dropping it in favour of a permission would remove the authentication requirement.',
    sections: [
        {
            heading: 'The rule',
            blocks: [
                { code: `sysadmin  →  user grant  →  role grant  →  the permission's own default`, },
                {
                    p:
                        'Most specific wins at every step, which is what lets a per-user DENY override '
                        + 'a role that allows.',
                },
                {
                    list: [
                        'A sysadmin always passes. Otherwise an admin could revoke permissions:manage '
                        + 'and leave the site administrable only by hand-editing the database.',
                        'An unknown key DENIES, so a typo in a guard fails closed. The alternative turns '
                        + 'a misspelling into an open route.',
                    ],
                },
            ],
        },
        {
            heading: 'Declaring one',
            blocks: [
                { p: 'packages/api/src/services/permissions/catalog.ts:', },
                {
                    code: `FEATURE_PERMISSIONS.recipes = [
  { key: 'recipes:read',  feature: 'recipes', label: 'View recipes',
    action: 'read',  defaultRoles: ['editor', 'admin', 'sysadmin'] },
  { key: 'recipes:write', feature: 'recipes', label: 'Create and edit recipes',
    action: 'write', defaultRoles: ['editor', 'admin', 'sysadmin'] },
];`,
                },
                {
                    p:
                        'Key format is feature:action. Use a dotted feature for a sub-area '
                        + '(shop.orders:refund).',
                },
                {
                    note:
                        'Choose defaults that PRESERVE today\'s behaviour. A permission that silently '
                        + 'takes access away from existing users is a regression. Tightening is the '
                        + 'operator\'s decision, made in Settings → Permissions.',
                },
                {
                    p:
                        'Registration is idempotent and runs at boot for enabled features. It refreshes '
                        + 'the label from code but never overwrites an edited rule — otherwise every '
                        + 'deploy would quietly undo the operator\'s policy.',
                },
            ],
        },
        {
            heading: 'Checking one',
            blocks: [
                {
                    code: `import { can, requirePermission } from '../services/permissions';

// In a route handler — throws 403 with a readable message.
await requirePermission({ id: user?.id, role: user?.role }, 'recipes:write');

// Branching instead of throwing.
if (await can(subject, 'recipes:publish')) { … }`,
                },
                {
                    list: [
                        'check(subject, key) → { allowed, reason }, naming the rule that decided it '
                        + '(user-deny, default-role, sysadmin-bypass, …). Use it to explain, not just enforce.',
                        'permissionsFor(subject) → every key\'s answer, for a UI that hides controls.',
                    ],
                },
                {
                    note:
                        'Never hand-roll role === "admin" next to a permission. Two sources of truth for '
                        + 'one question is how a policy starts disagreeing with itself.',
                },
            ],
        },
        {
            heading: 'From the client',
            blocks: [
                {
                    code: `const mine = await cms.permissions.mine();   // { 'recipes:write': true, … }
if (mine['recipes:write']) showEditButton();`,
                },
                {
                    note:
                        'Hiding a button is not enforcement. The server check is the boundary; the '
                        + 'client check is courtesy.',
                },
            ],
        },
        {
            heading: 'Where the data lives',
            blocks: [
                {
                    list: [
                        'permissions — the catalog plus each key\'s own default rule',
                        'permission_grants — only the EXCEPTIONS (a role or user, allowed or denied)',
                    ],
                },
                {
                    p:
                        'The default living on the permission is what keeps the grants table small: '
                        + '"all staff may do this" costs zero rows. granted is a boolean rather than '
                        + 'row-existence, because revoking one person\'s access to something their role '
                        + 'allows has to be representable.',
                },
            ],
        },
        {
            heading: 'Managing them',
            blocks: [
                {
                    list: [
                        'Settings → Permissions — the catalog grouped by feature; edit the default rule, '
                        + 'toggle roles, see exceptions, create hand-made permissions.',
                        'Users → Manage — one user\'s resolved answers, labelled by source (role versus '
                        + 'this user), with Allow / Deny / Reset.',
                    ],
                },
            ],
        },
    ],
};


export const COMPONENT_JS_DOC: SdkDoc = {
    id: 'component-js',
    path: '/admin/help/sdk/component-js',
    showModuleReference: true,
    title: 'Component JavaScript',
    lead:
        'A Component can carry a client script that runs where it renders, with the CMS SDK '
        + 'handed to it. That is what lets a component do real work — call an endpoint, branch on '
        + 'whether the visitor is signed in, open its own dialog — rather than being static markup.',
    sections: [
        {
            heading: 'The contract',
            blocks: [
                {
                    p: 'Export a `mount` function. It receives the element wrapping the '
                        + "component's rendered blocks, plus a context object. Return a function to "
                        + 'clean up when the component unmounts.',
                },
                {
                    code: `export function mount(el, ctx) {
  const { cms, user, settings, block } = ctx;

  const btn = el.querySelector('.my-cta');
  const onClick = async () => {
    await cms.shop.merchandiseSignup({ email: 'you@example.com' });
  };
  btn.addEventListener('click', onClick);

  // Teardown: undo anything that outlives the element itself.
  return () => btn.removeEventListener('click', onClick);
}`,
                },
                {
                    note: '`el` wraps the blocks you authored above, so `el.querySelector(...)` '
                        + 'reaches your own markup and you can enhance it in place. Mounting waits '
                        + "until those blocks are in the DOM, so your queries won't miss.",
                },
            ],
        },
        {
            heading: 'What ctx gives you',
            blocks: [
                {
                    table: [
                        ['Key', 'Type', 'What it is',],
                        ['cms', 'CmsClient', 'The same typed SDK the admin uses — every module below',],
                        ['user', 'User | null', 'The signed-in visitor, or null when anonymous',],
                        ['settings', 'object', 'Public site settings (name, appearance, enabled features)',],
                        ['block', 'object', "The using block's own settings — per-placement config",],
                    ],
                },
                {
                    p: '`user` is the usual reason to write a script at all: it lets one component '
                        + 'serve two audiences. The merchandise tout subscribes a signed-in visitor '
                        + 'in one click and shows a modal to everyone else.',
                },
                {
                    code: `export function mount(el, ctx) {
  if (ctx.user) {
    // Signed in — the server uses their account address.
    void ctx.cms.shop.merchandiseSignup({});
  } else {
    openMyModal();
  }
}`,
                },
            ],
        },
        {
            heading: 'Available modules',
            blocks: [
                {
                    p: '`ctx.cms` is the full `@sitesurge/client`. The complete reference is '
                        + 'below — every namespace, every method, with its signature. It is '
                        + "generated from the client's source, so it always matches the SDK "
                        + 'actually shipped with this site.',
                },
                {
                    table: [
                        ['Namespace', 'Typical use in a component',],
                        ['cms.shop', 'merchandiseSignup, products.list, checkout.preview',],
                        ['cms.forms', 'submit a form, read its questions',],
                        ['cms.posts / cms.pages', 'list or fetch content to render',],
                        ['cms.entities', 'read records of any entity type (product, contact, custom)',],
                        ['cms.campaigns', 'campaign details and donation flows',],
                        ['cms.mailingLists', 'subscribe an address to a list',],
                        ['cms.search', 'site-wide search',],
                        ['cms.auth', 'the current session; login / register',],
                        ['cms.settings', 'public settings and appearance',],
                    ],
                },
                {
                    note: 'The client runs in COOKIE auth mode, as the visitor. It is not an admin '
                        + "key — a component can only do what the person looking at the page could do. "
                        + 'Admin-only endpoints will fail for an anonymous visitor, which is correct.',
                },
            ],
        },
        {
            heading: 'Why a script and not inline JS',
            blocks: [
                {
                    p: "The site's Content Security Policy is `script-src 'self'` with no "
                        + "`'unsafe-inline'`. An inline `<script>` is blocked, and so is an inline "
                        + '`onclick=`. A Custom HTML block cannot run JavaScript for a second reason '
                        + 'as well: its content is inserted with `innerHTML`, which makes any '
                        + '`<script>` inside it inert.',
                },
                {
                    p: 'Your component script is served as a real same-origin ES module from '
                        + '`/api/v1/components/templates/<id>/client.js`, which satisfies '
                        + "`'self'`. That is why the code lives in this field instead of in your markup.",
                },
                {
                    note: 'A script that throws while mounting is caught and logged — it can never '
                        + 'break the page it is on. Check the browser console if a component seems inert.',
                },
            ],
        },
        {
            heading: 'Practical notes',
            blocks: [
                {
                    list: [
                        'Styles belong in your component\'s blocks (a Custom HTML block with a <style>), not the script. CSS is not CSP-restricted.',
                        'Anything you attach to `document` or `window` — a portalled modal, a scroll listener — must be removed in the teardown you return.',
                        'The toggle beside this field disables the script without deleting it, which is the quickest way to confirm a component is the cause of something.',
                        'Editing the script updates every block using this component: it is a reference, not a copy.',
                        'Writing this field needs the `components:script` permission (admin by default) — separate from editing blocks, because this is code that runs in every visitor\'s browser.',
                    ],
                },
            ],
        },
    ],
};

export const SDK_DOCS: SdkDoc[] = [HEADLESS_DOC, MODULES_DOC, PERMISSIONS_DOC, COMPONENT_JS_DOC,];
