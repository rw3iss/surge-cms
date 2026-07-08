import type {
    SettingsPublicResponse, SettingsGetAllResponse,
    SettingsUpdateBody, SettingsUpdateResponse,
    SettingsRawKeyBody, SettingsRawKeyResponse, SettingsRawKeyDeleteResponse,
    SettingsHomepageHeroResponse, SettingsHomepageHeroBody,
    SettingsSiteHeaderResponse, SettingsSiteHeaderBody,
    SettingsAdminAppearanceResponse, SettingsAdminAppearanceBody,
    SettingsSiteFooterResponse, SettingsSiteFooterBody,
    SettingsSiteBrandingResponse, SettingsSiteBrandingBody,
    SettingsAppearanceResponse, SettingsAppearanceBody,
    SettingsSiteColorsResponse, SettingsSiteColorsBody, SettingsSiteColorsReplaceResponse,
    SettingsSwatchUsagesResponse, SettingsFeatureUninstallResponse,
} from '@rw/cms-shared';
import { ModuleBase, } from './base';
import { CmsError, FeatureCascadeError, isFeatureCascadeResult, } from '../core/errors';

/**
 * /settings namespace — mixed public/admin. Curated public projection,
 * the full admin row dump, the arbitrary-key get/set/delete, the typed
 * per-section sugar (header / footer / appearance / branding / colors),
 * and the feature-toggle `update()` with its NON-STANDARD 409 cascade.
 *
 * The 409 cascade: PUT /settings answers 409 with a body that is NOT the
 * standard ApiError envelope — `{ success: false, error: <cascade result> }`.
 * The request core detects this in `errorFromEnvelope` and surfaces it as a
 * `FeatureCascadeError`; `update()` additionally re-asserts that mapping
 * defensively so consumers can always `catch (e) { if (e instanceof
 * FeatureCascadeError) … }` and retry with `enableDependencies` /
 * `disableDependents`. See `core/errors.ts`.
 */
export class SettingsModule extends ModuleBase {
    protected readonly module = 'settings';

    // ─── Top-level ────────────────────────────────────────────────

    /** GET /settings/public — curated public projection (cached, public). */
    getPublic(): Promise<SettingsPublicResponse> {
        return this.get<SettingsPublicResponse>('/settings/public',);
    }

    /** GET /settings (admin) — every row keyed by key, with editor metadata. */
    getAll(): Promise<SettingsGetAllResponse> {
        return this.get<SettingsGetAllResponse>('/settings',);
    }

    /**
     * PUT /settings — write non-feature fields and/or run the feature
     * dependency planner. On a rejected toggle the backend answers 409 with
     * the verbatim planner result; this throws `FeatureCascadeError` carrying
     * the typed `SettingsFeatureCascadeResult` (read `.result.missing` or
     * `.result.dependents`). Retry with `enableDependencies` /
     * `disableDependents` set in `body` once the operator confirms.
     */
    async update(body: SettingsUpdateBody,): Promise<SettingsUpdateResponse> {
        try {
            return await this.mutate<SettingsUpdateResponse>('PUT', '/settings', {
                body, invalidates: ['settings',],
            },);
        } catch (err) {
            // Primary path: the core already mapped the non-standard 409 body
            // to FeatureCascadeError — re-throw as-is.
            if (err instanceof FeatureCascadeError) throw err;
            // Defensive path: if a 409 carried the cascade result in `details`
            // but skipped the mapping, re-surface it as FeatureCascadeError.
            if (err instanceof CmsError && err.status === 409 && isFeatureCascadeResult(err.details,)) {
                throw new FeatureCascadeError(err.details, 409,);
            }
            throw err;
        }
    }

    // ─── Arbitrary key (admin) ────────────────────────────────────

    // NOTE: there is no `GET /settings/:key` route on the backend — reads go
    // through the literal-path getters above (getPublic / getSiteHeader / …).
    // Only PUT/DELETE accept an arbitrary key.

    /** PUT /settings/:key — write a value to an arbitrary settings row. */
    setKey(key: string, body: SettingsRawKeyBody,): Promise<SettingsRawKeyResponse> {
        return this.mutate<SettingsRawKeyResponse>('PUT', '/settings/:key', {
            params: { key, }, body, invalidates: ['settings',],
        },);
    }

    /** DELETE /settings/:key — drop an arbitrary settings row. */
    deleteKey(key: string,): Promise<SettingsRawKeyDeleteResponse> {
        return this.mutate<SettingsRawKeyDeleteResponse>('DELETE', '/settings/:key', {
            params: { key, }, invalidates: ['settings',],
        },);
    }

    // ─── Typed per-section sugar ──────────────────────────────────

