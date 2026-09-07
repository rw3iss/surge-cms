// Moved to `@sitesurge/types` so SSR can emit the SAME block CSS the client
// does — server-rendered pages were previously unstyled until the SPA mounted.
// Re-exported here so existing `../../utils/blockResponsiveCss` imports work.
export {
    blockCss,
    blockResponsiveCss,
    type BlockResponsiveOptions,
    carouselPropTargets,
    type CascadeLayer,
    type PropTargets,
} from '@sitesurge/types';
