/**
 * Color value resolver.
 *
 * Color fields throughout the app store one of three things in a
 * single string column:
 *
 *   1. A raw hex literal — `"#3498cf"`, `"#fff"`, `"#abc123"`.
 *   2. A swatch reference — `"swatch:abc123"` — pointing at an entry
 *      in the user's site swatch palette (`services/siteColors`).
 *   3. Empty / `"none"` / `"transparent"` — represents "no color".
 *
 * Consumers use the helpers here to turn whatever's stored back into a
 * usable CSS value:
 *
 *   - `colorCssValue(value, fallback)` is the recommended call. For
 *     swatch refs it returns `var(--swatch-{id}, fallback)` so the
 *     browser resolves the color natively from the CSS custom
 *     property emitted by the layout root. Editing a swatch updates
 *     the CSS var in place and every consumer repaints with no
 *     component-level subscription work.
 *
 *   - `resolveColor(value, fallback)` returns a concrete hex string,
 *     useful when you need the value programmatically (e.g. mixing
 *     colors in JS, computing contrast).
 *
 *   - `swatchCssVars(swatches)` builds the `--swatch-{id}: #hex` map
 *     consumed by AdminLayout / public Layout to wire the live CSS
 *     vars onto the tree.
 *
 * All helpers fall back gracefully: a `swatch:{id}` whose target was
 * deleted resolves to the caller-supplied fallback, never `undefined`,
 * so the UI keeps rendering even with stale references in old data.
 */
import type { SiteSwatch, } from '@rw/cms-shared';
import { findSwatch, swatches, } from './siteColors';

const SWATCH_PREFIX = 'swatch:';

/** True when a value is empty, "none", or "transparent". Centralized
 *  so callers don't repeat this check. */
export function isEmptyColor(value: string | null | undefined,): boolean {
    return !value || value === '' || value === 'none' || value === 'transparent';
}

/** True when a value is a swatch reference. Cheap prefix check — does
 *  not validate the ID structure. */
export function isSwatchRef(value: string | null | undefined,): boolean {
    return typeof value === 'string' && value.startsWith(SWATCH_PREFIX,);
}

/** Extract the swatch id from a `swatch:{id}` value. Returns `null`
 *  when the input isn't a reference. */
export function swatchRefId(value: string | null | undefined,): string | null {
    if (!isSwatchRef(value,)) return null;
    return (value as string).slice(SWATCH_PREFIX.length,);
}

/** Build a swatch reference string for a given ID. */
export function buildSwatchRef(id: string,): string {
    return `${SWATCH_PREFIX}${id}`;
}

/**
 * Resolve a stored color value to a concrete hex string.
 *
 * Returns `fallback` when:
 *   - the value is empty / "none" / "transparent"
 *   - the value is a swatch ref AND the swatch doesn't exist
 *
 * For raw hex strings the value is returned unchanged.
 */
export function resolveColor(value: string | null | undefined, fallback: string,): string {
    if (isEmptyColor(value,)) return fallback;
    const refId = swatchRefId(value,);
    if (refId !== null) {
        const swatch = findSwatch(refId,);
        return swatch?.hex ?? fallback;
    }
    return value as string;
}

/**
 * Render a stored color value as a CSS-ready string.
 *
 * For swatch refs, emits `var(--swatch-{id}, fallback)` — this is the
 * preferred path for inline styles because the browser resolves the
 * CSS variable natively. When a swatch is edited, only the
 * `:root { --swatch-{id}: ... }` declaration changes and every
 * consumer repaints automatically.
 *
 * For raw hex / empty values, returns the resolved hex (or fallback).
 */
export function colorCssValue(value: string | null | undefined, fallback: string,): string {
    if (isEmptyColor(value,)) return fallback;
    const refId = swatchRefId(value,);
    if (refId !== null) {
        // Browser-side resolution. The fallback in the var() expression
        // covers the "swatch was deleted" case — if `--swatch-{id}` is
        // unset the browser falls back to the second arg.
        return `var(--swatch-${refId}, ${fallback})`;
    }
    return value as string;
}

/**
 * Translate a swatch list into the inline-style record consumed by
 * AdminLayout / public Layout's root element. Each swatch gets a
 * single `--swatch-{id}` custom property; consumers reference these
 * via `colorCssValue()`.
 */
export function swatchCssVars(list: ReadonlyArray<SiteSwatch>,): Record<string, string> {
    const out: Record<string, string> = {};
    for (const s of list) {
        if (s && typeof s.id === 'string' && typeof s.hex === 'string') {
            out[`--swatch-${s.id}`] = s.hex;
        }
    }
    return out;
}

/** Reactive convenience: returns the CSS-vars map for the currently
 *  loaded swatches. Use inside `createMemo` to track changes. */
export function currentSwatchCssVars(): Record<string, string> {
    return swatchCssVars(swatches(),);
}

/** Reactive resolver — same contract as `resolveColor()` but reads
 *  the swatches signal so it tracks updates. Use inside `createMemo`. */
export function resolveColorReactive(value: string | null | undefined, fallback: string,): string {
    if (isEmptyColor(value,)) return fallback;
    const refId = swatchRefId(value,);
    if (refId !== null) {
        const swatch = swatches().find(s => s.id === refId);
        return swatch?.hex ?? fallback;
    }
    return value as string;
}
