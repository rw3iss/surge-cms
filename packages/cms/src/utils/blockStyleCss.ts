// Moved to `@sitesurge/types` so the SSR head builder (backend) and the
// public/admin renderers share ONE style→CSS mapping. Re-exported here so
// existing `../../utils/blockStyleCss` imports keep working.
export {
    blockStyleLayoutCss,
    type BlockStyleCssOptions,
    type BlockStyleCssResolvers,
    normalizeCssWidth,
} from '@sitesurge/types';
