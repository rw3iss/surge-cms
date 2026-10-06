# GiveButter Donations Plugin — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task ends with a build/typecheck gate.

**Goal:** Add a `givebutter` plugin that lets admins route a campaign's donations through GiveButter (their embedded widget + REST API) instead of the internal Stripe flow, per-campaign, when the plugin is enabled.

**Architecture:** The plugin owns the GiveButter API client, config (API key/account), and a custom config page. Because the current plugin contract can neither register backend routes nor inject UI into host entities, two small **generic** core extensions are added: (1) a **plugin server-action RPC** (`POST /plugins/:name/action/:action` → `server.js` `actions[name](ctx,payload)`) so any plugin can expose backend operations, and (2) three nullable columns on `campaigns` (`donation_provider`, `givebutter_campaign_id`, `givebutter_campaign_code`) so the public campaign payload can drive widget rendering. GiveButter donations are handled entirely client-side by GiveButter's embedded custom element; our Stripe path is bypassed for GiveButter campaigns. Syncing raised totals back via GiveButter webhooks is explicit future work.

**Tech stack:** Express/PG backend (`packages/api`), SolidJS admin+public SPA (`packages/cms`), shared types (`packages/shared`), headless client (`packages/cms-client`). Plugin = `packages/api/plugins/givebutter/`.

## Research summary (GiveButter)

- **REST API:** base `https://api.givebutter.com/v1`, auth `Authorization: Bearer <API_KEY>`, JSON.
  - `GET /campaigns?page=&scope=owned|beneficiary|chapter` — list.
  - `GET /campaigns/{id}` — one.
  - `POST /campaigns` — `{ title, type: 'standard'|'event'|'sweepstakes'|'p2p', goal?(cents), description?, end_at?(ISO) }`.
  - `PATCH /campaigns/{id}` — partial update. `DELETE /campaigns/{id}`.
  - `GET /transactions?...`, `GET /transactions/{id}` (donations; future use).
  - Campaign object includes numeric `id`, a **6-char `code`** (used by widgets), `title`, `description`, `goal`, `raised`, `donors`, `url`, `status`, `currency`, `end_at`.
- **Widgets (client-side embed):** load library once in `<head>`:
  `<script async src="https://widgets.givebutter.com/latest.umd.cjs?acct=ACCOUNT_ID"></script>`
  then place a custom element keyed by the campaign **code**:
  `<givebutter-giving-form campaign="CODE"></givebutter-giving-form>` (also `givebutter-button`, `givebutter-goal-bar`). Params: `amount`, `frequency`, `fund`, `promo`. Account ID: Dashboard → Settings → Integrations → Widgets.
- Reference only (not a dependency): `github.com/johnnylinsf/givebutter-mcp` mirrors these endpoints.

---

## Task 1: Generic plugin server-action RPC (core)

**Files:**
- Modify: `packages/api/src/plugins/types.ts` (add `actions` to `PluginServerModule`)
- Modify: `packages/api/src/services/plugins.ts` (add `dispatchAction`)
- Modify: `packages/api/src/routes/plugins.ts` (add route)
- Modify: `packages/cms-client/src/modules/plugins.ts` (add `action()`)

- [ ] **Step 1: Type the actions map.** In `types.ts` add to `PluginServerModule`:
```ts
    /** Named backend operations a plugin exposes to the admin via
     *  POST /plugins/:name/action/:action. Each receives the plugin ctx +
     *  the request payload and returns JSON. Keep them idempotent + defensive. */
    actions?: Record<
        string,
        (ctx: PluginServerContext, payload: Record<string, unknown>) => Promise<unknown>
    >;
```

