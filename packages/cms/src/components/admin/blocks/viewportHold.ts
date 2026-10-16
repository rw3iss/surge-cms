/**
 * Keep the editor's viewport still across a block change.
 *
 * `holdViewport(anchorId)` is called just BEFORE a change (a block update, a
 * style draft, a style Save). It:
 *
 *   1. PINS the document height — `<html>` min-height = the current height
 *      (or at least `scrollY + viewport`). If the change momentarily detaches
 *      part of the page (a type change re-mounting a block, a renderer
 *      suspending), the page would collapse and the browser would clamp
 *      scrollY toward 0 — the "jump to top". The pin stops the clamp.
 *   2. RE-ANCHORS each frame until layout settles: the anchor block (the one
 *      being edited) is scrolled back to the viewport position it had before,
 *      which also covers content above it changing height and late async
 *      previews. Without an anchor, the absolute scrollY is restored.
 *
 * It runs for at least MIN_SETTLE_MS (a late async reflow lands after the
 * sync layout went quiet) and at most MAX_SETTLE_MS. Overlapping holds share
 * one pin (ref-counted, only ever raised), so a nested change cannot lower a
 * floor an outer one set from the full height.
 *
 * This is a SAFETY NET. The editor must still patch the DOM in place (stable
 * stores, no app-level Suspense) — the hold only hides what slips through.
 */

const MIN_SETTLE_MS = 500;
const MAX_SETTLE_MS = 1500;

let pins = 0;
let pinnedHeight = 0;

export function holdViewport(anchorId?: string | null,): void {
    if (typeof window === 'undefined') return;
    const anchorEl = anchorId ? document.getElementById(anchorId,) : null;
    const prevTop = anchorEl ? anchorEl.getBoundingClientRect().top : null;
    const prevY = window.scrollY;

    const de = document.documentElement;
    const floor = Math.max(de.scrollHeight, prevY + window.innerHeight,);
    pinnedHeight = pins === 0 ? floor : Math.max(pinnedHeight, floor,);
    pins++;
    de.style.minHeight = `${pinnedHeight}px`;
    const release = () => {
        if (--pins <= 0) {
            pins = 0;
            pinnedHeight = 0;
            de.style.minHeight = '';
        }
    };

    let settledFrames = 0;
    const startedAt = performance.now();
    const correct = () => {
        if (anchorId && prevTop != null) {
            const el = document.getElementById(anchorId,);
            if (!el) return; // detached for the moment — wait it out
            const delta = el.getBoundingClientRect().top - prevTop;
            if (Math.abs(delta,) > 0.5) {
                window.scrollBy(0, delta,);
                settledFrames = 0;
            } else {
                settledFrames++;
            }
        } else if (Math.abs(window.scrollY - prevY,) > 0.5) {
            window.scrollTo(0, prevY,);
            settledFrames = 0;
        } else {
            settledFrames++;
        }
    };
    const loop = () => {
        correct();
        const elapsed = performance.now() - startedAt;
        if (elapsed < MIN_SETTLE_MS || (settledFrames < 3 && elapsed < MAX_SETTLE_MS)) {
            requestAnimationFrame(loop,);
        } else {
            release();
        }
    };
    requestAnimationFrame(loop,);
}
