/**
 * Toggle — the single project-wide on/off switch, and the DEFAULT control for
 * anything that would otherwise be `<input type="checkbox">`.
 *
 * **Project rule: no raw checkboxes.** A boolean gets this switch. A radio
 * group may use switches too, but prefer restating the choice as independent
 * toggles where that reads naturally.
 *
 * The one exception is SELECTION rather than settings — ticking rows in a table
 * for a bulk action, or a public form's "choose all that apply". A switch means
 * "this is now on"; a tick means "this one is included". Those use
 * `ui/Checkbox`, which is still custom-styled, so no native checkbox is
 * rendered anywhere either way.
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
import { Component, createUniqueId, JSX, Show, } from 'solid-js';
import { labelClickActivates, } from '../../utils/labelActivation';
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
    const labelId = `toggle-label-${createUniqueId()}`;

    const onClick = (): void => {
        if (p.disabled) return;
        p.onChange(!p.checked,);
    };

    /**
     * Clicking the label flips the switch, the way a native checkbox's
     * `<label>` does — the words are the bigger, more obvious target, and a
     * label that looks clickable but is not reads as broken.
     *
     * Not built as a real `<label for>` + hidden input: the control is a
     * `role="switch"` button, which a label cannot target. Not put on the outer
     * wrapper either — the switch lives there too, so a click on it would fire
     * both handlers and toggle twice, landing back where it started.
     *
     * The walk stops at the label itself rather than using `closest()` on the
     * document, so an interactive ANCESTOR of the whole toggle (a clickable
     * card, say) cannot suppress the label.
     */
    const onLabelClick = (e: MouseEvent,): void => {
        if (p.disabled) return;
        if (!labelClickActivates(e.target as HTMLElement | null, e.currentTarget as HTMLElement,)) return;
        onClick();
    };

    return (
        <span
            class={`toggle-control ${p.size === 'sm' ? 'toggle-control--sm' : ''} ${
                p.emphasis ? 'toggle-control--emphasis' : ''
            } ${p.class ?? ''}`}
        >
            <Show when={p.label}>
                <span
                    class="toggle-control__label"
                    id={labelId}
                    onClick={onLabelClick}
                >
                    {p.label}
                </span>
            </Show>
            <button
                type="button"
                class={`toggle-control__switch ${p.checked ? 'is-on' : ''}`}
                onClick={onClick}
                role="switch"
                aria-checked={p.checked}
                // Without this a switch given only `label` had NO accessible
                // name — the label is a sibling `<span>`, so nothing associated
                // the two and a screen reader announced a bare "switch".
                // An explicit `ariaLabel` still wins, for a bare switch.
                aria-label={p.ariaLabel}
                aria-labelledby={!p.ariaLabel && p.label ? labelId : undefined}
                disabled={p.disabled}
            >
                <span class="toggle-control__knob" />
            </button>
        </span>
    );
};

export default Toggle;
