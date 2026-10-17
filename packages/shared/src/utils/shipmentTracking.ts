/**
 * Order tracking display — ONE rule set shared by the admin, the storefront,
 * the PDF receipt and the buyer emails:
 *
 * - `carrierLabel(code)` turns a supplier's carrier code into a name a buyer
 *   recognises (`DHL_eCommerce_Expedited` → `DHL eCommerce Expedited`).
 * - `resolveTrackingUrl(...)` picks the link: a manual per-order URL → the
 *   supplier's URL (when the shop allows it) → the carrier template with
 *   `{number}` filled → none.
 * - `resolveOrderShipments(...)` builds the list of parcels to show.
 */
import type {
    ShopCarrierTrackingTemplate,
    ShopOrderShipment,
    ShopTrackingSettings,
} from '../types/shop';

/** Built-in carrier link templates, used until the operator edits the list. */
export const DEFAULT_CARRIER_TRACKING_TEMPLATES: readonly ShopCarrierTrackingTemplate[] = [
    { carrier: 'USPS', urlTemplate: 'https://tools.usps.com/go/TrackConfirmAction?tLabels={number}', },
    { carrier: 'UPS', urlTemplate: 'https://www.ups.com/track?tracknum={number}', },
    { carrier: 'FEDEX', urlTemplate: 'https://www.fedex.com/fedextrack/?trknbr={number}', },
    {
        carrier: 'DHL',
        urlTemplate: 'https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id={number}',
    },
    { carrier: 'DHL_ECOMMERCE', urlTemplate: 'https://webtrack.dhlecommerce.com/?trackingnumber={number}', },
    { carrier: 'ONTRAC', urlTemplate: 'https://www.ontrac.com/tracking/?number={number}', },
];

/** Carrier code → comparable key: upper case, letters and digits only. */
export function carrierKey(code: string | null | undefined,): string {
    return (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '',);
}

/** Known carrier names, by `carrierKey`. */
const CARRIER_NAMES: Record<string, string> = {
    USPS: 'USPS',
    UPS: 'UPS',
    UPSMI: 'UPS Mail Innovations',
    UPSSUREPOST: 'UPS SurePost',
    FEDEX: 'FedEx',
    FEDEXSMARTPOST: 'FedEx SmartPost',
    DHL: 'DHL',
    DHLEXPRESS: 'DHL Express',
    DHLECOMMERCE: 'DHL eCommerce',
    DHLECOMMERCEEXPEDITED: 'DHL eCommerce Expedited',
    ONTRAC: 'OnTrac',
    LASERSHIP: 'LaserShip',
    AMAZON: 'Amazon',
    CANADAPOST: 'Canada Post',
    ROYALMAIL: 'Royal Mail',
    AUSTRALIAPOST: 'Australia Post',
    PUROLATOR: 'Purolator',
    ASENDIA: 'Asendia',
    APC: 'APC',
    GLS: 'GLS',
    DPD: 'DPD',
    EVRI: 'Evri',
    YUNEXPRESS: 'YunExpress',
};

/** Word-level fixes when a code is not in `CARRIER_NAMES`. */
const WORD_NAMES: Record<string, string> = {
    USPS: 'USPS', UPS: 'UPS', DHL: 'DHL', FEDEX: 'FedEx', ONTRAC: 'OnTrac', ECOMMERCE: 'eCommerce',
    GLS: 'GLS', DPD: 'DPD', APC: 'APC',
};

/**
 * Friendly carrier name. Known codes map to their brand spelling; anything
 * else is split on `_` / `-` / spaces and title-cased word by word, so a new
 * supplier code still reads well (`CANADA_POST_EXPEDITED` → `Canada Post Expedited`).
 */
export function carrierLabel(code: string | null | undefined,): string | null {
    const raw = (code ?? '').trim();
    if (!raw) return null;
    const known = CARRIER_NAMES[carrierKey(raw,)];
    if (known) return known;
    return raw
        .split(/[\s_-]+/,)
        .filter(Boolean,)
        .map((w,) => {
            const fixed = WORD_NAMES[carrierKey(w,)];
            if (fixed) return fixed;
            return w.charAt(0,).toUpperCase() + w.slice(1,).toLowerCase();
        },)
        .join(' ',);
}

/** The carrier templates in effect (unset → the built-in defaults). */
export function carrierTemplates(settings?: ShopTrackingSettings | null,): readonly ShopCarrierTrackingTemplate[] {
    return settings?.carriers ?? DEFAULT_CARRIER_TRACKING_TEMPLATES;
}

/**
 * The template for a carrier: an exact key match, else the LONGEST template
 * whose key is a prefix of the carrier's (`DHL_eCommerce_Expedited` →
 * `DHL_ECOMMERCE` before `DHL`).
 */
export function findCarrierTemplate(
    carrier: string | null | undefined,
    templates: readonly ShopCarrierTrackingTemplate[],
): ShopCarrierTrackingTemplate | null {
    const key = carrierKey(carrier,);
    if (!key) return null;
    let best: ShopCarrierTrackingTemplate | null = null;
    let bestLen = 0;
    for (const t of templates) {
        const tk = carrierKey(t.carrier,);
        if (!tk || !t.urlTemplate?.trim()) continue;
        if (tk === key) return t;
        if (key.startsWith(tk,) && tk.length > bestLen) {
            best = t;
            bestLen = tk.length;
        }
    }
    return best;
}

