/**
 * Wire DTOs for the /settings module. Validation schemas live in
 * `packages/api/src/routes/settings.ts`; the per-key getters/setters,
 * the public projection, and the feature dependency planner live in
 * `packages/api/src/services/settings.ts` + `services/swatches.ts`.
 *
 * NOTE: PUT /settings has a NON-STANDARD 409 contract — see
 * `SettingsFeatureCascadeResult` below. Every other route here uses the
 * normal `ApiResponse<T>` envelope.
 */

import type {
    AppearanceSettings,
    SiteFeatures,
    SiteFooterSettings,
    SiteSettings,
    SiteSwatch,
} from '../../types/content';
import type { SiteHeaderSettings, } from '../../types/siteHeader';

// ─── Feature keys (mirror of the backend FEATURE_REGISTRY) ────────────

/**
 * The toggleable feature modules. Mirrors `FeatureKey` in
 * `packages/api/src/features/registry.ts` — re-declared here (shared
 * depends on nothing) so the cascade DTOs below can name the keys
 * precisely. Kept in sync with `SiteFeatureKey` (the public `features`
 * projection keys), which is the same set.
 */
export type SettingsFeatureKey =
    | 'patreon' | 'posts' | 'campaigns' | 'forms' | 'messages' | 'users'
    | 'mailing_lists' | 'shop';

// ─── GET /settings/public ─────────────────────────────────────────────

/**
 * GET /settings/public — the curated public projection. PUBLIC-SHAPED:
 * a fixed subset of `site_settings` (no admin keys, no audit metadata),
 * with `features` computed server-side. The two optional Shopify fields
 * are appended only when storefront credentials are configured; they are
 * NOT part of `SiteSettings`, so the projection type widens it here.
 */
export type SettingsPublicResponse = SiteSettings & {
    shopifyDomain?: string;
    shopifyStorefrontToken?: string;
};

// ─── GET /settings (admin) ────────────────────────────────────────────

/** One settings row as surfaced to the admin panel: the JSON value plus
 *  last-editor metadata. `updatedAt` serializes to an ISO string;
 *  `updatedBy` is the editor's display name (absent for system writes). */
export interface AdminSettingRow {
    value: unknown;
    /** ISO date-time */
    updatedAt: string;
    updatedBy?: string;
}

/** GET /settings — every settings row keyed by `site_settings.key`. */
export type SettingsGetAllResponse = Record<string, AdminSettingRow>;

// ─── PUT /settings (the feature cascade) ──────────────────────────────

/** Body for PUT /settings. Non-feature fields write straight through;
 *  `features` (if present) runs the dependency planner. */
export interface SettingsUpdateBody {
    siteName?: string;
    siteDescription?: string;
    logo?: string | null;
    favicon?: string | null;
    socialLinks?: Record<string, string>;
    contactEmail?: string;
    analytics?: { googleAnalyticsId?: string; facebookPixelId?: string; };
    theme?: { primaryColor?: string; secondaryColor?: string; accentColor?: string; };
    /** Feature toggles. Keys must exist in the registry; unknown keys 400. */
    features?: Record<string, boolean>;
    /** On enable: also enable any not-yet-enabled prerequisites. */
    enableDependencies?: boolean;
    /** On disable: also disable any enabled features that require this one. */
    disableDependents?: boolean;
}

/** PUT /settings (200, standard envelope) — confirmation + optional install results. */
export interface SettingsUpdateResponse {
    message: string;
    /** Present when the update toggled one or more features. One entry
     *  per feature step in the plan, carrying the migrations that ran
     *  (empty when the feature was already installed or was disabled). */
    features?: {
        key: string;
        enabled: boolean;
        appliedMigrations: string[];
    }[];
}

/** POST /settings/features/:key/uninstall — body (must pass `confirm: true`). */
export interface SettingsFeatureUninstallBody {
    confirm: true;
}

/** POST /settings/features/:key/uninstall — success response. */
export interface SettingsFeatureUninstallResponse {
    message: string;
    droppedTables: string[];
}

/**
 * !!! NON-STANDARD CONTRACT !!!
 *
 * When the feature dependency planner REJECTS a toggle, PUT /settings
 * answers **409** with a body that is NOT the standard `ApiError`
 * envelope. The body is exactly:
 *
 *   { success: false, error: SettingsFeatureCascadeResult }
 *
 * where `error` is the planner's verbatim refusal result (kind +
 * offending keys) — NOT an `{ code, message }` ApiError. The frontend
 * FeatureDependencyModal reads this exact shape to render its
 * "also enable/disable these?" confirmation and retries with
 * `enableDependencies` / `disableDependents` set. Do not route this
 * through the standard error handling; it bypasses the envelope on
 * purpose. (Flagged in the API charter.)
 */