- [ ] **Step 2: Implement `dispatchAction`** in `services/plugins.ts` (mirror the `enable()` resolve pattern — `mustGetRow` → `mustFindOnDisk` → `getServerModule` → `buildContext`, but do NOT wrap in `withPluginTxn`, since actions make external HTTP calls and shouldn't hold an advisory lock):
```ts
export async function dispatchAction(
    name: string,
    action: string,
    payload: Record<string, unknown>,
    audit: AuditContext,
): Promise<unknown> {
    const row = await mustGetRow(name);
    if (!row.enabled || !row.installed || row.error) {
        throw new AppError(409, 'PLUGIN_UNAVAILABLE', `Plugin '${name}' is not enabled`);
    }
    const disk = mustFindOnDisk(name);
    const mod = getServerModule(disk.dir, disk.manifest);
    const fn = mod?.actions?.[action];
    if (!fn) throw new AppError(404, 'ACTION_NOT_FOUND', `Plugin '${name}' has no action '${action}'`);
    const ctx = buildContext({
        name, dir: disk.dir, manifest: disk.manifest,
        config: row.config, installedVersion: row.installedVersion,
    });
    try {
        const result = await fn(ctx, payload ?? {});
        void audit; // actions self-audit if they mutate; RPC itself is read-mostly
        return result;
    } catch (err) {
        ctx.logger.error(`action '${action}' failed`, { error: err instanceof Error ? err.message : err });
        throw err instanceof AppError
            ? err
            : new AppError(502, 'PLUGIN_ACTION_FAILED', err instanceof Error ? err.message : 'Action failed');
    }
}
```
Confirm `buildContext` accepts no `client` (pool-backed) — the map showed `client` is optional. Import `AppError`, `AuditContext` as already used in the file.

- [ ] **Step 3: Add the route** in `routes/plugins.ts` after the config route:
```ts
    defineRoute({
        method: 'post', path: '/:name/action/:action', auth: 'admin',
        summary: 'Dispatch a plugin-defined backend action.',
        input: {
            params: nameParams.extend({ action: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/) }),
            body: z.record(z.string(), z.unknown()).optional(),
        },
        handler: ({ params, body, audit }) =>
            plugins.dispatchAction(params.name, params.action, body ?? {}, audit()),
    }),
```

- [ ] **Step 4: Client method** in `cms-client/src/modules/plugins.ts`:
```ts
    /** Invoke a plugin-defined backend action. */
    action<T = unknown>(name: string, action: string, payload?: Record<string, unknown>): Promise<T> {
        return this.http.post<T>(`/plugins/${name}/action/${action}`, payload ?? {});
    }
```
Match the module's existing `this.http.post` signature/return convention (check a sibling method like `saveConfig`).

- [ ] **Step 5: Gate.** `npx tsc --noEmit -p config/api/tsconfig.json` and `pnpm --filter @sitesurge/client build` clean (ignore the known VideoPlayer baseline in cms only).

---

## Task 2: Campaign ↔ GiveButter mapping columns (core)

**Files:**
- Create: `packages/api/src/db/migrations/058_add_givebutter_to_campaigns.sql`
- Modify: `packages/api/src/db/schema.sql` (campaigns table, ~line 301)
- Modify: `packages/api/src/repositories/campaigns.repo.ts` (`createCampaign` INSERT)
- Modify: `packages/api/src/routes/campaigns.ts` (`campaignSchema` zod)
- Modify: `packages/shared/src/types/campaign.ts` (`Campaign`)
- Modify: `packages/shared/src/api/routes/campaigns.ts` (`CampaignCreateBody`)

- [ ] **Step 1: Migration** `058_add_givebutter_to_campaigns.sql` (no `@feature` tag — campaigns is core, matching 051/052):
```sql
-- Campaign donation-provider selector + GiveButter mapping. All nullable/defaulted
-- so existing rows are unaffected and the columns are harmless when the GiveButter
-- plugin is absent. `donation_provider` = which system collects donations for this
-- campaign: 'internal' (Stripe, default) or 'givebutter'. The GiveButter numeric id
-- + 6-char widget code are stored when the campaign is linked/created in GiveButter.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS donation_provider VARCHAR(16) NOT NULL DEFAULT 'internal';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS givebutter_campaign_id BIGINT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS givebutter_campaign_code VARCHAR(16);
```

- [ ] **Step 2: schema.sql** — add the same three columns to the `campaigns` CREATE TABLE (before `created_by`), so fresh installs match:
```sql
    donation_provider VARCHAR(16) NOT NULL DEFAULT 'internal',
    givebutter_campaign_id BIGINT,
    givebutter_campaign_code VARCHAR(16),
```

- [ ] **Step 3: repo `createCampaign`** — add the three columns to the INSERT column list + values array (`data.donationProvider ?? 'internal'`, `data.givebutterCampaignId ?? null`, `data.givebutterCampaignCode ?? null`). `updateCampaign` needs no change (generic `buildUpdateSet`). `SELECT *` reads already return them.

- [ ] **Step 4: zod `campaignSchema`** in `routes/campaigns.ts` — add:
```ts
    donationProvider: z.enum(['internal', 'givebutter']).optional(),
    givebutterCampaignId: z.number().int().nullable().optional(),
    givebutterCampaignCode: z.string().max(16).nullable().optional(),
```

- [ ] **Step 5: shared types.** In `types/campaign.ts` `Campaign` add:
```ts
    donationProvider: 'internal' | 'givebutter';
    givebutterCampaignId?: number | null;
    givebutterCampaignCode?: string | null;
```
In `api/routes/campaigns.ts` `CampaignCreateBody` add the same three as optional. Keep `AssertCompatible`/`satisfies` bindings compiling.

- [ ] **Step 6: Gate.** `pnpm --filter @sitesurge/types build` then `npx tsc --noEmit -p config/api/tsconfig.json` clean.

---

## Task 3: The GiveButter plugin (`packages/api/plugins/givebutter/`)

**Files:** Create `plugin.json`, `server.js`, `client.js`, `README.md`, `.gitignore`.

- [ ] **Step 1: `plugin.json`**
```json
{
  "name": "givebutter",
  "label": "GiveButter Donations",
  "version": "0.1.0",
  "apiVersion": 1,
  "server": "server.js",
  "client": "client.js",
  "capabilities": ["config-page"],
  "adminOnlyToggle": true,
  "csp": {
    "scriptSrc": ["https://widgets.givebutter.com"],
    "connectSrc": ["https://api.givebutter.com", "https://widgets.givebutter.com"],
    "frameSrc": ["https://givebutter.com", "https://widgets.givebutter.com"],
    "imgSrc": ["https://givebutter.com", "https://*.givebutter.com"]
  },
  "configSchema": [
    { "key": "apiKey", "label": "GiveButter API key", "type": "secret", "required": true },
    { "key": "accountId", "label": "Widget Account ID", "type": "string", "required": true },
    { "key": "apiBaseUrl", "label": "API base URL", "type": "string", "default": "https://api.givebutter.com/v1" },
    { "key": "defaultWidgetType", "label": "Default widget", "type": "select", "options": ["giving-form", "button", "goal-bar"], "default": "giving-form" }
  ]
}
```
`apiKey` is `type:'secret'` → stripped from the public projection. `accountId` is public (needed by the widget script).

- [ ] **Step 2: `server.js`** — GiveButter REST client + actions. Full module:
```js
'use strict';
/**
 * GiveButter plugin — server hooks + backend actions. The admin invokes actions
 * via POST /api/v1/plugins/givebutter/action/:action. All GiveButter API access
 * uses the secret apiKey (never sent to the browser). Every action normalizes
 * errors to { ok:false, status, error } instead of throwing raw, so the admin UI
 * can surface a clear message and detect a broken campaign.
 */
const DEFAULT_BASE = 'https://api.givebutter.com/v1';

function cfg(ctx) {
    const c = ctx.config || {};
    return {
        apiKey: String(c.apiKey || ''),
        accountId: String(c.accountId || ''),
        base: String(c.apiBaseUrl || DEFAULT_BASE).replace(/\/$/, ''),
    };
}

async function gb(ctx, method, path, body) {
    const { apiKey, base } = cfg(ctx);
    if (!apiKey) return { ok: false, status: 0, error: 'GiveButter API key is not configured' };
    let res;
    try {
        res = await ctx.http(`${base}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch (e) {
        return { ok: false, status: 0, error: `Network error reaching GiveButter: ${e && e.message}` };
    }
    if (res.status === 204) return { ok: true, data: null };
    let json = null;
    try { json = await res.json(); } catch (_) { /* non-JSON */ }
    if (!res.ok) {
        const msg = (json && (json.message || json.error)) || res.statusText || `HTTP ${res.status}`;
        return { ok: false, status: res.status, error: msg, details: json };
    }
    return { ok: true, status: res.status, data: json };
}

