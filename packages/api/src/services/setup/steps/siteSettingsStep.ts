import { AppError, } from '../../../core/errors';
import { DbSettingsStore, } from '../stores/dbSettingsStore';
import type { InstallContext, InstallStep, } from './InstallStep';

/**
 * Writes wizard-collected runtime settings to `site_settings` and marks
 * the installation complete with `installed=true` + `installed_at`.
 *
 * Note: this step does NOT write the env-only secrets (DATABASE_URL,
 * JWT_SECRET, etc.); those go through `envBuffer` and are flushed by
 * `envWriteStep` last. Splitting the two means a partial run cannot
 * leave `installed=true` in the DB but the `.env` still missing
 * credentials.
 */
export const siteSettingsStep: InstallStep = {
    id: 'site-settings',
    section: 'general',
    isApplicable: () => true,

    async execute(ctx: InstallContext,): Promise<void> {
        if (!ctx.pool) throw new AppError(500, 'SETTINGS_NEEDS_POOL', 'No DB pool for site_settings',);
        const store = new DbSettingsStore(ctx.pool,);

        const { siteName, siteTagline, } = ctx.input.general;
        const entries: Record<string, string> = {
            site_name: JSON.stringify(siteName,),
            installed: JSON.stringify(true,),
            installed_at: JSON.stringify(new Date().toISOString(),),
            setup_version: JSON.stringify('1.0',),
            storage_provider: JSON.stringify(ctx.input.storage.provider,),
            upload_max_size_mb: JSON.stringify(ctx.input.general.uploadMaxSizeMb,),
        };
        // Tagline is optional — write only if the operator entered one.
        // We don't write empty so the absence is observable downstream
        // (a row that exists but is empty looks the same as "set to ''").
        const trimmedTagline = (siteTagline ?? '').trim();
        if (trimmedTagline) {
            entries.site_tagline = JSON.stringify(trimmedTagline,);
        }
        await store.setMany(entries,);
    },
};
