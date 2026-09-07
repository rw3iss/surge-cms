/**
 * Public shop settings, fetched once and shared.
 *
 * The header and every `/shop/*` guard need `storeEnabled` on first paint. Each
 * storefront page used to call `cms.shop.settings.getPublic()` for itself, so a
 * single page view could issue several identical requests and each consumer
 * would flash its own loading state. One in-flight promise instead.
 *
 * `storeEnabled` is the operator's "Store enabled" toggle in Shop Settings, and
 * it is NOT the same thing as the `shop` FEATURE being on. The feature decides
 * whether the module exists at all; this decides whether the storefront is open
 * for business. Both have to pass before a visitor sees a shop.
 */
import { createSignal, } from 'solid-js';
import type { ShopPublicSettings, } from '@sitesurge/types';
import { cms, } from '../services/cmsClient';

const [settings, setSettings,] = createSignal<ShopPublicSettings | null>(null,);
const [loaded, setLoaded,] = createSignal(false,);

let inFlight: Promise<void> | null = null;

/** Fetch once. Concurrent callers share the same request. */
export function loadShopSettings(): Promise<void> {
    if (loaded()) return Promise.resolve();
    inFlight ??= (async () => {
        try {
            // The endpoint wraps the settings alongside the storefront appearance.
            const res = await cms.shop.settings.getPublic();
            setSettings(res?.settings ?? null,);
        } catch {
            // A failed fetch must not wedge the guards permanently open or
            // shut; `loaded` still flips so consumers stop waiting, and the
            // null settings below resolve to "closed".
        } finally {
            setLoaded(true,);
            inFlight = null;
        }
    })();
    return inFlight;
}

export const shopSettings = settings;
export const shopSettingsLoaded = loaded;

/**
 * Is the storefront open?
 *
 * Defaults to CLOSED until the settings resolve, and stays closed if they fail
 * to load. Guarding a shop is a case where being wrong in the permissive
 * direction briefly exposes a store the operator has deliberately turned off.
 */
export const storeEnabled = (): boolean => settings()?.storeEnabled === true;

/** `page` = the operator points /shop at their own CMS page instead of the
 *  built-in product grid. */
export const storefrontMode = (): 'builtin' | 'page' =>
    settings()?.storefrontMode === 'page' ? 'page' : 'builtin';

/** Test seam — lets a test set state without a network call. */
export function __setShopSettingsForTest(value: ShopPublicSettings | null,): void {
    setSettings(value,);
    setLoaded(true,);
}