/** Fill `{number}` in a template (URL-encoded). Null when there is no number. */
export function fillTrackingTemplate(template: string, number: string | null | undefined,): string | null {
    const n = (number ?? '').trim();
    if (!n || !template.trim()) return null;
    return template.trim().replace(/\{number\}/gi, encodeURIComponent(n,),);
}

/** Only http(s) links are ever shown — a stored value is rendered as an href. */
function safeUrl(url: string | null | undefined,): string | null {
    const u = (url ?? '').trim();
    return /^https?:\/\//i.test(u,) ? u : null;
}

export interface TrackingUrlInput {
    /** A URL an admin typed on the order. */
    manualUrl?: string | null;
    /** The supplier's own tracking link. */
    supplierUrl?: string | null;
    carrier?: string | null;
    number?: string | null;
}

/**
 * The tracking link to show: manual URL → supplier URL (when
 * `useSupplierLinks` is on, the default) → carrier template → null.
 */
export function resolveTrackingUrl(input: TrackingUrlInput, settings?: ShopTrackingSettings | null,): string | null {
    const manual = safeUrl(input.manualUrl,);
    if (manual) return manual;
    const useSupplier = settings?.useSupplierLinks !== false;
    const supplier = useSupplier ? safeUrl(input.supplierUrl,) : null;
    if (supplier) return supplier;
    const tpl = findCarrierTemplate(input.carrier, carrierTemplates(settings,),);
    return tpl ? safeUrl(fillTrackingTemplate(tpl.urlTemplate, input.number,),) : null;
}

/** A supplier parcel as stored on a fulfilment row. */
export interface SupplierParcel {
    provider?: string | null;
    carrier?: string | null;
    number?: string | null;
    url?: string | null;
    shippedAt?: string | null;
    deliveredAt?: string | null;
}

/** The order-level tracking columns. */
export interface OrderTrackingColumns {
    carrier?: string | null;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
    trackingManual?: boolean | null;
}

/**
 * Every parcel to show for an order.
 *
 * - A MANUAL order-level entry (an admin typed it) comes first; supplier parcels
 *   with a different number follow (one with the same number is the same parcel).
 * - Otherwise every supplier parcel, de-duplicated by number.
 * - With no supplier parcels, the order-level columns (older orders).
 */
export function resolveOrderShipments(
    order: OrderTrackingColumns,
    parcels: SupplierParcel[],
    settings?: ShopTrackingSettings | null,
): ShopOrderShipment[] {
    const out: ShopOrderShipment[] = [];
    const seen = new Set<string>();
    const orderNumber = order.trackingNumber?.trim() || null;
    const orderCarrier = order.carrier?.trim() || null;
    const hasOrderLevel = Boolean(orderNumber || safeUrl(order.trackingUrl,),);

    if (order.trackingManual && hasOrderLevel) {
        // The parcel the admin corrected, if a supplier parcel shares its number.
        const match = orderNumber ? parcels.find((p,) => p.number?.trim() === orderNumber) : undefined;
        const carrier = orderCarrier ?? match?.carrier ?? null;
        out.push({
            carrier,
            carrierLabel: carrierLabel(carrier,),
            number: orderNumber,
            url: resolveTrackingUrl(
                { manualUrl: order.trackingUrl, supplierUrl: match?.url, carrier, number: orderNumber, },
                settings,
            ),
            shippedAt: match?.shippedAt ?? null,
            deliveredAt: match?.deliveredAt ?? null,
            source: 'manual',
            provider: match?.provider ?? null,
        },);
        if (orderNumber) seen.add(orderNumber,);
    }

    for (const p of parcels) {
        const number = p.number?.trim() || null;
        if (!number && !safeUrl(p.url,)) continue;
        if (number) {
            if (seen.has(number,)) continue;
            seen.add(number,);
        }
        out.push({
            carrier: p.carrier ?? null,
            carrierLabel: carrierLabel(p.carrier,),
            number,
            url: resolveTrackingUrl({ supplierUrl: p.url, carrier: p.carrier, number, }, settings,),
            shippedAt: p.shippedAt ?? null,
            deliveredAt: p.deliveredAt ?? null,
            source: 'supplier',
            provider: p.provider ?? null,
        },);
    }

    if (!out.length && hasOrderLevel) {
        out.push({
            carrier: orderCarrier,
            carrierLabel: carrierLabel(orderCarrier,),
            number: orderNumber,
            url: resolveTrackingUrl({ supplierUrl: order.trackingUrl, carrier: orderCarrier, number: orderNumber, }, settings,),
            shippedAt: null,
            deliveredAt: null,
            source: 'order',
            provider: null,
        },);
    }
    return out;
}

/** "OnTrac · 1LSCYM0001FODHC" (either half may be missing). */
export function shipmentText(s: Pick<ShopOrderShipment, 'carrierLabel' | 'carrier' | 'number'>,): string {
    return [s.carrierLabel ?? s.carrier, s.number,].filter(Boolean,).join(' · ',) || 'Tracking';
}
