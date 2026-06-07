/**
 * Toggle — a single-purpose on/off switch. Drop-in replacement for
 * `<input type="checkbox">` for binary settings (anything where the
 * value is conceptually "on or off", not "select one or more from a
 * set"). Bulk-select / multi-pick checkboxes stay as plain inputs.
 *
 * Renders a button (not a checkbox) for clarity: a click is one
 * deliberate state flip, keyboard accessible via Enter / Space, and
 * announced as `aria-pressed`. Styled by `_toggle.scss`.
 *
 *   <Toggle checked={enabled()} onChange={setEnabled} />
 *   <Toggle checked={x()} onChange={setX} label="Show advanced" />
 */
import { Component, JSX, Show, } from 'solid-js';

export interface ToggleProps {
    checked: boolean;
    onChange: (next: boolean,) => void;
    /** Optional inline label rendered to the left of the switch. */
    label?: string | JSX.Element;
    disabled?: boolean;
    /** Visual size hint. Defaults to `md`. */
    size?: 'sm' | 'md';
    /** Optional aria-label for cases where the surrounding context
     *  doesn't already label the toggle (e.g. a bare switch in a
     *  table row). */
    ariaLabel?: string;
    /** Optional class on the outer wrapper for ad-hoc tweaks. */
    class?: string;
}

const Toggle: Component<ToggleProps> = (p,) => {
    const onClick = (): void => {
        if (p.disabled) return;
        p.onChange(!p.checked,);
    };

    return (
        <span class={`toggle-control ${p.size === 'sm' ? 'toggle-control--sm' : ''} ${p.class ?? ''}`}>
            <Show when={p.label}>
                <span class="toggle-control__label">{p.label}</span>
            </Show>
            <button
                type="button"
                class={`toggle-control__switch ${p.checked ? 'is-on' : ''}`}
                onClick={onClick}
                aria-pressed={p.checked}
                aria-label={p.ariaLabel}
                disabled={p.disabled}
            >
                <span class="toggle-control__knob" />
            </button>
        </span>
    );
};

export default Toggle;
