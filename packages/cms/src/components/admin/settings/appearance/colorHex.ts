/** Hex colour helpers for the Appearance editors (#rgb / #rrggbb / #rrggbbaa). */

export function isValidHex(hex: string,): boolean {
    // #rgb, #rrggbb, or #rrggbbaa (8-digit carries the alpha channel).
    return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(hex,);
}

/** Normalize any accepted hex to a 6-digit `#rrggbb` base (drops alpha,
 *  expands shorthand) — used to feed the color wheel and recompose. */
export function hexBase6(hex: string,): string {
    const m = hex.replace('#', '',);
    if (m.length === 3) return '#' + m.split('',).map((c,) => c + c).join('',);
    return '#' + m.substring(0, 6,).padEnd(6, '0',);
}

/** Extract the alpha channel from a hex as a 0–100 percentage. 6-digit (no
 *  alpha) → 100%. */
export function hexAlphaPct(hex: string,): number {
    const m = hex.replace('#', '',);
    if (m.length === 8) return Math.round((parseInt(m.substring(6, 8,), 16,) / 255) * 100,);
    return 100;
}

/** Recompose a base color + opacity into a stored hex. 100% stays a simple
 *  6-digit `#rrggbb`; below 100% appends the alpha pair (`#rrggbbaa`). */
export function composeHex(base6: string, alphaPct: number,): string {
    if (alphaPct >= 100) return base6;
    const a = Math.round((Math.max(0, Math.min(100, alphaPct,)) / 100) * 255,);
    return base6 + a.toString(16,).padStart(2, '0',);
}
