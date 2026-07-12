import { useParams, } from '@solidjs/router';
import type { ShopProductDetail, ShopProductMediaDetail, ShopReview, ShopVariant, } from '@sitesurge/types';
import { Component, createMemo, createResource, createSignal, For, Show, } from 'solid-js';
import SeoHead from '../../components/common/seo/SeoHead';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import { siteName, } from '../../stores/siteSettings';
import { addToCart, } from '../../stores/shopCart';
import ShopStoreGuard from './ShopStoreGuard';
import StarRating from './StarRating';
import { money, ratingLabel, } from './shopFormat';
import './shop.scss';

const ShopProductInner: Component = () => {
    const params = useParams();
    const auth = useAuth();

    const [product] = createResource(
        () => params.slug,
        async (slug,) => {
            try {
                return await cms.shop.products.getBySlug(slug,) as ShopProductDetail;
            } catch {
                return null;
            }
        },
    );

    return (
        <div class="shop-store shop-product page-wrapper">
            <Show when={!product.loading} fallback={<div class="shop-store__loading">Loading…</div>}>
                <Show
                    when={product()}
                    fallback={
                        <div class="shop-store__not-found">
                            <h1>Product not found</h1>
                            <p>This product doesn't exist or is no longer available.</p>
                        </div>
                    }
                >
                    {(p,) => <ProductDetail product={p()} isLoggedIn={auth.isAuthenticated} />}
                </Show>
            </Show>
        </div>
    );
};

