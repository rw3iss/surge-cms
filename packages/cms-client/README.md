# @sitesurge/client

The headless, typed TypeScript client for any SiteSurge CMS backend — one
`cms.*` namespace surface over HTTP, with token lifecycle, an SWR cache, typed
errors, and optional SolidJS bindings. Zero runtime dependencies; works in
Node ≥ 18 and modern browsers.

**Doctrine:** all client-side API requests for SiteSurge route through this
package — `@sitesurge/admin`, external apps, and Node/agent scripts alike.

## Install

In-repo it is already wired as a workspace dependency:

```jsonc
{ "dependencies": { "@sitesurge/client": "workspace:*" } }
```

Publish-ready (ESM + CJS + `.d.ts`, `exports` map with `.` and `./solid`); no
npm publish yet.

## 30-second example

```ts
import { createClient } from '@sitesurge/client';

const cms = createClient({ baseUrl: 'https://cms.example.com', auth: { apiKey: 'ssk_…' } });
const posts = await cms.posts.list({ status: 'all' });   // typed, paginated, cached

// Or a Bearer session — login persists tokens (localStorage by default):
const app = createClient({ baseUrl: 'https://cms.example.com' });
await app.auth.login({ email: 'admin@example.com', password: 'secret' });
const me = await app.auth.me();
```

## Full reference

See **[docs/Overview.md](docs/Overview.md)** — config reference, auth modes,
caching (SWR), the error hierarchy, the SolidJS adapter, and a per-module method
table for all 26 namespaces.

## Integration smoke test

`test-integration/smoke.test.ts` exercises the built client against a REAL,
running API. It is **manual** — excluded from `npm test` (it lives outside
`src/`, which the unit vitest config globs) and from CI. The run is skipped
unless `SMOKE_API_KEY` is set, so it never fails a server-less environment.

Run it against a local API on the side port 3101 (ports 3000/3001 may host
another project):

```bash
# 1. Point the API at the side port (back up first — restore byte-identical).
cp packages/api/.env /tmp/cc-smoke-env-backup
sed -i 's/^PORT=3001$/PORT=3101/' packages/api/.env

# 2. Boot the API and wait for http://localhost:3101/api/v1/health/live.
( cd packages/api && npx tsx src/index.ts & )

# 3. Seed an admin-scoped API key (sha256 of the plaintext lands in key_hash).
HASH=$(node -e "console.log(require('crypto').createHash('sha256').update('ssk_smoketest0000000000000000000000000000000000').digest('hex'))")
psql "$DATABASE_URL" -c "INSERT INTO api_keys (name, key_hash, key_prefix, scopes) VALUES ('cc-smoke', '$HASH', 'ssk_smoketes', '{admin}')"

# 4. Build the client, then run the smoke test.
npm run build -w packages/cms-client
SMOKE_API_KEY='ssk_smoketest0000000000000000000000000000000000' npm run test:integration -w packages/cms-client

# 5. Teardown: kill the API, delete the key, restore .env byte-identical.
pgrep -f 'tsx src/index.ts' | xargs kill
psql "$DATABASE_URL" -c "DELETE FROM api_keys WHERE name='cc-smoke'"
cp /tmp/cc-smoke-env-backup packages/api/.env
```

The test asserts: `posts.list({ status: 'all' })` returns an array (admin via
key); a second identical list is served from the memory cache (one network
call across both); `health.live()` works; and `posts.getById('000…')` rejects
with `NotFoundError`.

## Drift check

`npm run check:drift -w packages/cms-client` asserts every route in
`docs/api-manifest.json` is reachable by a client method (or explicitly
allowlisted in `src/modules/coverage.ts`).

## References

- **Full client reference:** [docs/Overview.md](docs/Overview.md)
- **Charter & design decisions:** [docs/client-sdk-plan.md](../../docs/client-sdk-plan.md)
- **Machine-readable manifest:** [docs/api-manifest.json](../../docs/api-manifest.json)
- **Shared types & DTOs:** `@sitesurge/types` ([packages/shared](../shared))
