# @sitesurge/types

Shared TypeScript types, API DTOs, and utilities for the [Surge CMS](https://github.com/rw3iss/surge-cms).

The single source of truth for the Surge CMS wire contract: entity types
(`Page`, `Post`, `Block`, `Campaign`, `Form`, `User`, …) and per-module
request/response DTOs (`packages/shared/src/api/routes/<module>.ts`), plus small
format/validation helpers. The backend binds its zod schemas to these DTOs, so a
mismatch is a compile error — which means **you can build a fully-typed custom
client** against the Surge CMS REST API using only this package.

```bash
npm i @sitesurge/types
```

```ts
import type { Post, PostListResponse, PageMeta } from '@sitesurge/types';

async function getPosts(): Promise<{ data: Post[]; meta: PageMeta }> {
  const res = await fetch('https://cms.example.com/api/v1/posts?limit=12');
  return (await res.json()).data; // typed against PostListResponse
}
```

Prefer the ready-made SDK? Use [`@sitesurge/client`](https://www.npmjs.com/package/@sitesurge/client),
which is built on these types. Full route reference: `docs/API.md` +
`docs/api-manifest.json` in the repo.

> Note: this package is consumed via a bundler today. Direct use under raw Node
> ESM lands with the Node-resolvable build (see the packaging spec in `docs/`).
