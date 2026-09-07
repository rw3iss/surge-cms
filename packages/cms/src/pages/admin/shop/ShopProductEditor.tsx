import { Title, } from '@solidjs/meta';
import { useNavigate, useParams, } from '@solidjs/router';
import { Component, createMemo, createResource, createSignal, For, onMount, Show, } from 'solid-js';
import { createStore, produce, } from 'solid-js/store';
import type {
    ShopCategory,
    ShopCollection,
    ShopMediaInput,
    ShopOptionInput,
    ShopProductCreateBody,
    ShopProductDetail,
    ShopVariantInput,
} from '@sitesurge/types';
import Toggle from '../../../components/admin/common/Toggle';
import { FormField, FormSection, } from '../../../components/admin/forms';
import MediaSelectModal, { type MediaItem, } from '../../../components/admin/media/MediaSelectModal';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import { isPluginEnabled, loadEnabledPlugins, } from '../../../stores/plugins';
import ShopGuard from './ShopGuard';
import ShopifyManagedBanner from './ShopifyManagedBanner';
import { centsToDollars, dollarsToCents, slugify, } from './shopUtils';

// ── Local editor models ───────────────────────────────────────────────

interface OptionModel {
    name: string;
    /** Raw editable text for the values input (e.g. "Small, Medium, Large").
     *  Kept verbatim while typing so commas/spaces aren't stripped mid-edit;
     *  parsed into discrete values via `parseValues` only when building the
     *  variant grid or the save payload. */
    valuesText: string;
}

/** Split a comma-separated values string into trimmed, non-empty values. */
function parseValues(text: string,): string[] {
    return text.split(',',).map((s,) => s.trim()).filter(Boolean,);
}

/** One row in the variant matrix — the option combo + editable fields. */
interface VariantRow {
    id?: string;
    option1: string | null;
    option2: string | null;
    option3: string | null;
    sku: string;
    price: string;
    compareAt: string;
    inventory: string;
    weight: string;
    requiresShipping: boolean;
    /** Per-variant flat shipping cost, as editable dollars. */
    shipping: string;
    imageId: string | null;
}

interface MediaRow {
    /** Imported asset id ('' for external/provider media). */
    mediaId: string;
    /** External URL for provider-synced (e.g. Printify) media; undefined for
     *  imported assets. Carried so it round-trips on save (removing/reordering
     *  external media persists instead of being silently dropped). */
    externalUrl?: string;
    kind: 'image' | 'video';
    url: string;
    thumbnailUrl?: string;
    /**
     * Variant this image belongs to, or '' for "All" (shown for every
     * selection). Set automatically by the Printify / Apliiq syncs and
     * adjustable here. The storefront swaps the photo to the first image
     * matching the shopper's colour.
     */
    variantId?: string;
}

/** Stable key for a variant's option combo. */
function comboKey(o1: string | null, o2: string | null, o3: string | null,): string {
    return [o1 ?? '', o2 ?? '', o3 ?? '',].join('\u0000',);
}

/** Cartesian product of each option's values → the full variant grid. */
function cartesian(options: OptionModel[],): Array<[string | null, string | null, string | null,]> {
    const active = options
        .filter((o,) => o.name.trim() && parseValues(o.valuesText,).length > 0)
        .map((o,) => parseValues(o.valuesText,));
    if (active.length === 0) return [[null, null, null,],];
    let combos: string[][] = [[],];
    for (const vals of active) {
        const next: string[][] = [];
        for (const c of combos) {
            for (const v of vals) next.push([...c, v,]);
        }
        combos = next;
    }
    return combos.map((c,) => [c[0] ?? null, c[1] ?? null, c[2] ?? null,]);
}

const emptyVariant = (o1: string | null, o2: string | null, o3: string | null,): VariantRow => ({
    option1: o1,
    option2: o2,
    option3: o3,
    sku: '',
    price: '',
    compareAt: '',
    inventory: '0',
    weight: '',
    requiresShipping: true,
    shipping: '',
    imageId: null,
});

