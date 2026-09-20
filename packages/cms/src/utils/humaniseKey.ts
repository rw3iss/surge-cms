/**
 * Turn a field KEY into something readable for a label.
 *
 * `publishedAt` → "Published at", `featured_image` → "Featured image".
 *
 * A FALLBACK only — a schema field that carries its own label keeps it. Core
 * entity types were seeded with `label === key`, so their fields otherwise
 * appear as bare identifiers beside properly-titled standard columns ("Date
 * created", "Status") in the same dropdown.
 *
 * Lives in `utils/` rather than beside its caller so it can be unit-tested: the
 * component it is used from imports the modal shell, which touches `window` at
 * module scope and cannot be imported in a plain node test environment.
 */
export function humaniseKey(key: string,): string {
    const words = key
        .replace(/[_-]+/g, ' ',)
        // Split camelCase, and acronym boundaries with it: `metaURLTitle` →
        // `meta URL Title`, not `meta U R L Title`.
        .replace(/([a-z\d])([A-Z])/g, '$1 $2',)
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2',)
        .trim();
    if (!words) return key;
    return words
        .split(' ',)
        .map((w, i,) => {
            // Keep an acronym as written — "Meta url title" is worse than the
            // raw key it came from.
            if (w.length > 1 && w === w.toUpperCase()) return w;
            return i === 0 ? w.charAt(0,).toUpperCase() + w.slice(1,).toLowerCase() : w.toLowerCase();
        },)
        .join(' ',);
}
