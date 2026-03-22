import { Component, createSignal, Show, For, onCleanup, JSX } from 'solid-js';
import './Tooltip.scss';

export interface TooltipAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

export interface TooltipProps {
  header?: string;
  content: string | JSX.Element;
  actions?: TooltipAction[];
  icon?: JSX.Element;
  delay?: number;         // hover delay in ms, default 500
  maxWidth?: number;      // max tooltip width in px, default 280
}

const Tooltip: Component<TooltipProps> = (props) => {
  const [visible, setVisible] = createSignal(false);
  const [position, setPosition] = createSignal<{ top: number; left: number; placement: 'top' | 'bottom' }>({ top: 0, left: 0, placement: 'top' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let iconRef: HTMLSpanElement | undefined;
  let tooltipRef: HTMLDivElement | undefined;

  const delay = () => props.delay ?? 500;
  const maxWidth = () => props.maxWidth ?? 280;

  const calculatePosition = () => {
    if (!iconRef) return;
    const rect = iconRef.getBoundingClientRect();
    const tooltipWidth = maxWidth();
    const tooltipEstHeight = 150; // estimate, will adjust after render
    const gap = 8;

    // Default: show above the icon, centered
    let top = rect.top - gap;
    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    let placement: 'top' | 'bottom' = 'top';

    // If tooltip would go above viewport, show below instead
    if (top - tooltipEstHeight < 8) {
      top = rect.bottom + gap;
      placement = 'bottom';
    }

    // Clamp horizontal to stay within viewport
    const viewportWidth = window.innerWidth;
    if (left < 8) left = 8;
    if (left + tooltipWidth > viewportWidth - 8) left = viewportWidth - tooltipWidth - 8;

    setPosition({ top, left, placement });
  };

  // Re-adjust after tooltip renders (now we know actual height)
  const adjustAfterRender = () => {
    if (!tooltipRef || !iconRef) return;
    const rect = iconRef.getBoundingClientRect();
    const tipRect = tooltipRef.getBoundingClientRect();
    const gap = 8;

    let { left, placement } = position();
    let top: number;

    if (placement === 'top') {
      top = rect.top - tipRect.height - gap;
      // If still overflows top, flip to bottom
      if (top < 8) {
        top = rect.bottom + gap;
        placement = 'bottom';
      }
    } else {
      top = rect.bottom + gap;
      // If overflows bottom, flip to top
      if (top + tipRect.height > window.innerHeight - 8) {
        top = rect.top - tipRect.height - gap;
        placement = 'top';
      }
    }

    setPosition({ top, left, placement });
  };

  const show = () => {
    timer = setTimeout(() => {
      calculatePosition();
      setVisible(true);
      // Fine-tune after next frame when tooltip is in DOM
      requestAnimationFrame(adjustAfterRender);
    }, delay());
  };

  const hide = () => {
    clearTimeout(timer);
    setVisible(false);
  };

  onCleanup(() => clearTimeout(timer));

  return (
    <span
      class="tooltip-trigger"
      ref={iconRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusIn={show}
      onFocusOut={hide}
      tabIndex={0}
      role="button"
      aria-label="Help"
    >
      <Show when={props.icon} fallback={
        <svg class="tooltip-trigger__icon" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
        </svg>
      }>
        {props.icon}
      </Show>

      <Show when={visible()}>
        <div
          ref={tooltipRef}
          class={`tooltip-popup tooltip-popup--${position().placement}`}
          style={{
            position: 'fixed',
            top: `${position().top}px`,
            left: `${position().left}px`,
            'max-width': `${maxWidth()}px`,
          }}
          role="tooltip"
        >
          <Show when={props.header}>
            <div class="tooltip-popup__header">{props.header}</div>
          </Show>
          <div class="tooltip-popup__content">
            {props.content}
          </div>
          <Show when={props.actions?.length}>
            <div class="tooltip-popup__actions">
              <For each={props.actions}>
                {(action) => (
                  <button
                    class={`tooltip-popup__action tooltip-popup__action--${action.variant || 'secondary'}`}
                    onClick={(e) => { e.stopPropagation(); action.onClick(); hide(); }}
                  >
                    {action.label}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </span>
  );
};

export default Tooltip;
