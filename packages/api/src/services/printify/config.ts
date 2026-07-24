/**
 * Printify config — read the `printify` plugin's stored config (API token, shop
 * id, options) from the plugins registry. The plugin owns the credentials UI;
 * this lets the core sync/fulfillment engine use them. Returns null when the
 * plugin is disabled or unconfigured, so nothing runs unless the operator opted
 * in and set a token + shop id.
 */
import { query, } from '../../db';

export interface PrintifyConfig {
    apiToken: string;
    shopId: string;
    apiBaseUrl: string;
    /** Background refresh cadence (minutes); 0 disables auto-sync. */
    syncIntervalMinutes: number;
    /** Import products as 'active' (true) or 'draft' (false). */
    autoPublish: boolean;
    /** Optional retail uplift on the Printify price (percent). Printify's price
     *  is already retail, so this defaults to 0. */
    priceMarkupPercent: number;
    /** On a paid order, auto-send it to Printify production (fulfill). When
     *  false, the order is created in Printify but held for manual review
     *  (a safety valve for first tests). Defaults to true. */
    autoFulfill: boolean;
}

export async function getPrintifyConfig(): Promise<PrintifyConfig | null> {
    const r = await query(
        `SELECT enabled, installed, config FROM plugins WHERE name = 'printify'`,
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    if (!row.enabled || !row.installed) return null;
    const c = (row.config || {}) as Record<string, unknown>;
    const apiToken = String(c.apiToken ?? '',).trim();
    const shopId = String(c.shopId ?? '',).trim();
    if (!apiToken || !shopId) return null;
    return {
        apiToken,
        shopId,
        apiBaseUrl: String(c.apiBaseUrl ?? 'https://api.printify.com/v1',).replace(/\/+$/, '',),
        syncIntervalMinutes: Number(c.syncIntervalMinutes,) || 60,
        autoPublish: c.autoPublish !== false,
        priceMarkupPercent: Number(c.priceMarkupPercent,) || 0,
        autoFulfill: c.autoFulfill !== false,
    };
}

/** True when Printify is enabled + configured (for gating routes/UI). */
export async function isPrintifyActive(): Promise<boolean> {
    return (await getPrintifyConfig()) !== null;
}
