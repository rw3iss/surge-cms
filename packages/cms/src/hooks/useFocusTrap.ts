/**
 * Keyboard containment for a dialog: Tab / Shift+Tab wrap inside the dialog,
 * and closing it returns focus to whatever was focused when it opened.
 *
 * `aria-modal` alone does not stop Tab leaving the dialog, so without this a
 * keyboard user walks into the page behind it, and on close lands on <body>.
 *
 * Used by `ModalShell` (every admin modal) and the gallery lightbox
 * (`trapTab` directly — it owns its own keydown handler).
 *
 * Nested dialogs: traps form a STACK and only the top one handles Tab, so a
 * media viewer opened over the media picker keeps focus in the viewer rather
 * than the picker pulling it back. Focus is never moved on open — a modal with
 * an autofocused field keeps it; the first Tab from outside lands inside.
 */
import { createEffect, on, onCleanup, } from 'solid-js';

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

interface TrapEntry { root: () => HTMLElement | undefined; }
const stack: TrapEntry[] = [];

function onDocKeyDown(e: KeyboardEvent,): void {
    const top = stack[stack.length - 1];
    const root = top?.root();
    if (root) trapTab(root, e,);
}

/** Exposed for tests: how many traps are active. */
export function activeTrapCount(): number {
    return stack.length;
}

function push(entry: TrapEntry,): void {
    if (!stack.length) document.addEventListener('keydown', onDocKeyDown,);
    stack.push(entry,);
}

function remove(entry: TrapEntry,): void {
    const i = stack.indexOf(entry,);
    if (i >= 0) stack.splice(i, 1,);
    if (!stack.length) document.removeEventListener('keydown', onDocKeyDown,);
}

/** Return focus to `el` when it is still on the page and focus has not moved somewhere meaningful. */
function restore(el: HTMLElement | null, root: HTMLElement | undefined,): void {
    if (!el || !el.isConnected || typeof el.focus !== 'function') return;
    const active = document.activeElement;
    const lost = !active || active === document.body || (root ? root.contains(active,) || !active.isConnected : false);
    if (lost) el.focus();
}

/**
 * Trap Tab inside `root()` while `active()` is true; on deactivation (or
 * unmount) return focus to the element focused at activation.
 */
export function useFocusTrap(root: () => HTMLElement | undefined, active: () => boolean = () => true,): void {
    let entry: TrapEntry | null = null;
    let opener: HTMLElement | null = null;
    let lastRoot: HTMLElement | undefined;
    const trackedRoot = () => (lastRoot = root() ?? lastRoot);

    const stop = () => {
        if (!entry) return;
        remove(entry,);
        entry = null;
        const r = lastRoot;
        const o = opener;
        opener = null;
        // After the dialog's DOM is gone (Solid removes it in the same tick).
        queueMicrotask(() => restore(o, r,),);
    };

    createEffect(on(active, (on,) => {
        if (on && !entry) {
            opener = document.activeElement as HTMLElement | null;
            entry = { root: trackedRoot, };
            push(entry,);
        } else if (!on) stop();
    },),);
    onCleanup(stop,);
}
