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
        'Surge CMS ships an admin UI, but every one of its routes is a plain JSON API. '
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
                { code: `sysadmin  →  user grant  →  subscription-tier grant  →  role grant (role, then its base roles)  →  the permission's own default`, },
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

export const RELEASES_DOC: SdkDoc = {
    id: 'releases',
    path: '/admin/help/releases',
    title: 'Releases & updates',
    lead:
        'A CMS version is published once, from the source repository, with one command. Every '
        + 'installation then sees it under Settings → Admin → CMS Version and updates with two clicks.',
    sections: [
        {
            heading: 'Where versions live',
            blocks: [
                {
                    table: [
                        ['Place', 'What it holds', 'Who reads it',],
                        ['npm — @sitesurge/server "latest"', 'The installable packages', 'Check for update + Update & restart',],
                        ['GitHub Release vX.Y.Z', 'Release notes + package tarballs', 'The CMS Version panel ("What\'s new"); people',],
                        ['releases.json + CHANGELOG.md (repo)', 'The version index and history', 'People and tooling',],
                        ['ghcr.io/rw3iss/sitesurge-server:X.Y.Z', 'The Docker image (built on the tag)', 'Docker installs',],
                    ],
                },
                {
                    p:
                        'Every package — server, admin, cli, types, client, mcp and create-sitesurge — carries '
                        + 'the same version, so "the CMS version" is one number.',
                },
            ],
        },
        {
            heading: 'Publishing a new version',
            blocks: [
                { p: 'From a clean checkout of main in the source repository, signed in to npm and GitHub:', },
                {
                    code: `npm login                  # once per machine / when the session expires
gh auth login              # once per machine

pnpm release 1.2.0 --dry-run   # rehearse: builds, tests, previews notes, publishes nothing
pnpm release 1.2.0             # or: pnpm release patch | minor | major`,
                },
                {
                    list: [
                        'Preflight — on main, clean tree, signed in, the version is new.',
                        'Sets every package to the version, builds everything and runs the tests.',
                        'Writes CHANGELOG.md and releases.json, commits "release: vX.Y.Z" and tags vX.Y.Z.',
                        'Publishes all packages to npm, pushes main and the tag (the tag builds the Docker image).',
                        'Creates the GitHub Release with the change list and the package tarballs.',
                    ],
                },
                {
                    note:
                        'npm two-factor auth: the first run stops at the publish step asking for a code. Run it again '
                        + 'with a fresh code — pnpm release 1.2.0 --yes --otp=123456 — it sees the tag, skips build and '
                        + 'tests, and publishes at once while the code is valid. Any other stop after the tag resumes the '
                        + 'same way; packages already on npm are skipped.',
                },
            ],
        },
        {
            heading: 'Updating an installation',
            blocks: [
                {
                    list: [
                        'Settings → Admin → CMS Version → Check for update. It compares the installed version with '
                        + 'npm and shows the new release\'s notes.',
                        'Update & restart installs the new packages and restarts the server (about 30–60 seconds '
                        + 'of downtime). Database migrations run automatically on start; the page reloads by itself.',
                    ],
                },
                {
                    table: [
                        ['Installation', 'How it updates',],
                        ['npm (npm create sitesurge / @sitesurge/server as a dependency)', 'The Update & restart button',],
                        ['Docker image', 'Pull the new image tag and recreate the container',],
                        ['Source checkout of the repository', 'git fetch --tags && git checkout vX.Y.Z, rebuild, restart (or run the deploy script) — the button is disabled here',],
                    ],
                },
                {
                    note:
                        'One-click updates need a process supervisor (systemd, pm2, Docker restart policy) to start '
                        + 'the server again after it exits. Back up the database first (Settings → Admin → Backup & Restore).',
                },
            ],
        },
    ],
};

