import { A, } from '@solidjs/router';
import { ParentComponent, } from 'solid-js';
import FeatureReadyGuard from '../../../components/common/FeatureReadyGuard';

/**
 * Page-level guard for the /admin/shop/* section. A disabled-feature deep-link
 * shows a friendly "not enabled" panel rather than firing data calls that 404.
 * Shared gate/ready logic lives in FeatureReadyGuard.
 */
const ShopGuard: ParentComponent = (props,) => (
    <FeatureReadyGuard
        feature="shop"
        fallback={
            <div class="shop-admin__disabled">
                <h1>Shop is not enabled</h1>
                <p class="form-help-muted">
                    The Shop feature is currently disabled. Enable it under
                    Settings &rarr; Features to manage products, orders, and
                    checkout.
                </p>
                <A href="/admin/settings" class="ui-button ui-button--primary">Go to Settings</A>
            </div>
        }
    >
        {props.children}
    </FeatureReadyGuard>
);

export default ShopGuard;
