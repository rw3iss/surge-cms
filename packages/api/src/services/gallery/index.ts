/**
 * Gallery feature (`gallery`): media published for visitors. See
 * `@sitesurge/types` types/gallery.ts for the model and docs/how-it-works/GALLERY.md.
 */
export * from './access';
export * from './collections';
export * from './items';
export * from './settings';
// Side effects: comment target + read-only `gallery_item` entity type.
import './targets';
import './entity';
