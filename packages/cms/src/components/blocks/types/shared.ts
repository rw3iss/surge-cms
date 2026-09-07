/**
 * Pieces every public block renderer needs.
 *
 * Extracted when `BlockRenderer.tsx` was split per block type. It lives in its
 * own module rather than in `BlockRenderer.tsx` so a leaf renderer can import
 * what it needs WITHOUT importing the dispatcher — which would make an import
 * cycle out of what is really a one-way dependency.
 *
 * The recursive renderers (group, group_item, template, entity) do still import
 * the dispatcher, because they genuinely render arbitrary child blocks. That
 * cycle is fine: the binding is only read when a component renders, never while
 * the module evaluates.
 */
import type { RuntimeOptions, } from '../../../services/template/runtime';
import { colorCssValue, } from '../../../services/colorResolver';

/** Page-entity context threaded into a block's `{{ … }}` template resolution. */
export type TplCtx = RuntimeOptions['entities'];

/**
 * Render a stored colour value through the swatch resolver.
 *
 * Returns `undefined` when nothing should be emitted, so a caller can drop the
 * property entirely rather than writing an empty string into a style object.
 */
export function color(value: string | undefined,): string | undefined {
    return colorCssValue(value, '',) || undefined;
}
