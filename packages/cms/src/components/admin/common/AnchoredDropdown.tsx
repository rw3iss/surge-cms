/**
 * A dropdown that escapes whatever scroll container it lives in.
 *
 * ## Why this exists
 *
 * The block properties panel (`.flyout-panel__body`) is `overflow-y: auto`, and
 * has to be: a block with a long settings list would otherwise run past the
 * bottom of the window with no way to reach the rest. An absolutely positioned
 * dropdown inside it is therefore clipped at the panel's edge — which is what
 * cut the social post list off after three rows.
 *
 * CSS alone cannot solve it. Setting `overflow-y: auto` forces `overflow-x` to
 * compute to a non-`visible` value (and vice versa), so there is no combination
 * that keeps the panel scrollable AND lets a child paint outside it. The only
 * fix is to take the menu out of that subtree: render it in a Portal, position
 * it `fixed` against the trigger, and keep it aligned as things move.
 *
 * ## What it handles
 *
 *  - follows the anchor while the panel (or the window) scrolls;
 *  - flips above the anchor when there isn't room below;
 *  - clamps its height to the space actually available, so it never runs off
 *    the top or bottom of the window;
 *  - hides itself when the anchor scrolls out of its own scroll container,
 *    rather than leaving a menu floating over unrelated UI.
 */
import { createEffect, createSignal, JSX, onCleanup, Show, } from 'solid-js';
import { Portal, } from 'solid-js/web';

export interface AnchoredDropdownProps {
    /** The element to position against — usually the input the menu belongs to. */
    anchor: HTMLElement | undefined;
    open: boolean;
    /** Class for the floating element; keep the existing look. */
    class?: string;
    /** Upper bound on height; the available space can still shrink it. */
    maxHeight?: number;
    children: JSX.Element;
}

/** Nearest ancestor that scrolls, so we can tell when the anchor leaves it. */
function scrollParent(el: HTMLElement | undefined,): HTMLElement | null {
    let n = el?.parentElement ?? null;
    while (n) {
        const cs = getComputedStyle(n,);
        if (/(auto|scroll|hidden|clip)/.test(cs.overflowY + cs.overflowX,)) return n;
        n = n.parentElement;
    }
    return null;
}

const GAP = 2;
const EDGE = 8;

const AnchoredDropdown = (props: AnchoredDropdownProps,) => {
    const [pos, setPos,] = createSignal<
        { top: number; left: number; width: number; maxH: number; hidden: boolean; } | null
    >(null,);

    const place = () => {
        const a = props.anchor;
        if (!a) { setPos(null,); return; }
        const r = a.getBoundingClientRect();

        // Anchor scrolled out of its own container — don't leave a menu behind.
        const sp = scrollParent(a,);
        if (sp) {
            const sr = sp.getBoundingClientRect();
            if (r.bottom < sr.top || r.top > sr.bottom) {
                setPos({ top: 0, left: 0, width: 0, maxH: 0, hidden: true, },);
                return;
            }
        }

        const below = window.innerHeight - r.bottom - GAP - EDGE;
        const above = r.top - GAP - EDGE;
        const cap = props.maxHeight ?? 280;
        // Prefer below; flip only when below is genuinely cramped AND above is
        // roomier, so the menu doesn't jump sides on a small scroll.
        const flip = below < Math.min(cap, 160,) && above > below;
        const maxH = Math.max(80, Math.min(cap, flip ? above : below,),);

        setPos({
            top: flip ? r.top - GAP - maxH : r.bottom + GAP,
            left: r.left,
            width: r.width,
            maxH,
            hidden: false,
        },);
    };

    createEffect(() => {
        if (!props.open || !props.anchor) { setPos(null,); return; }
        place();
        // `capture` so a scroll on ANY ancestor (the panel, the page) is seen —
        // scroll doesn't bubble.
        window.addEventListener('scroll', place, true,);
        window.addEventListener('resize', place,);
        // The panel can also change height without scrolling (a section
        // expanding above the input), which moves the anchor.
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place,) : null;
        if (ro && props.anchor) ro.observe(props.anchor,);
        onCleanup(() => {
            window.removeEventListener('scroll', place, true,);
            window.removeEventListener('resize', place,);
            ro?.disconnect();
        },);
    },);

    return (
        <Show when={props.open && pos() && !pos()!.hidden}>
            <Portal>
                <div
                    class={props.class}
                    // Inline because these are per-instance measurements, not
                    // styling — the class keeps owning the appearance.
                    style={{
                        position: 'fixed',
                        top: `${pos()!.top}px`,
                        left: `${pos()!.left}px`,
                        width: `${pos()!.width}px`,
                        'max-height': `${pos()!.maxH}px`,
                        'overflow-y': 'auto',
                        // Above the flyout panel and the block editor chrome.
                        'z-index': 1200,
                    }}
                    // The parent's click-outside handler tests containment
                    // against its own subtree; portalled content is no longer
                    // inside it, so mark it for those checks.
                    data-anchored-dropdown="true"
                >
                    {props.children}
                </div>
            </Portal>
        </Show>
    );
};

export default AnchoredDropdown;
