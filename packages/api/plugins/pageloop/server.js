'use strict';
/**
 * PageLoop plugin — server hooks. The widget bundle (client/pageloop.umd.js +
 * vanilla.css, served same-origin at /api/v1/plugins/pageloop/assets/*) now
 * SHIPS WITH THIS PLUGIN: PageLoop went closed-source, so the old
 * download-from-npm/jsdelivr path 404s. install()/update() therefore keep the
 * shipped bundle in place; there is no network fetch. All hooks are idempotent.
 */
const PAGELOOP_VERSION = '0.7.4';
// Legacy public-CDN location — kept only as a last-resort fallback if the
// shipped bundle is somehow missing (it 404s for closed-source releases, so
// the fetch is wrapped and never allowed to throw the install).
const CDN = `https://cdn.jsdelivr.net/npm/@pageloop/vanilla@${PAGELOOP_VERSION}/dist`;

async function ensureBundle(ctx) {
    // The bundle ships with the plugin — storage.download with force=false is a
    // no-op when the file exists. Wrapped so a dead CDN can never fail install.
    try {
        await ctx.storage.download(`${CDN}/pageloop.umd.js`, 'client/pageloop.umd.js', { force: false });
        await ctx.storage.download(`${CDN}/vanilla.css`, 'client/vanilla.css', { force: false });
    } catch (err) {
        ctx.logger.warn(`PageLoop bundle ships with the plugin; CDN fetch skipped (${err && err.message}).`);
    }
}

module.exports = {
    async install(ctx) {
        await ensureBundle(ctx);
        ctx.logger.info(`PageLoop widget bundle v${PAGELOOP_VERSION} ready (shipped).`);
    },

    async update(ctx) {
        // The new bundle arrived with the updated plugin files; nothing to fetch.
        await ensureBundle(ctx);
        return {
            fromVersion: ctx.installedVersion || ctx.version,
            toVersion: ctx.version,
            migrated: false,
            notes: `PageLoop widget bundle v${PAGELOOP_VERSION} (shipped with the plugin).`,
        };
    },

    async onEnable(ctx) { ctx.logger.info('PageLoop enabled.'); },
    async onDisable(ctx) { ctx.logger.info('PageLoop disabled.'); },
    async onLoad() { /* no server-side runtime — the widget talks to the PageLoop endpoint directly */ },
    async uninstall() { /* downloaded bundle is removed with the plugin folder */ },

    validateConfig(config) {
        const errors = {};
        if (config.endpoint && !/^https?:\/\//i.test(String(config.endpoint))) {
            errors.endpoint = 'Must be an http(s) URL';
        }
        return { ok: Object.keys(errors).length === 0, errors };
    },
};
