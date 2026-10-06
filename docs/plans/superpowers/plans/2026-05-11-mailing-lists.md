# Mailing Lists Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax. After each phase, run `npm run build` from the repo root and confirm green before moving on. Commit at the end of each phase (or at logical sub-points within long phases).

**Goal:** Ship a complete Mailing Lists feature: dependency-aware feature toggle infrastructure, list + subscriber management, content-block-based mail templates, send wizard with tracked jobs and provider abstraction, token-based public unsubscribe.

**Architecture:** Five-phase rollout. Phase 1 builds shared feature-dependency infrastructure (registry, validator, lazy-install migrations). Phases 2–4 build Mailing Lists vertically: lists+subscribers → templates → send wizard. Phase 5 polishes (double-opt-in, audit, cache, bulk actions). Each phase is self-contained and ships working software.

**Tech Stack:** Express/Node/TypeScript backend; PostgreSQL via raw `pg`; Redis cache; SolidJS frontend; Nodemailer for SMTP; existing block editor & renderer reused for templates.

**Verification:** The project has minimal automated test infrastructure. Primary safety net is `npm run build` (TypeScript type-check across all three workspaces) + manual UI verification. We add targeted unit tests for the few high-risk pure functions (dependency validator, HMAC token gen/verify, variable substitution).

**Spec:** `docs/plans/superpowers/specs/2026-05-11-mailing-lists-design.md`

---

## File Structure (locked decisions)

### New backend files

```
backend/src/features/registry.ts              — FEATURE_REGISTRY + validateEnable
backend/src/features/migrations.ts            — applyFeatureMigrations
backend/src/db/migrations/030_*.sql … 036_*.sql — six tagged migrations
backend/src/repositories/mailingLists.repo.ts
backend/src/repositories/mailingListSubscribers.repo.ts
backend/src/repositories/mailTemplates.repo.ts
backend/src/repositories/mailTemplateBlocks.repo.ts
backend/src/repositories/mailSendJobs.repo.ts
backend/src/repositories/mailSendRecipients.repo.ts
backend/src/routes/mailingLists.ts
backend/src/routes/mailTemplates.ts
backend/src/routes/mailSend.ts
backend/src/routes/unsubscribe.ts
backend/src/services/mail/renderer.ts
backend/src/services/mail/variables.ts
backend/src/services/mail/sendWorker.ts
backend/src/services/mail/unsubscribe.ts
backend/src/services/mail/blocks/{richText,image,urlLink,spacer,hero,html,group,video,social,form,campaign,postList,carousel,document,index}.ts
backend/src/services/mail/providers/{types,smtp,mailgun,sendgrid,postmark,factory}.ts
backend/src/sdk/mailingLists.ts
backend/src/sdk/mailTemplates.ts
backend/src/sdk/mail.ts
```

### Modified backend files

```
backend/src/db/migrator.ts                    — @feature header parsing
backend/src/db/client.ts                      — (no changes)
backend/src/routes/settings.ts                — dependency-aware enable/disable
backend/src/services/email.ts                 — refactored over MailProvider
backend/src/services/cache.ts                 — invalidateMailCaches helpers
backend/src/app.ts                            — mount new routes + unsubscribe + boot resumer
backend/src/index.ts                          — call resumeRunningJobs after boot
backend/src/routes/index.ts                   — register new admin routers
backend/src/db/seed.ts                        — register mailing_lists feature row
backend/src/config/loader.ts (or config/index.ts) — read MAIL_PROVIDER, concurrency, delay, unsubscribe secret
backend/.env.example                          — new env vars documented
```

### New frontend files

```
frontend/src/pages/admin/MailingLists.tsx
frontend/src/pages/admin/MailingListEdit.tsx
frontend/src/pages/admin/MailTemplateEdit.tsx
frontend/src/pages/admin/MailSend.tsx
frontend/src/pages/admin/MailJob.tsx
frontend/src/components/admin/features/FeatureToggleRow.tsx
frontend/src/components/admin/features/FeatureDependencyModal.tsx
frontend/src/components/admin/mailing-lists/ListSettingsForm.tsx
frontend/src/components/admin/mailing-lists/SubscribersTable.tsx
frontend/src/components/admin/mailing-lists/SubscriberEditModal.tsx
frontend/src/components/admin/mail/TemplatesTable.tsx
frontend/src/components/admin/mail/MailTemplateBlockAdapter.ts
frontend/src/components/admin/mail/MailPreviewModal.tsx
frontend/src/components/admin/mail/VariableForm.tsx
frontend/src/components/admin/mail/MailJobStatus.tsx
frontend/src/pages/admin/styles/_mailing-lists.scss
```

### Modified frontend files

```
frontend/src/App.tsx                          — register new admin routes
frontend/src/pages/admin/AdminLayout.tsx      — Mailing Lists nav entry
frontend/src/pages/admin/AdminLayout.scss     — @use the new partial
frontend/src/stores/siteSettings.ts           — feature dependency helpers
frontend/src/config/blockTypes.ts             — emailRender / emailRenderWarning fields
frontend/src/services/api.ts                  — mailing-list + template + send helpers
frontend/src/pages/admin/Settings.tsx         — refactor Features panel to use FeatureToggleRow
```

### Shared

```
shared/src/types/mail.ts                      — all mailing-list & template & send types
shared/src/index.ts                           — re-export from mail.ts
```

---

# PHASE 1 — Feature Dependency Infrastructure

Builds the shared dependency-aware feature system. No mailing-list-specific code yet. Verifies existing six features still toggle correctly.

## Task 1.1: Shared FeatureKey type & registry skeleton

**Files:**
- Create: `backend/src/features/registry.ts`

- [ ] **Step 1: Create the registry file**

```ts
// backend/src/features/registry.ts
export type FeatureKey =
    | 'patreon' | 'posts' | 'campaigns' | 'forms' | 'messages' | 'users'
    | 'mailing_lists';

export interface FeatureConfig {
    key: FeatureKey;
    label: string;
    description?: string;
    defaultEnabled: boolean;
    requires?: FeatureKey[];
    migrations?: string[];
}

export const FEATURE_REGISTRY: Record<FeatureKey, FeatureConfig> = {
    patreon:       { key: 'patreon',       label: 'Patreon',       defaultEnabled: false, description: 'Patreon OAuth + membership tier sync.' },
    posts:         { key: 'posts',         label: 'Posts',         defaultEnabled: true,  description: 'Blog posts with rich content blocks.' },
    campaigns:     { key: 'campaigns',     label: 'Campaigns',     defaultEnabled: true,  description: 'Fundraising campaigns + donations.' },
    forms:         { key: 'forms',         label: 'Forms',         defaultEnabled: true,  description: 'Custom forms, surveys, polls.' },
    messages:      { key: 'messages',      label: 'Messages',      defaultEnabled: true,  description: 'Public contact form inbox.' },
    users:         { key: 'users',         label: 'Users',         defaultEnabled: false, description: 'Registered users, member tiers, gated content.' },
    mailing_lists: {
        key: 'mailing_lists',
        label: 'Mailing Lists',
        description: 'Author mail templates and send to subscriber lists.',
        defaultEnabled: false,
        requires: ['users'],
        migrations: [
            '030_create_mailing_lists.sql',
            '031_create_mailing_list_subscribers.sql',
            '032_create_mail_templates.sql',
            '033_create_mail_template_blocks.sql',
            '034_create_mail_send_jobs.sql',
            '035_create_mail_send_recipients.sql',
            '036_seed_mailing_lists_feature_setting.sql',
        ],
    },
};

/** Map feature key → site_settings row key. */
export function featureSettingKey(key: FeatureKey): string {
    return `${key}_enabled`;
}

/** Detect simple cycles at boot. Fail-fast on first cycle. */
export function assertNoCycles(): void {
    const visiting = new Set<FeatureKey>();
    const visited = new Set<FeatureKey>();
    const dfs = (k: FeatureKey, stack: FeatureKey[]) => {
        if (visiting.has(k)) throw new Error(`Feature dependency cycle: ${[...stack, k].join(' → ')}`);
        if (visited.has(k)) return;
        visiting.add(k);
        for (const r of FEATURE_REGISTRY[k].requires ?? []) {
            if (!FEATURE_REGISTRY[r]) throw new Error(`Feature '${k}' requires unknown feature '${r}'`);
            dfs(r, [...stack, k]);
        }
        visiting.delete(k);
        visited.add(k);
    };
    for (const k of Object.keys(FEATURE_REGISTRY) as FeatureKey[]) dfs(k, []);
}

/** Features that declare `key` as a prerequisite. */
export function getDependents(key: FeatureKey): FeatureKey[] {
    return (Object.values(FEATURE_REGISTRY) as FeatureConfig[])
        .filter(c => (c.requires ?? []).includes(key))
        .map(c => c.key);
}
```

- [ ] **Step 2: Type-check**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add backend/src/features/registry.ts
git commit -m "feat(features): introduce FeatureKey registry"
```

---

## Task 1.2: validateEnable pure function + tests

**Files:**
- Create: `backend/src/features/validator.ts`
- Create: `backend/src/features/validator.test.ts`

- [ ] **Step 1: Write the test file first**

```ts
// backend/src/features/validator.test.ts
import { validateEnable } from './validator';

const allOff = { patreon: false, posts: false, campaigns: false, forms: false, messages: false, users: false, mailing_lists: false } as const;

describe('validateEnable', () => {
    it('plans a single enable when no deps involved', () => {
        const r = validateEnable({ posts: true }, allOff);
        expect(r).toEqual({ ok: true, plan: [{ key: 'posts', enabled: true }] });
    });

    it('refuses enabling mailing_lists when users is off', () => {
        const r = validateEnable({ mailing_lists: true }, allOff);
        expect(r).toEqual({ ok: false, kind: 'missing_prerequisites', target: 'mailing_lists', missing: ['users'] });
    });

    it('plans prerequisite then target when enableDependencies=true', () => {
        const r = validateEnable({ mailing_lists: true }, allOff, { enableDependencies: true });
        expect(r).toEqual({ ok: true, plan: [{ key: 'users', enabled: true }, { key: 'mailing_lists', enabled: true }] });
    });

    it('refuses disabling users when mailing_lists is on', () => {
        const r = validateEnable({ users: false }, { ...allOff, users: true, mailing_lists: true });
        expect(r).toEqual({ ok: false, kind: 'has_dependents', target: 'users', dependents: ['mailing_lists'] });
    });

    it('plans dependent then target when disableDependents=true', () => {
        const r = validateEnable({ users: false }, { ...allOff, users: true, mailing_lists: true }, { disableDependents: true });
        expect(r).toEqual({ ok: true, plan: [{ key: 'mailing_lists', enabled: false }, { key: 'users', enabled: false }] });
    });

    it('no-op when target already in requested state', () => {
        const r = validateEnable({ posts: true }, { ...allOff, posts: true });
        expect(r).toEqual({ ok: true, plan: [] });
    });
});
```

- [ ] **Step 2: Implement validator**

```ts
// backend/src/features/validator.ts
import { FEATURE_REGISTRY, FeatureKey, getDependents } from './registry';

export interface PlanStep { key: FeatureKey; enabled: boolean; }
export type ValidationResult =
    | { ok: true; plan: PlanStep[] }
    | { ok: false; kind: 'missing_prerequisites'; target: FeatureKey; missing: FeatureKey[] }
    | { ok: false; kind: 'has_dependents'; target: FeatureKey; dependents: FeatureKey[] };

export interface ValidateOpts { enableDependencies?: boolean; disableDependents?: boolean; }

export function validateEnable(
    target: Partial<Record<FeatureKey, boolean>>,
    current: Record<FeatureKey, boolean>,
    opts: ValidateOpts = {},
): ValidationResult {
    const plan: PlanStep[] = [];
    const projected = { ...current };

    for (const [k, desired] of Object.entries(target) as [FeatureKey, boolean][]) {
        if (projected[k] === desired) continue;

        if (desired === true) {
            const missing = (FEATURE_REGISTRY[k].requires ?? []).filter(r => !projected[r]);
            if (missing.length > 0) {
                if (!opts.enableDependencies) return { ok: false, kind: 'missing_prerequisites', target: k, missing };
                for (const m of missing) {
                    plan.push({ key: m, enabled: true });
                    projected[m] = true;
                }
            }
            plan.push({ key: k, enabled: true });
            projected[k] = true;
        } else {
            const dependents = getDependents(k).filter(d => projected[d]);
            if (dependents.length > 0) {
                if (!opts.disableDependents) return { ok: false, kind: 'has_dependents', target: k, dependents };
                for (const d of dependents) {
                    plan.push({ key: d, enabled: false });
                    projected[d] = false;
                }
            }
            plan.push({ key: k, enabled: false });
            projected[k] = false;
        }
    }

    return { ok: true, plan };
}
```

- [ ] **Step 3: Type-check + run tests**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS

If the project has Jest configured (`backend/jest.config.*`), run tests; otherwise type-check is sufficient. Tests serve as living documentation either way.

- [ ] **Step 4: Commit**

```bash
git add backend/src/features/validator.ts backend/src/features/validator.test.ts
git commit -m "feat(features): validateEnable with dependency planning"
```

---

## Task 1.3: Migration runner — @feature header parsing

**Files:**
- Modify: `backend/src/db/migrator.ts`
- Create: `backend/src/features/migrations.ts`

- [ ] **Step 1: Add feature column to schema_migrations**

Modify `ensureMigrationsTable` in `backend/src/db/migrator.ts`:

```ts
async function ensureMigrationsTable(pool: Pool,): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id SERIAL PRIMARY KEY,
            filename VARCHAR(255) NOT NULL UNIQUE,
            applied_at TIMESTAMPTZ DEFAULT NOW(),
            feature VARCHAR(64) NULL
        );
    `,);
    await pool.query(`
        ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS feature VARCHAR(64) NULL;
    `,);
}
```

- [ ] **Step 2: Add feature-header parser**

Insert near top of `backend/src/db/migrator.ts`, after imports:

```ts
const FEATURE_HEADER_RE = /^\s*--\s*@feature\s+(\w+)\s*$/m;

export function parseFeatureHeader(sql: string): string | null {
    const m = sql.match(FEATURE_HEADER_RE);
    return m ? m[1] : null;
}
```

- [ ] **Step 3: Change applyMigration to accept feature**

```ts
async function applyMigration(pool: Pool, filename: string, sql: string,): Promise<void> {
    const feature = parseFeatureHeader(sql);
    const client = await pool.connect();
    try {
        await client.query('BEGIN',);
        await client.query(sql,);
        await client.query(
            'INSERT INTO schema_migrations (filename, feature) VALUES ($1, $2)',
            [filename, feature],
        );
        await client.query('COMMIT',);
        logger.info(`Applied migration: ${filename}${feature ? ` (feature=${feature})` : ''}`,);
    } catch (error) {
        await client.query('ROLLBACK',);
        logger.error(`Migration failed: ${filename}`, { error, },);
        throw error;
    } finally {
        client.release();
    }
}
```

- [ ] **Step 4: Filter runMigrations to skip disabled features**

In `runMigrations`, replace the `for (const filename of getMigrationFiles())` loop with:

```ts
const enabledFeatures = await getEnabledFeatures(pool);
for (const filename of getMigrationFiles()) {
    if (applied.has(filename,)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename,), 'utf-8',);
    const feature = parseFeatureHeader(sql);
    if (feature && !enabledFeatures.has(feature)) {
        logger.info(`Skipping migration ${filename}: feature '${feature}' disabled`);
        continue;
    }
    await applyMigration(pool, filename, sql,);
    appliedFilenames.push(filename,);
}
```

Add `getEnabledFeatures` helper near top:

```ts
async function getEnabledFeatures(pool: Pool): Promise<Set<string>> {
    try {
        const r = await pool.query<{ key: string; value: unknown }>(
            `SELECT key, value FROM site_settings WHERE key LIKE '%_enabled'`,
        );
        const enabled = new Set<string>();
        for (const row of r.rows) {
            const key = row.key.replace(/_enabled$/, '');
            const v = row.value;
            const isTrue = v === true || v === 'true' || (typeof v === 'object' && v !== null && (v as any).value === true);
            if (isTrue) enabled.add(key);
        }
        return enabled;
    } catch {
        return new Set();
    }
}
```

