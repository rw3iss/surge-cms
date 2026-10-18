/**
 * Lightbox keyboard helpers. The Tab containment itself is the shared
 * `hooks/useFocusTrap` (`trapTab`, re-exported here for the lightbox).
 */
export { focusableIn, trapTab, } from '../../hooks/useFocusTrap';

/**
 * Arrow keys belong to the control that has focus when it is a player /
 * slider / text field (seeking, volume, caret) — not to the lightbox's
 * previous / next.
 */
export function arrowsBelongToTarget(target: EventTarget | null,): boolean {
    const el = target as HTMLElement | null;
    if (!el || typeof el.closest !== 'function') return false;
    if (el.closest('input, textarea, select, [contenteditable="true"], [role="slider"]',)) return true;
    return Boolean(el.closest('[class*="vp-"], video',),);
}
