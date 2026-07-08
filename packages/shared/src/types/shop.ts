/**
 * Shared entity types for the Shop feature module. Used by frontend,
 * backend, and the headless client. camelCase fields; wire timestamps are
 * ISO strings. Mirrors the `shop_*` schema (migrations 039–049).
 */

export type ShopProductType = 'physical' | 'digital';
export type ShopProductStatus = 'draft' | 'active' | 'archived';

export interface ShopProduct {
    id: string;
    title: string;
    slug: string;
    description?: string | null;
    type: ShopProductType;
    status: ShopProductStatus;
    metaTitle?: string | null;
    metaDescription?: string | null;
    ratingAvg: number;
    ratingCount: number;
    createdBy?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ShopProductOption {
    id: string;
    productId: string;
    name: string;
    position: number;
    createdAt: string;
}

export interface ShopOptionValue {
    id: string;
    optionId: string;
    value: string;
    position: number;
}

export interface ShopVariant {
    id: string;
    productId: string;
    sku?: string | null;
    priceCents: number;
    compareAtPriceCents?: number | null;
    inventoryQty: number;
    weightGrams?: number | null;
    requiresShipping: boolean;
    option1?: string | null;
    option2?: string | null;
    option3?: string | null;
    imageId?: string | null;
    position: number;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
}

export type ShopProductMediaKind = 'image' | 'video';

export interface ShopProductMedia {
    id: string;
    productId: string;
    mediaId: string;
    variantId?: string | null;
    position: number;
    kind: ShopProductMediaKind;
    createdAt: string;
}

export interface ShopCategory {
    id: string;
    name: string;
    slug: string;
    parentId?: string | null;
    description?: string | null;
    imageId?: string | null;
    position: number;
    createdAt: string;
    updatedAt: string;
}

export interface ShopCollection {
    id: string;
    title: string;
    slug: string;
    description?: string | null;
    imageId?: string | null;
    position: number;
    isPublished: boolean;
    createdAt: string;
    updatedAt: string;
}

export type ShopReviewStatus = 'pending' | 'approved' | 'rejected';

export interface ShopReview {
    id: string;
    productId: string;
    userId?: string | null;
    orderId?: string | null;
    rating: number;
    title?: string | null;
    body?: string | null;
    status: ShopReviewStatus;
    verifiedPurchase: boolean;
    helpfulCount: number;
    createdAt: string;
    updatedAt: string;
}

export type ShopOrderStatus =
    | 'pending'
    | 'paid'
    | 'processing'
    | 'shipped'
    | 'delivered'
    | 'cancelled'
    | 'refunded';

export type ShopFulfillmentStatus = 'unfulfilled' | 'partial' | 'fulfilled';

export interface ShopAddress {
    name?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    phone?: string;
}

export interface ShopOrder {
    id: string;
    orderNumber: string;
    userId?: string | null;
    customerEmail: string;
    customerName?: string | null;
    status: ShopOrderStatus;
    subtotalCents: number;
    taxCents: number;
    shippingCents: number;
    discountCents: number;
    totalCents: number;
    currency: string;
    stripePaymentIntentId?: string | null;
    stripeChargeId?: string | null;
    shippingAddress?: ShopAddress | null;
    billingAddress?: ShopAddress | null;
    fulfillmentStatus: ShopFulfillmentStatus;
    trackingNumber?: string | null;
    notes?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ShopOrderItem {
    id: string;
    orderId: string;
    productId?: string | null;
    variantId?: string | null;
    title: string;
    variantTitle?: string | null;
    sku?: string | null;
    unitPriceCents: number;
    quantity: number;
    subtotalCents: number;
    isDigital: boolean;
    downloadToken?: string | null;
    createdAt: string;
}

// ── Config (site_settings rows: shop_settings / shop_appearance) ──────

export interface ShopShippingRate {
    name: string;
    priceCents: number;
}

export interface ShopSettings {
    currency: string;
    taxEnabled: boolean;
    businessName: string;
    businessAddress?: string;
    storeEnabled: boolean;
    stripeTaxEnabled?: boolean;
    shipping?: {
        flatCents?: number;
        freeThresholdCents?: number;
        rates?: ShopShippingRate[];
    };
}

export interface ShopAppearance {
    gridColumns: number;
    showRatings: boolean;
    cardStyle: string;
    currencyDisplay?: string;
}
