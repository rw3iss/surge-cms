# Using SiteSurge headlessly

SiteSurge is a normal CMS with an admin UI, but every one of its ~234 routes is
a plain JSON API. "Headless mode" is not a switch you flip — it is what you get
when you stop using the bundled SPA and talk to the API yourself.

There are three ways in, in increasing order of convenience:

| | What it is | Use when |
|---|---|---|
| REST | `GET /api/v1/posts` etc. | Any language; a one-off script |
| `@sitesurge/client` | Typed TS client, 36 module namespaces | A TS/JS app — this is the SDK |
| `@sitesurge/mcp` | MCP server wrapping the client | An AI agent should author the site |

## Connecting

```ts
import { createClient } from '@sitesurge/client';

const cms = createClient({
  baseUrl: 'https://your-site.com',
  auth: { apiKey: process.env.CMS_API_KEY },   // ssk_…
});

const { data, meta } = await cms.posts.list({ limit: 10 });
```

`baseUrl` is the SITE origin, not the API path — the client appends `/api/v1`
itself. Getting this wrong produces 404s on every call.

### Auth modes

- **`apiKey`** — server-to-server. Issue a scoped `ssk_` key in
  Settings → API Keys. It is shown once. Scopes are `read < write < admin`;
  GET/HEAD needs `read`, mutations need `write`.
- **`bearer`** — a user's JWT, for an app that signs people in.
- **`cookie`** — the browser session, used by the bundled admin itself. Keeps
  the httpOnly + CSRF session intact, so it only works same-origin.

An API key cannot manage API keys — key administration requires a real admin
login, so a leaked key cannot mint more of itself.

### What you get

Every module returns typed results. Paginated lists return `{ data, meta }`
(`meta` = `page`/`limit`/`total`/`totalPages`); single reads return the entity
directly. Errors are typed (`UnauthorizedError`, `ContentLockedError`,
`ServiceUnavailableError`, …) and also emitted on a bus:

```ts
cms.onError((e) => { if (e instanceof UnauthorizedError) redirectToLogin(); });
```

Reads are cached (SWR) and can be bypassed per call with `{ cache: false }` —
worth doing for anything that changes underneath you, like an inbox or a
payment status.

Full reference: `packages/cms-client/docs/Overview.md`.

## Rendering your own front end

The API is the only thing the bundled SPA uses, so anything it renders you can
render. The pieces you will want:

- `cms.pages.getBySlug(slug)` → the page + its block tree
- `cms.posts.list()` / `cms.posts.getBySlug(slug)`
- `cms.settings.getPublic()` → site name, appearance tokens, enabled features
- `cms.navigation.get()` → the menu

Blocks arrive as a flat list with `parentBlockId`; `buildBlockTree(flat)` from
`@sitesurge/types` assembles them. Rendering is yours — the block *types* are
described by `describe_block_types` (MCP) or the `BlockType` union.
