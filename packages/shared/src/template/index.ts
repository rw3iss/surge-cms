/**
 * Content `{{ … }}` template engine — the pure, framework-free core, shared by
 * the client renderer (`@sitesurge/admin`) and the server-side SSR resolver
 * (`@sitesurge/server`). Each side supplies its own `TemplateRuntime` (entity
 * resolvers); the parsing + evaluation logic here is identical.
 *
 * `renderTemplate(src, runtime)` → ordered `OutputNode[]` (HTML strings +
 * whole-entity segments). Parsing is cached per-source. A parse error degrades
 * gracefully: the original source is returned verbatim + a warning.
 */
import { evaluate } from './evaluator';
import { parse } from './parser';
import { hasTemplateSyntax } from './tokenizer';
import type { Node, OutputNode, TemplateRuntime } from './types';
import { TemplateParseError } from './types';

// Public API surface (internal AST types `Node`/`Expr` are intentionally NOT
// re-exported, to keep the @sitesurge/types barrel free of generic names).
export type { OutputNode, TemplateRuntime, EntityRef } from './types';
export { entityRef, isEntityRef, isMediaValue, MEDIA_FIELDS, mediaValue, TemplateParseError } from './types';
export type { MediaValue } from './types';
export { hasTemplateSyntax } from './tokenizer';
/** Parse a template into its AST (rarely needed directly; `renderTemplate`
 *  parses + evaluates). Exported for tooling/tests. */
export { parse as parseTemplate } from './parser';
/** Shared value/utility functions (upper, formatDate, default, …) that every
 *  runtime delegates to. */
export { resolveValueFunction, UNRESOLVED, VALUE_FUNCTION_NAMES } from './valueFunctions';

const astCache = new Map<string, Node[]>();

function getAst(src: string): Node[] {
    let ast = astCache.get(src);
    if (!ast) {
        ast = parse(src);
        if (astCache.size > 500) astCache.clear();
        astCache.set(src, ast);
    }
    return ast;
}

/**
 * Render a template source to a plain string using `runtime`. Whole-entity
 * segments are serialized by `onEntity` (defaults to dropping them, i.e. plain
 * variable/function output). Fast-paths sources with no `{{ }}`. Parse errors
 * degrade to the source (via `renderTemplate`); resolver errors are NOT caught
 * here — wrap the call if you need "never throw".
 */
export async function renderTemplateToString(
    src: string | null | undefined,
    runtime: TemplateRuntime,
    onEntity: (kind: string, data: Record<string, unknown> | null, options?: Record<string, unknown>) => string = () => '',
): Promise<string> {
    if (!src || !hasTemplateSyntax(src)) return src ?? '';
    const nodes = await renderTemplate(src, runtime);
    return nodes.map((n) => (n.type === 'html' ? n.html : onEntity(n.kind, n.data, n.options))).join('');
}

export async function renderTemplate(src: string, runtime: TemplateRuntime): Promise<OutputNode[]> {
    if (!hasTemplateSyntax(src)) return [{ type: 'html', html: src }];
    let ast: Node[];
    try {
        ast = getAst(src);
    } catch (e) {
        if (e instanceof TemplateParseError) {
            runtime.warn?.(`template: parse error — ${e.message} (block left un-templated)`);
            return [{ type: 'html', html: src }];
        }
        throw e;
    }
    return evaluate(ast, runtime);
}