export const VIDEO_DOC: SdkDoc = {
    id: 'video',
    path: '/admin/help/video',
    title: 'Video hosting',
    lead:
        'With the Video feature on, videos upload straight to object storage, the server encodes them to '
        + 'adaptive HLS one quality at a time, and viewers stream them from the CDN. A video can be public, '
        + 'or private — full playback only for permitted viewers, with a short public teaser for everyone else.',
    sections: [
        {
            heading: 'Uploading large videos',
            blocks: [
                {
                    list: [
                        'Enable Settings → Features → Video. Uploads of video files (or any file over 50 MB) then go '
                        + 'from the browser directly to storage in parts — the bytes never pass through this server.',
                        'Progress shows in the upload tray (bottom corner of the admin). The upload keeps running while you '
                        + 'move between admin pages, and can be paused and resumed.',
                        'After a reload or a lost connection, the tray lists the upload as unfinished. Choose the same file '
                        + 'again and only the missing parts are sent.',
                        'The size limit and part size are in Media → Settings → Video.',
                    ],
                },
            ],
        },
        {
            heading: 'Processing',
            blocks: [
                {
                    list: [
                        'After the upload, an encode job makes the HLS renditions one at a time, at low priority, so the '
                        + 'website stays fast. Only qualities at or below the source are made.',
                        'The lowest quality (480p) is made first: the video plays within minutes, and higher qualities '
                        + 'appear in the player\'s quality menu as they finish.',
                        'A teaser (the first N seconds, never encrypted) and per-quality MP4 downloads are made too, when '
                        + 'enabled in Media → Settings → Video.',
                        'The media library shows progress per quality; a failed quality can be retried, and a video can be '
                        + 're-encoded while its original is kept.',
                    ],
                },
            ],
        },
        {
            heading: 'Public and private videos',
            blocks: [
                {
                    table: [
                        ['Access', 'Who plays the full video', 'Everyone else',],
                        ['Public', 'Anyone', '—',],
                        ['Private', 'Viewers with the media.private:view permission', 'The teaser, then a "subscribe" prompt',],
                    ],
                },
                {
                    list: [
                        'Private videos are AES-128 encrypted with a SHARED key. Only a permitted viewer can fetch the key, '
                        + 'and only a permitted viewer is ever given the full stream\'s address.',
                        'To sell access, grant media.private:view to a subscription tier (Users → Settings → Subscriptions → '
                        + 'the tier → extra permissions), or to a role in Settings → Permissions.',
                        'Rotate the key in Media → Settings → Video. Private videos are then re-packaged onto the new key '
                        + '(no re-encode); a leaked key stops working.',
                    ],
                },
            ],
        },
        {
            heading: 'Using a video in a block',
            blocks: [
                {
                    list: [
                        'Add a Video block, then upload a file or choose Select Existing to pick one from the media library. '
                        + 'The editor preview has a Full video / Teaser switch.',
                        'A YouTube or Vimeo link pasted in the URL field still plays in the provider\'s player; any other '
                        + 'video file URL plays in the site player.',
                        'Carousel slides can use a library video as a background — it streams the same way.',
                    ],
                },
            ],
        },
        {
            heading: 'From code (SDK)',
            blocks: [
                {
                    code: `// Direct multipart upload (admin)
const session = await cms.media.uploads.create({ filename, mimeType, size, fingerprint });
const { urls } = await cms.media.uploads.partUrls(session.id, [1, 2, 3]);
// …PUT each part to its URL (keep the ETag), then:
const media = await cms.media.uploads.complete(session.id); // status: processing

// Encode status and actions (staff)
const info = await cms.media.video.info(media.id);      // renditions, teaser, job
await cms.media.video.update(media.id, { accessLevel: 'private' });

// Playback (anyone) — the full stream's src is null unless the viewer may watch it
const pb = await cms.media.playback(media.id);
const teaser = await cms.media.teaserUrl(media.id);`,
                },
                {
                    p: 'The exact method names and shapes are in the SDK module reference (`cms.media`).',
                },
            ],
        },
        {
            heading: 'Operations',
            blocks: [
                {
                    list: [
                        'The server needs ffmpeg with libx264. On Fedora: sudo dnf swap ffmpeg-free ffmpeg --allowerasing '
                        + '(RPM Fusion). Media → Settings → Video shows whether ffmpeg, disk space and storage are ready.',
                        'The storage bucket needs a CORS rule allowing GET and PUT from the site origin (and exposing ETag) — '
                        + 'hls.js and the direct upload both use cross-origin requests.',
                        'Add a CDN cache rule for the video path so .m3u8 and .ts files are cached at the edge (they are not '
                        + 'cached by extension by default).',
                        'Encoding runs on the primary process only, one job at a time; Encode threads (default 1) trades '
                        + 'speed for website responsiveness.',
                    ],
                },
                {
                    note:
                        'A video that plays in the admin but not on the site is almost always the bucket CORS rule or the '
                        + 'site Content-Security-Policy (media-src / connect-src must allow the CDN host).',
                },
            ],
        },
    ],
};

export const SDK_DOCS: SdkDoc[] = [HEADLESS_DOC, MODULES_DOC, PERMISSIONS_DOC, COMPONENT_JS_DOC,];