- [ ] **Step 5: Create feature-migration applier**

```ts
// backend/src/features/migrations.ts
import fs from 'fs';
import path from 'path';
import type { PoolClient } from 'pg';
import { logger } from '../utils/logger';
import { FEATURE_REGISTRY, FeatureKey } from './registry';
import { parseFeatureHeader } from '../db/migrator';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

export async function applyFeatureMigrations(key: FeatureKey, client: PoolClient): Promise<string[]> {
    const lockKey = `feature:${key}`;
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey]);

    const cfg = FEATURE_REGISTRY[key];
    const filenames = cfg.migrations ?? [];
    if (filenames.length === 0) return [];

    const applied = await client.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations WHERE filename = ANY($1)`,
        [filenames],
    );
    const appliedSet = new Set(applied.rows.map(r => r.filename));

    const ran: string[] = [];
    for (const filename of filenames) {
        if (appliedSet.has(filename)) continue;
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf-8');
        const feature = parseFeatureHeader(sql);
        if (feature && feature !== key) {
            throw new Error(`Migration ${filename} is tagged @feature ${feature} but listed under ${key}`);
        }
        await client.query(sql);
        await client.query(
            'INSERT INTO schema_migrations (filename, feature) VALUES ($1, $2)',
            [filename, key],
        );
        logger.info(`Applied feature migration: ${filename} (feature=${key})`);
        ran.push(filename);
    }
    return ran;
}
```

- [ ] **Step 6: Type-check + commit**

```bash
cd /home/rw3iss/Sites/rw/rw-cms && cd backend && npx tsc --noEmit
git add backend/src/db/migrator.ts backend/src/features/migrations.ts
git commit -m "feat(migrations): @feature header parsing + lazy-install applier"
```

---

## Task 1.4: PUT /settings — dependency-aware enable/disable

**Files:**
- Modify: `backend/src/routes/settings.ts`

- [ ] **Step 1: Replace FEATURE_TO_SETTING_KEY with registry-driven approach**

In `backend/src/routes/settings.ts`:

```ts
// Remove the old FEATURE_TO_SETTING_KEY const.
// Replace settingsSchema.features with:
features: z.record(z.string(), z.boolean()).optional(),

// Add the new flags to settingsSchema:
enableDependencies: z.boolean().optional(),
disableDependents: z.boolean().optional(),
```

Add imports at top:

```ts
import { FEATURE_REGISTRY, FeatureKey, featureSettingKey } from '../features/registry';
import { validateEnable } from '../features/validator';
import { applyFeatureMigrations } from '../features/migrations';
import { getPool } from '../db/client';
```

- [ ] **Step 2: Replace the features-handling block in PUT handler**

Find the section that handles `parsed.data.features` and replace with:

```ts
if (parsed.data.features) {
    const currentRows = await query(`SELECT key, value FROM site_settings WHERE key LIKE '%_enabled'`);
    const current: Record<FeatureKey, boolean> = {} as any;
    for (const k of Object.keys(FEATURE_REGISTRY) as FeatureKey[]) {
        current[k] = FEATURE_REGISTRY[k].defaultEnabled;
    }
    for (const row of currentRows.rows) {
        const key = String(row.key).replace(/_enabled$/, '') as FeatureKey;
        if (FEATURE_REGISTRY[key]) {
            current[key] = row.value === true || (typeof row.value === 'object' && row.value !== null && (row.value as any).value === true);
        }
    }

    const targetEntries = Object.entries(parsed.data.features) as [FeatureKey, boolean][];
    const target: Partial<Record<FeatureKey, boolean>> = {};
    for (const [k, v] of targetEntries) {
        if (!FEATURE_REGISTRY[k]) {
            throw new ValidationError(`Unknown feature: ${k}`);
        }
        target[k] = v;
    }

    const result = validateEnable(target, current, {
        enableDependencies: parsed.data.enableDependencies,
        disableDependents: parsed.data.disableDependents,
    });

    if (!result.ok) {
        return res.status(409).json({ success: false, error: result });
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const step of result.plan) {
            if (step.enabled) {
                await applyFeatureMigrations(step.key, client);
            }
            await client.query(
                `INSERT INTO site_settings (key, value, updated_by)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
                [featureSettingKey(step.key), JSON.stringify(step.enabled), authReq.user!.id],
            );
        }
        await client.query('COMMIT');

        await logAudit({
            userId: authReq.user!.id,
            action: 'update',
            entityType: 'settings',
            entityId: 'features',
            newValues: { plan: result.plan },
            ipAddress: authReq.ip,
            userAgent: authReq.headers['user-agent'] as string,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    await cache.invalidateSettingsCache();
}
```

- [ ] **Step 3: Update computePublicFeatures to iterate the registry**

Find `computePublicFeatures` and refactor to:

```ts
async function computePublicFeatures(settings: Record<string, unknown>): Promise<SiteSettings['features']> {
    const out: Record<string, { enabled: boolean }> = {};
    for (const cfg of Object.values(FEATURE_REGISTRY)) {
        const row = settings[featureSettingKey(cfg.key)];
        let enabled = cfg.defaultEnabled;
        if (row === true) enabled = true;
        else if (row === false) enabled = false;
        else if (typeof row === 'object' && row !== null && 'value' in row) enabled = Boolean((row as any).value);
        out[cfg.key] = { enabled };
    }
    // Patreon stays gated on runtime connection check (existing behavior)
    if (out.patreon?.enabled) {
        const hasPatreon = !!(config.patreon?.clientId && config.patreon?.clientSecret);
        out.patreon = { enabled: hasPatreon };
    }
    return out as SiteSettings['features'];
}
```

- [ ] **Step 4: Boot cycle-check**

In `backend/src/index.ts`, add near the top (after imports):

```ts
import { assertNoCycles } from './features/registry';
assertNoCycles();
```

- [ ] **Step 5: Type-check + commit**

```bash
cd backend && npx tsc --noEmit
git add backend/src/routes/settings.ts backend/src/index.ts
git commit -m "feat(settings): dependency-aware feature toggle endpoint"
```

---

## Task 1.5: Frontend store — dependency helpers

**Files:**
- Modify: `frontend/src/stores/siteSettings.ts`
- Create: `frontend/src/config/features.ts` (mirrors backend registry — keep simple)

- [ ] **Step 1: Create frontend feature registry mirror**

```ts
// frontend/src/config/features.ts
export type FeatureKey =
    | 'patreon' | 'posts' | 'campaigns' | 'forms' | 'messages' | 'users'
    | 'mailing_lists';

export interface FeatureConfig {
    key: FeatureKey;
    label: string;
    description?: string;
    requires?: FeatureKey[];
}

export const FEATURES: FeatureConfig[] = [
    { key: 'patreon',       label: 'Patreon',       description: 'Patreon OAuth + membership tiers.' },
    { key: 'users',         label: 'Users',         description: 'Registered users, member tiers, gated content.' },
    { key: 'posts',         label: 'Posts',         description: 'Blog posts with content blocks.' },
    { key: 'campaigns',     label: 'Campaigns',     description: 'Fundraising campaigns + donations.' },
    { key: 'forms',         label: 'Forms',         description: 'Custom forms, surveys, polls.' },
    { key: 'messages',      label: 'Messages',      description: 'Public contact form inbox.' },
    { key: 'mailing_lists', label: 'Mailing Lists', description: 'Subscriber lists + mail templates.', requires: ['users'] },
];

export function getFeature(key: FeatureKey): FeatureConfig {
    const f = FEATURES.find(f => f.key === key);
    if (!f) throw new Error(`Unknown feature: ${key}`);
    return f;
}

export function getDependents(key: FeatureKey): FeatureKey[] {
    return FEATURES.filter(f => (f.requires ?? []).includes(key)).map(f => f.key);
}
```

- [ ] **Step 2: Add helpers to siteSettings store**

In `frontend/src/stores/siteSettings.ts`, append:

```ts
import { FEATURES, FeatureKey, getDependents as registryDependents, getFeature } from '../config/features';

export function getFeatureConfig(key: FeatureKey) { return getFeature(key); }

export function getMissingPrerequisites(key: FeatureKey): FeatureKey[] {
    const cfg = getFeature(key);
    return (cfg.requires ?? []).filter(r => !isFeatureEnabled(r));
}

export function getEnabledDependents(key: FeatureKey): FeatureKey[] {
    return registryDependents(key).filter(d => isFeatureEnabled(d));
}

export function allFeatures(): typeof FEATURES { return FEATURES; }
```

- [ ] **Step 3: Type-check + commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/config/features.ts frontend/src/stores/siteSettings.ts
git commit -m "feat(features): frontend registry + dependency helpers"
```

---

## Task 1.6: FeatureToggleRow + FeatureDependencyModal components

**Files:**
- Create: `frontend/src/components/admin/features/FeatureToggleRow.tsx`
- Create: `frontend/src/components/admin/features/FeatureDependencyModal.tsx`
- Create: `frontend/src/components/admin/features/features.scss`

- [ ] **Step 1: FeatureDependencyModal**

```tsx
// frontend/src/components/admin/features/FeatureDependencyModal.tsx
import { Component, For } from 'solid-js';
import { Portal } from 'solid-js/web';
import { FeatureKey, getFeature } from '../../../config/features';

interface Props {
    target: FeatureKey;
    mode: 'enable' | 'disable';
    chain: FeatureKey[];   // features that will also be toggled (prereqs or dependents)
    onConfirm: () => void;
    onCancel: () => void;
}

const FeatureDependencyModal: Component<Props> = (p) => {
    const verb = () => p.mode === 'enable' ? 'enable' : 'disable';
    const targetLabel = () => getFeature(p.target).label;
    const chainLabels = () => p.chain.map(k => getFeature(k).label);
    const allLabels = () => p.mode === 'enable'
        ? [...chainLabels(), targetLabel()]
        : [...chainLabels(), targetLabel()];

    return (
        <Portal>
            <div class="modal-overlay" onClick={p.onCancel}>
                <div class="modal feature-dep-modal" onClick={e => e.stopPropagation()}>
                    <h3>{verb().charAt(0).toUpperCase() + verb().slice(1)} {targetLabel()}?</h3>
                    <p>
                        {p.mode === 'enable'
                            ? `${targetLabel()} requires the following features. They will also be enabled:`
                            : `These features depend on ${targetLabel()} and will also be disabled:`}
                    </p>
                    <ul>
                        <For each={chainLabels()}>{(l) => <li>{l}</li>}</For>
                    </ul>
                    <div class="modal-actions">
                        <button class="btn btn--secondary" onClick={p.onCancel}>Cancel</button>
                        <button class={`btn ${p.mode === 'enable' ? 'btn--primary' : 'btn--danger'}`} onClick={p.onConfirm}>
                            {verb().charAt(0).toUpperCase() + verb().slice(1)} {allLabels().join(' + ')}
                        </button>
                    </div>
                </div>
            </div>
        </Portal>
    );
};

export default FeatureDependencyModal;
```

- [ ] **Step 2: FeatureToggleRow**

```tsx
// frontend/src/components/admin/features/FeatureToggleRow.tsx
import { Component, createSignal, Show } from 'solid-js';
import { FeatureKey, getFeature } from '../../../config/features';
import {
    isFeatureEnabled,
    getMissingPrerequisites,
    getEnabledDependents,
} from '../../../stores/siteSettings';
import FeatureDependencyModal from './FeatureDependencyModal';

interface Props {
    featureKey: FeatureKey;
    onChange: (next: boolean, opts?: { enableDependencies?: boolean; disableDependents?: boolean }) => void | Promise<void>;
}

const FeatureToggleRow: Component<Props> = (p) => {
    const cfg = () => getFeature(p.featureKey);
    const enabled = () => isFeatureEnabled(p.featureKey);
    const missing = () => getMissingPrerequisites(p.featureKey);
    const dependents = () => getEnabledDependents(p.featureKey);

    const [modal, setModal] = createSignal<'enable' | 'disable' | null>(null);

    const onClick = () => {
        if (!enabled()) {
            if (missing().length > 0) { setModal('enable'); return; }
            void p.onChange(true);
        } else {
            if (dependents().length > 0) { setModal('disable'); return; }
            void p.onChange(false);
        }
    };

    return (
        <div class="feature-toggle-row">
            <div class="feature-toggle-row__info">
                <div class="feature-toggle-row__label">
                    {cfg().label}
                    <Show when={cfg().requires && cfg().requires!.length > 0}>
                        <span
                            class="feature-toggle-row__info-icon"
                            title={`Requires: ${cfg().requires!.map(k => getFeature(k).label).join(', ')}`}
                        >ⓘ</span>
                    </Show>
                </div>
                <Show when={cfg().description}>
                    <small class="feature-toggle-row__desc">{cfg().description}</small>
                </Show>
            </div>
            <button
                type="button"
                class={`feature-toggle-row__switch ${enabled() ? 'is-on' : ''} ${missing().length > 0 && !enabled() ? 'is-blocked' : ''}`}
                onClick={onClick}
                aria-pressed={enabled()}
            >
                <span class="feature-toggle-row__knob" />
            </button>

            <Show when={modal() === 'enable'}>
                <FeatureDependencyModal
                    target={p.featureKey}
                    mode="enable"
                    chain={missing()}
                    onCancel={() => setModal(null)}
                    onConfirm={async () => { setModal(null); await p.onChange(true, { enableDependencies: true }); }}
                />
            </Show>
            <Show when={modal() === 'disable'}>
                <FeatureDependencyModal
                    target={p.featureKey}
                    mode="disable"
                    chain={dependents()}
                    onCancel={() => setModal(null)}
                    onConfirm={async () => { setModal(null); await p.onChange(false, { disableDependents: true }); }}
                />
            </Show>
        </div>
    );
};

export default FeatureToggleRow;
```

- [ ] **Step 3: SCSS**

```scss
// frontend/src/components/admin/features/features.scss
@use 'sass:color';
@use '../../../styles/variables' as *;

.feature-toggle-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--admin-border, $border-color);

    &__info { flex: 1; min-width: 0; }
    &__label { font-weight: 500; display: flex; align-items: center; gap: 0.4rem; }
    &__desc { color: var(--admin-text-muted, $text-light); display: block; margin-top: 0.15rem; }
    &__info-icon { cursor: help; color: var(--admin-text-muted, $text-light); font-size: 0.9em; }

    &__switch {
        position: relative;
        width: 44px; height: 24px; border-radius: 12px;
        background: var(--admin-border, $border-color);
        border: none; cursor: pointer; transition: background 120ms;
        &.is-on { background: var(--site-primary, $primary-color); }
        &.is-blocked { opacity: 0.55; cursor: pointer; }
    }
    &__knob {
        position: absolute; top: 2px; left: 2px;
        width: 20px; height: 20px; border-radius: 50%;
        background: white; transition: left 120ms;
    }
    &__switch.is-on &__knob { left: 22px; }
}

.feature-dep-modal {
    max-width: 480px;
    h3 { margin-top: 0; }
    ul { padding-left: 1.5rem; margin: 0.5rem 0 1rem; }
    .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem; }
}
```

Then `@use` it from the admin SCSS index. Open `frontend/src/pages/admin/AdminLayout.scss` and add (in the right grouping per ADMIN_STYLES.md):

```scss
@use '../../components/admin/features/features';
```

- [ ] **Step 4: Type-check + commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/admin/features/ frontend/src/pages/admin/AdminLayout.scss
git commit -m "feat(features): toggle row + dependency cascade modal"
```

---

## Task 1.7: Refactor Settings → Features panel to use new registry

**Files:**
- Modify: `frontend/src/pages/admin/Settings.tsx`

- [ ] **Step 1: Find the Features panel section**

Open `frontend/src/pages/admin/Settings.tsx`. Locate the section that renders the existing toggle rows (search for `features.posts` or similar).

- [ ] **Step 2: Replace with registry iteration**

Replace the hardcoded toggle JSX with:

