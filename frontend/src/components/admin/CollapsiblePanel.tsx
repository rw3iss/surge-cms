import { Component, createSignal, JSX, Show, } from 'solid-js';

interface CollapsiblePanelProps {
    title: string;
    /** Legacy short subtitle next to the title. Ignored when `headerContent` is provided. */
    subtitle?: string;
    /**
     * Rich content rendered next to the title (replaces `subtitle`
     * when set). Used to show a "brief view" of the panel's contents
     * while it's collapsed — e.g. a page's slug in a lighter style.
     */
    headerContent?: JSX.Element;
    /**
     * Right-aligned slot in the header bar. Stays visible whether the
     * panel is open or closed — used for status / access pills that
     * should always be glanceable. Clicks inside this slot don't
     * toggle the panel (event propagation is stopped).
     */
    headerExtra?: JSX.Element;
    defaultOpen?: boolean;
    children: JSX.Element;
}

/**
 * Collapsible panel with a clickable header bar.
 * Used for property sections in page/post editors.
 *
 * Header layout (left → right):
 *   [chevron] [title] [subtitle | headerContent] ............ [headerExtra]
 *
 * The toggle now wraps only the left half so `headerExtra` (badges
 * etc.) can host its own click handlers without bubbling up.
 */
const CollapsiblePanel: Component<CollapsiblePanelProps> = (props,) => {
    const [open, setOpen,] = createSignal(props.defaultOpen ?? false,);

    return (
        <div class={`collapsible-panel ${open() ? 'collapsible-panel--open' : ''}`}>
            <div class="collapsible-panel__header">
                <button
                    type="button"
                    class="collapsible-panel__header-toggle"
                    onClick={() => setOpen(!open(),)}
                    aria-expanded={open()}
                >
                    <span class="collapsible-panel__icon">{open() ? '▼' : '▶'}</span>
                    <span class="collapsible-panel__title">{props.title}</span>
                    <Show when={props.headerContent}>
                        <span class="collapsible-panel__header-content">{props.headerContent}</span>
                    </Show>
                    <Show when={!props.headerContent && props.subtitle}>
                        <span class="collapsible-panel__subtitle">{props.subtitle}</span>
                    </Show>
                </button>
                <Show when={props.headerExtra}>
                    <span
                        class="collapsible-panel__header-extra"
                        onClick={(e,) => e.stopPropagation()}
                    >
                        {props.headerExtra}
                    </span>
                </Show>
            </div>
            <Show when={open()}>
                <div class="collapsible-panel__body">
                    {props.children}
                </div>
            </Show>
        </div>
    );
};

export default CollapsiblePanel;
