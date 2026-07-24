/**
 * Minimal Printify REST client (https://api.printify.com/v1). Bearer-token auth.
 * Used by the sync engine and (later) order fulfillment.
 */
import { logger, } from '../../utils/logger';
import type { PrintifyConfig, } from './config';

export interface PrintifyVariant {
    id: number;
    sku: string;
    price: number; // retail, cents
    cost?: number; // our wholesale cost, cents
    title: string; // e.g. "Dark Heather / S"
    grams?: number;
    is_enabled: boolean;
    is_available: boolean;
    options: number[]; // option-value ids, positional to product.options
    quantity?: number;
}

export interface PrintifyOptionValue {
    id: number;
    title: string;
    colors?: string[];
}
export interface PrintifyOption {
    name: string; // "Colors" | "Sizes" | ...
    type: string; // "color" | "size" | ...
    values: PrintifyOptionValue[];
}

export interface PrintifyImage {
    src: string;
    variant_ids: number[];
    position: string; // "front" | "back" | ...
    is_default: boolean;
    is_selected_for_publishing?: boolean;
}

export interface PrintifyProduct {
    id: string;
    title: string;
    description: string;
    tags: string[];
    visible: boolean;
    is_deleted: boolean;
    is_locked?: boolean;
    blueprint_id: number;
    print_provider_id: number;
    options: PrintifyOption[];
    variants: PrintifyVariant[];
    images: PrintifyImage[];
}

async function req<T = any>(
    cfg: PrintifyConfig,
    method: string,
    path: string,
    body?: unknown,
): Promise<T> {
    const url = `${cfg.apiBaseUrl}${path}`;
    let res: Response;
    try {
        res = await fetch(url, {
            method,
            headers: {
                Authorization: `Bearer ${cfg.apiToken}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'User-Agent': 'SiteSurge-CMS',
            },
            body: body !== undefined ? JSON.stringify(body,) : undefined,
        },);
    } catch (err) {
        throw new Error(`Printify request failed (network): ${(err as Error).message}`,);
    }
    const text = await res.text();
    let data: any = null;
    try {
        data = text ? JSON.parse(text,) : null;
    } catch {
        data = text;
    }
    if (!res.ok) {
        const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
        logger.warn(`Printify ${method} ${path} → ${res.status}: ${msg}`,);
        throw new Error(`Printify API error (${res.status}): ${msg}`,);
    }
    return data as T;
}

/** List every product in the shop (paginates the products endpoint). */
export async function listAllProducts(cfg: PrintifyConfig,): Promise<PrintifyProduct[]> {
    const out: PrintifyProduct[] = [];
    let page = 1;
    for (;;) {
        const d = await req<{ data: PrintifyProduct[]; current_page: number; last_page: number; }>(
            cfg,
            'GET',
            `/shops/${cfg.shopId}/products.json?limit=50&page=${page}`,
        );
        const rows = d.data ?? [];
        out.push(...rows,);
        const last = d.last_page ?? page;
        if (rows.length === 0 || page >= last || page > 200) break;
        page++;
    }
    return out;
}

/** Verify the token + shop id; returns the resolved shop title. */
export async function testConnection(cfg: PrintifyConfig,): Promise<{ ok: true; shopTitle: string; }> {
    const shops = await req<Array<{ id: number; title: string; }>>(cfg, 'GET', '/shops.json',);
    const shop = (shops ?? []).find((s,) => String(s.id,) === String(cfg.shopId,));
    return { ok: true, shopTitle: shop ? shop.title : `(shop ${cfg.shopId} not found in account)`, };
}

// ─── Orders / shipping (commerce) ─────────────────────────────────────

export interface PrintifyLineItem {
    product_id: string;
    variant_id: number;
    quantity: number;
}

/** Calculate shipping for a set of line items to an address. Returns cents per
 *  method: { standard, express?, priority?, printify_express? }. */
export async function calcShipping(
    cfg: PrintifyConfig,
    lineItems: PrintifyLineItem[],
    addressTo: Record<string, unknown>,
): Promise<{ standard?: number; express?: number; priority?: number; printify_express?: number; }> {
    return req(cfg, 'POST', `/shops/${cfg.shopId}/orders/shipping.json`, { line_items: lineItems, address_to: addressTo, },);
}

/** Create a fulfillment order. Returns the created Printify order (with id). */
export async function createOrder(cfg: PrintifyConfig, order: unknown,): Promise<any> {
    return req(cfg, 'POST', `/shops/${cfg.shopId}/orders.json`, order,);
}

/** Send a created order to production (actually fulfill it). */
export async function sendToProduction(cfg: PrintifyConfig, printifyOrderId: string,): Promise<any> {
    return req(cfg, 'POST', `/shops/${cfg.shopId}/orders/${printifyOrderId}/send_to_production.json`,);
}

/** Fetch a Printify order (status + shipments for tracking sync). */
export async function getOrder(cfg: PrintifyConfig, printifyOrderId: string,): Promise<any> {
    return req(cfg, 'GET', `/shops/${cfg.shopId}/orders/${printifyOrderId}.json`,);
}