```tsx
import FeatureToggleRow from '../../components/admin/features/FeatureToggleRow';
import { FEATURES } from '../../config/features';

// In the Features panel JSX, replace the hardcoded toggles with:
<For each={FEATURES}>
    {(f) => (
        <FeatureToggleRow
            featureKey={f.key}
            onChange={async (next, opts) => {
                await api.put('/settings', {
                    features: { [f.key]: next },
                    ...(opts?.enableDependencies && { enableDependencies: true }),
                    ...(opts?.disableDependents && { disableDependents: true }),
                });
                await refetchSiteSettings();
            }}
        />
    )}
</For>
```

(If `refetchSiteSettings` doesn't exist by that name in the store, find the existing refetch hook in the same file and call it.)

- [ ] **Step 3: Verify**

Type-check, then start dev server:

```bash
cd backend && npx tsc --noEmit && cd ../frontend && npx tsc --noEmit
cd .. && npm run dev
```

In the browser: go to Settings → Features. Each existing feature should render through `FeatureToggleRow`. Toggle `posts` off and on — should work unchanged. Mailing Lists row should appear; clicking with Users off should open the dependency modal. (Mailing Lists table doesn't exist yet, so confirming actually enables it requires Phase 2 — for now, cancel out of the modal.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/admin/Settings.tsx
git commit -m "feat(settings): refactor Features panel to use FeatureToggleRow"
```

---

**Phase 1 complete.** Run a final `npm run build` from the repo root and verify green.

---

# PHASE 2 — Lists CRUD + Subscribers + Unsubscribe

Smallest end-to-end vertical slice. Validates the dependency system + lazy install path.

## Task 2.1: Migration 030 — mailing_lists table

**Files:**
- Create: `backend/src/db/migrations/030_create_mailing_lists.sql`

- [ ] **Step 1: Write migration**

```sql
-- @feature mailing_lists
CREATE TABLE IF NOT EXISTS mailing_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    registered_users_only BOOLEAN NOT NULL DEFAULT FALSE,
    double_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    default_template_id UUID NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mailing_lists_enabled ON mailing_lists (is_enabled);

CREATE OR REPLACE FUNCTION mailing_lists_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mailing_lists_updated_at ON mailing_lists;
CREATE TRIGGER trg_mailing_lists_updated_at BEFORE UPDATE ON mailing_lists
FOR EACH ROW EXECUTE FUNCTION mailing_lists_updated_at();
```

Note: `default_template_id` FK to `mail_templates` is added in migration 032 with `ALTER TABLE`.

- [ ] **Step 2: Commit (do not run yet — feature is off)**

```bash
git add backend/src/db/migrations/030_create_mailing_lists.sql
git commit -m "migration(mailing_lists): mailing_lists table"
```

---

## Task 2.2: Migration 031 — subscribers

```sql
-- @feature mailing_lists
CREATE TABLE IF NOT EXISTS mailing_list_subscribers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id UUID NOT NULL REFERENCES mailing_lists(id) ON DELETE CASCADE,
    user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    name TEXT,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'subscribed'
        CHECK (status IN ('subscribed','pending_confirmation','unsubscribed','bounced','complained')),
    confirmation_token TEXT,
    unsubscribe_token TEXT NOT NULL,
    custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    unsubscribed_at TIMESTAMPTZ,
    last_send_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mailing_list_subscribers_unique_email
    ON mailing_list_subscribers (list_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_mailing_list_subscribers_user ON mailing_list_subscribers (user_id);
CREATE INDEX IF NOT EXISTS idx_mailing_list_subscribers_status ON mailing_list_subscribers (status);
CREATE INDEX IF NOT EXISTS idx_mailing_list_subscribers_unsub_token
    ON mailing_list_subscribers (unsubscribe_token);
```

Commit.

---

## Task 2.3: Migration 036 — mailing_lists feature setting row

```sql
-- @feature mailing_lists
INSERT INTO site_settings (key, value)
VALUES ('mailing_lists_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
```

This migration runs *during the enable transaction*, so the row exists by the time the route flips it. (`PUT /settings` then writes `true` over it anyway via the planned `ON CONFLICT DO UPDATE` — the migration just ensures the row is present for clean SELECT semantics elsewhere.)

Commit.

---

## Task 2.4: Shared types

**Files:**
- Create: `shared/src/types/mail.ts`
- Modify: `shared/src/index.ts`

```ts
// shared/src/types/mail.ts
export interface MailingList {
    id: string;
    slug: string;
    name: string;
    description?: string;
    isEnabled: boolean;
    registeredUsersOnly: boolean;
    doubleOptIn: boolean;
    defaultTemplateId?: string | null;
    createdBy?: string | null;
    createdAt: string;
    updatedAt: string;
    subscriberCount?: number;
}

export type SubscriberStatus = 'subscribed' | 'pending_confirmation' | 'unsubscribed' | 'bounced' | 'complained';

export interface MailingListSubscriber {
    id: string;
    listId: string;
    userId?: string | null;
    email: string;
    name?: string;
    phone?: string;
    status: SubscriberStatus;
    customFields: Record<string, unknown>;
    subscribedAt: string;
    confirmedAt?: string;
    unsubscribedAt?: string;
    lastSendAt?: string;
}

export interface MailTemplate {
    id: string;
    name: string;
    description?: string;
    isEnabled: boolean;
    subject: string;
    preheader?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
    createdBy?: string | null;
    createdAt: string;
    updatedAt: string;
}

export type MailSendJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface MailSendJob {
    id: string;
    listId: string;
    templateId?: string | null;
    subject: string;
    preheader?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
    renderedHtmlTemplate: string;
    status: MailSendJobStatus;
    totalRecipients: number;
    sentCount: number;
    failedCount: number;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    createdBy?: string | null;
    createdAt: string;
}

export type MailRecipientStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface MailSendRecipient {
    id: string;
    jobId: string;
    subscriberId?: string | null;
    email: string;
    status: MailRecipientStatus;
    error?: string;
    sentAt?: string;
    attemptCount: number;
}

export interface OutboundMessage {
    to: string;
    fromName?: string;
    fromEmail: string;
    replyTo?: string;
    subject: string;
    html: string;
    headers?: Record<string, string>;
}

export interface VariableDescriptor { path: string; description: string; sample: string; }
```

Add to `shared/src/index.ts`:

```ts
export * from './types/mail';
```

Type-check from repo root: `npm run build -w shared`. Commit.

---

## Task 2.5: mailingLists repo

**Files:**
- Create: `backend/src/repositories/mailingLists.repo.ts`

Use existing `backend/src/repositories/messages.repo.ts` as a structural reference for row-mapping conventions.

```ts
// backend/src/repositories/mailingLists.repo.ts
import type { MailingList } from '@rw/shared';
import { query } from '../db';

interface DbRow {
    id: string; slug: string; name: string; description: string | null;
    is_enabled: boolean; registered_users_only: boolean; double_opt_in: boolean;
    default_template_id: string | null; created_by: string | null;
    created_at: Date; updated_at: Date;
    subscriber_count?: number;
}

function map(row: DbRow): MailingList {
    return {
        id: row.id, slug: row.slug, name: row.name,
        description: row.description ?? undefined,
        isEnabled: row.is_enabled,
        registeredUsersOnly: row.registered_users_only,
        doubleOptIn: row.double_opt_in,
        defaultTemplateId: row.default_template_id,
        createdBy: row.created_by,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        subscriberCount: row.subscriber_count,
    };
}

export async function list(): Promise<MailingList[]> {
    const r = await query<DbRow>(`
        SELECT l.*, (SELECT COUNT(*)::int FROM mailing_list_subscribers s WHERE s.list_id = l.id AND s.status='subscribed') AS subscriber_count
        FROM mailing_lists l ORDER BY l.created_at DESC
    `);
    return r.rows.map(map);
}

export async function findById(id: string): Promise<MailingList | null> {
    const r = await query<DbRow>(`SELECT * FROM mailing_lists WHERE id = $1`, [id]);
    return r.rows[0] ? map(r.rows[0]) : null;
}

export async function findBySlug(slug: string): Promise<MailingList | null> {
    const r = await query<DbRow>(`SELECT * FROM mailing_lists WHERE slug = $1`, [slug]);
    return r.rows[0] ? map(r.rows[0]) : null;
}

export interface CreateInput {
    slug: string; name: string; description?: string;
    isEnabled?: boolean; registeredUsersOnly?: boolean; doubleOptIn?: boolean;
    defaultTemplateId?: string | null; createdBy?: string | null;
}

export async function create(input: CreateInput): Promise<MailingList> {
    const r = await query<DbRow>(`
        INSERT INTO mailing_lists (slug, name, description, is_enabled, registered_users_only, double_opt_in, default_template_id, created_by)
        VALUES ($1, $2, $3, COALESCE($4, TRUE), COALESCE($5, FALSE), COALESCE($6, FALSE), $7, $8)
        RETURNING *
    `, [input.slug, input.name, input.description ?? null, input.isEnabled, input.registeredUsersOnly, input.doubleOptIn, input.defaultTemplateId ?? null, input.createdBy ?? null]);
    return map(r.rows[0]);
}

export async function update(id: string, patch: Partial<CreateInput>): Promise<MailingList | null> {
    const fields: string[] = []; const values: unknown[] = [];
    const set = (col: string, val: unknown) => { values.push(val); fields.push(`${col} = $${values.length}`); };
    if (patch.slug !== undefined) set('slug', patch.slug);
    if (patch.name !== undefined) set('name', patch.name);
    if (patch.description !== undefined) set('description', patch.description ?? null);
    if (patch.isEnabled !== undefined) set('is_enabled', patch.isEnabled);
    if (patch.registeredUsersOnly !== undefined) set('registered_users_only', patch.registeredUsersOnly);
    if (patch.doubleOptIn !== undefined) set('double_opt_in', patch.doubleOptIn);
    if (patch.defaultTemplateId !== undefined) set('default_template_id', patch.defaultTemplateId);
    if (fields.length === 0) return findById(id);
    values.push(id);
    const r = await query<DbRow>(
        `UPDATE mailing_lists SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values,
    );
    return r.rows[0] ? map(r.rows[0]) : null;
}

export async function remove(id: string): Promise<void> {
    await query(`DELETE FROM mailing_lists WHERE id = $1`, [id]);
}
```

Type-check + commit.

---

## Task 2.6: mailingListSubscribers repo

**Files:**
- Create: `backend/src/repositories/mailingListSubscribers.repo.ts`
- Create: `backend/src/services/mail/unsubscribe.ts` (token gen used by repo on insert)

- [ ] **Step 1: Create unsubscribe token helper first** (will be expanded in Task 2.10)

```ts
// backend/src/services/mail/unsubscribe.ts
import { createHmac } from 'crypto';
import { config } from '../../config';

function secret(): string {
    const s = (config as any).mailUnsubscribeSecret as string | undefined;
    if (!s) throw new Error('MAIL_UNSUBSCRIBE_SECRET is not configured');
    return s;
}

export function generateUnsubscribeToken(subscriberId: string, listId: string): string {
    const sig = createHmac('sha256', secret()).update(`${subscriberId}:${listId}`).digest('base64url');
    return `${subscriberId}.${listId}.${sig}`;
}

export interface VerifiedToken { subscriberId: string; listId: string; }
export function verifyUnsubscribeToken(token: string): VerifiedToken | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [subscriberId, listId, sig] = parts;
    const expected = createHmac('sha256', secret()).update(`${subscriberId}:${listId}`).digest('base64url');
    if (sig !== expected) return null;
    return { subscriberId, listId };
}
```

Update `backend/src/config/loader.ts` (or wherever env is read) to expose `mailUnsubscribeSecret`. Add to `.env.example`:

```
MAIL_UNSUBSCRIBE_SECRET=change-me-to-a-random-hex-string
```

- [ ] **Step 2: Subscribers repo**

```ts
// backend/src/repositories/mailingListSubscribers.repo.ts
import type { MailingListSubscriber, SubscriberStatus } from '@rw/shared';
import { query } from '../db';
import { generateUnsubscribeToken } from '../services/mail/unsubscribe';

interface DbRow {
    id: string; list_id: string; user_id: string | null; email: string;
    name: string | null; phone: string | null; status: SubscriberStatus;
    confirmation_token: string | null; unsubscribe_token: string;
    custom_fields: Record<string, unknown>;
    subscribed_at: Date; confirmed_at: Date | null;
    unsubscribed_at: Date | null; last_send_at: Date | null;
}

function map(row: DbRow): MailingListSubscriber {
    return {
        id: row.id, listId: row.list_id, userId: row.user_id, email: row.email,
        name: row.name ?? undefined, phone: row.phone ?? undefined,
        status: row.status, customFields: row.custom_fields ?? {},
        subscribedAt: row.subscribed_at.toISOString(),
        confirmedAt: row.confirmed_at?.toISOString(),
        unsubscribedAt: row.unsubscribed_at?.toISOString(),
        lastSendAt: row.last_send_at?.toISOString(),
    };
}

export interface ListSubscribersOpts { listId: string; search?: string; status?: SubscriberStatus; limit?: number; offset?: number; }
export interface ListSubscribersResult { items: MailingListSubscriber[]; total: number; }

export async function list(opts: ListSubscribersOpts): Promise<ListSubscribersResult> {
    const where: string[] = ['list_id = $1']; const values: unknown[] = [opts.listId];
    if (opts.search) { values.push(`%${opts.search.toLowerCase()}%`); where.push(`(lower(email) LIKE $${values.length} OR lower(coalesce(name,'')) LIKE $${values.length})`); }
    if (opts.status) { values.push(opts.status); where.push(`status = $${values.length}`); }
    const limit = Math.min(200, opts.limit ?? 50); const offset = opts.offset ?? 0;

    const countRes = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM mailing_list_subscribers WHERE ${where.join(' AND ')}`, values);
    values.push(limit, offset);
    const dataRes = await query<DbRow>(
        `SELECT * FROM mailing_list_subscribers WHERE ${where.join(' AND ')} ORDER BY subscribed_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
    );
    return { items: dataRes.rows.map(map), total: countRes.rows[0].n };
}

export async function findById(id: string): Promise<MailingListSubscriber | null> {
    const r = await query<DbRow>(`SELECT * FROM mailing_list_subscribers WHERE id = $1`, [id]);
    return r.rows[0] ? map(r.rows[0]) : null;
}

export async function findByEmail(listId: string, email: string): Promise<MailingListSubscriber | null> {
    const r = await query<DbRow>(`SELECT * FROM mailing_list_subscribers WHERE list_id = $1 AND lower(email) = lower($2)`, [listId, email]);
    return r.rows[0] ? map(r.rows[0]) : null;
}

export interface CreateInput {
    listId: string; email: string; name?: string; phone?: string;
    userId?: string | null; status?: SubscriberStatus; customFields?: Record<string, unknown>;
    confirmationToken?: string | null;
}

export async function create(input: CreateInput): Promise<MailingListSubscriber> {
    const id = (await query<{ id: string }>('SELECT gen_random_uuid()::text AS id')).rows[0].id;
    const token = generateUnsubscribeToken(id, input.listId);
    const r = await query<DbRow>(`
        INSERT INTO mailing_list_subscribers
            (id, list_id, user_id, email, name, phone, status, confirmation_token, unsubscribe_token, custom_fields)
        VALUES ($1, $2, $3, lower($4), $5, $6, COALESCE($7, 'subscribed'), $8, $9, COALESCE($10, '{}'::jsonb))
        RETURNING *
    `, [id, input.listId, input.userId ?? null, input.email, input.name ?? null, input.phone ?? null,
        input.status ?? null, input.confirmationToken ?? null, token, JSON.stringify(input.customFields ?? {})]);
    return map(r.rows[0]);
}

export async function setStatus(id: string, status: SubscriberStatus): Promise<void> {
    const stamps: Record<SubscriberStatus, string> = {
        subscribed: 'subscribed_at',
        pending_confirmation: 'subscribed_at',
        unsubscribed: 'unsubscribed_at',
        bounced: 'unsubscribed_at',
        complained: 'unsubscribed_at',
    };
    const stamp = stamps[status];
    await query(`UPDATE mailing_list_subscribers SET status = $1, ${stamp} = NOW() WHERE id = $2`, [status, id]);
}

export async function update(id: string, patch: { name?: string; phone?: string; email?: string; customFields?: Record<string, unknown> }): Promise<MailingListSubscriber | null> {
    const fields: string[] = []; const values: unknown[] = [];
    const set = (col: string, val: unknown) => { values.push(val); fields.push(`${col} = $${values.length}`); };
    if (patch.name !== undefined) set('name', patch.name);
    if (patch.phone !== undefined) set('phone', patch.phone);
    if (patch.email !== undefined) set('email', patch.email.toLowerCase());
    if (patch.customFields !== undefined) { values.push(JSON.stringify(patch.customFields)); fields.push(`custom_fields = $${values.length}::jsonb`); }
    if (fields.length === 0) return findById(id);
    values.push(id);
    const r = await query<DbRow>(`UPDATE mailing_list_subscribers SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
    return r.rows[0] ? map(r.rows[0]) : null;
}

export async function remove(id: string): Promise<void> {
    await query(`DELETE FROM mailing_list_subscribers WHERE id = $1`, [id]);
}

export async function bulkRemove(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await query(`DELETE FROM mailing_list_subscribers WHERE id = ANY($1::uuid[])`, [ids]);
}

export async function findByUnsubscribeToken(token: string): Promise<MailingListSubscriber | null> {
    const r = await query<DbRow>(`SELECT * FROM mailing_list_subscribers WHERE unsubscribe_token = $1`, [token]);
    return r.rows[0] ? map(r.rows[0]) : null;
}
```

Type-check + commit.

---

## Task 2.7: Admin routes — lists + subscribers

**Files:**
- Create: `backend/src/routes/mailingLists.ts`
- Modify: `backend/src/routes/index.ts` (mount the router)

Use `backend/src/routes/messages.ts` as a structural reference. Provide endpoints:

- `GET /admin/mailing-lists` → list
- `POST /admin/mailing-lists` → create
- `GET /admin/mailing-lists/:id` → fetch one (includes subscriber count)
- `PUT /admin/mailing-lists/:id` → update
- `DELETE /admin/mailing-lists/:id` → remove
- `GET /admin/mailing-lists/:id/subscribers?search=&status=&limit=&offset=` → list subscribers
- `POST /admin/mailing-lists/:id/subscribers` → admin-add subscriber
- `PUT /admin/mailing-lists/:id/subscribers/:subId` → update subscriber
- `DELETE /admin/mailing-lists/:id/subscribers/:subId` → remove subscriber
- `POST /admin/mailing-lists/:id/subscribers/bulk-delete` → `{ ids: string[] }`
- `POST /api/v1/lists/:slug/subscribe` → public subscribe

```ts
// backend/src/routes/mailingLists.ts
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../middleware/error';
import { handleRouteError, sendSuccess } from '../utils/response';
import { logAudit } from '../services/audit';
import * as lists from '../repositories/mailingLists.repo';
import * as subs from '../repositories/mailingListSubscribers.repo';

const router = Router();

const listSchema = z.object({
    slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    isEnabled: z.boolean().optional(),
    registeredUsersOnly: z.boolean().optional(),
    doubleOptIn: z.boolean().optional(),
    defaultTemplateId: z.string().uuid().nullable().optional(),
});

const subscriberAdminSchema = z.object({
    email: z.string().email(),
    name: z.string().optional(),
    phone: z.string().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    forceConfirmed: z.boolean().optional(),  // admin-add → status='subscribed' regardless of double-opt-in
});

// === ADMIN ROUTES ===

router.get('/', authenticate(), requireAdmin, async (_req, res) => {
    try { sendSuccess(res, await lists.list()); } catch (e) { handleRouteError(res, e); }
});

router.post('/', authenticate(), requireAdmin, async (req, res) => {
    try {
        const parsed = listSchema.safeParse(req.body);
        if (!parsed.success) throw new ValidationError('Invalid input', parsed.error.issues);
        const created = await lists.create({ ...parsed.data, createdBy: (req as AuthenticatedRequest).user!.id });
        await logAudit({ userId: (req as AuthenticatedRequest).user!.id, action: 'create', entityType: 'mailing_list', entityId: created.id, newValues: created });
        sendSuccess(res, created, 201);
    } catch (e) { handleRouteError(res, e); }
});

router.get('/:id', authenticate(), requireAdmin, async (req, res) => {
    try {
        const item = await lists.findById(req.params.id);
        if (!item) throw new NotFoundError('Mailing list not found');
        sendSuccess(res, item);
    } catch (e) { handleRouteError(res, e); }
});

router.put('/:id', authenticate(), requireAdmin, async (req, res) => {
    try {
        const parsed = listSchema.partial().safeParse(req.body);
        if (!parsed.success) throw new ValidationError('Invalid input', parsed.error.issues);
        const updated = await lists.update(req.params.id, parsed.data);
        if (!updated) throw new NotFoundError('Mailing list not found');
        await logAudit({ userId: (req as AuthenticatedRequest).user!.id, action: 'update', entityType: 'mailing_list', entityId: req.params.id, newValues: parsed.data });
        sendSuccess(res, updated);
    } catch (e) { handleRouteError(res, e); }
});

router.delete('/:id', authenticate(), requireAdmin, async (req, res) => {
    try {
        await lists.remove(req.params.id);
        await logAudit({ userId: (req as AuthenticatedRequest).user!.id, action: 'delete', entityType: 'mailing_list', entityId: req.params.id });
        sendSuccess(res, { ok: true });
    } catch (e) { handleRouteError(res, e); }
});

router.get('/:id/subscribers', authenticate(), requireAdmin, async (req, res) => {
    try {
        const limit = req.query.limit ? Number(req.query.limit) : undefined;
        const offset = req.query.offset ? Number(req.query.offset) : undefined;
        const search = typeof req.query.search === 'string' ? req.query.search : undefined;
        const status = typeof req.query.status === 'string' ? req.query.status as any : undefined;
        const r = await subs.list({ listId: req.params.id, limit, offset, search, status });
        sendSuccess(res, r);
    } catch (e) { handleRouteError(res, e); }
});

router.post('/:id/subscribers', authenticate(), requireAdmin, async (req, res) => {
    try {
        const parsed = subscriberAdminSchema.safeParse(req.body);
        if (!parsed.success) throw new ValidationError('Invalid input', parsed.error.issues);
        const created = await subs.create({
            listId: req.params.id,
            email: parsed.data.email, name: parsed.data.name, phone: parsed.data.phone,
            customFields: parsed.data.customFields,
            status: 'subscribed',
        });
        sendSuccess(res, created, 201);
    } catch (e) { handleRouteError(res, e); }
});

router.put('/:id/subscribers/:subId', authenticate(), requireAdmin, async (req, res) => {
    try {
        const updated = await subs.update(req.params.subId, req.body);
        if (!updated) throw new NotFoundError('Subscriber not found');
        sendSuccess(res, updated);
    } catch (e) { handleRouteError(res, e); }
});

router.delete('/:id/subscribers/:subId', authenticate(), requireAdmin, async (req, res) => {
    try {
        await subs.remove(req.params.subId);
        sendSuccess(res, { ok: true });
    } catch (e) { handleRouteError(res, e); }
});

router.post('/:id/subscribers/bulk-delete', authenticate(), requireAdmin, async (req, res) => {
    try {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids as string[] : [];
        await subs.bulkRemove(ids);
        sendSuccess(res, { removed: ids.length });
    } catch (e) { handleRouteError(res, e); }
});

export default router;
```

Mount in `backend/src/routes/index.ts`:

```ts
import mailingListsRoutes from './mailingLists';
// ...
router.use('/mailing-lists', mailingListsRoutes);
```

(Match the existing router-mounting style in that file.)

Type-check + commit.

---

## Task 2.8: Public subscribe route

**Files:**
- Create: `backend/src/routes/publicMailingLists.ts`
- Modify: `backend/src/routes/index.ts` — mount under unauthenticated `/lists` (or wherever public read routes are grouped)

```ts
// backend/src/routes/publicMailingLists.ts
import { Router } from 'express';
import { z } from 'zod';
import { ValidationError, NotFoundError } from '../middleware/error';
import { handleRouteError, sendSuccess } from '../utils/response';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import * as lists from '../repositories/mailingLists.repo';
import * as subs from '../repositories/mailingListSubscribers.repo';
import { randomBytes } from 'crypto';

const router = Router();

const subscribeSchema = z.object({
    email: z.string().email().optional(),
    name: z.string().optional(),
    phone: z.string().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
});

router.post('/:slug/subscribe', authenticate(false), async (req, res) => {
    try {
        const list = await lists.findBySlug(req.params.slug);
        if (!list || !list.isEnabled) throw new NotFoundError('List not found');
        const parsed = subscribeSchema.safeParse(req.body);
        if (!parsed.success) throw new ValidationError('Invalid input', parsed.error.issues);

        const authReq = req as AuthenticatedRequest;
        let email = parsed.data.email;
        let userId: string | null = null;

        if (list.registeredUsersOnly) {
            if (!authReq.user) throw new ValidationError('Login required to subscribe to this list');
            email = authReq.user.email; userId = authReq.user.id;
        }
        if (!email) throw new ValidationError('Email is required');

        const existing = await subs.findByEmail(list.id, email);
        const wantsDoubleOpt = list.doubleOptIn;
        const targetStatus = wantsDoubleOpt ? 'pending_confirmation' : 'subscribed';

        if (existing) {
            if (existing.status === 'subscribed') {
                return sendSuccess(res, { status: 'subscribed', already: true });
            }
            await subs.setStatus(existing.id, targetStatus);
            return sendSuccess(res, { status: targetStatus, already: true });
        }

        const confirmationToken = wantsDoubleOpt ? randomBytes(24).toString('base64url') : null;
        const created = await subs.create({
            listId: list.id, email, name: parsed.data.name, phone: parsed.data.phone,
            userId, customFields: parsed.data.customFields, status: targetStatus,
            confirmationToken,
        });

        // TODO Phase 5: send double-opt-in confirmation email if wantsDoubleOpt.

        sendSuccess(res, { status: created.status, id: created.id });
    } catch (e) { handleRouteError(res, e); }
});

export default router;
```

Mount under `/lists` in the public/api router area. Type-check + commit.

---

## Task 2.9: Unsubscribe public route

**Files:**
- Create: `backend/src/routes/unsubscribe.ts`
- Modify: `backend/src/app.ts` — mount `/u/:token` and `/u/:token/resubscribe` at the public root (not under `/api/v1`)

```ts
// backend/src/routes/unsubscribe.ts
import { Router } from 'express';
import { verifyUnsubscribeToken } from '../services/mail/unsubscribe';
import * as subs from '../repositories/mailingListSubscribers.repo';
import * as lists from '../repositories/mailingLists.repo';

const router = Router();

function page(title: string, body: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font:14px/1.5 system-ui,sans-serif;max-width:480px;margin:8vh auto;padding:0 1rem;color:#333}
    h1{font-size:1.4rem}.btn{display:inline-block;padding:.5rem 1rem;background:#3498cf;color:#fff;border-radius:6px;text-decoration:none}
    </style></head><body>${body}</body></html>`;
}

router.get('/u/:token', async (req, res) => {
    const verified = verifyUnsubscribeToken(req.params.token);
    if (!verified) { res.status(400).type('html').send(page('Unsubscribe', '<h1>Invalid unsubscribe link.</h1>')); return; }
    const sub = await subs.findById(verified.subscriberId);
    const list = await lists.findById(verified.listId);
    if (!sub || !list) { res.status(404).type('html').send(page('Unsubscribe', '<h1>Subscriber not found.</h1>')); return; }
    if (sub.status !== 'unsubscribed') await subs.setStatus(sub.id, 'unsubscribed');
    res.type('html').send(page('Unsubscribed', `
        <h1>You have been unsubscribed from ${escapeHtml(list.name)}.</h1>
        <p><a class="btn" href="/u/${encodeURIComponent(req.params.token)}/resubscribe">Resubscribe</a></p>
    `));
});

router.get('/u/:token/resubscribe', async (req, res) => {
    const verified = verifyUnsubscribeToken(req.params.token);
    if (!verified) { res.status(400).type('html').send(page('Resubscribe', '<h1>Invalid link.</h1>')); return; }
    const sub = await subs.findById(verified.subscriberId);
    const list = await lists.findById(verified.listId);
    if (!sub || !list) { res.status(404).type('html').send(page('Resubscribe', '<h1>Subscriber not found.</h1>')); return; }
    const target = list.doubleOptIn ? 'pending_confirmation' : 'subscribed';
    await subs.setStatus(sub.id, target as any);
    res.type('html').send(page('Resubscribed', `<h1>Welcome back to ${escapeHtml(list.name)}.</h1>`));
});

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export default router;
```

In `backend/src/app.ts`, after the routes mounting:

```ts
import unsubscribeRoutes from './routes/unsubscribe';
// In the running-mode branch:
app.use('/', unsubscribeRoutes);
```

Type-check + commit.

---

## Task 2.10: Frontend api helpers

**Files:**
- Modify: `frontend/src/services/api.ts`

Append:

```ts
import type { MailingList, MailingListSubscriber } from '@rw/shared';

export const mailingListsApi = {
    list: () => api.get<MailingList[]>('/mailing-lists'),
    get: (id: string) => api.get<MailingList>(`/mailing-lists/${id}`),
    create: (data: Partial<MailingList>) => api.post<MailingList>('/mailing-lists', data),
    update: (id: string, data: Partial<MailingList>) => api.put<MailingList>(`/mailing-lists/${id}`, data),
    remove: (id: string) => api.delete(`/mailing-lists/${id}`),
    listSubscribers: (id: string, params: { search?: string; status?: string; limit?: number; offset?: number }) =>
        api.get<{ items: MailingListSubscriber[]; total: number }>(`/mailing-lists/${id}/subscribers`, { params }),
    addSubscriber: (id: string, data: Partial<MailingListSubscriber>) =>
        api.post<MailingListSubscriber>(`/mailing-lists/${id}/subscribers`, data),
    updateSubscriber: (id: string, subId: string, data: Partial<MailingListSubscriber>) =>
        api.put<MailingListSubscriber>(`/mailing-lists/${id}/subscribers/${subId}`, data),
    removeSubscriber: (id: string, subId: string) =>
        api.delete(`/mailing-lists/${id}/subscribers/${subId}`),
    bulkRemoveSubscribers: (id: string, ids: string[]) =>
        api.post(`/mailing-lists/${id}/subscribers/bulk-delete`, { ids }),
};
```

(If `api` uses a different params-passing convention, adjust accordingly — look at how `mediaApi` or `postsApi` formats query params.)

Type-check + commit.

---

## Task 2.11: MailingLists index page

**Files:**
- Create: `frontend/src/pages/admin/MailingLists.tsx`
- Create: `frontend/src/pages/admin/styles/_mailing-lists.scss`

```tsx
// frontend/src/pages/admin/MailingLists.tsx
import { Component, createResource, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { mailingListsApi } from '../../services/api';

const MailingLists: Component = () => {
    const [lists, { refetch }] = createResource(() => mailingListsApi.list());

    return (
        <div class="admin-page mailing-lists-page">
            <div class="admin-page__header">
                <h1>Mailing Lists</h1>
                <div class="admin-page__actions">
                    <A href="/admin/mail/send" class="btn btn--secondary">Send a Message…</A>
                    <A href="/admin/mailing-lists/new" class="btn btn--primary">+ New List</A>
                </div>
            </div>

            <section class="admin-section">
                <header class="admin-section__header">
                    <h2>Lists</h2>
                </header>
                <Show when={!lists.loading} fallback={<p>Loading…</p>}>
                    <table class="admin-table">
                        <thead><tr><th>Name</th><th>Slug</th><th>Subscribers</th><th>Status</th><th></th></tr></thead>
                        <tbody>
                            <For each={lists()?.data ?? []}>
                                {(l) => (
                                    <tr>
                                        <td><A href={`/admin/mailing-lists/${l.id}`}>{l.name}</A></td>
                                        <td><code>{l.slug}</code></td>
                                        <td>{l.subscriberCount ?? 0}</td>
                                        <td>{l.isEnabled ? 'Enabled' : 'Disabled'}</td>
                                        <td><A href={`/admin/mailing-lists/${l.id}`} class="btn btn--small btn--secondary">Edit</A></td>
                                    </tr>
                                )}
                            </For>
                            <Show when={(lists()?.data?.length ?? 0) === 0}>
                                <tr><td colspan="5"><em>No lists yet. Create one to get started.</em></td></tr>
                            </Show>
                        </tbody>
                    </table>
                </Show>
            </section>

            {/* Templates section placeholder — wired in Phase 3 */}
            <section class="admin-section">
                <header class="admin-section__header"><h2>Mail Templates</h2></header>
                <p class="form-help-muted">Available after Phase 3.</p>
            </section>
        </div>
    );
};

export default MailingLists;
```

```scss
// frontend/src/pages/admin/styles/_mailing-lists.scss
@use 'sass:color';
@use '../../../styles/variables' as *;

.mailing-lists-page {
    .admin-section { margin-bottom: 2rem; }
    .admin-section__header { display: flex; align-items: center; justify-content: space-between; }
    .admin-table { width: 100%; }
}
```

`@use` from `AdminLayout.scss`. Commit.

---

## Task 2.12: MailingListEdit page

**Files:**
- Create: `frontend/src/pages/admin/MailingListEdit.tsx`
- Create: `frontend/src/components/admin/mailing-lists/ListSettingsForm.tsx`
- Create: `frontend/src/components/admin/mailing-lists/SubscribersTable.tsx`
- Create: `frontend/src/components/admin/mailing-lists/SubscriberEditModal.tsx`

This is the biggest page in Phase 2. Use existing `Forms.tsx` or `FormEditor.tsx` as a structural reference for split-page layout (header + sections + bottom table).

Page structure: top header with Save / Delete / Send-to-this-list buttons → `ListSettingsForm` → `SubscribersTable` with search input, bulk-delete button, "+ Add subscriber" button.

```tsx
// frontend/src/pages/admin/MailingListEdit.tsx — skeleton
import { Component, createResource, createSignal, Show } from 'solid-js';
import { useParams, useNavigate, A } from '@solidjs/router';
import { mailingListsApi } from '../../services/api';
import ListSettingsForm from '../../components/admin/mailing-lists/ListSettingsForm';
import SubscribersTable from '../../components/admin/mailing-lists/SubscribersTable';
import type { MailingList } from '@rw/shared';

const MailingListEdit: Component = () => {
    const params = useParams<{ id: string }>();
    const navigate = useNavigate();
    const isNew = () => params.id === 'new';

    const [list, setList] = createSignal<Partial<MailingList>>(isNew() ? { isEnabled: true, registeredUsersOnly: false, doubleOptIn: false, slug: '', name: '' } : {});
    const [loaded] = createResource(() => isNew() ? null : params.id, async (id) => {
        if (!id) return null;
        const r = await mailingListsApi.get(id);
        if (r.success && r.data) setList(r.data);
        return r.data;
    });
    const [saving, setSaving] = createSignal(false);

    const onSave = async () => {
        setSaving(true);
        try {
            const data = list();
            if (isNew()) {
                const r = await mailingListsApi.create(data);
                if (r.success && r.data) navigate(`/admin/mailing-lists/${r.data.id}`);
            } else {
                await mailingListsApi.update(params.id, data);
            }
        } finally { setSaving(false); }
    };

    const onDelete = async () => {
        if (!confirm('Delete this list and all its subscribers?')) return;
        await mailingListsApi.remove(params.id);
        navigate('/admin/mailing-lists');
    };

    return (
        <div class="admin-page mailing-list-edit-page">
            <div class="admin-page__header">
                <A href="/admin/mailing-lists" class="back-link">← Lists</A>
                <h1>{isNew() ? 'New List' : list().name || '…'}</h1>
                <div class="admin-page__actions">
                    <Show when={!isNew()}>
                        <A href={`/admin/mail/send?list=${params.id}`} class="btn btn--secondary">Send to this list</A>
                        <button class="btn btn--danger" onClick={onDelete}>Delete</button>
                    </Show>
                    <button class="btn btn--primary" onClick={onSave} disabled={saving()}>{saving() ? 'Saving…' : 'Save'}</button>
                </div>
            </div>

            <ListSettingsForm value={list()} onChange={setList} />

            <Show when={!isNew()}>
                <SubscribersTable listId={params.id} />
            </Show>
        </div>
    );
};

export default MailingListEdit;
```

Author `ListSettingsForm` (controlled form with name/slug/description/flags/default-template-dropdown — leave default template as a TODO disabled dropdown for now; Phase 3 wires it).

Author `SubscribersTable` (uses `createResource` keyed on `(listId, search, page)`, renders the existing admin-table partial, includes search box, bulk-checkbox column, bulk-delete button, "+ Add" button that opens `SubscriberEditModal`, click row → opens `SubscriberEditModal`).

Author `SubscriberEditModal` (Portal-mounted; form with email/name/phone fields; save calls update; delete calls remove).

Each subcomponent is 60–120 LOC. Use existing `MessageView.tsx` and `Users.tsx` for similar patterns.

Type-check + commit (one commit at the end of the page or one per file — your call).

---

## Task 2.13: Register routes + sidebar

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/admin/AdminLayout.tsx`

In App.tsx (search for `/admin/messages` to find where to insert):

```tsx
const AdminMailingLists = lazy(() => import('./pages/admin/MailingLists'));
const AdminMailingListEdit = lazy(() => import('./pages/admin/MailingListEdit'));

// In the admin routes block:
<Route path="/admin/mailing-lists" component={AdminMailingLists} />
<Route path="/admin/mailing-lists/:id" component={AdminMailingListEdit} />
```

In `AdminLayout.tsx`'s NAV_ITEMS, insert after the `messages` entry:

```ts
{ path: '/admin/mailing-lists', label: 'Mailing Lists', icon: 'mail', feature: 'mailing_lists' },
```

Verify the `mail` icon exists in `ICONS`; if not, add one (use an envelope SVG):

```tsx
mail: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7l9 6 9-6"/><rect x="3" y="5" width="18" height="14" rx="2"/></svg>,
```

Type-check + commit.

---

## Task 2.14: Manual smoke test — Phase 2 end-to-end

- [ ] **Step 1: Start the stack**

```bash
docker-compose up -d  # postgres + redis
npm run dev
```

- [ ] **Step 2: Enable Mailing Lists**

Visit Settings → Features. Click Mailing Lists toggle. Modal should appear ("Requires Users"). Click confirm.

Inspect logs: migrations 030, 031, 036 should run.

- [ ] **Step 3: Create a list**

Sidebar should now show "Mailing Lists". Visit `/admin/mailing-lists`. Click "+ New List". Fill in name + slug. Save. Verify it appears in the table.

- [ ] **Step 4: Subscribe via public endpoint**

```bash
curl -X POST http://localhost:3001/api/v1/lists/<slug>/subscribe \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","name":"Test"}'
```

Verify status response.

- [ ] **Step 5: View in admin**

Refresh list edit page. Subscriber should appear in the table.

- [ ] **Step 6: Unsubscribe**

Get the `unsubscribe_token` from the DB:

```bash
docker exec -it <pg-container> psql -U <user> <db> -c "SELECT unsubscribe_token FROM mailing_list_subscribers LIMIT 1;"
```

Visit `http://localhost:3001/u/<token>`. Should see the unsubscribed page. Refresh admin → subscriber status should be `unsubscribed`.

- [ ] **Step 7: Phase 2 commit point**

If any commits are still outstanding, commit. Move to Phase 3.

---

# PHASE 3 — Mail Templates

Templates are authored using the existing block editor and previewed via a backend-rendered iframe.

## Task 3.1: Migration 032 — mail_templates

```sql
-- @feature mailing_lists
CREATE TABLE IF NOT EXISTS mail_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    subject TEXT NOT NULL DEFAULT '',
    preheader TEXT,
    from_name TEXT,
    from_email TEXT,
    reply_to TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mail_templates_enabled ON mail_templates (is_enabled);

CREATE OR REPLACE FUNCTION mail_templates_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_mail_templates_updated_at ON mail_templates;
CREATE TRIGGER trg_mail_templates_updated_at BEFORE UPDATE ON mail_templates
FOR EACH ROW EXECUTE FUNCTION mail_templates_updated_at();

-- Late-bound FK from mailing_lists.default_template_id
ALTER TABLE mailing_lists
    ADD CONSTRAINT mailing_lists_default_template_id_fkey
    FOREIGN KEY (default_template_id) REFERENCES mail_templates(id) ON DELETE SET NULL;
```

Commit.

---

## Task 3.2: Migration 033 — mail_template_blocks

```sql
-- @feature mailing_lists
CREATE TABLE IF NOT EXISTS mail_template_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES mail_templates(id) ON DELETE CASCADE,
    parent_block_id UUID NULL REFERENCES mail_template_blocks(id) ON DELETE CASCADE,
    block_type block_type NOT NULL,
    position INTEGER NOT NULL,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    style JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mail_template_blocks_template ON mail_template_blocks (template_id, parent_block_id, position);
```

Commit.

---

## Task 3.3: mailTemplates + mailTemplateBlocks repos

Mirror `mailingLists.repo.ts` and `backend/src/repositories/pages.repo.ts` patterns. Templates repo provides standard CRUD; blocks repo provides:

- `findByTemplate(templateId)` returning rows ordered by `(parent_block_id NULLS FIRST, position)`.
- `replaceAll(templateId, blocks, tx?)` — transactional replace (DELETE all blocks for template, INSERT new). This is the simplest correct approach for an editor that sends the full tree on save; aligns with how page blocks are handled.
- `previewRender(blocks)` — pure helper to assemble a tree from flat data (reuse `buildBlockTree` from shared if it exists).

Commit.

---

## Task 3.4: BlockTypeConfig — emailRender field

**Files:**
- Modify: `frontend/src/config/blockTypes.ts`

Add to the `BlockTypeConfig` interface:

```ts
emailRender: 'full' | 'fallback' | 'unsupported';
emailRenderWarning?: string;
```

For each block type entry, add the appropriate value per the spec §4 table. For brevity, the assignments:

- `rich_text`, `image`, `url_link`, `html`, `spacer`, `hero`, `group`: `'full'`
- `group_item`: `'full'` (it's structural; rendered as a `<td>`)
- `video`: `'fallback'`, warning: `'Email clients can't play video. Renders as a poster image linking to the video.'`
- `social`: `'fallback'`, warning: `'Renders as a card link to the original post; embedded social widgets don't work in email.'`
- `form`: `'fallback'`, warning: `'Renders as a CTA button linking to the form page.'`
- `campaign`: `'fallback'`, warning: `'Renders as a title + blurb + donate link card.'`
- `post_list`: `'fallback'`, warning: `'Renders as a static list of post links; refreshes only on next send.'`
- `carousel`: `'fallback'`, warning: `'Renders the first slide only with a View more link.'`
- `document`: `'fallback'`, warning: `'Renders as a download link card.'`

Type-check + commit.

---

## Task 3.5: Variables module

**Files:**
- Create: `backend/src/services/mail/variables.ts`

```ts
// backend/src/services/mail/variables.ts
import type { VariableDescriptor, MailingList, MailingListSubscriber } from '@rw/shared';
import { config } from '../../config';

export interface VariableContext {
    user: { name: string; email: string; phone: string; custom: Record<string, unknown> };
    list: { name: string; description: string; slug: string };
    site: { name: string; url: string };
    unsubscribe_url: string;
    view_in_browser_url: string;
}

export function buildVariableContext(args: { subscriber: MailingListSubscriber; list: MailingList; siteName: string; siteUrl: string; unsubscribeUrl: string; }): VariableContext {
    return {
        user: {
            name: args.subscriber.name ?? '',
            email: args.subscriber.email,
            phone: args.subscriber.phone ?? '',
            custom: args.subscriber.customFields,
        },
        list: { name: args.list.name, description: args.list.description ?? '', slug: args.list.slug },
        site: { name: args.siteName, url: args.siteUrl },
        unsubscribe_url: args.unsubscribeUrl,
        view_in_browser_url: '',
    };
}

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function detectVariables(text: string): string[] {
    const set = new Set<string>();
    for (const m of text.matchAll(TOKEN_RE)) set.add(m[1]);
    return Array.from(set);
}

function resolvePath(ctx: any, path: string): string {
    const parts = path.split('.');
    let cur: any = ctx;
    for (const p of parts) {
        if (cur == null) return '';
        cur = cur[p];
    }
    if (cur == null) return '';
    return String(cur);
}

export function substituteVariables(text: string, ctx: VariableContext | Record<string, unknown>): string {
    return text.replace(TOKEN_RE, (_, path) => resolvePath(ctx, path));
}

export function describeVariables(): VariableDescriptor[] {
    return [
        { path: 'user.name',  description: 'Subscriber name (blank for email-only subscribers).', sample: 'Sample Subscriber' },
        { path: 'user.email', description: 'Subscriber email.', sample: 'subscriber@example.com' },
        { path: 'user.phone', description: 'Subscriber phone (optional).', sample: '' },
        { path: 'list.name',  description: 'Mailing list name.', sample: 'Weekly Newsletter' },
        { path: 'list.description', description: 'Mailing list description.', sample: '' },
        { path: 'list.slug',  description: 'Mailing list slug.', sample: 'newsletter' },
        { path: 'site.name',  description: 'Site name.', sample: 'SiteSurge' },
        { path: 'site.url',   description: 'Site URL.', sample: 'https://example.com' },
        { path: 'unsubscribe_url', description: 'One-click unsubscribe URL.', sample: 'https://example.com/u/sample-token' },
        { path: 'view_in_browser_url', description: 'Public archive URL. V1: empty.', sample: '' },
    ];
}
```

Type-check + commit.

---

## Task 3.6: Per-block-type email renderers — registry skeleton

**Files:**
- Create: `backend/src/services/mail/blocks/index.ts`
- Create: empty stubs in `backend/src/services/mail/blocks/<type>.ts` for each type

```ts
// backend/src/services/mail/blocks/index.ts
import type { BlockType } from '@rw/shared';
import { renderRichText } from './richText';
import { renderImage } from './image';
import { renderUrlLink } from './urlLink';
import { renderSpacer } from './spacer';
import { renderHero } from './hero';
import { renderHtml } from './html';
import { renderGroup } from './group';
import { renderVideo } from './video';
import { renderSocial } from './social';
import { renderForm } from './form';
import { renderCampaign } from './campaign';
import { renderPostList } from './postList';
import { renderCarousel } from './carousel';
import { renderDocument } from './document';

export interface EmailBlockNode {
    id: string;
    blockType: BlockType;
    settings: Record<string, unknown>;
    style: Record<string, unknown>;
    children: EmailBlockNode[];
}

export interface EmailRenderCtx {
    siteName: string;
    siteUrl: string;
    palette: Record<string, string>;  // swatch_id → hex
    fontFamily: string;
    textColor: string;
    bgColor: string;
    linkColor: string;
}

export type BlockEmailRenderer = (node: EmailBlockNode, ctx: EmailRenderCtx) => string;

export const RENDERERS: Partial<Record<BlockType, BlockEmailRenderer>> = {
    rich_text: renderRichText,
    image: renderImage,
    url_link: renderUrlLink,
    spacer: renderSpacer,
    hero: renderHero,
    html: renderHtml,
    group: renderGroup,
    video: renderVideo,
    social: renderSocial,
    form: renderForm,
    campaign: renderCampaign,
    post_list: renderPostList,
    carousel: renderCarousel,
    document: renderDocument,
};

export function renderNode(node: EmailBlockNode, ctx: EmailRenderCtx): string {
    const fn = RENDERERS[node.blockType];
    if (!fn) return '';
    return fn(node, ctx);
}
```

- [ ] **Step 1: Create all per-block files as stubs returning placeholders**

For each type, create a file like:

```ts
// backend/src/services/mail/blocks/richText.ts
import { BlockEmailRenderer } from './index';

export const renderRichText: BlockEmailRenderer = (node, _ctx) => {
    const html = String(node.settings.content ?? '');
    return `<tr><td style="padding:16px;font-family:inherit;color:inherit;line-height:1.5">${html}</td></tr>`;
};
```

- [ ] **Step 2: Fill in each renderer with the spec's fallback strategy**

Each renderer outputs a `<tr><td>...</td></tr>` row (or nested table for groups). Use inline `style="..."` exclusively — never class names. Helpers in `index.ts` or a sibling `_util.ts`:

```ts
export function inlineStyle(obj: Record<string, string | number | undefined>): string {
    return Object.entries(obj).filter(([_, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}:${v}`).join(';');
}
export function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
}
```

Full renderer bodies (paste each into its file):

**image.ts:**
```ts
import { BlockEmailRenderer } from './index';
import { escapeHtml, inlineStyle } from './_util';
export const renderImage: BlockEmailRenderer = (node) => {
    const imgs = (node.settings.images as any[]) || (node.settings.url ? [{ url: node.settings.url, alt: node.settings.alt, caption: node.settings.caption, link: node.settings.link }] : []);
    if (imgs.length === 0) return '';
    const cells = imgs.map(img => {
        const inner = `<img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt ?? '')}" width="600" style="${inlineStyle({ display: 'block', 'max-width': '100%', height: 'auto' })}"/>`;
        const wrapped = img.link ? `<a href="${escapeHtml(img.link)}">${inner}</a>` : inner;
        const cap = img.caption ? `<div style="text-align:center;font-size:13px;color:#666;padding-top:6px">${escapeHtml(img.caption)}</div>` : '';
        return `<td style="padding:8px">${wrapped}${cap}</td>`;
    }).join('');
    return `<tr><td><table role="presentation" width="100%"><tr>${cells}</tr></table></td></tr>`;
};
```

**urlLink.ts:**
```ts
import { BlockEmailRenderer } from './index';
import { escapeHtml } from './_util';
export const renderUrlLink: BlockEmailRenderer = (node, ctx) => {
    const url = String(node.settings.url ?? '#');
    const text = String(node.settings.text ?? node.settings.url ?? 'Link');
    return `<tr><td style="padding:12px;text-align:center"><a href="${escapeHtml(url)}" style="color:${ctx.linkColor};text-decoration:underline">${escapeHtml(text)}</a></td></tr>`;
};
```

**spacer.ts:**
```ts
import { BlockEmailRenderer } from './index';
export const renderSpacer: BlockEmailRenderer = (node) => {
    const h = Number(node.settings.height ?? 24);
    return `<tr><td style="line-height:${h}px;height:${h}px">&nbsp;</td></tr>`;
};
```

**hero.ts:**
```ts
import { BlockEmailRenderer } from './index';
import { escapeHtml } from './_util';
export const renderHero: BlockEmailRenderer = (node) => {
    const title = String(node.settings.title ?? '');
    const sub = String(node.settings.subtitle ?? '');
    const bg = String(node.settings.backgroundImage ?? '');
    const cta = node.settings.ctaUrl ? `<div style="padding-top:16px"><a href="${escapeHtml(String(node.settings.ctaUrl))}" style="background:#3498cf;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">${escapeHtml(String(node.settings.ctaText ?? 'Learn more'))}</a></div>` : '';
    const bgStyle = bg ? `background-image:url(${escapeHtml(bg)});background-size:cover;background-position:center;` : '';
    return `<tr><td style="padding:32px 24px;text-align:center;${bgStyle}"><h1 style="margin:0 0 8px;font-size:28px">${escapeHtml(title)}</h1><div style="font-size:16px;color:#555">${escapeHtml(sub)}</div>${cta}</td></tr>`;
};
```

**html.ts:**
```ts
import { BlockEmailRenderer } from './index';
export const renderHtml: BlockEmailRenderer = (node) => {
    // Operator-authored — passed through verbatim, wrapped in a row.
    const html = String(node.settings.content ?? node.settings.html ?? '');
    return `<tr><td style="padding:16px">${html}</td></tr>`;
};
```

**group.ts:**
```ts
import { BlockEmailRenderer, renderNode } from './index';
import { inlineStyle } from './_util';
export const renderGroup: BlockEmailRenderer = (node, ctx) => {
    const direction = String(node.settings.direction ?? 'horizontal');
    const itemNodes = node.children.filter(c => c.blockType === 'group_item');
    const cells = itemNodes.map(item => {
        const inner = item.children.map(c => renderNode(c, ctx)).join('');
        // Wrap each child render (each child is a <tr>) inside an inner table so the cell content is well-formed.
        const innerTable = `<table role="presentation" width="100%">${inner}</table>`;
        const style = inlineStyle({
            width: item.settings.width as string,
            'min-width': item.settings.minWidth as string,
            'max-width': item.settings.maxWidth as string,
            'vertical-align': (item.settings.alignSelf as string) ?? 'top',
            padding: '6px',
        });
        return `<td style="${style}">${innerTable}</td>`;
    }).join('');
    const row = direction === 'vertical'
        ? cells.replace(/<td/g, '<tr><td').replace(/<\/td>/g, '</td></tr>')
        : `<tr>${cells}</tr>`;
    return `<tr><td><table role="presentation" width="100%">${row}</table></td></tr>`;
};
```

**video.ts:** (fallback)
```ts
import { BlockEmailRenderer } from './index';
import { escapeHtml } from './_util';
export const renderVideo: BlockEmailRenderer = (node) => {
    const poster = String(node.settings.posterUrl ?? node.settings.thumbnailUrl ?? '');
    const url = String(node.settings.url ?? '#');
    const title = String(node.settings.title ?? 'Watch video');
    const inner = poster
        ? `<img src="${escapeHtml(poster)}" alt="${escapeHtml(title)}" width="600" style="display:block;max-width:100%"/>`
        : `<div style="padding:32px;text-align:center;background:#eee">${escapeHtml(title)}</div>`;
    return `<tr><td style="padding:8px"><a href="${escapeHtml(url)}">${inner}</a><div style="text-align:center;font-size:13px;color:#666;padding-top:6px">▶ Watch the video</div></td></tr>`;
};
```

**social.ts:** (fallback — card link)
```ts
import { BlockEmailRenderer } from './index';
import { escapeHtml } from './_util';
export const renderSocial: BlockEmailRenderer = (node) => {
    const items = (node.settings.items as any[]) || [];
    if (items.length === 0) return '';
    const cards = items.filter(i => i.postUrl || i.postId).map(i => {
        const thumb = i.thumbnailUrl ? `<img src="${escapeHtml(i.thumbnailUrl)}" alt="" width="120" style="display:block"/>` : '';
        const text = escapeHtml(String(i.content ?? '').slice(0, 200));
        const link = i.postUrl ?? '#';
        return `<tr><td style="padding:8px"><a href="${escapeHtml(link)}" style="text-decoration:none;color:inherit">${thumb}<div style="padding-top:6px">${text}</div></a></td></tr>`;
    }).join('');
    return `<tr><td><table role="presentation" width="100%">${cards}</table></td></tr>`;
};
```

**form.ts:** (fallback — CTA link)
```ts
import { BlockEmailRenderer } from './index';
import { escapeHtml } from './_util';
export const renderForm: BlockEmailRenderer = (node, ctx) => {
    const slug = String(node.settings.formSlug ?? '');
    const label = String(node.settings.ctaText ?? 'Open the form');
    const url = slug ? `${ctx.siteUrl}/forms/${slug}` : ctx.siteUrl;
    return `<tr><td style="padding:16px;text-align:center"><a href="${escapeHtml(url)}" style="background:${ctx.linkColor};color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">${escapeHtml(label)}</a></td></tr>`;
};
```

**campaign.ts:** (fallback — title/blurb/donate link)
```ts
import { BlockEmailRenderer } from './index';
import { escapeHtml } from './_util';
export const renderCampaign: BlockEmailRenderer = (node, ctx) => {
    const title = String(node.settings.title ?? '');
    const blurb = String(node.settings.blurb ?? node.settings.description ?? '');
    const slug = String(node.settings.campaignSlug ?? '');
    const url = slug ? `${ctx.siteUrl}/donate/${slug}` : `${ctx.siteUrl}/donate`;
    return `<tr><td style="padding:16px"><h2 style="margin:0 0 8px;font-size:20px">${escapeHtml(title)}</h2><div style="margin-bottom:12px">${escapeHtml(blurb)}</div><a href="${escapeHtml(url)}" style="background:${ctx.linkColor};color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">Donate</a></td></tr>`;
};
```

**postList.ts:** (fallback — list of post rows)
```ts
import { BlockEmailRenderer } from './index';
import { escapeHtml } from './_util';
export const renderPostList: BlockEmailRenderer = (node, ctx) => {
    const posts = (node.settings.resolvedPosts as any[]) || [];
    // 'resolvedPosts' is expected to be denormalized at render-prep time
    // (the route fetches posts before invoking the renderer if a postList
    // block appears). If absent, fall back to a CTA link to the blog.
    if (posts.length === 0) {
        return `<tr><td style="padding:16px;text-align:center"><a href="${escapeHtml(ctx.siteUrl + '/posts')}" style="color:${ctx.linkColor}">View latest posts →</a></td></tr>`;
    }
    const rows = posts.map((p: any) => {
        const url = `${ctx.siteUrl}/posts/${p.slug}`;
        const thumb = p.featuredImage ? `<img src="${escapeHtml(p.featuredImage)}" alt="" width="120" style="display:block"/>` : '';
        return `<tr><td style="padding:12px 0;border-bottom:1px solid #eee">${thumb}<a href="${escapeHtml(url)}" style="color:${ctx.linkColor};text-decoration:none;font-weight:600">${escapeHtml(p.title)}</a><div style="font-size:14px;color:#666">${escapeHtml(p.excerpt ?? '')}</div></td></tr>`;
    }).join('');
    return `<tr><td><table role="presentation" width="100%">${rows}</table></td></tr>`;
};
```

**carousel.ts:** (fallback — first slide + "View more" link)
```ts
import { BlockEmailRenderer } from './index';
import { escapeHtml } from './_util';
export const renderCarousel: BlockEmailRenderer = (node, ctx) => {
    const slides = (node.settings.slides as any[]) || [];
    if (slides.length === 0) return '';
    const first = slides[0];
    const img = first.imageUrl ? `<img src="${escapeHtml(first.imageUrl)}" alt="${escapeHtml(first.title ?? '')}" width="600" style="display:block;max-width:100%"/>` : '';
    const more = slides.length > 1 ? `<div style="text-align:center;padding-top:6px"><a href="${escapeHtml(ctx.siteUrl)}" style="color:${ctx.linkColor}">View more →</a></div>` : '';
    return `<tr><td style="padding:8px">${img}${more}</td></tr>`;
};
```

**document.ts:** (fallback — download link card)
```ts
import { BlockEmailRenderer } from './index';
import { escapeHtml } from './_util';
export const renderDocument: BlockEmailRenderer = (node) => {
    const url = String(node.settings.url ?? '#');
    const name = String(node.settings.fileName ?? node.settings.url ?? 'Document');
    const size = node.settings.fileSize ? ` (${node.settings.fileSize} bytes)` : '';
    return `<tr><td style="padding:12px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 16px;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;text-decoration:none;color:#333">📄 ${escapeHtml(name)}${size}</a></td></tr>`;
};
```

**richText.ts:** (full)
```ts
import { BlockEmailRenderer } from './index';
import { sanitizeHtml } from '../../../utils/sanitize';
export const renderRichText: BlockEmailRenderer = (node) => {
    const raw = String(node.settings.content ?? '');
    const clean = sanitizeHtml(raw);
    return `<tr><td style="padding:16px;line-height:1.5">${clean}</td></tr>`;
};
```

(If `sanitizeHtml` doesn't take the right shape, use whatever helper exists in `utils/sanitize.ts`.)

Create `_util.ts` with the helpers.

Type-check + commit.

---

## Task 3.7: Main renderer + boilerplate

**Files:**
- Create: `backend/src/services/mail/renderer.ts`

```ts
// backend/src/services/mail/renderer.ts
import type { Block } from '@rw/shared';
import { detectVariables } from './variables';
import { EmailBlockNode, EmailRenderCtx, renderNode } from './blocks';

export interface RenderInput {
    blocks: Block[];               // flat list as stored
    subject: string;
    preheader?: string;
    siteName: string;
    siteUrl: string;
    palette: Record<string, string>;
    fontFamily?: string;
    textColor?: string;
    bgColor?: string;
    linkColor?: string;
}

export interface RenderResult {
    html: string;
    subject: string;
    preheader?: string;
    detectedVariables: string[];
}

function buildTree(blocks: Block[]): EmailBlockNode[] {
    const byParent = new Map<string | null, Block[]>();
    for (const b of blocks) {
        const key = (b as any).parentBlockId ?? null;
        const arr = byParent.get(key) ?? [];
        arr.push(b);
        byParent.set(key, arr);
    }
    for (const arr of byParent.values()) arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const toNode = (b: Block): EmailBlockNode => ({
        id: b.id,
        blockType: b.blockType,
        settings: b.settings ?? {},
        style: (b as any).style ?? {},
        children: (byParent.get(b.id) ?? []).map(toNode),
    });
    return (byParent.get(null) ?? []).map(toNode);
}

export function renderMailHtml(input: RenderInput): RenderResult {
    const ctx: EmailRenderCtx = {
        siteName: input.siteName,
        siteUrl: input.siteUrl,
        palette: input.palette,
        fontFamily: input.fontFamily ?? 'system-ui, -apple-system, sans-serif',
        textColor: input.textColor ?? '#333',
        bgColor: input.bgColor ?? '#ffffff',
        linkColor: input.linkColor ?? '#3498cf',
    };

    const tree = buildTree(input.blocks);
    const rows = tree.map(n => renderNode(n, ctx)).join('\n');

    const preheaderTag = input.preheader
        ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${input.preheader}</div>`
        : '';

    const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${ctx.bgColor};font-family:${ctx.fontFamily};color:${ctx.textColor}">
${preheaderTag}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${ctx.bgColor}">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${ctx.bgColor}">
${rows}
</table>
</td></tr>
</table>
</body></html>`;

    return {
        html,
        subject: input.subject,
        preheader: input.preheader,
        detectedVariables: detectVariables(html + ' ' + input.subject + ' ' + (input.preheader ?? '')),
    };
}

function escape(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
}
```

Type-check + commit.

---

## Task 3.8: Template admin routes + preview

**Files:**
- Create: `backend/src/routes/mailTemplates.ts`
- Modify: `backend/src/routes/index.ts` (mount)

Endpoints:
- `GET /admin/mail-templates` → list
- `POST /admin/mail-templates` → create
- `GET /admin/mail-templates/:id` → template + blocks
- `PUT /admin/mail-templates/:id` → update template meta
- `PUT /admin/mail-templates/:id/blocks` → replace block tree (body: `{ blocks: Block[] }`)
- `DELETE /admin/mail-templates/:id` → remove
- `POST /admin/mail-templates/preview` → `{ blocks, subject, preheader, variables }` → `{ html, subject, preheader, detectedVariables }`

The preview endpoint resolves site palette + appearance from `site_settings` (use existing helpers), calls `renderMailHtml`, then runs `substituteVariables` over the result using the user-supplied `variables` map merged with defaults from `describeVariables()` samples.

Skeleton:

```ts
// backend/src/routes/mailTemplates.ts
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../middleware/error';
import { handleRouteError, sendSuccess } from '../utils/response';
import * as templates from '../repositories/mailTemplates.repo';
import * as blocks from '../repositories/mailTemplateBlocks.repo';
import { renderMailHtml } from '../services/mail/renderer';
import { describeVariables, substituteVariables } from '../services/mail/variables';
import { query } from '../db';

const router = Router();

const templateSchema = z.object({
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    isEnabled: z.boolean().optional(),
    subject: z.string().max(1000),
    preheader: z.string().optional(),
    fromName: z.string().optional(),
    fromEmail: z.string().email().optional().or(z.literal('')),
    replyTo: z.string().email().optional().or(z.literal('')),
});

router.get('/', authenticate(), requireAdmin, async (_req, res) => {
    try { sendSuccess(res, await templates.list()); } catch (e) { handleRouteError(res, e); }
});

router.post('/', authenticate(), requireAdmin, async (req, res) => {
    try {
        const parsed = templateSchema.safeParse(req.body);
        if (!parsed.success) throw new ValidationError('Invalid input', parsed.error.issues);
        const created = await templates.create({ ...parsed.data, createdBy: (req as AuthenticatedRequest).user!.id });
        sendSuccess(res, created, 201);
    } catch (e) { handleRouteError(res, e); }
});

router.get('/:id', authenticate(), requireAdmin, async (req, res) => {
    try {
        const t = await templates.findById(req.params.id);
        if (!t) throw new NotFoundError('Template not found');
        const tBlocks = await blocks.findByTemplate(req.params.id);
        sendSuccess(res, { ...t, blocks: tBlocks });
    } catch (e) { handleRouteError(res, e); }
});

router.put('/:id', authenticate(), requireAdmin, async (req, res) => {
    try {
        const parsed = templateSchema.partial().safeParse(req.body);
        if (!parsed.success) throw new ValidationError('Invalid input', parsed.error.issues);
        const updated = await templates.update(req.params.id, parsed.data);
        if (!updated) throw new NotFoundError('Template not found');
        sendSuccess(res, updated);
    } catch (e) { handleRouteError(res, e); }
});

router.put('/:id/blocks', authenticate(), requireAdmin, async (req, res) => {
    try {
        const arr = Array.isArray(req.body?.blocks) ? req.body.blocks : [];
        await blocks.replaceAll(req.params.id, arr);
        sendSuccess(res, { ok: true });
    } catch (e) { handleRouteError(res, e); }
});

router.delete('/:id', authenticate(), requireAdmin, async (req, res) => {
    try { await templates.remove(req.params.id); sendSuccess(res, { ok: true }); } catch (e) { handleRouteError(res, e); }
});

router.post('/preview', authenticate(), requireAdmin, async (req, res) => {
    try {
        const { blocks: rawBlocks, subject, preheader, variables } = req.body ?? {};
        const settings = await query<{ key: string; value: any }>(`SELECT key, value FROM site_settings`);
        const settingsMap = Object.fromEntries(settings.rows.map(r => [r.key, r.value]));
        const palette: Record<string, string> = {};
        for (const s of (settingsMap.site_colors as any[]) ?? []) {
            if (s?.id && s?.hex) palette[s.id] = s.hex;
        }
        const result = renderMailHtml({
            blocks: rawBlocks ?? [],
            subject: subject ?? '',
            preheader,
            siteName: settingsMap.site_name ?? 'Site',
            siteUrl: settingsMap.site_url ?? '',
            palette,
        });

        const sampleCtx: Record<string, unknown> = {};
        for (const d of describeVariables()) {
            const parts = d.path.split('.');
            let cur: any = sampleCtx;
            for (let i = 0; i < parts.length - 1; i++) {
                cur[parts[i]] = cur[parts[i]] ?? {};
                cur = cur[parts[i]];
            }
            cur[parts[parts.length - 1]] = d.sample;
        }
        const ctx = { ...sampleCtx, ...(variables ?? {}) };

        sendSuccess(res, {
            html: substituteVariables(result.html, ctx as any),
            subject: substituteVariables(result.subject, ctx as any),
            preheader: result.preheader ? substituteVariables(result.preheader, ctx as any) : undefined,
            detectedVariables: result.detectedVariables,
        });
    } catch (e) { handleRouteError(res, e); }
});

export default router;
```

Mount: `router.use('/mail-templates', mailTemplatesRoutes);` Type-check + commit.

---

## Task 3.9: Frontend api helpers for templates

In `frontend/src/services/api.ts`, append:

```ts
import type { MailTemplate, Block } from '@rw/shared';

export const mailTemplatesApi = {
    list: () => api.get<MailTemplate[]>('/mail-templates'),
    get: (id: string) => api.get<MailTemplate & { blocks: Block[] }>(`/mail-templates/${id}`),
    create: (data: Partial<MailTemplate>) => api.post<MailTemplate>('/mail-templates', data),
    update: (id: string, data: Partial<MailTemplate>) => api.put<MailTemplate>(`/mail-templates/${id}`, data),
    saveBlocks: (id: string, blocks: Block[]) => api.put(`/mail-templates/${id}/blocks`, { blocks }),
    remove: (id: string) => api.delete(`/mail-templates/${id}`),
    preview: (data: { blocks: Block[]; subject: string; preheader?: string; variables?: Record<string, unknown> }) =>
        api.post<{ html: string; subject: string; preheader?: string; detectedVariables: string[] }>('/mail-templates/preview', data),
};
```

Type-check + commit.

---

## Task 3.10: MailTemplateBlockAdapter

**Files:**
- Create: `frontend/src/components/admin/mail/MailTemplateBlockAdapter.ts`

The existing `BlockEditor` accepts a data adapter or a `pageId`/`postId` source. Read `frontend/src/components/admin/blocks/BlockEditor.tsx` to determine the exact interface, then write the adapter to plug into the same shape but using `mailTemplatesApi.saveBlocks`.

A minimal adapter approach: pass `templateId` into a wrapper component that fetches `mailTemplatesApi.get(templateId)`, hands blocks to `BlockEditor`, and on save calls `mailTemplatesApi.saveBlocks`.

```ts
// frontend/src/components/admin/mail/MailTemplateBlockAdapter.ts
import type { Block } from '@rw/shared';
import { mailTemplatesApi } from '../../../services/api';

export interface BlockDataAdapter {
    load(): Promise<Block[]>;
    save(blocks: Block[]): Promise<void>;
}

export function mailTemplateAdapter(templateId: string): BlockDataAdapter {
    return {
        async load() {
            const r = await mailTemplatesApi.get(templateId);
            return r.success && r.data ? r.data.blocks : [];
        },
        async save(blocks) {
            await mailTemplatesApi.saveBlocks(templateId, blocks);
        },
    };
}
```

If `BlockEditor` doesn't expose an adapter contract today, *create one* — refactor `BlockEditor` to accept an `adapter` prop (or a `pageId | templateId | postId` discriminated union). This is a deliberate small refactor noted in the spec.

Commit.

---

## Task 3.11: MailPreviewModal + VariableForm

**Files:**
- Create: `frontend/src/components/admin/mail/MailPreviewModal.tsx`
- Create: `frontend/src/components/admin/mail/VariableForm.tsx`

```tsx
// frontend/src/components/admin/mail/MailPreviewModal.tsx
import { Component, createSignal, createEffect, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { mailTemplatesApi } from '../../../services/api';
import type { Block } from '@rw/shared';
import VariableForm from './VariableForm';

interface Props {
    blocks: Block[];
    subject: string;
    preheader?: string;
    onClose: () => void;
}

const MailPreviewModal: Component<Props> = (p) => {
    const [vars, setVars] = createSignal<Record<string, string>>({});
    const [html, setHtml] = createSignal<string>('');
    const [subject, setSubject] = createSignal<string>(p.subject);
    const [detected, setDetected] = createSignal<string[]>([]);
    const [varsOpen, setVarsOpen] = createSignal<boolean>(false);

    let debounceHandle: any;
    const fetchPreview = () => {
        const variables: Record<string, unknown> = {};
        for (const [path, value] of Object.entries(vars())) {
            const parts = path.split('.');
            let cur: any = variables;
            for (let i = 0; i < parts.length - 1; i++) {
                cur[parts[i]] = cur[parts[i]] ?? {};
                cur = cur[parts[i]];
            }
            cur[parts[parts.length - 1]] = value;
        }
        mailTemplatesApi.preview({ blocks: p.blocks, subject: p.subject, preheader: p.preheader, variables })
            .then(r => { if (r.success && r.data) { setHtml(r.data.html); setSubject(r.data.subject); setDetected(r.data.detectedVariables); } });
    };

    createEffect(() => {
        // Re-fetch when vars or blocks change.
        vars();
        clearTimeout(debounceHandle);
        debounceHandle = setTimeout(fetchPreview, 250);
    });

    return (
        <Portal>
            <div class="modal-overlay" onClick={p.onClose}>
                <div class="modal mail-preview-modal" onClick={e => e.stopPropagation()}>
                    <header class="mail-preview-modal__header">
                        <strong>Subject: {subject() || '(no subject)'}</strong>
                        <button type="button" class="modal-close" onClick={p.onClose} aria-label="Close">×</button>
                    </header>
                    <div class="mail-preview-modal__vars">
                        <button type="button" class="collapsible-toggle" onClick={() => setVarsOpen(!varsOpen())}>
                            {varsOpen() ? '▼' : '▶'} Variables ({detected().length})
                        </button>
                        <Show when={varsOpen()}>
                            <VariableForm paths={detected()} values={vars()} onChange={setVars} />
                        </Show>
                    </div>
                    <iframe class="mail-preview-modal__frame" srcdoc={html()} />
                    <footer class="mail-preview-modal__footer">
                        <button class="btn btn--secondary" onClick={p.onClose}>Close</button>
                    </footer>
                </div>
            </div>
        </Portal>
    );
};

export default MailPreviewModal;
```

```tsx
// frontend/src/components/admin/mail/VariableForm.tsx
import { Component, For } from 'solid-js';

interface Props {
    paths: string[];
    values: Record<string, string>;
    onChange: (next: Record<string, string>) => void;
}

const VariableForm: Component<Props> = (p) => {
    return (
        <div class="variable-form">
            <For each={p.paths}>
                {(path) => (
                    <div class="variable-form__row">
                        <code class="variable-form__path">{`{{${path}}}`}</code>
                        <input
                            type="text"
                            value={p.values[path] ?? ''}
                            onInput={(e) => p.onChange({ ...p.values, [path]: e.currentTarget.value })}
                        />
                    </div>
                )}
            </For>
        </div>
    );
};

export default VariableForm;
```

SCSS for these in `_mailing-lists.scss`:

```scss
.mail-preview-modal {
    width: 90vw; height: 90vh; max-width: 1100px;
    background: #fff; border-radius: 8px;
    display: flex; flex-direction: column;
    overflow: hidden;
    &__header { padding: .75rem 1rem; border-bottom: 1px solid #eee; display: flex; align-items: center; justify-content: space-between; }
    &__vars { padding: .5rem 1rem; border-bottom: 1px solid #eee; max-height: 30%; overflow: auto; }
    &__frame { flex: 1; width: 100%; border: 0; background: #fff; }
    &__footer { padding: .5rem 1rem; border-top: 1px solid #eee; display: flex; justify-content: flex-end; }
}
.variable-form__row { display: grid; grid-template-columns: 180px 1fr; gap: .5rem; padding: .25rem 0; align-items: center; }
.variable-form__path { font-family: monospace; font-size: 13px; color: $primary-color; }
```

Commit.

---

## Task 3.12: MailTemplateEdit page

**Files:**
- Create: `frontend/src/pages/admin/MailTemplateEdit.tsx`

Mirrors `MailingListEdit.tsx`: header with Save/Preview/Delete, meta form fields (name/description/enabled/subject/preheader/from-name/from-email/reply-to), `BlockEditor` with the adapter, collapsible Variables reference section.

Register in `App.tsx`:

```tsx
const AdminMailTemplateEdit = lazy(() => import('./pages/admin/MailTemplateEdit'));
<Route path="/admin/mail-templates/:id" component={AdminMailTemplateEdit} />
```

Also: wire the Templates section on `MailingLists.tsx` index page to fetch + show templates (replace the Phase 3 placeholder). Add "+ New Template" button there.

Commit.

---

## Task 3.13: Manual smoke test — Phase 3

- [ ] Reload site, visit `/admin/mailing-lists`. Templates section should render real templates (probably empty).
- [ ] Click "+ New Template". Fill name + subject. Save. Add a Rich Text block; type a greeting that includes `Hello {{user.name}}!`. Save blocks.
- [ ] Click Preview. Iframe should render the message with "Sample Subscriber" in place of `{{user.name}}`.
- [ ] Expand the Variables section; type a custom name. Iframe should re-render with the new name.
- [ ] Add a Posts block (the post_list type) and observe the fallback rendering in preview.
- [ ] Verify Add Block menu shows warning icons next to video, social, etc.

Commit any final touches.

---

# PHASE 4 — Send Wizard + Worker + Provider Abstraction

## Task 4.1: Migrations 034 & 035

```sql
-- @feature mailing_lists  (034_create_mail_send_jobs.sql)
CREATE TABLE IF NOT EXISTS mail_send_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id UUID NOT NULL REFERENCES mailing_lists(id),
    template_id UUID NULL REFERENCES mail_templates(id) ON DELETE SET NULL,
    subject TEXT NOT NULL,
    preheader TEXT,
    from_name TEXT,
    from_email TEXT,
    reply_to TEXT,
    rendered_html_template TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','running','completed','failed','cancelled')),
    total_recipients INT NOT NULL DEFAULT 0,
    sent_count INT NOT NULL DEFAULT 0,
    failed_count INT NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mail_send_jobs_status ON mail_send_jobs (status);
CREATE INDEX IF NOT EXISTS idx_mail_send_jobs_list ON mail_send_jobs (list_id, created_at DESC);
```

```sql
-- @feature mailing_lists  (035_create_mail_send_recipients.sql)
CREATE TABLE IF NOT EXISTS mail_send_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES mail_send_jobs(id) ON DELETE CASCADE,
    subscriber_id UUID NULL REFERENCES mailing_list_subscribers(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','sent','failed','skipped')),
    error TEXT,
    sent_at TIMESTAMPTZ,
    attempt_count INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mail_send_recipients_job_status ON mail_send_recipients (job_id, status);
CREATE INDEX IF NOT EXISTS idx_mail_send_recipients_subscriber ON mail_send_recipients (subscriber_id);
```

Commit.

---

## Task 4.2: mailSendJobs + mailSendRecipients repos

Standard pattern. Key methods:

- `mailSendJobs.create(input)` returning the inserted row.
- `mailSendJobs.findById(id)` with optional counts.
- `mailSendJobs.setStatus(id, status, extras)`.
- `mailSendJobs.incrementCounts(id, sent: number, failed: number)`.
- `mailSendJobs.findRunning()` for boot resumer.
- `mailSendRecipients.bulkInsert(jobId, items)`.
- `mailSendRecipients.findPending(jobId, limit)`.
- `mailSendRecipients.setStatus(id, status, error?)`.
- `mailSendRecipients.listForJob(jobId, opts)` with status filter + pagination.

Commit.

---

## Task 4.3: Provider abstraction

**Files:**
- Create: `backend/src/services/mail/providers/types.ts`
- Create: `backend/src/services/mail/providers/smtp.ts`
- Create: `backend/src/services/mail/providers/{mailgun,sendgrid,postmark}.ts` (stubs)
- Create: `backend/src/services/mail/providers/factory.ts`

```ts
// providers/types.ts
import type { OutboundMessage } from '@rw/shared';
export interface MailProvider {
    send(msg: OutboundMessage): Promise<{ providerId?: string }>;
    verify(): Promise<boolean>;
}
```

```ts
// providers/smtp.ts
import nodemailer, { Transporter } from 'nodemailer';
import type { MailProvider } from './types';
import { config } from '../../../config';

export class SmtpMailProvider implements MailProvider {
    private transporter: Transporter;
    constructor() {
        const c = config.email;
        if (!c?.host) throw new Error('SMTP not configured (set EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS)');
        this.transporter = nodemailer.createTransport({
            host: c.host, port: c.port, secure: c.secure,
            auth: c.user ? { user: c.user, pass: c.pass } : undefined,
        });
    }
    async send(msg) {
        const from = msg.fromName ? `"${msg.fromName}" <${msg.fromEmail}>` : msg.fromEmail;
        const info = await this.transporter.sendMail({
            from, to: msg.to, subject: msg.subject, html: msg.html,
            replyTo: msg.replyTo, headers: msg.headers,
        });
        return { providerId: info.messageId };
    }
    async verify() { return this.transporter.verify().then(() => true).catch(() => false); }
}
```

```ts
// providers/mailgun.ts (and sendgrid, postmark — same shape)
import type { MailProvider } from './types';
export class MailgunMailProvider implements MailProvider {
    async send(): Promise<{ providerId?: string }> { throw new Error('MailgunMailProvider: not implemented yet (Phase 2 of native REST adapters)'); }
    async verify() { return false; }
}
```

```ts
// providers/factory.ts
import type { MailProvider } from './types';
import { SmtpMailProvider } from './smtp';
import { MailgunMailProvider } from './mailgun';
import { SendgridMailProvider } from './sendgrid';
import { PostmarkMailProvider } from './postmark';
import { config } from '../../../config';

let instance: MailProvider | null = null;
export function getProvider(): MailProvider {
    if (instance) return instance;
    const p = (config as any).mailProvider as string | undefined;
    switch (p) {
        case 'mailgun':  instance = new MailgunMailProvider(); break;
        case 'sendgrid': instance = new SendgridMailProvider(); break;
        case 'postmark': instance = new PostmarkMailProvider(); break;
        default:         instance = new SmtpMailProvider();
    }
    return instance;
}
export function _resetProviderForTest() { instance = null; }
```

Update config to read `MAIL_PROVIDER` env. Type-check + commit.

---

## Task 4.4: Refactor email.ts to use provider

Modify `backend/src/services/email.ts`. Replace internal nodemailer wiring with `getProvider().send(...)`. Existing `sendEmail`, `sendWelcomeEmail`, `sendDonationThankYou` keep their signatures.

Type-check + manual sanity check (`curl` a known flow that sends an email if available). Commit.

---

## Task 4.5: sendWorker

**Files:**
- Create: `backend/src/services/mail/sendWorker.ts`

```ts
// backend/src/services/mail/sendWorker.ts
import { logger } from '../../utils/logger';
import { getProvider } from './providers/factory';
import { substituteVariables, buildVariableContext } from './variables';
import * as jobs from '../../repositories/mailSendJobs.repo';
import * as recipients from '../../repositories/mailSendRecipients.repo';
import * as subs from '../../repositories/mailingListSubscribers.repo';
import * as lists from '../../repositories/mailingLists.repo';
import { generateUnsubscribeToken } from './unsubscribe';
import { config } from '../../config';

const CONCURRENCY = Number(process.env.MAIL_SEND_CONCURRENCY ?? 10);
const DELAY_MS = Number(process.env.MAIL_SEND_DELAY_MS ?? 50);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function kickJob(jobId: string): Promise<void> {
    const job = await jobs.findById(jobId);
    if (!job) return;
    if (job.status !== 'pending' && job.status !== 'running') return;

    await jobs.setStatus(jobId, 'running', { startedAt: new Date().toISOString() });
    const list = await lists.findById(job.listId);
    if (!list) {
        await jobs.setStatus(jobId, 'failed', { error: 'List not found', completedAt: new Date().toISOString() });
        return;
    }

    const provider = getProvider();
    const siteUrl = (config as any).siteUrl ?? '';
    const siteName = (config as any).siteName ?? '';

    while (true) {
        const fresh = await jobs.findById(jobId);
        if (!fresh || fresh.status === 'cancelled') break;
        const batch = await recipients.findPending(jobId, CONCURRENCY);
        if (batch.length === 0) break;

        await Promise.all(batch.map(async (r) => {
            try {
                const sub = r.subscriberId ? await subs.findById(r.subscriberId) : null;
                const unsubUrl = sub ? `${siteUrl}/u/${generateUnsubscribeToken(sub.id, list.id)}` : '';
                const ctx = buildVariableContext({
                    subscriber: sub ?? ({ id: '', listId: list.id, email: r.email, customFields: {}, status: 'subscribed', subscribedAt: '' } as any),
                    list, siteName, siteUrl, unsubscribeUrl: unsubUrl,
                });
                const subject = substituteVariables(job.subject, ctx);
                const html = substituteVariables(job.renderedHtmlTemplate, ctx);
                const headers: Record<string, string> = {
                    'X-Mail-Job-Id': jobId,
                };
                if (unsubUrl) {
                    headers['List-Unsubscribe'] = `<${unsubUrl}>`;
                    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
                }
                await provider.send({
                    to: r.email,
                    fromName: job.fromName ?? siteName,
                    fromEmail: job.fromEmail ?? (config.email as any)?.from ?? 'no-reply@example.com',
                    replyTo: job.replyTo,
                    subject, html, headers,
                });
                await recipients.setStatus(r.id, 'sent');
                await jobs.incrementCounts(jobId, 1, 0);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.warn(`Mail send failed: ${r.email}: ${msg}`);
                await recipients.setStatus(r.id, 'failed', msg);
                await jobs.incrementCounts(jobId, 0, 1);
            }
        }));

        await sleep(DELAY_MS);
    }

    const final = await jobs.findById(jobId);
    if (!final) return;
    if (final.status === 'cancelled') return;
    const allFailed = final.failedCount === final.totalRecipients;
    await jobs.setStatus(jobId, allFailed ? 'failed' : 'completed', { completedAt: new Date().toISOString() });
}

export async function resumeRunningJobs(): Promise<void> {
    const running = await jobs.findRunning();
    for (const j of running) {
        logger.info(`Resuming send job ${j.id} (left in 'running' from a previous boot)`);
        setImmediate(() => { void kickJob(j.id); });
    }
}
```

In `backend/src/index.ts` after the app is listening:

```ts
import { resumeRunningJobs } from './services/mail/sendWorker';
// After app.listen succeeds:
void resumeRunningJobs().catch(err => logger.error('resumeRunningJobs failed', err));
```

Type-check + commit.

---

## Task 4.6: Send + jobs routes

**Files:**
- Create: `backend/src/routes/mailSend.ts`

Endpoints:
- `POST /admin/mail/send` → create job + recipients, kick worker, return `{ jobId }`
- `GET /admin/mail/jobs/:id` → status + counts
- `GET /admin/mail/jobs/:id/recipients?status=&limit=&offset=` → recipient list
- `POST /admin/mail/jobs/:id/retry` → reset failed → pending, re-kick
- `PATCH /admin/mail/jobs/:id` (body `{ status: 'cancelled' }`) → cancel

Send handler:

```ts
router.post('/send', authenticate(), requireAdmin, async (req, res) => {
    try {
        const { listId, templateId, subject, preheader, fromName, fromEmail, replyTo, blocks: rawBlocks } = req.body ?? {};
        if (!listId || !subject) throw new ValidationError('listId and subject required');
        const list = await lists.findById(listId);
        if (!list || !list.isEnabled) throw new ValidationError('List not found or disabled');

        // Render HTML once, tokens preserved
        const settings = await query<{ key: string; value: any }>(`SELECT key, value FROM site_settings`);
        const settingsMap = Object.fromEntries(settings.rows.map(r => [r.key, r.value]));
        const palette: Record<string, string> = {};
        for (const s of (settingsMap.site_colors as any[]) ?? []) if (s?.id && s?.hex) palette[s.id] = s.hex;
        const rendered = renderMailHtml({
            blocks: rawBlocks ?? [],
            subject, preheader,
            siteName: settingsMap.site_name ?? '',
            siteUrl: settingsMap.site_url ?? '',
            palette,
        });

        const subscribedRows = await query<{ id: string; email: string }>(
            `SELECT id, email FROM mailing_list_subscribers WHERE list_id = $1 AND status = 'subscribed'`,
            [listId],
        );

        const job = await jobs.create({
            listId, templateId: templateId ?? null,
            subject, preheader, fromName, fromEmail, replyTo,
            renderedHtmlTemplate: rendered.html,
            totalRecipients: subscribedRows.rows.length,
            createdBy: (req as AuthenticatedRequest).user!.id,
        });

        if (subscribedRows.rows.length > 0) {
            await recipients.bulkInsert(job.id, subscribedRows.rows.map(r => ({ subscriberId: r.id, email: r.email })));
        }

        setImmediate(() => { void kickJob(job.id); });
        sendSuccess(res, { jobId: job.id }, 202);
    } catch (e) { handleRouteError(res, e); }
});
```

(Wire jobs status, recipient list, retry, cancel endpoints with straightforward repo calls.)

Mount in routes index. Commit.

---

## Task 4.7: Frontend api helpers — send + jobs

```ts
// In services/api.ts:
import type { MailSendJob, MailSendRecipient } from '@rw/shared';

export const mailSendApi = {
    send: (data: { listId: string; templateId?: string; subject: string; preheader?: string; fromName?: string; fromEmail?: string; replyTo?: string; blocks: Block[] }) =>
        api.post<{ jobId: string }>('/mail/send', data),
    job: (id: string) => api.get<MailSendJob>(`/mail/jobs/${id}`),
    recipients: (id: string, params?: { status?: string; limit?: number; offset?: number }) =>
        api.get<{ items: MailSendRecipient[]; total: number }>(`/mail/jobs/${id}/recipients`, { params }),
    retry: (id: string) => api.post(`/mail/jobs/${id}/retry`),
    cancel: (id: string) => api.patch(`/mail/jobs/${id}`, { status: 'cancelled' }),
};
```

Commit.

---

## Task 4.8: MailSend wizard page

**Files:**
- Create: `frontend/src/pages/admin/MailSend.tsx`

Two-step page driven by `?step=` query param. State held in a `createStore`. Step 1 components: list + template dropdowns, meta inputs, BlockEditor mounted on local block state (initialized from template), Preview button → `MailPreviewModal`. Step 2: confirmation summary + inline preview iframe + Send button.

Submit handler calls `mailSendApi.send`, navigates to `/admin/mail/jobs/<id>` on success.

Read query param `?list=<id>` to pre-fill list when navigated from `MailingListEdit`.

Register in App.tsx. Commit.

---

## Task 4.9: MailJob status page

**Files:**
- Create: `frontend/src/pages/admin/MailJob.tsx`
- Create: `frontend/src/components/admin/mail/MailJobStatus.tsx`

Page polls `/admin/mail/jobs/:id` every 2s while status is pending/running. Renders progress bar (`(sentCount + failedCount) / totalRecipients`), counts, started/completed timestamps, status badge. Buttons: Retry failed (visible when failedCount > 0 and status is completed/failed), Cancel (visible only when running).

Recipients table below with status filter tabs (All / Failed / Pending / Sent).

Register in App.tsx. Commit.

---

## Task 4.10: Manual smoke test — Phase 4

- [ ] Start dev. Set up Mailpit locally (`docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit`). Set `.env`:

```
EMAIL_HOST=localhost
EMAIL_PORT=1025
EMAIL_SECURE=false
EMAIL_FROM=test@local
MAIL_UNSUBSCRIBE_SECRET=local-dev-secret-please-replace
MAIL_PROVIDER=smtp
MAIL_SEND_CONCURRENCY=5
MAIL_SEND_DELAY_MS=100
```

- [ ] Create 10 test subscribers on a list (via curl loop or admin UI).
- [ ] Create a template with a Rich Text block containing `Hi {{user.name}}! See <a href="{{unsubscribe_url}}">here</a> to unsubscribe.`
- [ ] Click "Send a Message…", pick list + template, click Confirmation, click Send.
- [ ] Inspect Mailpit at `http://localhost:8025` — should see 10 emails delivered, each with `List-Unsubscribe` header and per-recipient `{{user.name}}`.
- [ ] Click an unsubscribe URL → confirms unsubscribe page → check subscriber status flipped in admin.

Commit fixes if any.

---

# PHASE 5 — Polish

## Task 5.1: Double opt-in send

- In the public subscribe route, when `wantsDoubleOpt`, generate a one-shot `confirmationToken`, send a confirmation email via `getProvider().send(...)` with a link to `${siteUrl}/lists/${slug}/confirm/${token}`. Subject + body: simple hardcoded text-and-link template for V1 (operator can override via a future `mail_templates` row keyed by purpose).

- Add `GET /lists/:slug/confirm/:token` to `unsubscribe.ts` (or a new route file):

```ts
router.get('/lists/:slug/confirm/:token', async (req, res) => {
    const list = await lists.findBySlug(req.params.slug);
    if (!list) { res.status(404).type('html').send(page('Confirm', '<h1>List not found.</h1>')); return; }
    const r = await query<{ id: string }>(`SELECT id FROM mailing_list_subscribers WHERE list_id = $1 AND confirmation_token = $2`, [list.id, req.params.token]);
    if (r.rows.length === 0) { res.status(400).type('html').send(page('Confirm', '<h1>Invalid or expired confirmation link.</h1>')); return; }
    await query(`UPDATE mailing_list_subscribers SET status='subscribed', confirmed_at=NOW(), confirmation_token=NULL WHERE id=$1`, [r.rows[0].id]);
    res.type('html').send(page('Confirmed', `<h1>Subscription confirmed for ${escapeHtml(list.name)}.</h1>`));
});
```

Commit.

---

## Task 5.2: Force-confirm admin action

In `SubscriberEditModal`, when subscriber `status === 'pending_confirmation'`, show a "Force Confirm" button that PATCHes the subscriber → status `subscribed`. Add a small backend endpoint `POST /admin/mailing-lists/:id/subscribers/:subId/force-confirm`. Commit.

---

## Task 5.3: Audit logging across mutations

For list create/update/delete, template create/update/delete, send-job created, send-job cancelled, bulk subscriber actions: call `logAudit({ userId, action, entityType, entityId, newValues })`. Use existing patterns from `routes/messages.ts`. Commit.

---

## Task 5.4: Redis cache for enabled-list catalog

`cache.ts`: add `invalidateMailingListsCache()` that deletes `mail:lists:enabled`. Call it from list create/update/delete in `mailingLists.ts`. Use it in the public subscribe path or anywhere the enabled-list catalog is read. Commit.

---

## Task 5.5: Variable catalog reference UI

In `MailTemplateEdit`, render a collapsible "Variables" section that fetches `GET /admin/mail-templates/variables` (a new endpoint that returns `describeVariables()` from the backend), and renders one `<dt><code>{{path}}</code></dt><dd>{description}</dd>` pair per descriptor. Commit.

---

## Task 5.6: Bulk delete subscribers

`SubscribersTable` already includes bulk-checkbox + bulk-delete from Phase 2 — verify the call wires to `mailingListsApi.bulkRemoveSubscribers`. If skipped earlier, wire it now. Commit.

---

## Task 5.7: Build + final smoke test

- [ ] `npm run build` from repo root — full green build.
- [ ] Exercise the full happy path end-to-end: enable feature → create list → seed 5 subscribers → create template → preview with variables → send → watch job complete in Mailpit → unsubscribe one recipient → confirm subscriber status flipped.
- [ ] Disable Mailing Lists from Settings → should auto-cascade-disable… wait, Mailing Lists has no dependents. So it disables cleanly. Tables remain (lazy install never destroys). Re-enable, lists still there.
- [ ] Final commit.

---

## Self-Review Checklist (for the implementing engineer)

Run through this before declaring Phase N complete:

1. **TypeScript:** `npm run build` from repo root is green.
2. **Migrations:** `schema_migrations` shows the expected new rows with `feature='mailing_lists'`.
3. **Feature toggle:** Turning Mailing Lists on/off runs migrations only the first time and never destroys data.
4. **Unsubscribe:** Tokens generated against `MAIL_UNSUBSCRIBE_SECRET` survive a backend restart (the secret is stable in `.env`).
5. **Provider switch:** Setting `MAIL_PROVIDER=mailgun` causes the next outbound send to throw "not implemented" (proving the factory dispatch works); reset to `smtp` to continue.
6. **Preview ↔ Send parity:** A preview HTML with sample variables matches the actual sent HTML (modulo per-recipient substitution).
7. **No `var(--...)` survives in sent HTML:** grep a sample email for `var\(`. Should be zero.
8. **List-Unsubscribe header present on every outbound message:** check Mailpit headers.
9. **Boot resumer recovers a mid-send job:** start a send to 50 recipients, kill the backend mid-job, restart, observe that the worker picks up the remaining `pending` rows.

---

## Open follow-ups (post-V1, not part of this plan)

- Native REST adapter bodies for Mailgun/SendGrid/Postmark with bounce/open webhook ingestion.
- Bounce auto-suppression: webhook → mark subscribers `bounced`, exclude from future sends automatically.
- View-in-browser archive page.
- BullMQ / Redis-backed queue for >10K-recipient lists.
- CSV bulk-import for subscribers.
- Per-template "test send" button (send to one address before mass send).