const ProductDetail: Component<{ product: ShopProductDetail; isLoggedIn: boolean; }> = (props,) => {
    const product = () => props.product;

    // ── Media gallery ────────────────────────────────────────────────
    const media = createMemo(() =>
        [...(product().media ?? []),].sort((a, b,) => a.position - b.position,),
    );
    const [activeMedia, setActiveMedia,] = createSignal(0,);
    const currentMedia = (): ShopProductMediaDetail | undefined => media()[activeMedia()];

    // ── Variant resolution ───────────────────────────────────────────
    // Options are ordered by `position`; a variant's option1/2/3 map to the
    // selected value of option[0]/[1]/[2]. We track the selected value per
    // option name and resolve the matching variant (all set options equal).
    const options = createMemo(() =>
        [...(product().options ?? []),].sort((a, b,) => a.position - b.position,),
    );
    const variants = () => product().variants ?? [];

    const initialSelection = (): Record<string, string> => {
        const def = variants().find((v,) => v.isDefault,) ?? variants()[0];
        const sel: Record<string, string> = {};
        options().forEach((opt, idx,) => {
            const key = ([def?.option1, def?.option2, def?.option3,][idx]) ?? opt.values[0]?.value;
            if (key) sel[opt.name] = key;
        },);
        return sel;
    };
    const [selection, setSelection,] = createSignal<Record<string, string>>(initialSelection(),);

    const selectOption = (name: string, value: string,) =>
        setSelection((prev,) => ({ ...prev, [name]: value, }),);

    const resolvedVariant = createMemo<ShopVariant | undefined>(() => {
        const opts = options();
        const sel = selection();
        // build [selectedForOption0, 1, 2]
        const picks = opts.map((o,) => sel[o.name]);
        return variants().find((v,) => {
            const vo = [v.option1, v.option2, v.option3,];
            return picks.every((pick, i,) => (pick == null) || vo[i] === pick,)
                // require every option the product declares to be chosen
                && opts.every((_, i,) => picks[i] != null,);
        },) ?? (opts.length === 0 ? variants()[0] : undefined);
    });

    const inStock = () => (resolvedVariant()?.inventoryQty ?? 0) > 0;
    const price = () => resolvedVariant()?.priceCents;
    const compareAt = () => resolvedVariant()?.compareAtPriceCents;

    const [added, setAdded,] = createSignal(false,);
    const handleAdd = () => {
        const v = resolvedVariant();
        if (!v || !inStock()) return;
        const variantTitle = options().map((o,) => selection()[o.name]).filter(Boolean,).join(' / ',);
        addToCart({
            variantId: v.id,
            productId: product().id,
            slug: product().slug,
            title: product().title,
            variantTitle: variantTitle || null,
            priceCents: v.priceCents,
            image: media()[0]?.url ?? null,
            qty: 1,
        },);
        setAdded(true,);
        setTimeout(() => setAdded(false,), 2000,);
    };

    // ── Reviews ──────────────────────────────────────────────────────
    const [reviews, { refetch: refetchReviews, },] = createResource(
        () => product().id,
        async (productId,) => {
            try {
                const { data, } = await cms.shop.reviews.list(productId,);
                return data ?? [];
            } catch {
                return [] as ShopReview[];
            }
        },
    );

    const [rvRating, setRvRating,] = createSignal(5,);
    const [rvTitle, setRvTitle,] = createSignal('',);
    const [rvBody, setRvBody,] = createSignal('',);
    const [rvSubmitting, setRvSubmitting,] = createSignal(false,);
    const [rvMessage, setRvMessage,] = createSignal('',);
    const [rvError, setRvError,] = createSignal('',);

    const submitReview = async (e: Event,) => {
        e.preventDefault();
        setRvError('',);
        setRvMessage('',);
        setRvSubmitting(true,);
        try {
            await cms.shop.reviews.create(product().id, {
                rating: rvRating(),
                title: rvTitle() || undefined,
                body: rvBody() || undefined,
            },);
            setRvMessage('Thanks! Your review was submitted and is pending approval.',);
            setRvTitle('',);
            setRvBody('',);
            setRvRating(5,);
            void refetchReviews();
        } catch (err) {
            setRvError(err instanceof Error ? err.message : 'Failed to submit review.',);
        } finally {
            setRvSubmitting(false,);
        }
    };

    const markHelpful = async (id: string,) => {
        try {
            await cms.shop.reviews.markHelpful(id,);
            void refetchReviews();
        } catch {
            /* ignore */
        }
    };

    return (
        <>
            <SeoHead
                title={product().metaTitle || product().title}
                description={product().metaDescription || product().description || `${product().title} — ${siteName()}`}
                canonical={`${window.location.origin}/shop/${product().slug}`}
                type="website"
            />

            <div class="shop-product__layout">
                {/* Gallery */}
                <div class="shop-product__gallery">
                    <div class="shop-product__gallery-main">
                        <Show
                            when={currentMedia()}
                            fallback={<div class="shop-product__gallery-placeholder" aria-hidden="true">🛍</div>}
                        >
                            {(m,) => (
                                <Show
                                    when={m().kind === 'video'}
                                    fallback={<img src={m().url} alt={m().alt || product().title} />}
                                >
                                    <video src={m().url} controls />
                                </Show>
                            )}
                        </Show>
                    </div>
                    <Show when={media().length > 1}>
                        <div class="shop-product__thumbs">
                            <For each={media()}>
                                {(m, i,) => (
                                    <button
                                        type="button"
                                        class={`shop-product__thumb ${activeMedia() === i() ? 'is-active' : ''}`}
                                        onClick={() => setActiveMedia(i(),)}
                                    >
                                        <img src={m.thumbnailUrl || m.url} alt={m.alt || ''} />
                                    </button>
                                )}
                            </For>
                        </div>
                    </Show>
                </div>

                {/* Info */}
                <div class="shop-product__info">
                    <h1 class="shop-product__title">{product().title}</h1>

                    <Show when={product().ratingCount > 0}>
                        <div class="shop-product__rating">
                            <StarRating value={product().ratingAvg} count={product().ratingCount} showCount />
                            <span class="shop-product__rating-avg">{ratingLabel(product().ratingAvg,)}</span>
                        </div>
                    </Show>

                    <div class="shop-product__price">
                        <Show when={price() != null} fallback={<span>Unavailable</span>}>
                            <span class="shop-product__price-now">{money(price()!,)}</span>
                            <Show when={compareAt() && compareAt()! > price()!}>
                                <span class="shop-product__price-was">{money(compareAt()!,)}</span>
                            </Show>
                        </Show>
                    </div>

                    {/* Option selectors */}
                    <For each={options()}>
                        {(opt,) => (
                            <div class="shop-product__option">
                                <label class="shop-product__option-label">{opt.name}</label>
                                <div class="shop-product__option-values">
                                    <For each={opt.values}>
                                        {(val,) => (
                                            <button
                                                type="button"
                                                class={`shop-product__swatch ${selection()[opt.name] === val.value ? 'is-selected' : ''}`}
                                                onClick={() => selectOption(opt.name, val.value,)}
                                            >
                                                {val.value}
                                            </button>
                                        )}
                                    </For>
                                </div>
                            </div>
                        )}
                    </For>

                    <div class="shop-product__actions">
                        <button
                            type="button"
                            class="btn btn--primary shop-product__add"
                            disabled={!resolvedVariant() || !inStock()}
                            onClick={handleAdd}
                        >
                            <Show when={!resolvedVariant()} fallback={
                                <Show when={inStock()} fallback="Out of stock">
                                    {added() ? 'Added ✓' : 'Add to Cart'}
                                </Show>
                            }>
                                Select options
                            </Show>
                        </button>
                        <Show when={resolvedVariant() && inStock() && resolvedVariant()!.inventoryQty <= 5}>
                            <span class="shop-product__stock-note">
                                Only {resolvedVariant()!.inventoryQty} left
                            </span>
                        </Show>
                    </div>

                    <Show when={product().description}>
                        <div class="shop-product__description rich-text" innerHTML={product().description!} />
                    </Show>
                </div>
            </div>

            {/* Reviews */}
            <section class="shop-reviews">
                <h2>Reviews</h2>
                <Show when={product().ratingCount > 0}>
                    <div class="shop-reviews__summary">
                        <span class="shop-reviews__avg">{ratingLabel(product().ratingAvg,)}</span>
                        <StarRating value={product().ratingAvg} />
                        <span class="shop-reviews__count">
                            {product().ratingCount} review{product().ratingCount === 1 ? '' : 's'}
                        </span>
                    </div>
                </Show>

                <Show
                    when={(reviews() ?? []).length > 0}
                    fallback={<p class="shop-reviews__empty">No reviews yet. Be the first!</p>}
                >
                    <ul class="shop-reviews__list">
                        <For each={reviews()}>
                            {(r,) => (
                                <li class="shop-review">
                                    <div class="shop-review__head">
                                        <StarRating value={r.rating} />
                                        <Show when={r.verifiedPurchase}>
                                            <span class="shop-review__verified">Verified purchase</span>
                                        </Show>
                                    </div>
                                    <Show when={r.title}>
                                        <h3 class="shop-review__title">{r.title}</h3>
                                    </Show>
                                    <Show when={r.body}>
                                        <p class="shop-review__body">{r.body}</p>
                                    </Show>
                                    <button
                                        type="button"
                                        class="shop-review__helpful"
                                        onClick={() => markHelpful(r.id,)}
                                    >
                                        Helpful ({r.helpfulCount})
                                    </button>
                                </li>
                            )}
                        </For>
                    </ul>
                </Show>

                {/* Write a review */}
                <div class="shop-reviews__write">
                    <h3>Write a review</h3>
                    <Show
                        when={props.isLoggedIn}
                        fallback={
                            <p class="shop-reviews__login">
                                Please <a href="/login">sign in</a> to write a review.
                            </p>
                        }
                    >
                        <form onSubmit={submitReview}>
                            <div class="shop-reviews__stars-input">
                                <For each={[1, 2, 3, 4, 5,]}>
                                    {(n,) => (
                                        <button
                                            type="button"
                                            class={`shop-reviews__star-btn ${rvRating() >= n ? 'is-on' : ''}`}
                                            onClick={() => setRvRating(n,)}
                                            aria-label={`${n} star${n === 1 ? '' : 's'}`}
                                        >
                                            ★
                                        </button>
                                    )}
                                </For>
                            </div>
                            <input
                                type="text"
                                placeholder="Title (optional)"
                                value={rvTitle()}
                                onInput={(e,) => setRvTitle(e.currentTarget.value,)}
                            />
                            <textarea
                                placeholder="Share your thoughts…"
                                rows={4}
                                value={rvBody()}
                                onInput={(e,) => setRvBody(e.currentTarget.value,)}
                            />
                            <Show when={rvError()}>
                                <div class="shop-store__error">{rvError()}</div>
                            </Show>
                            <Show when={rvMessage()}>
                                <div class="shop-store__notice">{rvMessage()}</div>
                            </Show>
                            <button type="submit" class="btn btn--primary" disabled={rvSubmitting()}>
                                {rvSubmitting() ? 'Submitting…' : 'Submit review'}
                            </button>
                        </form>
                    </Show>
                </div>
            </section>
        </>
    );
};

const ShopProduct: Component = () => (
    <ShopStoreGuard>
        <ShopProductInner />
    </ShopStoreGuard>
);

export default ShopProduct;