const ShopProductEditorInner: Component = () => {
    const params = useParams<{ id: string, }>();
    const navigate = useNavigate();
    const toast = useToast();
    const isNew = () => !params.id || params.id === 'new';

    const [title, setTitle,] = createSignal('',);
    const [slug, setSlug,] = createSignal('',);
    const [slugTouched, setSlugTouched,] = createSignal(false,);
    const [description, setDescription,] = createSignal('',);
    const [type, setType,] = createSignal<'physical' | 'digital'>('physical',);
    const [status, setStatus,] = createSignal<'draft' | 'active' | 'archived'>('draft',);
    const [isFeatured, setIsFeatured,] = createSignal(false,);
    const [metaTitle, setMetaTitle,] = createSignal('',);
    const [metaDescription, setMetaDescription,] = createSignal('',);
    const [shippingType, setShippingType,] = createSignal<'flat' | 'calculated'>('calculated',);
    const [useDefaultShipping, setUseDefaultShipping,] = createSignal(true,);

    const [options, setOptions,] = createStore<OptionModel[]>([],);
    const [variants, setVariants,] = createStore<VariantRow[]>([emptyVariant(null, null, null,),],);
    const [media, setMedia,] = createStore<MediaRow[]>([],);

    const [categoryIds, setCategoryIds,] = createSignal<string[]>([],);
    const [collectionIds, setCollectionIds,] = createSignal<string[]>([],);
    const [tags, setTags,] = createSignal<string[]>([],);
    // Manual sort position — '' means unset ('-' → falls back to updated_at order).
    const [position, setPosition,] = createSignal<string>('',);

    // Total product count → the Position dropdown offers 1..N.
    const [productCount,] = createResource(async () => {
        try {
            const r = await cms.shop.products.list({ page: 1, limit: 1, },);
            return r.meta?.total ?? 0;
        } catch { return 0; }
    },);
    const [tagInput, setTagInput,] = createSignal('',);

    const [saving, setSaving,] = createSignal(false,);
    const [deleting, setDeleting,] = createSignal(false,);
    const [showMedia, setShowMedia,] = createSignal(false,);
    // when picking a per-variant image, holds that variant's index
    const [mediaTargetVariant, setMediaTargetVariant,] = createSignal<number | null>(null,);

    const [allCategories,] = createResource(async () => {
        try { return await cms.shop.categories.list() as ShopCategory[]; } catch { return [] as ShopCategory[]; }
    },);
    const [allCollections,] = createResource(async () => {
        try { return await cms.shop.collections.list({ all: 'true', },) as ShopCollection[]; } catch { return [] as ShopCollection[]; }
    },);

    const hydrate = (d: ShopProductDetail,) => {
        setTitle(d.title,);
        setSlug(d.slug,);
        setSlugTouched(true,);
        setDescription(d.description || '',);
        setType(d.type,);
        setStatus(d.status,);
        setIsFeatured(Boolean(d.isFeatured,),);
        setMetaTitle(d.metaTitle || '',);
        setMetaDescription(d.metaDescription || '',);
        setShippingType(d.shippingType === 'calculated' ? 'calculated' : 'flat',);
        setUseDefaultShipping(d.useDefaultShipping ?? true,);
        setOptions(d.options.map((o,) => ({ name: o.name, valuesText: o.values.map((v,) => v.value,).join(', ',), }),),);
        setVariants(
            d.variants.length
                ? d.variants.map((v,) => ({
                    id: v.id,
                    option1: v.option1 ?? null,
                    option2: v.option2 ?? null,
                    option3: v.option3 ?? null,
                    sku: v.sku || '',
                    price: centsToDollars(v.priceCents,),
                    compareAt: centsToDollars(v.compareAtPriceCents,),
                    inventory: String(v.inventoryQty ?? 0,),
                    weight: v.weightGrams != null ? String(v.weightGrams,) : '',
                    requiresShipping: v.requiresShipping,
                    shipping: v.shippingCents != null ? centsToDollars(v.shippingCents,) : '',
                    imageId: v.imageId ?? null,
                }),)
                : [emptyVariant(null, null, null,),],
        );
        setMedia(
            // Native rows carry a mediaId; external (Printify) rows carry an
            // externalUrl (null mediaId). Keep BOTH so the row round-trips on
            // save — otherwise removing/reordering external media is dropped.
            d.media.map((m,) => ({
                mediaId: m.mediaId ?? '',
                externalUrl: m.externalUrl ?? undefined,
                kind: m.kind,
                url: m.url,
                thumbnailUrl: m.thumbnailUrl ?? undefined,
                variantId: m.variantId ?? '',
            }),),
        );
        setCategoryIds(d.categoryIds,);
        setCollectionIds(d.collectionIds,);
        setTags(d.tags,);
        setPosition(d.position != null ? String(d.position,) : '',);
    };

    const [loaded,] = createResource(
        () => (isNew() ? null : params.id),
        async (id,) => {
            try {
                const d = await cms.shop.products.getById(id,);
                hydrate(d,);
                return d;
            } catch {
                return null;
            }
        },
    );

    // ── Sync from Printify (single item) ──────────────────────────────
    const [syncing, setSyncing,] = createSignal(false,);
    // Refresh enabled-plugin state on mount so the button's visibility is
    // accurate as soon as the page loads.
    onMount(() => { void loadEnabledPlugins(); },);
    // Only for Printify-linked products, and only when the plugin is enabled.
    const canSyncPrintify = () =>
        !isNew() && isPluginEnabled('printify',) && loaded()?.externalProvider === 'printify';

    const handleSyncFromPrintify = async () => {
        if (!canSyncPrintify()) return;
        setSyncing(true,);
        try {
            const r = await cms.shop.printify.syncOne(params.id,);
            if (r.ok) {
                toast.success('Synced from Printify.',);
                // Re-hydrate the form with the freshly-synced product (media, prices).
                const d = await cms.shop.products.getById(params.id,);
                hydrate(d,);
            } else {
                toast.error(r.error || 'Printify sync failed.',);
            }
        } catch (err: any) {
            toast.error(err?.message || 'Printify sync failed.',);
        } finally {
            setSyncing(false,);
        }
    };

    const handleTitle = (v: string,) => {
        setTitle(v,);
        if (!slugTouched()) setSlug(slugify(v,),);
    };

    // ── Options + variant matrix ──────────────────────────────────────

    const regenerateVariants = () => {
        const combos = cartesian(options,);
        // preserve existing rows by their option combo
        const byKey = new Map<string, VariantRow>();
        for (const v of variants) byKey.set(comboKey(v.option1, v.option2, v.option3,), v,);
        const next: VariantRow[] = combos.map(([o1, o2, o3,],) => {
            const existing = byKey.get(comboKey(o1, o2, o3,),);
            return existing ? { ...existing, option1: o1, option2: o2, option3: o3, } : emptyVariant(o1, o2, o3,);
        },);
        setVariants(next,);
    };

    const addOption = () => {
        if (options.length >= 3) return;
        setOptions(produce((o,) => { o.push({ name: '', valuesText: '', },); }),);
    };
    const removeOption = (idx: number,) => {
        setOptions(produce((o,) => { o.splice(idx, 1,); }),);
        regenerateVariants();
    };
    const setOptionName = (idx: number, name: string,) => setOptions(idx, 'name', name,);
    // Store the raw text verbatim while editing — parsing happens on blur
    // (regenerateVariants) and at save (buildPayload). Parsing per keystroke
    // is what previously ate commas/spaces and blocked multi-value entry.
    const setOptionValues = (idx: number, raw: string,) => setOptions(idx, 'valuesText', raw,);

    const hasOptions = createMemo(() => options.some((o,) => o.name.trim() && parseValues(o.valuesText,).length > 0));

    const optionLabels = createMemo(() => options.filter((o,) => o.name.trim()).map((o,) => o.name.trim()));

    // ── Media ─────────────────────────────────────────────────────────

    const handleMediaSelect = (item: MediaItem,) => {
        const targetVariant = mediaTargetVariant();
        if (targetVariant !== null) {
            setVariants(targetVariant, 'imageId', item.id,);
            setMediaTargetVariant(null,);
            setShowMedia(false,);
            return;
        }
        if (!media.some((m,) => m.mediaId === item.id,)) {
            setMedia(produce((list,) => {
                list.push({
                    mediaId: item.id,
                    kind: item.mimeType.startsWith('video/',) ? 'video' : 'image',
                    url: item.url,
                    thumbnailUrl: item.thumbnailUrl,
                },);
            }),);
        }
        setShowMedia(false,);
    };

    const removeMedia = (idx: number,) => setMedia(produce((list,) => { list.splice(idx, 1,); }),);

    /** Attribute one image to a variant, or '' for "All". */
    const setMediaVariant = (idx: number, variantId: string,) =>
        setMedia(idx, 'variantId', variantId,);

    /**
     * Move a media row to an arbitrary index (drag-and-drop).
     *
     * Order IS the stored `position` — it's assigned from the array index on
     * save, so dropping a row renumbers everything after it automatically and
     * the sequence always starts at 0 with no gaps.
     */
    const reorderMedia = (from: number, to: number,) => {
        if (from === to || from < 0 || to < 0 || from >= media.length || to >= media.length) return;
        setMedia(produce((list,) => {
            const [row,] = list.splice(from, 1,);
            list.splice(to, 0, row,);
        }),);
    };

    const [dragIndex, setDragIndex,] = createSignal<number | null>(null,);
    const [dragOverIndex, setDragOverIndex,] = createSignal<number | null>(null,);

    /**
     * The choices offered per image.
     *
     * COLOURS, not every variant. A product with 3 colours x 5 sizes has 15
     * variants but only 3 distinct photos — listing all 15 would be noise, and
     * the storefront already falls back from "this exact variant" to "any image
     * whose variant shares this option1". Each choice therefore carries the
     * FIRST variant id of that colour, which is exactly what the Printify and
     * Apliiq syncs attribute to.
     *
     * Empty when the product has no options (a single default variant), where
     * attribution would mean nothing.
     */
    const mediaVariantChoices = (): { id: string; label: string; }[] => {
        // WHICH option is the colour? Not necessarily the first — a product may
        // be defined Size-then-Color. Prefer an option actually named colour,
        // and fall back to the first only when nothing says so.
        const axis = Math.max(0, options.findIndex((o,) => /colou?r/i.test(o.name,),),);
        const valueOf = (v: VariantRow,) =>
            axis === 2 ? v.option3 : axis === 1 ? v.option2 : v.option1;

        const seen = new Map<string, string>();
        for (const v of variants) {
            const label = valueOf(v,);
            if (!v.id || !label) continue;
            if (!seen.has(label,)) seen.set(label, v.id,);
        }
        return [...seen.entries(),].map(([label, id,],) => ({ id, label, }));
    };

    /**
     * Group the media by variant for the DEFAULT presentation — each colour's
     * images together, "All" first. Applied on demand rather than continuously,
     * so a manual drag isn't undone the moment it lands.
     */
    const groupMediaByVariant = () => {
        const order = new Map<string, number>();
        mediaVariantChoices().forEach((c, i,) => order.set(c.id, i,));
        setMedia(produce((list,) => {
            const rows = [...list,];
            // Stable sort: rows within a colour keep their relative order.
            rows.sort((a, b,) => {
                // "All" rows lead — they apply to every selection.
                const rank = (m: MediaRow,) => (m.variantId ? (order.get(m.variantId,) ?? 1e6) : -1);
                return rank(a,) - rank(b,);
            },);
            list.splice(0, list.length, ...rows,);
        }),);
    };

    // ── Tags ──────────────────────────────────────────────────────────

    const addTag = () => {
        const t = tagInput().trim();
        if (t && !tags().includes(t,)) setTags([...tags(), t,],);
        setTagInput('',);
    };
    const removeTag = (t: string,) => setTags(tags().filter((x,) => x !== t,),);

    const toggleId = (accessor: () => string[], setter: (v: string[],) => void, id: string,) => {
        const cur = accessor();
        setter(cur.includes(id,) ? cur.filter((x,) => x !== id,) : [...cur, id,],);
    };

    // ── Shipping ──────────────────────────────────────────────────────
    // Show the per-variant shipping cost column only for flat-fee products
    // that aren't using the shop's default flat rate.
    const showVariantShipping = () => shippingType() === 'flat' && !useDefaultShipping();
    const applyShippingToAll = () => {
        const first = variants[0]?.shipping ?? '';
        for (let i = 0; i < variants.length; i++) setVariants(i, 'shipping', first,);
    };

    // ── Save ──────────────────────────────────────────────────────────

    const buildPayload = (): ShopProductCreateBody => {
        const optionInputs: ShopOptionInput[] = options
            .filter((o,) => o.name.trim() && parseValues(o.valuesText,).length > 0)
            .map((o, i,) => ({
                name: o.name.trim(),
                position: i,
                values: parseValues(o.valuesText,).map((v, vi,) => ({ value: v, position: vi, }),),
            }),);

        const variantInputs: ShopVariantInput[] = variants.map((v, i,) => ({
            sku: v.sku || null,
            priceCents: dollarsToCents(v.price,),
            compareAtPriceCents: v.compareAt ? dollarsToCents(v.compareAt,) : null,
            inventoryQty: parseInt(v.inventory || '0', 10,) || 0,
            weightGrams: v.weight ? parseInt(v.weight, 10,) : null,
            requiresShipping: v.requiresShipping,
            // Per-variant flat shipping only matters for flat-fee products not
            // using the shop default; otherwise null.
            shippingCents: (shippingType() === 'flat' && !useDefaultShipping() && v.shipping)
                ? dollarsToCents(v.shipping,)
                : null,
            option1: v.option1,
            option2: v.option2,
            option3: v.option3,
            imageId: v.imageId,
            position: i,
            isDefault: i === 0 && !hasOptions(),
        }),);

        const mediaInputs: ShopMediaInput[] = media.map((m, i,) => ({
            // Send exactly the identity the row has: a native asset's mediaId, or
            // an external (Printify) row's externalUrl — so external media survive
            // a save instead of being dropped.
            mediaId: m.mediaId || undefined,
            externalUrl: m.mediaId ? undefined : m.externalUrl,
            // '' means "All" — send null so the column is cleared rather than
            // rejected as a malformed uuid.
            variantId: m.variantId || null,
            position: i,
            kind: m.kind,
        }),);

        return {
            title: title(),
            slug: slug(),
            description: description() || null,
            type: type(),
            status: status(),
            isFeatured: isFeatured(),
            metaTitle: metaTitle() || null,
            metaDescription: metaDescription() || null,
            shippingType: shippingType(),
            useDefaultShipping: useDefaultShipping(),
            options: optionInputs,
            variants: variantInputs,
            media: mediaInputs,
            categoryIds: categoryIds(),
            collectionIds: collectionIds(),
            tags: tags(),
            // '' → null (clear position, fall back to updated_at order).
            position: position() === '' ? null : Number(position(),),
        };
    };

    const handleSave = async () => {
        if (!title().trim() || !slug().trim()) {
            toast.error('Title and slug are required.',);
            return;
        }
        setSaving(true,);
        try {
            const payload = buildPayload();
            if (isNew()) {
                const created = await cms.shop.products.create(payload,);
                toast.success('Product created.',);
                navigate(`/admin/shop/products/${created.id}`,);
            } else {
                await cms.shop.products.update(params.id, payload,);
                toast.success('Product saved.',);
            }
        } catch {
            /* error bus surfaces the toast */
        } finally {
            setSaving(false,);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Delete this product? This cannot be undone.',)) return;
        setDeleting(true,);
        try {
            await cms.shop.products.remove(params.id,);
            toast.success('Product deleted.',);
            navigate('/admin/shop/products',);
        } catch {
            /* error bus surfaces the toast */
        } finally {
            setDeleting(false,);
        }
    };

    return (
        <div class="shop-admin shop-product-editor">
            <Title>{isNew() ? 'New Product' : 'Edit Product'} - Admin - RW</Title>
            {/* All actions live in the STICKY header, so Save stays reachable
                from anywhere in a long product form instead of requiring a
                scroll to the bottom. Sync sits next to the title (it acts on
                where the data comes from), the rest are right-aligned. */}
            <div class="admin-header">
                <h1>{isNew() ? 'New Product' : 'Edit Product'}</h1>
                <Show when={canSyncPrintify()}>
                    <button
                        class="ui-button ui-button--sm ui-button--secondary"
                        onClick={handleSyncFromPrintify}
                        disabled={syncing()}
                        title="Pull the latest images, price, and details for this product from Printify"
                    >
                        {syncing() ? 'Syncing…' : 'Sync from Printify'}
                    </button>
                </Show>
                <div class="admin-header__actions">
                    <button
                        class="ui-button ui-button--secondary"
                        onClick={() => navigate('/admin/shop/products',)}
                        disabled={saving()}
                    >
                        Cancel
                    </button>
                    <Show when={!isNew()}>
                        <button
                            class="ui-button ui-button--danger"
                            onClick={handleDelete}
                            disabled={deleting() || saving()}
                        >
                            {deleting() ? 'Deleting…' : 'Delete'}
                        </button>
                    </Show>
                    <button
                        class="ui-button ui-button--primary"
                        onClick={handleSave}
                        disabled={saving()}
                    >
                        {saving() ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>
            <ShopifyManagedBanner note="Products are managed in Shopify while the plugin is enabled; this internal editor doesn't affect the storefront." />

            <Show when={isNew() || loaded.state !== 'pending'} fallback={<div class="empty-state">Loading...</div>}>
                <div class="shop-product-editor__grid">
                    {/* Section 1 — product details (left) + settings & SEO (right) */}
                    <div class="shop-product-editor__cols">
                        <div class="shop-product-editor__col">
                            <FormField label="Title" class="form-field--block">
                                <input
                                    type="text"
                                    value={title()}
                                    onInput={(e,) => handleTitle(e.currentTarget.value,)}
                                />
                            </FormField>
                            <FormField label="Slug" hint="lowercase, no spaces" class="form-field--block">
                                <input
                                    type="text"
                                    value={slug()}
                                    onInput={(e,) => { setSlugTouched(true,); setSlug(e.currentTarget.value,); }}
                                />
                            </FormField>
                            <FormField label="Description" class="form-field--block">
                                <textarea
                                    rows={5}
                                    value={description()}
                                    onInput={(e,) => setDescription(e.currentTarget.value,)}
                                />
                            </FormField>
                            <FormField label="Tags">
                                <div class="shop-product-editor__tags">
                                    <For each={tags()}>
                                        {(t,) => (
                                            <span class="shop-product-editor__tag">
                                                {t}
                                                <button onClick={() => removeTag(t,)}>×</button>
                                            </span>
                                        )}
                                    </For>
                                    <input
                                        type="text"
                                        placeholder="Add tag + Enter"
                                        value={tagInput()}
                                        onInput={(e,) => setTagInput(e.currentTarget.value,)}
                                        onKeyDown={(e,) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                                    />
                                </div>
                            </FormField>
                            <FormField
                                label="Position"
                                hint="Manual sort order in product listings. '-' falls back to last-updated order."
                            >
                                <select value={position()} onChange={(e,) => setPosition(e.currentTarget.value,)}>
                                    <option value="">-</option>
                                    <For each={Array.from({ length: productCount() ?? 0, }, (_, i) => i + 1,)}>
                                        {(n,) => <option value={String(n,)}>{n}</option>}
                                    </For>
                                </select>
                            </FormField>
                        </div>
                        <div class="shop-product-editor__col">
                            <FormField label="Type" inline>
                                <select value={type()} onChange={(e,) => setType(e.currentTarget.value as 'physical' | 'digital',)}>
                                    <option value="physical">Physical</option>
                                    <option value="digital">Digital</option>
                                </select>
                            </FormField>
                            <FormField label="Status" inline>
                                <select
                                    value={status()}
                                    onChange={(e,) => setStatus(e.currentTarget.value as 'draft' | 'active' | 'archived',)}
                                >
                                    <option value="draft">Draft</option>
                                    <option value="active">Active</option>
                                    <option value="archived">Archived</option>
                                </select>
                            </FormField>
                            <FormField
                                label="Shipping"
                                tooltip="How shipping is priced for this product. Flat fee: a static cost (the shop's default flat rate, or a per-variant amount). Calculated: a live rate from a shipping provider at checkout based on weight + address."
                                inline
                            >
                                <select
                                    value={shippingType()}
                                    onChange={(e,) => setShippingType(e.currentTarget.value as 'flat' | 'calculated',)}
                                >
                                    <option value="flat">Flat fee</option>
                                    <option value="calculated">Calculated</option>
                                </select>
                            </FormField>
                            <Show when={shippingType() === 'flat'}>
                                <div class="form-group">
                                    <Toggle
                                        checked={useDefaultShipping()}
                                        onChange={setUseDefaultShipping}
                                        label="Use default shipping cost"
                                    />
                                    <span class="form-help">
                                        {useDefaultShipping()
                                            ? 'Uses the shop’s Flat shipping rate (Shop → Settings → Shipping).'
                                            : 'Set a per-variant shipping cost in the Variants table below.'}
                                    </span>
                                </div>
                            </Show>
                            <Show when={shippingType() === 'calculated'}>
                                <p class="form-help-muted">
                                    Live rates are calculated at checkout from the shipping provider based
                                    on the items and delivery address. If a live quote can’t be retrieved,
                                    the shop’s flat shipping rate is used as a fallback.
                                </p>
                            </Show>
                            <FormField
                                label="Is featured"
                                tooltip="Marks this product as featured. Use it to target or pull featured items into carousels and other blocks — bind an entity block to a query with `isFeatured` set to true and it pulls a live set, so you don't have to hand-pick products that later go out of stock. Deactivated and archived products are never returned to the public site, featured or not."
                                class="form-field--block"
                            >
                                <Toggle
                                    label={isFeatured() ? 'Featured' : 'Not featured'}
                                    checked={isFeatured()}
                                    onChange={setIsFeatured}
                                />
                            </FormField>
                            <FormField
                                label="Meta title"
                                tooltip="The title shown in search-engine results and browser tabs for this product's page. Falls back to the product title if left blank. Aim for ~50–60 characters."
                                class="form-field--block"
                            >
                                <input type="text" value={metaTitle()} onInput={(e,) => setMetaTitle(e.currentTarget.value,)} />
                            </FormField>
                            <FormField
                                label="Meta description"
                                tooltip="A short summary shown beneath the title in search-engine results. It doesn't affect ranking but influences click-through. Aim for ~150–160 characters."
                                class="form-field--block"
                            >
                                <textarea rows={2} value={metaDescription()} onInput={(e,) => setMetaDescription(e.currentTarget.value,)} />
                            </FormField>
                        </div>
                    </div>

                    {/* Section 2 — media (left) + taxonomy (right; header dropped, the
                        Categories/Collections labels stand on their own) */}
                    <div class="shop-product-editor__cols">
                        <div class="shop-product-editor__col">
                            <FormSection title="Media" padded>
                                <button
                                    class="ui-button ui-button--sm ui-button--secondary"
                                    onClick={() => { setMediaTargetVariant(null,); setShowMedia(true,); }}
                                >
                                    + Add media
                                </button>
                                <Show when={media.length} fallback={<p class="form-help-muted">No media added.</p>}>
                                    <Show when={mediaVariantChoices().length > 0}>
                                        <div class="shop-product-editor__media-toolbar">
                                            <p class="form-help-muted">
                                                Drag to reorder. The first image is the main one; assigning an
                                                image to a colour makes the storefront switch to it when a
                                                shopper picks that colour.
                                            </p>
                                            <button
                                                type="button"
                                                class="ui-button ui-button--sm ui-button--secondary"
                                                onClick={groupMediaByVariant}
                                            >
                                                Group by colour
                                            </button>
                                        </div>
                                    </Show>
                                    <div class="shop-product-editor__media-list">
                                        <For each={media}>
                                            {(m, i,) => (
                                                <div
                                                    class="shop-product-editor__media-item"
                                                    classList={{
                                                        'is-dragging': dragIndex() === i(),
                                                        'is-drop-target': dragOverIndex() === i() && dragIndex() !== i(),
                                                    }}
                                                    draggable={true}
                                                    onDragStart={(e,) => {
                                                        setDragIndex(i(),);
                                                        // Firefox won't start a drag without payload.
                                                        e.dataTransfer?.setData('text/plain', String(i(),),);
                                                    }}
                                                    onDragOver={(e,) => { e.preventDefault(); setDragOverIndex(i(),); }}
                                                    onDrop={(e,) => {
                                                        e.preventDefault();
                                                        const from = dragIndex();
                                                        if (from !== null) reorderMedia(from, i(),);
                                                        setDragIndex(null,); setDragOverIndex(null,);
                                                    }}
                                                    onDragEnd={() => { setDragIndex(null,); setDragOverIndex(null,); }}
                                                >
                                                    {/* The frame is the positioning
                                                        context for the overlays, so
                                                        they anchor to the THUMBNAIL
                                                        rather than to the tile (which
                                                        also contains the select, and
                                                        whose height therefore varies). */}
                                                    <div class="shop-product-editor__media-frame">
                                                        <Show
                                                            when={m.kind === 'image'}
                                                            fallback={<div class="shop-product-editor__media-thumb shop-product-editor__media-thumb--video">▶</div>}
                                                        >
                                                            <img
                                                                class="shop-product-editor__media-thumb"
                                                                src={m.thumbnailUrl || m.url}
                                                                alt=""
                                                                draggable={false}
                                                            />
                                                        </Show>
                                                        {/* Floats over the bottom of the
                                                            thumbnail. In flow it added a
                                                            line to the FIRST tile only,
                                                            pushing that tile's dropdown
                                                            out of line with the others. */}
                                                        <Show when={i() === 0}>
                                                            <span class="shop-product-editor__media-main">Main</span>
                                                        </Show>

                                                        {/* Delete lives in the corner and appears on hover, so a
                                                            grid of thumbnails isn't a wall of buttons. */}
                                                        <button
                                                            type="button"
                                                            class="shop-product-editor__media-remove"
                                                            aria-label="Remove media"
                                                            title="Remove"
                                                            onClick={() => removeMedia(i(),)}
                                                        >
                                                            ×
                                                        </button>
                                                    </div>

                                                    <Show when={mediaVariantChoices().length > 0}>
                                                        <select
                                                            class="shop-product-editor__media-variant"
                                                            aria-label="Assign this image to a colour"
                                                            value={m.variantId ?? ''}
                                                            onChange={(e,) => setMediaVariant(i(), e.currentTarget.value,)}
                                                        >
                                                            <option value="">All</option>
                                                            <For each={mediaVariantChoices()}>
                                                                {(c,) => <option value={c.id}>{c.label}</option>}
                                                            </For>
                                                        </select>
                                                    </Show>
                                                </div>
                                            )}
                                        </For>
                                    </div>
                                </Show>
                            </FormSection>
                        </div>
                        <div class="shop-product-editor__col">
                            <FormField label="Categories">
                                <div class="shop-product-editor__checks">
                                    <For each={allCategories() || []}>
                                        {(c,) => (
                                            <label class="shop-product-editor__check">
                                                <input
                                                    type="checkbox"
                                                    checked={categoryIds().includes(c.id,)}
                                                    onChange={() => toggleId(categoryIds, setCategoryIds, c.id,)}
                                                />
                                                {c.name}
                                            </label>
                                        )}
                                    </For>
                                    <Show when={!(allCategories() || []).length}>
                                        <span class="form-help-muted">No categories yet.</span>
                                    </Show>
                                </div>
                            </FormField>
                            <FormField label="Collections">
                                <div class="shop-product-editor__checks">
                                    <For each={allCollections() || []}>
                                        {(c,) => (
                                            <label class="shop-product-editor__check">
                                                <input
                                                    type="checkbox"
                                                    checked={collectionIds().includes(c.id,)}
                                                    onChange={() => toggleId(collectionIds, setCollectionIds, c.id,)}
                                                />
                                                {c.title}
                                            </label>
                                        )}
                                    </For>
                                    <Show when={!(allCollections() || []).length}>
                                        <span class="form-help-muted">No collections yet.</span>
                                    </Show>
                                </div>
                            </FormField>
                        </div>
                    </div>

                    {/* Section 3 — Options + Variants, each a full-width row */}
                    <FormSection title="Options" padded>
                        <p class="form-help-muted">
                            Add up to 3 options (e.g. Size, Color). Values are comma-separated.
                            Editing options regenerates the variant grid below.
                        </p>
                        <For each={options}>
                            {(opt, i,) => (
                                <div class="shop-product-editor__option-row">
                                    <input
                                        type="text"
                                        placeholder="Option name"
                                        value={opt.name}
                                        onInput={(e,) => setOptionName(i(), e.currentTarget.value,)}
                                        onBlur={regenerateVariants}
                                    />
                                    <input
                                        type="text"
                                        placeholder="Values (comma separated)"
                                        value={opt.valuesText}
                                        onInput={(e,) => setOptionValues(i(), e.currentTarget.value,)}
                                        onBlur={regenerateVariants}
                                    />
                                    <button class="ui-button ui-button--sm ui-button--ghost" onClick={() => removeOption(i(),)}>
                                        Remove
                                    </button>
                                </div>
                            )}
                        </For>
                        <Show when={options.length < 3}>
                            <button class="ui-button ui-button--sm ui-button--secondary" onClick={addOption}>+ Add option</button>
                        </Show>
                    </FormSection>

                    {/* Variants */}
                    <FormSection title="Variants" padded>
                        <Show when={showVariantShipping() && variants.length > 1}>
                            <button
                                class="ui-button ui-button--sm ui-button--secondary"
                                style={{ 'margin-bottom': '0.5rem', }}
                                onClick={applyShippingToAll}
                            >
                                Use first variant’s shipping cost for all
                            </button>
                        </Show>
                        <div class="admin-table-container">
                            <table class="admin-table shop-product-editor__variants">
                                <thead>
                                    <tr>
                                        <Show
                                            when={hasOptions()}
                                            fallback={<th>Default</th>}
                                        >
                                            <For each={optionLabels()}>{(l,) => <th>{l}</th>}</For>
                                        </Show>
                                        <th>SKU</th>
                                        <th>Price</th>
                                        <th>Compare at</th>
                                        <th>Inventory</th>
                                        <th>Weight (g)</th>
                                        <th>Ships</th>
                                        <Show when={showVariantShipping()}><th>Shipping ($)</th></Show>
                                        <th>Image</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <For each={variants}>
                                        {(v, i,) => (
                                            <tr>
                                                <Show
                                                    when={hasOptions()}
                                                    fallback={<td>Default</td>}
                                                >
                                                    <For each={optionLabels()}>
                                                        {(_l, li,) => (
                                                            <td>
                                                                {li() === 0 ? v.option1 : li() === 1 ? v.option2 : v.option3}
                                                            </td>
                                                        )}
                                                    </For>
                                                </Show>
                                                <td>
                                                    <input
                                                        type="text"
                                                        value={v.sku}
                                                        onInput={(e,) => setVariants(i(), 'sku', e.currentTarget.value,)}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="text"
                                                        inputmode="decimal"
                                                        value={v.price}
                                                        onInput={(e,) => setVariants(i(), 'price', e.currentTarget.value,)}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="text"
                                                        inputmode="decimal"
                                                        value={v.compareAt}
                                                        onInput={(e,) => setVariants(i(), 'compareAt', e.currentTarget.value,)}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        value={v.inventory}
                                                        onInput={(e,) => setVariants(i(), 'inventory', e.currentTarget.value,)}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        value={v.weight}
                                                        onInput={(e,) => setVariants(i(), 'weight', e.currentTarget.value,)}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        checked={v.requiresShipping}
                                                        onChange={(e,) => setVariants(i(), 'requiresShipping', e.currentTarget.checked,)}
                                                    />
                                                </td>
                                                <Show when={showVariantShipping()}>
                                                    <td>
                                                        <input
                                                            type="text"
                                                            inputmode="decimal"
                                                            placeholder="0.00"
                                                            value={v.shipping}
                                                            disabled={!v.requiresShipping}
                                                            onInput={(e,) => setVariants(i(), 'shipping', e.currentTarget.value,)}
                                                        />
                                                    </td>
                                                </Show>
                                                <td>
                                                    <button
                                                        class="ui-button ui-button--sm ui-button--ghost"
                                                        onClick={() => { setMediaTargetVariant(i(),); setShowMedia(true,); }}
                                                    >
                                                        {v.imageId ? 'Change' : 'Set'}
                                                    </button>
                                                </td>
                                            </tr>
                                        )}
                                    </For>
                                </tbody>
                            </table>
                        </div>
                    </FormSection>

                </div>

            </Show>

            <Show when={showMedia()}>
                <MediaSelectModal
                    onSelect={handleMediaSelect}
                    onClose={() => { setShowMedia(false,); setMediaTargetVariant(null,); }}
                />
            </Show>
        </div>
    );
};

const ShopProductEditor: Component = () => (
    <ShopGuard>
        <ShopProductEditorInner />
    </ShopGuard>
);

export default ShopProductEditor;
