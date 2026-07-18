/**
 * cms-side entry for the content `{{ … }}` template engine. The pure engine now
 * lives in `@sitesurge/types` (shared with the server-side SSR resolver); this
 * re-exports it so existing `../../services/template` imports keep working, and
 * the CMS-specific `runtime.ts` (SDK resolvers) lives alongside.
 */
export {
    entityRef,
    hasTemplateSyntax,
    isEntityRef,
    parseTemplate as parse,
    renderTemplate,
    TemplateParseError,
} from '@sitesurge/types';
export type { EntityRef, OutputNode, TemplateRuntime, } from '@sitesurge/types';
