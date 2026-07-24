/**
 * Printify integration (core engine). The `printify` plugin owns the
 * enable/config/credentials UI + CSP; this module does the work: sync products
 * into the native shop, report status, and (commerce layer) submit paid orders
 * to Printify for fulfillment.
 */
export { getPrintifyConfig, isPrintifyActive, type PrintifyConfig, } from './config';
export { syncProducts, getStatus, type PrintifySyncResult, type PrintifyStatus, } from './sync';
export { testConnection, } from './client';
