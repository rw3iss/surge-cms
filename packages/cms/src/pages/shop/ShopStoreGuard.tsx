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
 */
const ShopStoreGuard: ParentComponent<{ requireStoreEnabled?: boolean; }> = (props,) => {
    // Resolve settings before deciding, or a closed store flashes its contents
    // for a frame before the 404 replaces it.
    const [ready,] = createResource(async () => {
        await loadShopSettings();
        return true;
    },);

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
            <Show
                when={!props.requireStoreEnabled || ready()}
                fallback={<div class="shop-store__loading">Loading…</div>}
            >
                <Show
                    when={!props.requireStoreEnabled || storeEnabled()}
                    fallback={<NotFoundPage />}
                >
                    {props.children}
                </Show>
            </Show>
        </FeatureReadyGuard>
    );
};

export default ShopStoreGuard;
