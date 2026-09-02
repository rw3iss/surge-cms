# Creating a feature module

A *feature* is an installable slice of the CMS — Shop, Events, Mailing Lists.
It owns tables, routes, settings and permissions, can be turned on and off in
Settings → Features, and 404s cleanly when off.

## 1. Declare it in the registry

`packages/api/src/features/registry.ts`:

```ts
recipes: {
  key: 'recipes',
  label: 'Recipes',
  description: 'Recipe catalog with ingredients and steps.',
  defaultEnabled: false,
  requires: ['posts'],                 // dependency planner enforces this
  migrations: ['095_create_recipes.sql'],
  tables: ['recipe_steps', 'recipes'], // CREATION order; uninstall drops in reverse
  settingsKeys: ['recipes_*'],
  onEnable: async (client) => { /* idempotent seed, inside the txn */ },
  onUninstall: async (client) => { /* idempotent cleanup, before the drop */ },
},
```

`FeatureKey` is a union, so adding the entry is what makes the key legal
everywhere else.

## 2. Tag the migrations

Every SQL file for the feature starts with a header:

```sql
-- @feature recipes
CREATE TABLE IF NOT EXISTS recipes ( … );
```

The runner skips tagged migrations while the feature is disabled, and a guard
test fails the build if a tagged migration is missing from the registry entry's
`migrations` list. Migrations against a BASE table (one that always exists) stay
untagged so they always run.

## 3. Repository → service → routes

The layering is not optional; it is what keeps modules testable.

- `repositories/recipes.repo.ts` — SQL only, `mapRow` to camelCase.
- `services/recipes.ts` — business rules, audit logging, cache invalidation.
- `routes/recipes.ts` — thin `defineRoute` manifests. No SQL, no `res.json`,
  no try/catch.

```ts
export const recipesRoutes = [
  defineRoute({
    method: 'get', path: '/', auth: 'optional',
    summary: 'List recipes.',
    input: { query: listQuery },
    handler: ({ query, user }) => recipes.list(query, { isAdmin: isAdminRole(user?.role) }),
  }),
];
```

Mount it feature-gated, so every route 404s when the feature is off:

```ts
router.use('/recipes', registerModule('recipes', recipesRoutes, {
  mountPath: '/api/v1/recipes',
  feature: 'recipes',
}));
```

## 4. Share the wire types

Request/response DTOs go in `packages/shared/src/api/routes/recipes.ts` and the
zod schemas bind to them (`satisfies z.ZodType<RecipeCreateBody>`), so DTO drift
is a compile error rather than a runtime surprise.

## 5. Declare permissions

**Required.** Any read or write that should be gated needs a permission — see
`docs/sdk/permissions.md`. Add the set to `FEATURE_PERMISSIONS.recipes` in
`services/permissions/catalog.ts`; boot registers it when the feature is
enabled.

## 6. Regenerate the docs

`npm run docs:api` rewrites `docs/API.md` + `docs/api-manifest.json` from the
live manifest. Do not hand-edit those two.

## Checklist

- [ ] Registry entry with `tables` + `settingsKeys` (or it is not uninstallable)
- [ ] `-- @feature` header on every owned migration
- [ ] repo / service / routes split
- [ ] DTOs in `@sitesurge/types`
- [ ] Permissions declared and checked
- [ ] `registerModule(..., { feature })` so it 404s when off
- [ ] `npm run docs:api`
