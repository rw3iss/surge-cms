# Generic Entities — Headless SDK

The generic entity system exposes every entity type — the built-in core types
(`post`, `page`, `user`, `campaign`, `form`) and any custom types an admin
defines — through one uniform API and SDK surface. Use it to read/write content
from a headless client without per-entity bespoke endpoints.

```ts
import { createClient } from '@sitesurge/client';

const cms = createClient({ baseUrl: 'https://cms.example.com', auth: { apiKey: 'ssk_…' } });
```

## Entity types (schema)

`cms.entityTypes` manages the type registry (admin/staff auth).

```ts
const types = await cms.entityTypes.list();          // EntityTypeDef[]
const recipe = await cms.entityTypes.getOne('recipe');

// Create a custom type — a backing table is generated automatically.
await cms.entityTypes.create({
  key: 'recipe',                 // machine name → table `ce_recipe`, {{recipe(...)}}
  label: 'Recipe',
  hasSlug: true,
  hasStatus: true,
  searchable: true,
  fields: [
    { key: 'title',     type: 'text',    required: true, searchable: true, indexed: true },
    { key: 'prep_time', type: 'integer' },
    { key: 'body',      type: 'richtext' },
    { key: 'cuisine',   type: 'enum', options: { values: ['italian', 'thai', 'mexican'] } },
  ],
});

// Add a field (ALTER TABLE ADD COLUMN under the hood). Core fields are locked.
await cms.entityTypes.update('recipe', { fields: [/* full field list */] });

await cms.entityTypes.remove('recipe');   // custom types only; drops the table
```

### Field types

`text` `longtext` `richtext` `markdown` `number` `integer` `boolean` `date`
`datetime` `enum` `json` `media` `relation` `slug` `blocks`. Each field may set
`required`, `unique`, `indexed`, `searchable`, `defaultValue`, and type-specific
`options` (enum `values`, relation `relationType`, `min`/`max`/`pattern`).

## Instances (generic CRUD)

`cms.entities` reads/writes records of any type. Reads are `optional`-auth
(anonymous sees published records for status-bearing types); writes are `staff`.

```ts
const { data, meta } = await cms.entities.list('recipe', {
  page: 1, limit: 20,
  sortBy: 'created_at', sortOrder: 'desc',
  search: 'pasta',
  filter: { cuisine: 'italian', prep_time: { op: 'lte', value: 30 } },
});

const one   = await cms.entities.getOne('recipe', 'spaghetti-carbonara'); // id or slug
const made  = await cms.entities.create('recipe', { title: 'Carbonara', prep_time: 20 });
const fixed = await cms.entities.update('recipe', made.id, { prep_time: 25 });
await cms.entities.remove('recipe', made.id);
const total = await cms.entities.count('recipe', { filter: { cuisine: 'thai' } });
```

Records return the schema fields verbatim (snake_case keys) plus the standard
columns `id`, `slug`, `status`, `createdAt`, `updatedAt`, `createdBy` (camel).

## Templates in `{{ }}`

Once a type is registered, its records resolve in the content-template engine on
every surface (pages, SSR, email):

```
{{ recipe('spaghetti-carbonara').title }}
{{ for recipes as r }} <li>{{ r.title }}</li> {{ endfor }}
{{ recipe('id') }}    → whole-entity render (generic field card)
```

## Content-block templates

`cms.contentBlockTemplates` manages reusable, entity-bound block subtrees used by
the `entity` content block (single/list/query/context data binding).

```ts
const tpls = await cms.contentBlockTemplates.list('recipe');
const tpl  = await cms.contentBlockTemplates.create('recipe', { name: 'Recipe card', mode: 'single' });
await cms.contentBlockTemplates.saveBlocks('recipe', tpl.id, [/* block subtree */]);
const withBlocks = await cms.contentBlockTemplates.getOne('recipe', tpl.id);
```

## Freshness: where entity reads are cached, and where they are not

An `entity` block bound to a `query` ("the newest published post") is a LIVE
view of the database, so it is read with `cache: false` from the browser and
served from the server's Redis cache instead. That is deliberate, and the
reasoning generalises:

> **Cache where invalidation is authoritative.** A writer can drop a Redis key
> for everyone. It cannot reach the `localStorage` of a visitor who is not the
> one publishing. A per-browser cache in front of a live query means the
> correctness of the front page depends on when that particular browser last
> happened to refetch.

`cms.entities.list()` and `.getOne()` take a third `QueryOptions` argument;
pass `{ cache: false }` on any surface that must reflect the database as it is
right now. The entity-block resolver (`services/entityBinding.ts`) and the
record picker (`EntitySearchSelectModal`) both do.

### Core types are cached twice

`post`, `page`, `campaign`, `form` and `user` are core entity types adopting
their existing tables, so one row is reachable through the bespoke module
(`posts:*`) AND the generic entity service (`entity:post:list:*`). Every core
invalidator in `services/cache.ts` therefore also drops the mirrored
`entity:<type>:*` prefix. **If you add a bespoke write path for a core type,
call the named invalidator** — do not delete keys directly; the mirrored bust
lives inside the invalidator precisely so no call site has to remember it.

### Bounded staleness in the client

The SWR cache serves a stale entry for at most `DEFAULT_MAX_STALE_MS` (5 min)
past expiry; beyond that it blocks on a fetch, falling back to the stale value
only if that fetch fails. Before this bound existed, `read()` returned any
cached entry however old and the revalidated value never reached the caller
mid-render — a page was observed rendering an entry that had expired 22 hours
earlier.

### Gotcha: a template that hardcodes what it should interpolate

If an entity block updates *some* fields and not others, suspect the template
before the cache. A template authored by pasting rendered markup keeps the
pasted values as literal text; only the fields written as `{{ }}` ever change.
A block whose link and excerpt track the newest record while its heading and
date do not is not a stale cache — it is a template with `{{post.slug}}` and
`{{post.excerpt}}` but no `{{post.title}}`.

To check a template quickly:

```sql
SELECT settings->>'content' FROM content_block_template_blocks WHERE id = '<id>';
```

and confirm every field that should vary appears as `{{post.field}}`.
