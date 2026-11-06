/**
 * Shop → Discount codes: site-wide codes (affiliate codes are managed per
 * member on Shop → Affiliates). Permission `shop.discounts:manage`.
 */
import { A, } from '@solidjs/router';
import type { ShopDiscountCode, } from '@sitesurge/types';
import { Component, createResource, createSignal, onCleanup, Show, } from 'solid-js';
import AdminTitle from '../../../components/admin/common/AdminTitle';
import LoadingState from '../../../components/admin/common/LoadingState';
import DiscountCodeModal from '../../../components/admin/discounts/DiscountCodeModal';
import DiscountCodeTable from '../../../components/admin/discounts/DiscountCodeTable';
import { cms, } from '../../../services/cmsClient';
import { isFeatureEnabled, } from '../../../stores/siteSettings';
import ShopGuard from './ShopGuard';

const ShopDiscountsInner: Component = () => {
    const [search, setSearch,] = createSignal('',);
    const [loadError, setLoadError,] = createSignal('',);
    const [codes, { refetch, },] = createResource(search, (q,) =>
        cms.shop.discounts.list({ type: 'site', search: q || undefined, },).then((r,) => { setLoadError('',); return r; },).catch((e,) => {
            setLoadError(e instanceof Error ? e.message : 'The discount codes could not be loaded.',);
            return [];
        },)
    );
    // Debounced, and read through `.latest` below: a new search must not suspend
    // the page (which blanked it and took the focus out of this box per keystroke).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSearch = (v: string,) => {
        clearTimeout(timer,);
        timer = setTimeout(() => setSearch(v.trim(),), 250,);
    };
    onCleanup(() => clearTimeout(timer,),);
    const [editing, setEditing,] = createSignal<ShopDiscountCode | null | undefined>(undefined,);

    return (
        <div class="shop-admin">
            <AdminTitle>Discount codes</AdminTitle>
            <div class="admin-header">
                <A href="/admin/shop" class="admin-header__back">← Shop</A>
                <h1>Discount codes</h1>
                <div class="admin-header__actions">
                    <button type="button" class="ui-button ui-button--primary" onClick={() => setEditing(null,)}>+ New code</button>
                </div>
            </div>

            <section class="admin-section">
                <header class="admin-section__header">
                    <h2>Site-wide codes</h2>
                    <p class="form-help-muted">
                        Codes any buyer can enter at checkout — or only members on chosen levels / roles. They always apply to
                        merchandise{isFeatureEnabled('events',) ? ', and to event tickets when the code allows it' : ''}. "Used" counts paid orders.
                        <Show when={isFeatureEnabled('affiliates',)}>
                            {' '}Affiliate codes are on <A href="/admin/shop/affiliates">Shop → Affiliates</A>.
                        </Show>
                    </p>
                </header>
                <input
                    type="search"
                    class="discount-search"
                    placeholder="Search codes"
                    aria-label="Search codes"
                    // Search-as-you-type box (the one documented exception to commit-on-blur).
                    onInput={(e,) => onSearch(e.currentTarget.value,)}
                />
                <Show when={!loadError()} fallback={<p class="alert alert--error" role="alert">{loadError()}</p>}>
                <Show when={codes.state !== 'unresolved' && codes.state !== 'pending'} fallback={<LoadingState />}>
                    <DiscountCodeTable
                        codes={codes.latest ?? []}
                        onEdit={(c,) => setEditing(c,)}
                        onChanged={() => void refetch()}
                        emptyText={search() ? 'No codes match this search.' : 'No discount codes yet — create one with + New code.'}
                    />
                </Show>
                </Show>
            </section>

            <Show when={editing() !== undefined}>
                <DiscountCodeModal
                    open
                    code={editing()}
                    onClose={() => setEditing(undefined,)}
                    onSaved={() => { setEditing(undefined,); void refetch(); }}
                />
            </Show>
        </div>
    );
};

const ShopDiscounts: Component = () => (
    <ShopGuard>
        <ShopDiscountsInner />
    </ShopGuard>
);

export default ShopDiscounts;