    /** GET /settings/homepage-hero (public). */
    getHomepageHero(): Promise<SettingsHomepageHeroResponse> {
        return this.get<SettingsHomepageHeroResponse>('/settings/homepage-hero',);
    }

    /** PUT /settings/homepage-hero (admin). */
    setHomepageHero(body: SettingsHomepageHeroBody,): Promise<SettingsRawKeyResponse> {
        return this.mutate<SettingsRawKeyResponse>('PUT', '/settings/homepage-hero', {
            body, invalidates: ['settings',],
        },);
    }

    /** GET /settings/site-header (public). */
    getSiteHeader(): Promise<SettingsSiteHeaderResponse> {
        return this.get<SettingsSiteHeaderResponse>('/settings/site-header',);
    }

    /** PUT /settings/site-header (admin). */
    siteHeader(body: SettingsSiteHeaderBody,): Promise<SettingsRawKeyResponse> {
        return this.mutate<SettingsRawKeyResponse>('PUT', '/settings/site-header', {
            body, invalidates: ['settings',],
        },);
    }

    /** GET /settings/admin-appearance (admin) — admin chrome tokens. */
    getAdminAppearance(): Promise<SettingsAdminAppearanceResponse> {
        return this.get<SettingsAdminAppearanceResponse>('/settings/admin-appearance',);
    }

    /** PUT /settings/admin-appearance (admin). */
    adminAppearance(body: SettingsAdminAppearanceBody,): Promise<SettingsRawKeyResponse> {
        return this.mutate<SettingsRawKeyResponse>('PUT', '/settings/admin-appearance', {
            body, invalidates: ['settings',],
        },);
    }

    /** GET /settings/site-footer (public). */
    getSiteFooter(): Promise<SettingsSiteFooterResponse> {
        return this.get<SettingsSiteFooterResponse>('/settings/site-footer',);
    }

    /** PUT /settings/site-footer (admin). */
    siteFooter(body: SettingsSiteFooterBody,): Promise<SettingsRawKeyResponse> {
        return this.mutate<SettingsRawKeyResponse>('PUT', '/settings/site-footer', {
            body, invalidates: ['settings',],
        },);
    }

    /** GET /settings/site-branding (public) — logo / favicon refs. */
    getSiteBranding(): Promise<SettingsSiteBrandingResponse> {
        return this.get<SettingsSiteBrandingResponse>('/settings/site-branding',);
    }

    /** PUT /settings/site-branding (admin). */
    siteBranding(body: SettingsSiteBrandingBody,): Promise<SettingsRawKeyResponse> {
        return this.mutate<SettingsRawKeyResponse>('PUT', '/settings/site-branding', {
            body, invalidates: ['settings',],
        },);
    }

    /** GET /settings/appearance (public) — public appearance settings. */
    getAppearance(): Promise<SettingsAppearanceResponse> {
        return this.get<SettingsAppearanceResponse>('/settings/appearance',);
    }

    /** PUT /settings/appearance (admin). */
    appearance(body: SettingsAppearanceBody,): Promise<SettingsRawKeyResponse> {
        return this.mutate<SettingsRawKeyResponse>('PUT', '/settings/appearance', {
            body, invalidates: ['settings',],
        },);
    }

    // ─── Swatches (site-colors) ───────────────────────────────────

    /** GET /settings/site-colors (public) — the swatch palette (bare array). */
    listSwatches(): Promise<SettingsSiteColorsResponse> {
        return this.get<SettingsSiteColorsResponse>('/settings/site-colors',);
    }

    /** PUT /settings/site-colors (admin) — replace the whole palette. */
    replaceSwatches(body: SettingsSiteColorsBody,): Promise<SettingsSiteColorsReplaceResponse> {
        return this.mutate<SettingsSiteColorsReplaceResponse>('PUT', '/settings/site-colors', {
            body, invalidates: ['settings',],
        },);
    }

    /** GET /settings/site-colors/usages/:id (admin) — `swatch:{id}` ref count. */
    swatchUsages(id: string,): Promise<SettingsSwatchUsagesResponse> {
        return this.get<SettingsSwatchUsagesResponse>('/settings/site-colors/usages/:id', {
            params: { id, },
        },);
    }

    // ─── Feature lifecycle ────────────────────────────────────────

    /** Permanently remove a feature (drops tables + data). Irreversible. */
    uninstallFeature(key: string,): Promise<SettingsFeatureUninstallResponse> {
        return this.mutate<SettingsFeatureUninstallResponse>('POST', '/settings/features/:key/uninstall', {
            params: { key, }, body: { confirm: true, }, invalidates: ['settings',],
        },);
    }
}
