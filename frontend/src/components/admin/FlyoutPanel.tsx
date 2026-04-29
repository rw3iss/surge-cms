import { Component, createSignal, JSX, Show, } from 'solid-js';
import './FlyoutPanel.scss';

export type FlyoutMode = 'float' | 'inline';

export interface FlyoutPanelProps {
    title: string;
    open: boolean;
    onClose: () => void;
    side?: 'left' | 'right';
    onSideChange?: (side: 'left' | 'right',) => void;
    /** 'float' = fixed overlay, 'inline' = in-page sticky column */
    mode?: FlyoutMode;
    onModeChange?: (mode: FlyoutMode,) => void;
    children: JSX.Element;
}

/**
 * A floating/docked panel that can be positioned on the left or right
 * side of the screen. Draggable header — drag past the midpoint to
 * snap to the other side. Collapsible to header-only.
 */
const FlyoutPanel: Component<FlyoutPanelProps> = (props,) => {
    const [collapsed, setCollapsed,] = createSignal(false,);
    const [dragging, setDragging,] = createSignal(false,);
    const [topOffset, setTopOffset,] = createSignal(0,);
    let panelRef: HTMLDivElement | undefined;
    const side = () => props.side || 'right';
    const mode = () => props.mode || 'inline';
    const isInline = () => mode() === 'inline';

    // Compute the legal range for `topOffset` given the current panel
    // height. When the panel fits the viewport the range is [0,
    // viewport - height] (panel stays fully visible). When it's
    // taller than the viewport the range is [viewport - height, 0]
    // (negative top allowed so the user can scroll the panel by
    // dragging — top:0 shows the top edge, more negative shows the
    // bottom). Both cases collapse correctly when slack === 0.
    const topBounds = () => {
        const panelHeight = panelRef?.offsetHeight ?? 100;
        const slack = window.innerHeight - panelHeight;
        return { min: Math.min(0, slack,), max: Math.max(0, slack,), };
    };

    const clampTop = (t: number,) => {
        const { min, max, } = topBounds();
        return Math.max(min, Math.min(max, t,),);
    };

    // The browser synthesizes a click on pointerup, which would
    // otherwise fall through to the title's onClick and toggle the
    // panel right after every drag-and-release. We track whether the
    // pointer actually moved (small jitter under 4px doesn't count as
    // a drag) and swallow the synthesized click in capture phase when
    // it did.
    const DRAG_THRESHOLD_PX = 4;

    const handleDragStart = (e: PointerEvent,) => {
        if ((e.target as HTMLElement).closest('button',)) return;
        if (isInline()) return; // no dragging in inline mode
        e.preventDefault();
        setDragging(true,);

        const startX = e.clientX;
        const startY = e.clientY;
        const startTop = topOffset();
        const startSide = side();
        const midpointX = window.innerWidth / 2;
        let dragMoved = false;

        const handleMove = (ev: PointerEvent,) => {
            if (!dragMoved) {
                const dx = Math.abs(ev.clientX - startX,);
                const dy = Math.abs(ev.clientY - startY,);
                if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) {
                    dragMoved = true;
                }
            }
            const newSide = ev.clientX < midpointX ? 'left' : 'right';
            if (newSide !== startSide && props.onSideChange) {
                props.onSideChange(newSide,);
            }
            // Allow vertical drag in both collapsed and expanded states.
            // Bounds are recomputed each frame so resizing the window
            // mid-drag clamps cleanly.
            const deltaY = ev.clientY - startY;
            setTopOffset(clampTop(startTop + deltaY,),);
        };

        const handleUp = () => {
            setDragging(false,);
            document.removeEventListener('pointermove', handleMove,);
            document.removeEventListener('pointerup', handleUp,);

            if (dragMoved) {
                // Swallow exactly the one click event the browser
                // emits after pointerup. Capture phase + immediate
                // propagation stop keeps the title onClick from
                // running. Self-removes after firing or on the next
                // animation frame, whichever comes first, so a
                // legitimate later click still works.
                const swallow = (ce: MouseEvent,) => {
                    ce.stopImmediatePropagation();
                    ce.preventDefault();
                    window.removeEventListener('click', swallow, true,);
                };
                window.addEventListener('click', swallow, true,);
                requestAnimationFrame(() => {
                    window.removeEventListener('click', swallow, true,);
                },);
            }
        };

        document.addEventListener('pointermove', handleMove,);
        document.addEventListener('pointerup', handleUp,);
    };

    // Toggle collapsed while preserving the BOTTOM edge of the panel,
    // so expanding "grows up" from where the collapsed header sat
    // (and collapsing "shrinks up" to leave the header where the
    // expanded body's bottom was). This matches how every other
    // floating-panel UI behaves.
    const handleToggleCollapse = () => {
        if (isInline() || !panelRef) {
            setCollapsed(!collapsed(),);
            return;
        }
        const bottomBefore = panelRef.getBoundingClientRect().bottom;
        setCollapsed(!collapsed(),);
        // Wait for SolidJS to apply the DOM change before measuring
        // the new height — Solid mutates synchronously on signal write
        // but layout may not be finalized until the next frame.
        requestAnimationFrame(() => {
            if (!panelRef) return;
            const newHeight = panelRef.offsetHeight;
            setTopOffset(clampTop(bottomBefore - newHeight,),);
        },);
    };

    const toggleMode = () => {
        const next: FlyoutMode = isInline() ? 'float' : 'inline';
        props.onModeChange?.(next,);
        if (next === 'inline') {
            setCollapsed(false,);
            setTopOffset(0,);
        }
    };

    return (
        <Show when={props.open}>
            <div
                ref={panelRef}
                class={`flyout-panel flyout-panel--${side()} ${
                    isInline() ? 'flyout-panel--inline' : ''
                } ${collapsed() ? 'flyout-panel--collapsed' : ''
                } ${dragging() ? 'flyout-panel--dragging' : ''}`}
                style={!isInline() ? { top: `${topOffset()}px`, } : {}}
            >
                <div
                    class="flyout-panel__header"
                    onPointerDown={!isInline() ? handleDragStart : undefined}
                >
                    <span
                        class="flyout-panel__title"
                        onClick={handleToggleCollapse}
                    >
                        <span class="flyout-panel__collapse-icon">
                            {collapsed() ? '▶' : '▼'}
                        </span>
                        {props.title}
                    </span>
                    <div class="flyout-panel__header-actions">
                        {/* Inline / float toggle */}
                        <button
                            class={`flyout-panel__header-btn ${isInline() ? '' : 'flyout-panel__header-btn--active'}`}
                            onClick={toggleMode}
                            title={isInline() ? 'Float panel' : 'Dock in page'}
                        >
                            <svg viewBox="0 0 16 16" width="14" height="14">
                                <Show when={isInline()}>
                                    {/* "pop out" icon */}
                                    <rect x="1" y="1" width="14" height="14" rx="1.5" stroke="currentColor" fill="none" stroke-width="1.2" />
                                    <path d="M6 2v4H2M10 14v-4h4" stroke="currentColor" stroke-width="1.2" />
                                </Show>
                                <Show when={!isInline()}>
                                    {/* "dock in" icon */}
                                    <rect x="1" y="1" width="14" height="14" rx="1.5" stroke="currentColor" fill="none" stroke-width="1.2" />
                                    <path d="M10 1v14M12 5h2M12 8h2M12 11h2" stroke="currentColor" stroke-width="1.2" />
                                </Show>
                            </svg>
                        </button>
                        {/* Dock side toggle */}
                        <button
                            class="flyout-panel__header-btn"
                            onClick={() => props.onSideChange?.(side() === 'right' ? 'left' : 'right',)}
                            title={`Dock ${side() === 'right' ? 'left' : 'right'}`}
                        >
                            {side() === 'right' ? '◁' : '▷'}
                        </button>
                        <button
                            class="flyout-panel__header-btn flyout-panel__header-btn--close"
                            onClick={props.onClose}
                            title="Close"
                        >
                            ✕
                        </button>
                    </div>
                </div>
                <Show when={!collapsed()}>
                    <div class="flyout-panel__body">
                        {props.children}
                    </div>
                </Show>
            </div>
        </Show>
    );
};

export default FlyoutPanel;
