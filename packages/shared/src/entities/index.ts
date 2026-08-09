/**
 * Generic entity system — shared contracts.
 *
 * Barrel for the entity-type definitions, field types, content-block
 * templates, the `entity` block binding, and the shared EntityTypeRegistry.
 * Re-exported from `@sitesurge/types` so backend, cms, SDK, and MCP share one
 * definition per shape.
 */
export * from './fieldTypes';
export * from './types';
export * from './templates';
export * from './entityBlock';
export * from './registry';
