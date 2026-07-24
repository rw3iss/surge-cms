'use strict';

/**
 * Printify plugin (credentials + config veneer). The heavy lifting — syncing
 * products into the built-in Shop and submitting paid orders to Printify for
 * fulfillment — lives in the CORE (`services/printify/*`), which reads this
 * plugin's saved config (token/shop id). This module only validates config and
 * offers a "Test connection" action for the config page. Products are synced
 * from Shop → Products ("Sync from Printify").
 */

const DEFAULT_BASE = 'https://api.printify.com/v1';

function cfg(ctx) {
    const c = ctx.config || {};
    return {
        apiToken: String(c.apiToken || '').trim(),
        shopId: String(c.shopId || '').trim(),
        base: String(c.apiBaseUrl || DEFAULT_BASE).replace(/\/+$/, ''),
    };
}

async function pf(ctx, method, path) {
    const c = cfg(ctx);
    if (!c.apiToken) return { ok: false, status: 0, error: 'Set your Printify API token first.' };
    return ctx.httpJson(`${c.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${c.apiToken}`, 'User-Agent': 'SiteSurge-CMS' },
    });
}

module.exports = {
    async install(ctx) { ctx.logger.info('Printify plugin installed.'); },
    async onEnable(ctx) { ctx.logger.info('Printify enabled — configure a token + shop id, then Sync from Printify in Shop → Products.'); },
    async onDisable(ctx) { ctx.logger.info('Printify disabled.'); },
    async onLoad() { /* background sync is scheduled by the core cron */ },
    async update(ctx) {
        return { fromVersion: ctx.installedVersion || ctx.version, toVersion: ctx.version, migrated: false, notes: 'No migration.' };
    },

    validateConfig(config) {
        const errors = {};
        if (config.apiToken !== undefined && !String(config.apiToken).trim()) {
            errors.apiToken = 'API token is required.';
        }
        if (config.shopId !== undefined && String(config.shopId).trim() && !/^\d+$/.test(String(config.shopId).trim())) {
            errors.shopId = 'Shop id should be numeric.';
        }
        if (config.syncIntervalMinutes !== undefined && Number(config.syncIntervalMinutes) < 0) {
            errors.syncIntervalMinutes = 'Interval must be 0 or more minutes.';
        }
        return { ok: Object.keys(errors).length === 0, errors };
    },

    actions: {
        // Verify the token and list the account's shops so the operator can pick
        // the right shop id. Never throws — returns { ok:false, error } on failure.
        async testConnection(ctx) {
            const c = cfg(ctx);
            const r = await pf(ctx, 'GET', '/shops.json');
            if (!r.ok) return { ok: false, error: r.error || 'Could not reach Printify.' };
            const shops = Array.isArray(r.data) ? r.data : [];
            const shop = shops.find((s) => String(s.id) === c.shopId);
            return {
                ok: true,
                shopCount: shops.length,
                shopFound: Boolean(shop),
                shopTitle: shop ? shop.title : null,
                shops: shops.map((s) => ({ id: s.id, title: s.title, channel: s.sales_channel })),
            };
        },
    },
};
