import { A, } from '@solidjs/router';
import { createResource, ParentComponent, Show, } from 'solid-js';
import { isFeatureEnabled, loadSiteSettings, } from '../../../stores/siteSettings';

/**
 * Page-level guard for the /admin/shop/* section. The nav hides the Shop
 * entry when the feature is disabled, but a disabled-feature deep-link
 * should show a friendly "not enabled" panel rather than fire data calls
 * that 404. We wait for site settings to load first so we don't flash the
 * disabled state during the initial fetch.
 */
const ShopGuard: ParentComponent = (props,) => {
    const [ready,] = createResource(async () => {
        await loadSiteSettings();
        return true;
    },);

    return (
        <Show when={ready()} fallback={<div class="empty-state">Loading...</div>}>
            <Show
                when={isFeatureEnabled('shop',)}
                fallback={
                    <div class="shop-admin__disabled">
                        <h1>Shop is not enabled</h1>
                        <p class="form-help-muted">
                            The Shop feature is currently disabled. Enable it under
                            Settings &rarr; Features to manage products, orders, and
                            checkout.
                        </p>
                        <A href="/admin/settings" class="btn btn--primary">Go to Settings</A>
                    </div>
                }
            >
                {props.children}
            </Show>
        </Show>
    );
};

export default ShopGuard;
