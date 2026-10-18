/**
 * Keyboard containment for a full-screen dialog (the gallery lightbox):
 * Tab / Shift+Tab wrap inside `root`, and closing returns focus to whatever
 * was focused when it opened (the tile the visitor came from).
 *
 * `aria-modal` alone does not stop Tab leaving the dialog, so without this a
 * keyboard user walks into the page behind it, and on close lands on <body>.
 * Candidate for `hooks/` once ModalShell wants the same behaviour.
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), video[controls]';

export function focusableIn(root: HTMLElement,): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE,),].filter((el,) => el.offsetParent !== null || el === document.activeElement);
}

/** Handle a keydown: wraps Tab inside `root`. Returns true when it acted. */
export function trapTab(root: HTMLElement, e: KeyboardEvent,): boolean {
    if (e.key !== 'Tab') return false;
    const els = focusableIn(root,);
    if (!els.length) { e.preventDefault(); return true; }
    const first = els[0];
    const last = els[els.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = !!active && root.contains(active,);
    if (e.shiftKey && (!inside || active === first)) { e.preventDefault(); last.focus(); return true; }
    if (!e.shiftKey && (!inside || active === last)) { e.preventDefault(); first.focus(); return true; }
    return false;
}

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
