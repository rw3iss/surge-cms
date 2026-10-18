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
 * There is ONE hold at a time. A call while a hold is running RE-ARMS it (the
 * settle window restarts; the anchor position measured by the first call is
 * kept, since nothing the user did has moved it) instead of starting a second
 * frame loop — overlapping loops each corrected against a position captured at
 * a different moment, and fought each other while typing.
 *
 * The user always wins: a wheel / touch scroll or a scrolling key (PageUp,
 * PageDown, arrows, Home, End, Space outside a field) ends the hold at once,
 * where before the loop pulled the page back toward the anchor.
 *
 * It runs for at least `minMs` (default MIN_SETTLE_MS — a late async reflow
 * lands after the sync layout went quiet; data edits pass a shorter one) and
 * at most MAX_SETTLE_MS.
 *
 * This is a SAFETY NET. The editor must still patch the DOM in place (stable
 * stores, no app-level Suspense) — the hold only hides what slips through.
 */

export const MIN_SETTLE_MS = 500;
/** Settle window for a DATA edit (typing, a toggle): enough for a re-render. */
export const DATA_SETTLE_MS = 150;
export const MAX_SETTLE_MS = 1500;

/** Everything the hold touches — injectable so it can be tested without a DOM. */
export interface ViewportEnv {
    raf: (cb: () => void,) => void;
    now: () => number;
    anchorTop: (id: string,) => number | null;
    scrollY: () => number;
    scrollBy: (dy: number,) => void;
    scrollTo: (y: number,) => void;
    docHeight: () => number;
    innerHeight: () => number;
    setMinHeight: (px: number | null,) => void;
    /** Subscribe to user-scroll intent; returns the unsubscribe. */
    onUserScroll: (cb: () => void,) => () => void;
}

const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ',],);

function browserEnv(): ViewportEnv {
    return {
        raf: (cb,) => requestAnimationFrame(cb,),
        now: () => performance.now(),
        anchorTop: (id,) => document.getElementById(id,)?.getBoundingClientRect().top ?? null,
        scrollY: () => window.scrollY,
        scrollBy: (dy,) => window.scrollBy(0, dy,),
        scrollTo: (y,) => window.scrollTo(0, y,),
        docHeight: () => document.documentElement.scrollHeight,
        innerHeight: () => window.innerHeight,
        setMinHeight: (px,) => { document.documentElement.style.minHeight = px == null ? '' : `${px}px`; },
        onUserScroll: (cb,) => {
            const onKey = (e: KeyboardEvent,) => {
                if (!SCROLL_KEYS.has(e.key,)) return;
                const t = e.target as HTMLElement | null;
                // Arrow keys in a field move the caret, not the page.
                if (t && (t.isContentEditable || t.closest?.('input, textarea, select',))) return;
                cb();
            };
            window.addEventListener('wheel', cb, { passive: true, },);
            window.addEventListener('touchmove', cb, { passive: true, },);
            window.addEventListener('keydown', onKey,);
            return () => {
                window.removeEventListener('wheel', cb,);
                window.removeEventListener('touchmove', cb,);
                window.removeEventListener('keydown', onKey,);
            };
        },
    };
}

export interface HoldOptions {
    /** Minimum settle window (ms). Default MIN_SETTLE_MS. */
    minMs?: number;
}

/** A hold controller over `env` (one per page; tests make their own). */
export function createViewportHold(env: ViewportEnv,) {
    let active: {
        anchorId: string | null;
        prevTop: number | null;
        prevY: number;
        startedAt: number;
        minMs: number;
        settledFrames: number;
        unsubscribe: () => void;
    } | null = null;

    const release = () => {
        if (!active) return;
        active.unsubscribe();
        active = null;
        env.setMinHeight(null,);
    };

    const correct = () => {
        const a = active!;
        if (a.anchorId && a.prevTop != null) {
            const top = env.anchorTop(a.anchorId,);
            if (top == null) return; // detached for the moment — wait it out
            const delta = top - a.prevTop;
            if (Math.abs(delta,) > 0.5) {
                env.scrollBy(delta,);
                a.settledFrames = 0;
            } else {
                a.settledFrames++;
            }
        } else if (Math.abs(env.scrollY() - a.prevY,) > 0.5) {
            env.scrollTo(a.prevY,);
            a.settledFrames = 0;
        } else {
            a.settledFrames++;
        }
    };

    const loop = () => {
        if (!active) return; // released (user scrolled)
        correct();
        const elapsed = env.now() - active.startedAt;
        if (elapsed < active.minMs || (active.settledFrames < 3 && elapsed < MAX_SETTLE_MS)) env.raf(loop,);
        else release();
    };

    return {
        hold(anchorId?: string | null, opts: HoldOptions = {},): void {
            const minMs = opts.minMs ?? MIN_SETTLE_MS;
            const floor = Math.max(env.docHeight(), env.scrollY() + env.innerHeight(),);
            if (active) {
                // Re-arm the running hold: a new settle window, the pin only ever raised.
                active.startedAt = env.now();
                active.minMs = Math.max(active.minMs, minMs,);
                active.settledFrames = 0;
                if ((anchorId ?? null) !== active.anchorId) {
                    active.anchorId = anchorId ?? null;
                    active.prevTop = anchorId ? env.anchorTop(anchorId,) : null;
                    active.prevY = env.scrollY();
                }
                env.setMinHeight(floor,);
                return;
            }
            active = {
                anchorId: anchorId ?? null,
                prevTop: anchorId ? env.anchorTop(anchorId,) : null,
                prevY: env.scrollY(),
                startedAt: env.now(),
                minMs,
                settledFrames: 0,
                // The user scrolling ends the hold: never pull the page back.
                unsubscribe: env.onUserScroll(() => release(),),
            };
            env.setMinHeight(floor,);
            env.raf(loop,);
        },
        isHolding: (): boolean => active !== null,
        release,
    };
}

let shared: ReturnType<typeof createViewportHold> | null = null;

export function holdViewport(anchorId?: string | null, opts?: HoldOptions,): void {
    if (typeof window === 'undefined') return;
    shared ??= createViewportHold(browserEnv(),);
    shared.hold(anchorId, opts,);
}
