/**
 * Printify integration (core engine). The `printify` plugin owns the
 * enable/config/credentials UI + CSP; this module does the work: sync products
 * into the native shop, report status, and (commerce layer) submit paid orders
 * to Printify for fulfillment.
 */
export { getPrintifyConfig, isPrintifyActive, type PrintifyConfig, } from './config';
export {
    getStatus,
    type PrintifyOneSyncResult,
    type PrintifyStatus,
    type PrintifySyncResult,
    syncOneProduct,
    syncProducts,
} from './sync';
export { testConnection, } from './client';
export {
    getPrintifyShippingOptions,
    PRINTIFY_SHIPPING_METHODS,
    type PrintifyShippingMethod,
    type PrintifyShippingQuote,
    pollOrderStatuses,
    submitOrderToPrintify,
} from './fulfillment';
