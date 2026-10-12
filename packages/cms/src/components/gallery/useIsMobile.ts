/**
 * "Mobile" for gallery layouts — the same rule as the hero carousel: the real
 * viewport is ≤768px, OR the admin is previewing a breakpoint and the
 * component's own (capped) width is ≤768px. On the public site
 * `previewBreakpoint()` is always '' so only the viewport counts.
 */
import { type Accessor, createSignal, onCleanup, onMount, } from 'solid-js';
import { previewBreakpoint, } from '../../stores/previewBreakpoint';

const MOBILE_MQ = '(max-width: 768px)';

export function useIsMobile(el: () => HTMLElement | undefined,): Accessor<boolean> {
    const [viewportMobile, setViewportMobile,] = createSignal(typeof window !== 'undefined' && window.matchMedia(MOBILE_MQ,).matches,);
    const [width, setWidth,] = createSignal(0,);
    onMount(() => {
        const mq = window.matchMedia(MOBILE_MQ,);
        const update = () => setViewportMobile(mq.matches,);
        mq.addEventListener('change', update,);
        onCleanup(() => mq.removeEventListener('change', update,),);
        const node = el();
        if (node && typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver((entries,) => {
                for (const e of entries) setWidth(e.contentRect.width,);
            },);
            ro.observe(node,);
            onCleanup(() => ro.disconnect(),);
        }
    },);
    return () => viewportMobile() || (previewBreakpoint() !== '' && width() > 0 && width() <= 768);
}
