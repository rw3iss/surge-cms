/**
 * Shop settings service — the shop's two `site_settings` JSONB rows
 * (`shop_settings` + `shop_appearance`) with a cached raw read, a
 * storefront-safe public projection, an admin full read, and an admin
 * merge/update.
 *
 *   const { settings, appearance } = await getRaw();
 *   const pub = await getPublic();          // cache-safe, no secrets
 *   await update({ settings: { currency: 'eur' } }, ctx);
 *
 * Defaults MUST match the registry `shop` onEnable seed
 * (`features/registry.ts`) so a fresh install and an unseeded install read
 * the same shape.
 *
 * PUBLIC PROJECTION is cache-safe: it emits only display flags
 * (currency / storeEnabled / taxEnabled display flag / businessName /
 * currencyDisplay) plus the full appearance (all render-time, public by
 * nature). Stripe secret keys live in env/config — never in these rows —
 * so they cannot leak through any of these reads.
 */
import type { ShopAppearance, ShopPublicSettings, ShopSettings, } from '@rw/cms-shared';
import { query, } from '../../db';
import { ValidationError, } from '../../core/errors';
import { logAudit, } from '../audit';
import { cache, } from '../cache';
import { uuidOrNull, } from '../../utils/uuid';
import type { AuditContext, } from '../types';

const SETTINGS_KEY = 'shop_settings';
const APPEARANCE_KEY = 'shop_appearance';
const PUBLIC_CACHE_KEY = 'shop:settings:public';
const RAW_CACHE_KEY = 'shop:settings:raw';

// Defaults mirror the registry `shop` onEnable seed. Keep in sync.
const DEFAULT_SETTINGS: ShopSettings = {
    currency: 'usd',
    taxEnabled: true,
    businessName: '',
    storeEnabled: true,
};

const DEFAULT_APPEARANCE: ShopAppearance = {
    gridColumns: 3,
    showRatings: true,
    cardStyle: 'standard',
};

export interface ShopConfig {
    settings: ShopSettings;
    appearance: ShopAppearance;
}

async function readRow<T,>(key: string,): Promise<Partial<T> | null> {
    const result = await query<{ value: Partial<T>; }>(
        `SELECT value FROM site_settings WHERE key = $1`,
        [key,],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].value;
}

/**
 * Read both rows and merge with defaults (matching the registry seed).
 * Cached like other settings — the raw config feeds checkout/fulfillment
 * as well as the admin read. Returns defaults when rows are absent.
 */
export async function getRaw(): Promise<ShopConfig> {
    const cached = await cache.get<ShopConfig>(RAW_CACHE_KEY,);
    if (cached) return cached;

    const [settingsRow, appearanceRow,] = await Promise.all([
        readRow<ShopSettings>(SETTINGS_KEY,),
        readRow<ShopAppearance>(APPEARANCE_KEY,),
    ],);

    const config: ShopConfig = {
        settings: { ...DEFAULT_SETTINGS, ...(settingsRow ?? {}), },
        appearance: { ...DEFAULT_APPEARANCE, ...(appearanceRow ?? {}), },
    };

    await cache.set(RAW_CACHE_KEY, config, 600,);
    return config;
}

/**
 * Storefront projection (cached 600s). SAFE SUBSET only — appearance is
 * fully public; settings are reduced to display flags. NO Stripe secret
 * keys / payout internals / business address. Single cache entry, safe to
 * serve to everyone.
 */
export async function getPublic(): Promise<{ settings: ShopPublicSettings; appearance: ShopAppearance; }> {
    const cached = await cache.get<{ settings: ShopPublicSettings; appearance: ShopAppearance; }>(PUBLIC_CACHE_KEY,);
    if (cached) return cached;

    const { settings, appearance, } = await getRaw();
    const projection = {
        settings: {
            currency: settings.currency,
            taxEnabled: settings.taxEnabled,
            storeEnabled: settings.storeEnabled,
            businessName: settings.businessName,
            currencyDisplay: appearance.currencyDisplay,
        },
        appearance,
    };

    await cache.set(PUBLIC_CACHE_KEY, projection, 600,);
    return projection;
}

/** Admin full config — every settings + appearance field. Still no raw
 *  Stripe secret (those are env/config, not these rows). */
export async function getAdmin(): Promise<ShopConfig> {
    return getRaw();
}

export interface ShopSettingsPatch {
    settings?: Partial<ShopSettings>;
    appearance?: Partial<ShopAppearance>;
}

function validate(patch: ShopSettingsPatch,): void {
    const s = patch.settings;
    if (s) {
        if (s.currency !== undefined && !/^[a-zA-Z]{3}$/.test(s.currency,)) {
            throw new ValidationError('currency must be a 3-letter ISO code',);
        }
        const ship = s.shipping;
        if (ship) {
            if (ship.flatCents !== undefined && (!Number.isInteger(ship.flatCents,) || ship.flatCents < 0)) {
                throw new ValidationError('shipping.flatCents must be a non-negative integer',);
            }
            if (ship.freeThresholdCents !== undefined
                && (!Number.isInteger(ship.freeThresholdCents,) || ship.freeThresholdCents < 0)) {
                throw new ValidationError('shipping.freeThresholdCents must be a non-negative integer',);
            }
        }
    }
    const a = patch.appearance;
    if (a) {
        if (a.gridColumns !== undefined && (!Number.isInteger(a.gridColumns,) || a.gridColumns < 1 || a.gridColumns > 6)) {
            throw new ValidationError('gridColumns must be an integer between 1 and 6',);
        }
    }
}

async function writeRow(key: string, value: unknown, actor: string | null,): Promise<void> {
    await query(
        `INSERT INTO site_settings (key, value, updated_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [key, JSON.stringify(value,), actor,],
    );
}

/**
 * Merge a partial patch into shop_settings and/or shop_appearance, validate,
 * persist both affected rows, audit (entityType 'shop-settings'), and bust
 * the shop-settings caches (raw + public) plus the global settings cache.
 * Appearance is render-time client-side, so the product caches are left
 * intact. Returns the updated full config.
 */
export async function update(patch: ShopSettingsPatch, ctx: AuditContext,): Promise<ShopConfig> {
    validate(patch,);

    const current = await getRaw();
    const actor = uuidOrNull(ctx.userId,);

    const nextSettings: ShopSettings = { ...current.settings, ...(patch.settings ?? {}), };
    const nextAppearance: ShopAppearance = { ...current.appearance, ...(patch.appearance ?? {}), };

    if (patch.settings) {
        await writeRow(SETTINGS_KEY, nextSettings, actor,);
    }
    if (patch.appearance) {
        await writeRow(APPEARANCE_KEY, nextAppearance, actor,);
    }

    await cache.del(RAW_CACHE_KEY,);
    await cache.del(PUBLIC_CACHE_KEY,);
    await cache.invalidateSettingsCache();

    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'shop-settings',
        entityId: 'shop',
        newValues: { settings: patch.settings, appearance: patch.appearance, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    return { settings: nextSettings, appearance: nextAppearance, };
}

/** Convenience for checkout / fulfillment: the full ShopSettings row
 *  (shipping + tax + currency) merged with defaults. */
export async function getShopSettings(): Promise<ShopSettings> {
    const { settings, } = await getRaw();
    return settings;
}