export type SettingsFeatureCascadeResult =
    | {
        ok: false;
        kind: 'missing_prerequisites';
        target: SettingsFeatureKey;
        missing: SettingsFeatureKey[];
    }
    | {
        ok: false;
        kind: 'has_dependents';
        target: SettingsFeatureKey;
        dependents: SettingsFeatureKey[];
    };

/** The full 409 body PUT /settings sends on a rejected cascade. NOT the
 *  standard `ApiResponse` / `ApiError` shape — see the doc note above. */
export interface SettingsFeatureCascadeErrorBody {
    success: false;
    error: SettingsFeatureCascadeResult;
}

// ─── GET/PUT /settings/homepage-hero ──────────────────────────────────
// Each keyed JSON setting is stored as one opaque `site_settings` row.
// The route layer never validates the body shape (input is `unknown`),
// so the wire DTOs are loosely typed to match what is actually stored.

/** GET /settings/homepage-hero — the stored hero blob (or its fallback). */
export type SettingsHomepageHeroResponse = unknown;

/** Body for PUT /settings/homepage-hero — written verbatim. */
export type SettingsHomepageHeroBody = unknown;

// ─── GET/PUT /settings/site-header ────────────────────────────────────

/** GET /settings/site-header — stored header settings (or fallback). */
export type SettingsSiteHeaderResponse = SiteHeaderSettings;

/** Body for PUT /settings/site-header. */
export type SettingsSiteHeaderBody = SiteHeaderSettings;

// ─── GET/PUT /settings/admin-appearance ───────────────────────────────

/** GET /settings/admin-appearance — admin chrome tokens (opaque blob). */
export type SettingsAdminAppearanceResponse = unknown;

/** Body for PUT /settings/admin-appearance. */
export type SettingsAdminAppearanceBody = unknown;

// ─── GET/PUT /settings/site-footer ────────────────────────────────────

/** GET /settings/site-footer — stored footer settings (or fallback). */
export type SettingsSiteFooterResponse = SiteFooterSettings;

/** Body for PUT /settings/site-footer. */
export type SettingsSiteFooterBody = SiteFooterSettings;

// ─── GET/PUT /settings/site-branding ──────────────────────────────────

/** Logo / favicon reference. Each holds an optional media id + URL. */
export interface SiteBranding {
    logo?: { mediaId?: string; url?: string; };
    favicon?: { mediaId?: string; url?: string; };
}

/** GET /settings/site-branding — stored branding (or fallback). */
export type SettingsSiteBrandingResponse = SiteBranding;

/** Body for PUT /settings/site-branding. */
export type SettingsSiteBrandingBody = SiteBranding;

// ─── GET/PUT /settings/appearance ─────────────────────────────────────

/** GET /settings/appearance — stored public appearance (or fallback). */
export type SettingsAppearanceResponse = AppearanceSettings;

/** Body for PUT /settings/appearance. */
export type SettingsAppearanceBody = AppearanceSettings;

// ─── GET/PUT /settings/site-colors ────────────────────────────────────

/** GET /settings/site-colors — the swatch palette as a BARE ARRAY (no
 *  pagination meta). Legacy `string[]` storage is auto-migrated on read. */
export type SettingsSiteColorsResponse = SiteSwatch[];

/** Body for PUT /settings/site-colors — the replacement palette. Entries
 *  with an invalid hex are dropped; missing/duplicate ids are reallocated
 *  server-side, so every field is optional on input. */
export type SettingsSiteColorsBody = Array<Partial<SiteSwatch>>;

/** PUT /settings/site-colors — the validated, persisted palette. */
export type SettingsSiteColorsReplaceResponse = SiteSwatch[];

// ─── GET /settings/site-colors/usages/:id ─────────────────────────────

/** Params for GET /settings/site-colors/usages/:id. */
export interface SettingsSwatchUsagesParams {
    id: string;
}

/** GET /settings/site-colors/usages/:id — count of `swatch:{id}`
 *  references across the DB, broken down by source. */
export interface SettingsSwatchUsagesResponse {
    total: number;
    breakdown: Array<{ source: string; count: number; }>;
}

// ─── PUT/DELETE /settings/:key ────────────────────────────────────────

/** Params for the arbitrary-key upsert/delete routes. */
export interface SettingsKeyParams {
    key: string;
}

/** Body for PUT /settings/:key — the value is written verbatim. */
export interface SettingsRawKeyBody {
    value: unknown;
}

/** PUT /settings/:key — confirmation message. */
export interface SettingsRawKeyResponse {
    message: string;
}

/** DELETE /settings/:key — confirmation message. */
export interface SettingsRawKeyDeleteResponse {
    message: string;
}

// Re-export the computed feature projection for consumers wiring the
// public settings shape (it already lives on SiteSettings.features).
export type { SiteFeatures, };
