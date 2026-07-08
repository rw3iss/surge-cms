/**
 * Shop service aggregate — re-exports the sub-services so `sdk/shop.ts`
 * (and `cms.shop`) has a single import surface. Catalog Phase 2 covers
 * products / variants / catalog; Phase 3 reviews; Phase 4 checkout /
 * orders. Settings (Phase 5) lands later.
 */
export * as products from './products';
export * as variants from './variants';
export * as catalog from './catalog';
export * as reviews from './reviews';
export * as checkout from './checkout';
export * as orders from './orders';