// Normalize a GiveButter campaign to the fields our UI needs.
function pickCampaign(c) {
    if (!c || typeof c !== 'object') return null;
    return {
        id: c.id, code: c.code, title: c.title, description: c.description,
        goal: c.goal, raised: c.raised, donors: c.donors, url: c.url,
        status: c.status, currency: c.currency, end_at: c.end_at,
    };
}

module.exports = {
    async install(ctx) { ctx.logger.info('GiveButter plugin installed.'); },
    async onEnable(ctx) { ctx.logger.info('GiveButter enabled.'); },
    async onDisable(ctx) { ctx.logger.info('GiveButter disabled.'); },
    async onLoad() { /* no server runtime; the widget is client-side */ },
    async update(ctx) {
        return { fromVersion: ctx.installedVersion || ctx.version, toVersion: ctx.version, migrated: false, notes: 'No migration.' };
    },

    validateConfig(config) {
        const errors = {};
        if (config.apiKey !== undefined && !String(config.apiKey || '').trim()) errors.apiKey = 'API key required';
        if (config.accountId !== undefined && !String(config.accountId || '').trim()) errors.accountId = 'Account ID required';
        if (config.apiBaseUrl && !/^https?:\/\//i.test(String(config.apiBaseUrl))) errors.apiBaseUrl = 'Must be an http(s) URL';
        return { ok: Object.keys(errors).length === 0, errors };
    },

    actions: {
        // Verify credentials by listing the first page of campaigns.
        async testConnection(ctx) {
            const r = await gb(ctx, 'GET', '/campaigns?page=1');
            if (!r.ok) return { ok: false, status: r.status, error: r.error };
            const list = (r.data && r.data.data) || [];
            return { ok: true, accountId: cfg(ctx).accountId, campaignCount: Array.isArray(list) ? list.length : 0 };
        },
        async listCampaigns(ctx, payload) {
            const page = payload && payload.page ? Number(payload.page) : 1;
            const scope = payload && payload.scope ? `&scope=${encodeURIComponent(String(payload.scope))}` : '';
            const r = await gb(ctx, 'GET', `/campaigns?page=${page}${scope}`);
            if (!r.ok) return r;
            const items = ((r.data && r.data.data) || []).map(pickCampaign).filter(Boolean);
            return { ok: true, campaigns: items, meta: (r.data && r.data.meta) || null };
        },
        async getCampaign(ctx, payload) {
            const id = payload && payload.id;
            if (!id) return { ok: false, status: 400, error: 'campaign id required' };
            const r = await gb(ctx, 'GET', `/campaigns/${encodeURIComponent(String(id))}`);
            if (!r.ok) return r;
            return { ok: true, campaign: pickCampaign(r.data && (r.data.data || r.data)) };
        },
        async createCampaign(ctx, payload) {
            const body = {
                title: String((payload && payload.title) || '').trim(),
                type: (payload && payload.type) || 'standard',
            };
            if (!body.title) return { ok: false, status: 400, error: 'title required' };
            if (payload && payload.goal != null) body.goal = Number(payload.goal);
            if (payload && payload.description) body.description = String(payload.description);
            if (payload && payload.end_at) body.end_at = String(payload.end_at);
            const r = await gb(ctx, 'POST', '/campaigns', body);
            if (!r.ok) return r;
            return { ok: true, campaign: pickCampaign(r.data && (r.data.data || r.data)) };
        },
        async updateCampaign(ctx, payload) {
            const id = payload && payload.id;
            if (!id) return { ok: false, status: 400, error: 'campaign id required' };
            const body = {};
            for (const k of ['title', 'goal', 'description', 'end_at']) {
                if (payload[k] !== undefined) body[k] = k === 'goal' ? Number(payload[k]) : payload[k];
            }
            const r = await gb(ctx, 'PATCH', `/campaigns/${encodeURIComponent(String(id))}`, body);
            if (!r.ok) return r;
            return { ok: true, campaign: pickCampaign(r.data && (r.data.data || r.data)) };
        },
        async deleteCampaign(ctx, payload) {
            const id = payload && payload.id;
            if (!id) return { ok: false, status: 400, error: 'campaign id required' };
            const r = await gb(ctx, 'DELETE', `/campaigns/${encodeURIComponent(String(id))}`);
            return r.ok ? { ok: true } : r;
        },
        // Health check for a linked campaign: does it still exist + is it live?
        async checkCampaign(ctx, payload) {
            const id = payload && payload.id;
            if (!id) return { ok: false, status: 400, error: 'campaign id required' };
            const r = await gb(ctx, 'GET', `/campaigns/${encodeURIComponent(String(id))}`);
            if (!r.ok) return { ok: false, status: r.status, error: r.error, exists: r.status !== 404 };
            const c = pickCampaign(r.data && (r.data.data || r.data));
            return { ok: true, exists: true, code: c && c.code, status: c && c.status, campaign: c };
        },
    },
};
```

- [ ] **Step 3: `client.js`** — `mountConfig` (vanilla DOM): apiKey/accountId/apiBaseUrl/defaultWidgetType inputs, **Save** (`host.saveConfig`), **Test connection** (`host.api.post('/action/testConnection')` → shows account + campaign count), and a **Campaigns** button that lists GiveButter campaigns via `host.api.post('/action/listCampaigns')`. Model the DOM helpers on PageLoop's `client.js` (`group`/`input`/`select`/`.form-group`/`.btn`). No `mountWidget` (the donation widget is rendered by core campaign UI, not the global host).

- [ ] **Step 4: `.gitignore`** = `.data/` (no vendored bundle; the widget script is loaded from GiveButter's CDN). `README.md` — short doc mirroring `plugins/pageloop/README.md` (what it does, config keys, how campaigns link, that donations go to GiveButter).

- [ ] **Step 5: Gate.** `node -e "require('./packages/api/plugins/givebutter/server.js')"` loads without error; `node --check packages/api/plugins/givebutter/client.js` passes.

---

## Task 4: Frontend plugin-enabled store + host CSRF (core)

**Files:**
- Create: `packages/cms/src/stores/plugins.ts`
- Modify: `packages/cms/src/plugins/host.ts` (attach CSRF header on POST)

- [ ] **Step 1: `stores/plugins.ts`** — mirror `stores/siteSettings.ts`:
```ts
import { createSignal } from 'solid-js';
import type { PublicPlugin } from '@sitesurge/types';
import { cms } from '../services/cmsClient';

const [enabledPlugins, setEnabledPlugins] = createSignal<PublicPlugin[] | null>(null);
let loading: Promise<PublicPlugin[]> | null = null;

export async function loadEnabledPlugins(force = false): Promise<PublicPlugin[]> {
    if (!force && enabledPlugins() !== null) return enabledPlugins()!;
    if (!loading) loading = cms.plugins.listEnabled().then((p) => { setEnabledPlugins(p); return p; }).catch(() => { setEnabledPlugins([]); return []; }).finally(() => { loading = null; });
    return loading;
}
export { enabledPlugins };
export function isPluginEnabled(name: string): boolean {
    return (enabledPlugins() ?? []).some((p) => p.name === name);
}
export function pluginConfig(name: string): Record<string, unknown> {
    return (enabledPlugins() ?? []).find((p) => p.name === name)?.config ?? {};
}
```

- [ ] **Step 2: host CSRF.** In `host.ts` `call()`, on non-GET add the CSRF header read from the `csrf-token` cookie so admin action POSTs pass `csrfProtection`:
```ts
const headers = body ? { 'Content-Type': 'application/json' } : {};
if (method !== 'GET') {
    const m = document.cookie.match(/(?:^|; )csrf-token=([^;]+)/);
    if (m) headers['x-csrf-token'] = decodeURIComponent(m[1]);
}
```
(Then pass `headers` to fetch.)

- [ ] **Step 3: Gate.** cms typecheck clean.

---

## Task 5: CampaignEditor GiveButter panel (core, plugin-gated)

**Files:** Modify `packages/cms/src/pages/admin/CampaignEditor.tsx`.

- [ ] **Step 1: Load plugin state.** On mount call `loadEnabledPlugins()`; add a memo `const gbEnabled = () => isPluginEnabled('givebutter')`.

- [ ] **Step 2: Signals.** Add `donationProvider` (`'internal'|'givebutter'`, default from loaded campaign), `gbMode` (`'link'|'create'`, UI-only), `gbCampaignId` (number|null), `gbCampaignCode` (string), `gbList` (resource of GiveButter campaigns), `gbStatus` (string for warnings/errors). Hydrate `donationProvider`/`gbCampaignId`/`gbCampaignCode` from the loaded campaign.

- [ ] **Step 3: Panel UI** — a new `form-section` shown `<Show when={gbEnabled()}>`, placed above the columns:
  - Heading "Donations" + a clear badge when `donationProvider()==='givebutter'`: *"GiveButter is managing donations for this campaign."*
  - **Provider** `<select>`: Internal (Stripe) / GiveButter.
  - When `givebutter`:
    - **Mode** `<select>`: "Link existing GiveButter campaign" / "Create new on save".
    - Mode `link`: a **Load campaigns** button → `cms.plugins.action('givebutter','listCampaigns')`; render a `<select>` of `{code} — {title}` (value = id); on pick set `gbCampaignId`+`gbCampaignCode`. Plus a manual **campaign code** text input fallback (sets `gbCampaignCode`, and id if entered).
    - Mode `create`: read-only note that a GiveButter campaign will be created from this campaign's title/goal/description when saved.
    - **Warning** `<Show when={donationProvider()==='givebutter' && !gbCampaignCode()}>`: *"⚠ No GiveButter campaign linked — donations can't render until you link or create one."*

- [ ] **Step 4: Save flow.** In `handleSubmit`, when `gbEnabled() && donationProvider()==='givebutter' && gbMode()==='create' && !gbCampaignId()`, first create the GiveButter campaign:
```ts
const res: any = await cms.plugins.action('givebutter', 'createCampaign', {
    title: title(), description: shortDescription() || description(),
    goal: hasGoal() && goalAmount() ? Math.round(parseFloat(goalAmount()) * 100) : undefined,
    end_at: endDate() ? new Date(endDate()).toISOString() : undefined,
});
if (!res?.ok || !res.campaign?.code) { setGbStatus(res?.error || 'GiveButter campaign creation failed'); return; }
setGbCampaignId(res.campaign.id); setGbCampaignCode(res.campaign.code);
```
Then include in the payload: `donationProvider: donationProvider(), givebutterCampaignId: gbCampaignId(), givebutterCampaignCode: gbCampaignCode()`. On link mode, persist the picked id/code. If provider is `internal`, still send `donationProvider:'internal'` (clears any prior mapping is optional — leave id/code as-is).

- [ ] **Step 5: Gate.** cms typecheck clean; manual check the panel only appears when the plugin is enabled.

---

## Task 6: GiveButter widget rendering (core, plugin-gated)

**Files:**
- Create: `packages/cms/src/components/blocks/GiveButterWidget.tsx` (+ small scss or inline)
- Modify: `packages/cms/src/pages/Campaign.tsx`
- Modify: `packages/cms/src/components/blocks/BlockRenderer.tsx` (`CampaignBlock`)

- [ ] **Step 1: `GiveButterWidget.tsx`** — injects the widgets library once and renders the custom element:
```tsx
import { onMount, createSignal, Show } from 'solid-js';
import { pluginConfig } from '../../stores/plugins';

let libLoaded = false;
function ensureLib(accountId: string) {
    if (libLoaded || !accountId) return;
    if (document.querySelector('script[data-givebutter]')) { libLoaded = true; return; }
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://widgets.givebutter.com/latest.umd.cjs?acct=${encodeURIComponent(accountId)}`;
    s.setAttribute('data-givebutter', '1');
    document.head.appendChild(s);
    libLoaded = true;
}

export default function GiveButterWidget(props: { code?: string | null; type?: string }) {
    const [ready, setReady] = createSignal(false);
    onMount(() => {
        const acct = String(pluginConfig('givebutter').accountId || '');
        ensureLib(acct);
        setReady(Boolean(acct && props.code));
    });
    const tag = () => (props.type === 'button' ? 'givebutter-button' : props.type === 'goal-bar' ? 'givebutter-goal-bar' : 'givebutter-giving-form');
    return (
        <Show when={ready() && props.code} fallback={<div class="gb-widget__missing">This campaign isn't linked to GiveButter yet.</div>}>
            {/* eslint-disable-next-line */}
            <div class="gb-widget" innerHTML={`<${tag()} campaign="${props.code}"></${tag()}>`} />
        </Show>
    );
}
```
(Custom elements aren't in Solid's JSX types; injecting via `innerHTML` on a wrapper avoids TS friction and is safe — `code` is a 6-char server-controlled token. If SSR/hydration complains, guard with `isServer`.)

- [ ] **Step 2: `Campaign.tsx`** — when `isPluginEnabled('givebutter') && c().donationProvider==='givebutter'`, render `<GiveButterWidget code={c().givebutterCampaignCode} />` in place of `<DonationForm>`; if the code is missing show the "not linked" note. Otherwise render the existing `<DonationForm>`. Call `loadEnabledPlugins()` alongside the campaign fetch.

- [ ] **Step 3: `CampaignBlock`** (in `BlockRenderer.tsx`) — for the single-campaign case, when the resolved campaign is GiveButter-provided and the plugin is enabled, render the `giving-form` widget inline **below** the existing `CampaignCard` (so the block both teases and accepts donations). Keep the all-campaigns list path unchanged. Load plugin state at the block level (or read the already-loaded store).

- [ ] **Step 4: Gate.** cms build (`pnpm --filter @sitesurge/admin build`) succeeds.

---

## Task 7: Docs + marketplace catalog

**Files:**
- Create: `docs/how-it-works/GIVEBUTTER.md`
- Modify: `CLAUDE.md` (Plugins bullet — mention GiveButter as the second first-party plugin), `docs/how-it-works/PLUGINS.md` (note the new action-RPC capability + GiveButter), `README.md` if it enumerates plugins.

- [ ] **Step 1:** Write `docs/how-it-works/GIVEBUTTER.md`: what it does, config keys (apiKey/accountId/apiBaseUrl/defaultWidgetType), the per-campaign provider switch + link/create flow, the widget rendering, actions list, error handling, and the **future work** note (webhook total sync, delete UI). Mirror the tone/length of `docs/how-it-works/PLUGINS.md`.
- [ ] **Step 2:** Add a one-line note in `CLAUDE.md` Plugins section + document the generic **plugin action-RPC** (`POST /plugins/:name/action/:action` → `actions` map) in `docs/how-it-works/PLUGINS.md` under the server.js contract.
- [ ] **Step 3:** Confirm the build's plugin-catalog copy picks up `plugins/givebutter/*` (it copies `plugins/*` minus vendor `client/`), so marketplace install works for npm-server consumers.

---

## Task 8: Verification + deploy

- [ ] Full ordered build: `pnpm --filter @sitesurge/types build && pnpm --filter @sitesurge/server build && pnpm --filter @sitesurge/admin build && pnpm --filter @sitesurge/client build`.
- [ ] `npx tsc --noEmit -p config/api/tsconfig.json` and cms typecheck (minus VideoPlayer baseline) clean.
- [ ] Local smoke: enable the plugin (Settings → Features → Plugins, then install+enable `givebutter`), set apiKey/accountId, open a campaign editor → GiveButter panel appears; provider=givebutter + a code → public campaign page renders the giving-form.
- [ ] Deploy via `./deploy/hotpatch-surge.sh` **without** `SKIP_MIGRATE` (migration 058 must run on surge), health green. Commit + push per house rules (stage by path; brief messages; no secrets).

## Risks / decisions

- **Core columns on `campaigns`** (vs a plugin-owned table): chosen so the *public* campaign payload carries the widget code with no extra public endpoint; columns are nullable/defaulted and inert without the plugin.
- **Action-RPC not txn-wrapped:** actions do external HTTP; wrapping in `withPluginTxn` would hold a PG advisory lock across network I/O. Writes to plugin tables (none here) would need their own txn.
- **Donation totals:** GiveButter collects donations client-side; our `current_amount_cents`/`donorCount` won't reflect GiveButter donations. Displaying GiveButter's own `raised`/goal (via `getCampaign`/goal-bar) and webhook sync are follow-ups.
- **Delete campaign:** the `deleteCampaign` action exists but is intentionally not wired to a destructive admin button in v1 (user noted "which will add eventually").
