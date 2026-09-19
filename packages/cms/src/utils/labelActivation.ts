/**
 * "Did this label click mean the control, or something inside the label?"
 *
 * Shared by `ui/Toggle` and `admin/forms/FormField`, which both make a label
 * activate a control that a native `<label>` cannot target — a `role="switch"`
 * button is not a labelable element, and `FormField`'s label is a SIBLING of
 * its control rather than its parent.
 *
 * Extracted from both so the one genuinely subtle rule — which descendants own
 * their own click — lives in a single, testable place instead of being
 * duplicated in two components where the copies could drift apart.
 */

/**
 * Descendants of a label that handle their own clicks.
 *
 * Keyed on FOCUSABILITY rather than tag name. The help tooltip rendered inside
 * `FormCheck` and `FormField` labels is a `<span tabindex="0">`, so a
 * `button, a, input` list would miss it — and flipping someone's setting
 * because they reached for the help icon is worse than the label not working.
 */
export const INTERACTIVE_IN_LABEL =
    'a[href], button, input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';

/** The bit of `Element` this needs — so tests need no DOM implementation. */
export interface LabelNode {
    matches?: (selector: string,) => boolean;
    parentElement: LabelNode | null;
}

/**
 * True when a click on `target` should activate the label's control.
 *
 * The walk stops at `boundary` (the label itself) instead of using
 * `closest()` on the whole document: an interactive ANCESTOR of the label — a
 * clickable card, a row with a handler — must not suppress it, only something
 * INSIDE it.
 */
export function labelClickActivates(
    target: LabelNode | null,
    boundary: LabelNode,
    selector: string = INTERACTIVE_IN_LABEL,
): boolean {
    let el = target;
    while (el && el !== boundary) {
        if (el.matches?.(selector,)) return false;
        el = el.parentElement;
    }
    return true;
}
