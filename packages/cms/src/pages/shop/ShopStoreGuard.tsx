import { createResource, ParentComponent, Show, } from 'solid-js';
import { lazy, } from 'solid-js';
import FeatureReadyGuard from '../../components/common/FeatureReadyGuard';
import { loadShopSettings, storeEnabled, } from '../../stores/shopSettings';

const NotFoundPage = lazy(() => import('../NotFound'));

/**
 * Page-level guard for the public `/shop/*` storefront.
 *
 * TWO independent gates, which are easy to confuse:
 *
 *  - the **`shop` feature** — is the module installed at all? Off means the
 *    site never had a shop, so we show a friendly "store unavailable" panel
 *    rather than a 404, keeping the public Layout chrome and theme tokens.
 *
 *  - **`storeEnabled`** — the operator's "Store enabled" toggle. Off means the
 *    shop exists but is closed. That gets a real **404**: the operator has
 *    deliberately taken the storefront down, so it should look gone rather
 *    than temporarily broken.
 *
 * Pass `requireStoreEnabled` for the routes that only make sense with an open
 * store (the grid, products, cart, checkout). Order confirmation deliberately
 * does NOT use it — someone who already bought something must still be able to
 * reach their receipt after the store closes.
 *
 * It accepts a FUNCTION as well as a boolean, for the one route whose answer
 * depends on the settings this guard is already waiting for: /shop only needs
 * an open store in `builtin` mode, because `page` mode renders the operator's
 * own CMS page, which is ordinary content. Without that, ShopIndex had to
 * duplicate the readiness resource, the loading state and the 404 — the same
 * gate twice, nested inside itself.
 */
const ShopStoreGuard: ParentComponent<{
    requireStoreEnabled?: boolean | (() => boolean);
}> = (props,) => {
    // Resolve settings before deciding, or a closed store flashes its contents
    // for a frame before the 404 replaces it.
    const [ready,] = createResource(async () => {
        await loadShopSettings();
        return true;
    },);

    // Resolved only after settings load, so a predicate can read them safely.
    const required = () => {
        const r = props.requireStoreEnabled;
        return typeof r === 'function' ? r() : Boolean(r,);
    };

    return (
        <FeatureReadyGuard
            feature="shop"
            loading={<div class="shop-store__loading">Loading…</div>}
            fallback={
                <div class="shop-store__unavailable page-wrapper">
                    <h1>Store unavailable</h1>
                    <p>The shop is not currently available. Please check back later.</p>
                </div>
            }
        >
            {/* Wait for settings before deciding, always: a predicate needs
                them, and without the wait a closed store flashes its contents
                for a frame before the 404 replaces it. */}
            <Show when={ready()} fallback={<div class="shop-store__loading">Loading…</div>}>
                <Show when={!required() || storeEnabled()} fallback={<NotFoundPage />}>
                    {props.children}
                </Show>
            </Show>
        </FeatureReadyGuard>
    );
};

export default ShopStoreGuard;
