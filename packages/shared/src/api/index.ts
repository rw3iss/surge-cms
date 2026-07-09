/**
 * Shared API contract surface. The envelope (`ApiResponse<T>`) lives in
 * `contract.ts`; per-module request/response DTOs live under `routes/`.
 *
 * ## DTO conventions (applied uniformly across every module)
 *
 * - **Naming:** `<Module><Action>Query` / `Body` / `Params` for requests
 *   and `<Module><Action>Response` for the `data` payload. Module-prefixed
 *   names prevent cross-module collisions (e.g. two `ListQuery`s).
 * - **List responses** type the `data` payload as the ELEMENT ARRAY
 *   (`type XListResponse = Entity[]`). Pagination (`page`/`limit`/`total`)
 *   rides the `ApiResponse.meta` envelope, never the data array.
 * - **Query DTOs describe the CLIENT-FACING input** (what you put in a URL).
 *   `page`/`limit` are typed `number` even though they travel as strings —
 *   serialization handles the round-trip, and the backend coerces. Where a
 *   zod schema's coercion makes input ≠ output (so `satisfies z.ZodType<Q>`
 *   is awkward), the route file binds the DTO with a compile-time
 *   `AssertCompatible<z.infer<typeof schema>, XQuery>` assertion instead.
 * - **Entity reuse:** DTOs REFERENCE entity types from `../types/` — they
 *   never re-declare entity fields. Where a service returns an entity
 *   subset/extension that only existed in the API package (e.g.
 *   `PostWithBlocks`), the wire shape is DEFINED here so all consumers
 *   share one definition. Shared depends on nothing — never import from
 *   `@rw/cms-api`.
 * - **Wire timestamps:** entities that carry `Date` on the server appear as
 *   ISO `string` on the wire; DTOs defined here for API-internal types use
 *   `string` accordingly.
 */

export * from './auth';
export * from './contract';
// per-module route DTOs — add a line here as each module gets its contract file
export * from './routes/_shared';
export * from './routes/posts';
export * from './routes/apiKeys';
export * from './routes/blockStyles';
export * from './routes/fonts';
export * from './routes/dev';
export * from './routes/health';
export * from './routes/dashboard';
export * from './routes/audit';
export * from './routes/search';
export * from './routes/setup';
export * from './routes/messages';
export * from './routes/users';
export * from './routes/social';
export * from './routes/campaigns';
export * from './routes/forms';
export * from './routes/pages';
export * from './routes/auth';
export * from './routes/connections';
export * from './routes/settings';
export * from './routes/feed';
export * from './routes/sitemap';
export * from './routes/unsubscribe';
export * from './routes/media';
export * from './routes/payments';
export * from './routes/mailingLists';
export * from './routes/mailTemplates';
export * from './routes/mailSend';
export * from './routes/shop';
export * from './routes/utils';
