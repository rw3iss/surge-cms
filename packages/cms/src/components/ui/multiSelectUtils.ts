/**
 * Pure selection/filtering/navigation helpers for `MultiSelect`. No DOM, no
 * Solid — unit-tested directly so the "selection order follows the options
 * order, not click order" rule can't silently regress.
 */

export interface MultiSelectOption {
    value: string;
    label: string;
    hint?: string;
    disabled?: boolean;
}

/**
 * Reorder a selection list to match `options` order. A value no longer
 * present in `options` (stale data) trails the known ones, in its existing
 * relative order, rather than being dropped silently.
 */
export function orderBySelectionOptions(selected: string[], options: MultiSelectOption[],): string[] {
    const rank = new Map(options.map((o, i,) => [o.value, i,],),);
    const known = selected.filter((v,) => rank.has(v,),).toSorted((a, b,) => rank.get(a,)! - rank.get(b,)!,);
    const unknown = selected.filter((v,) => !rank.has(v,),);
    return [...known, ...unknown,];
}

/**
 * Toggle `target` in `selected`, returning a NEW array ordered to match
 * `options` — never the order things were clicked in.
 */
export function toggleSelection(
    selected: string[],
    options: MultiSelectOption[],
    target: string,
): string[] {
    const next = selected.includes(target,)
        ? selected.filter((v,) => v !== target,)
        : [...selected, target,];
    return orderBySelectionOptions(next, options,);
}

/** Every enabled option's value, in order — "Select all" over the given list. */
export function allEnabledValues(options: MultiSelectOption[],): string[] {
    return options.filter((o,) => !o.disabled,).map((o,) => o.value,);
}

/** Case-insensitive filter over label + hint. Empty query returns `options` unchanged. */
export function filterOptions(options: MultiSelectOption[], query: string,): MultiSelectOption[] {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o,) => o.label.toLowerCase().includes(q,) || (o.hint ?? '').toLowerCase().includes(q,),);
}

/**
 * Next highlighted index when navigating Up (`delta: -1`) / Down (`delta: 1`),
 * skipping disabled options and wrapping around. `current` may be out of
 * range (e.g. after the list was filtered) — the walk still lands on a valid
 * index. Returns -1 for an empty list, and `current` back if every option is
 * disabled.
 */
export function nextActiveIndex(options: MultiSelectOption[], current: number, delta: 1 | -1,): number {
    const n = options.length;
    if (n === 0) return -1;
    let i = current;
    for (let step = 0; step < n; step++) {
        i = (i + delta + n) % n;
        if (!options[i].disabled) return i;
    }
    return current >= 0 && current < n ? current : -1;
}
