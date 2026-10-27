/**
 * StableSuspense — a `<Suspense>` boundary that never changes the layout.
 *
 * Why: in Solid, ANY resource read while loading (first load OR a refetch
 * because its key changed) hands control to the NEAREST `<Suspense>`, which
 * swaps its whole subtree for the fallback. With only the app-level boundary
 * above the admin, editing one block property that re-keyed a resource blanked
 * the entire admin for a frame: the document collapsed to the window height,
 * the browser clamped the scroll to 0, and the editor "jumped to the top".
 *
 * Rule: wrap every region that may load on its own — a block preview, the
 * block property panel, the admin page outlet — in this boundary. A suspension
 * then stays INSIDE the region, and its placeholder keeps the region's last
 * measured height, so nothing around it moves.
 *
 * How the height is kept: a ResizeObserver records the box height only while
 * real content is shown (the placeholder carries `data-suspense-fallback`),
 * and the placeholder renders at that height. `display: contents` is not
 * used on the box because it cannot be measured.
 *
 * `measure`: measure an EXISTING element instead of rendering a wrapper div
 * (the admin `<main>`, whose styles target its direct children — a wrapper
 * would break `.admin-layout__main > …`). The placeholder then becomes that
 * element's child and takes the element's last CONTENT height (padding
 * excluded) — for a single-page outlet, the page's height.
 */
import { createSignal, type JSX, onCleanup, onMount, type ParentComponent, Suspense, } from 'solid-js';

export const StableSuspense: ParentComponent<{
    /** Shown while loading, inside the held height (default: nothing). */
    fallback?: JSX.Element;
    class?: string;
    style?: JSX.CSSProperties;
    /** Measure this element (no wrapper div is rendered). */
    measure?: () => HTMLElement | undefined;
}> = (props,) => {
    let own: HTMLDivElement | undefined;
    const box = () => props.measure?.() ?? own;
    const [held, setHeld,] = createSignal(0,);

    onMount(() => {
        const el = box();
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => {
            if (el.querySelector(':scope > [data-suspense-fallback]',)) return;
            const cs = getComputedStyle(el,);
            setHeld(el.clientHeight - (parseFloat(cs.paddingTop,) || 0) - (parseFloat(cs.paddingBottom,) || 0),);
        },);
        ro.observe(el,);
        onCleanup(() => ro.disconnect(),);
    },);

    const boundary = () => (
        <Suspense
            fallback={
                <div data-suspense-fallback="" aria-busy="true" style={{ 'min-height': `${held()}px`, }}>
                    {props.fallback}
                </div>
            }
        >
            {props.children}
        </Suspense>
    );

    return props.measure
        ? boundary()
        : <div ref={own} class={props.class} style={props.style}>{boundary()}</div>;
};

export default StableSuspense;
