/**
 * Toggle — the single project-wide on/off switch. Drop-in replacement for
 * `<input type="checkbox">` for binary settings (anything conceptually "on or
 * off", not "pick one/more from a set" — those stay plain checkboxes).
 *
 * Renders switch-first (switch on the left, optional label after) as a
 * `role="switch"` button: one deliberate flip, keyboard-accessible via
 * Enter/Space, announced with `aria-checked`. Styled by the co-located
 * `Toggle.scss` (component-scoped so it works in BOTH the admin and the
 * setup flow — the admin global stylesheet isn't loaded during setup).
 *
 * `admin/common/Toggle` re-exports this so its 20+ call sites are unchanged.
 *
 *   <Toggle checked={enabled()} onChange={setEnabled} />
 *   <Toggle checked={x()} onChange={setX} label="Show advanced" size="sm" />
 */
import { Component, JSX, Show, } from 'solid-js';
import './Toggle.scss';

export interface ToggleProps {
    checked: boolean;
    onChange: (next: boolean,) => void;
    /** Optional inline label rendered after the switch. */
    label?: string | JSX.Element;
    disabled?: boolean;
    /** Visual size hint. Defaults to `md`. */
    size?: 'sm' | 'md';
    /** Larger label styling — used when the toggle acts as a section header. */
    emphasis?: boolean;
    /** Optional aria-label for a bare switch with no surrounding label. */
    ariaLabel?: string;
    /** Optional class on the outer wrapper for ad-hoc tweaks. */
    class?: string;
}

export const Toggle: Component<ToggleProps> = (p,) => {
    const onClick = (): void => {
        if (p.disabled) return;
        p.onChange(!p.checked,);
    };

    return (
        <span
            class={`toggle-control ${p.size === 'sm' ? 'toggle-control--sm' : ''} ${
                p.emphasis ? 'toggle-control--emphasis' : ''
            } ${p.class ?? ''}`}
        >
            <Show when={p.label}>
                <span class="toggle-control__label">{p.label}</span>
            </Show>
            <button
                type="button"
                class={`toggle-control__switch ${p.checked ? 'is-on' : ''}`}
                onClick={onClick}
                role="switch"
                aria-checked={p.checked}
                aria-label={p.ariaLabel}
                disabled={p.disabled}
            >
                <span class="toggle-control__knob" />
            </button>
        </span>
    );
};

export default Toggle;
