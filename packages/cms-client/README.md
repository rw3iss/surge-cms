# @rw/cms-client

> **NOT IMPLEMENTED** — structure scaffold only. See [docs/client-sdk-plan.md](../../docs/client-sdk-plan.md) for the full charter.

Typed TypeScript HTTP client for the SiteSurge CMS backend. Once built, ALL
client-side API requests from `@rw/cms-web` and any external consumer will flow
through this package.

## Goal

```ts
const cms = createClient({ baseUrl, auth: { apiKey: 'ssk_…' } });
const posts = await cms.posts.list({ status: 'all' });   // typed, paginated
const post  = await cms.posts.getBySlug('hello-world');  // throws ContentLockedError
```

Works in Node ≥ 18 and modern browsers. Zero runtime dependencies (fetch-based).

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

## References

- **Charter & design decisions:** [docs/client-sdk-plan.md](../../docs/client-sdk-plan.md)
- **API surface (28 modules / 196 routes):** [docs/API.md](../../docs/API.md)
- **Machine-readable manifest:** [docs/api-manifest.json](../../docs/api-manifest.json)
- **Shared types & DTOs:** `@rw/cms-shared` ([packages/shared](../shared))

## Planned layout

```
packages/cms-client/
├── src/
│   ├── core/           # fetch wrapper, auth, token refresh, typed errors
│   ├── modules/        # one namespace per manifest module
│   └── index.ts        # createClient() factory
├── config/cms-client/
│   └── tsconfig.json   # build config (rooted here, extended by tsconfig stub)
├── package.json
└── README.md           # this file
```
