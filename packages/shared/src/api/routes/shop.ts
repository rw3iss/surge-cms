/**
 * Wire DTOs for the shop feature module (mounted at /api/v1/shop,
 * `requireFeature('shop')`). Entity types live in `../../types/shop` and
 * are referenced — never re-declared — by the request/response DTOs.
 *
 * This is a Phase-1 skeleton: the real request/response DTOs are filled in
 * per sub-area across later phases:
 *   - Phase 2: catalog (products, variants, options, media, categories,
 *     collections, tags).
 *   - Phase 3: reviews.
 *   - Phase 4: checkout + orders.
 *   - Phase 5: shop settings / appearance.
 *
 * Naming follows the barrel convention (`../index.ts`): `<Module><Action>`
 * Query / Body / Params for requests, `<Module><Action>Response` for the
 * `data` payload; list responses type `data` as the element array with
 * pagination on `ApiResponse.meta`.
 */

export {};
