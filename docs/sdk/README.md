# SiteSurge Headless SDK

`@sitesurge/client` is the typed HTTP client for the SiteSurge CMS — the single
networking path used by the admin app and the recommended way to drive the CMS
from any headless/external client.

```ts
import { createClient } from '@sitesurge/client';
const cms = createClient({ baseUrl: 'https://cms.example.com', auth: { apiKey: 'ssk_…' } });
```

## Reference

- [Generic Entities](./entities.md) — the entity-type registry, generic instance
  CRUD (`cms.entities`, `cms.entityTypes`), content-block templates, and `{{ }}`
  resolution for custom types.

## Auth modes

- `auth: { apiKey: 'ssk_…' }` — a scoped API key (headless/machine clients).
- `auth: { mode: 'cookie' }` — the admin app's httpOnly session (browser).

## Conventions

- List endpoints return `{ data, meta }` where `meta` is
  `{ page, limit, total, totalPages }`; single-entity GETs return the entity.
- Errors are typed (`UnauthorizedError`, `NotFoundError`, `ValidationError`,
  `ContentLockedError`, `ServiceUnavailableError`, …).

_These docs are the source for both the repo and the in-app `/admin/help` pages._
