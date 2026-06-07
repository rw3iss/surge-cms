import { Component, JSX, Show, createSignal, } from 'solid-js';
import { Toggle, } from './Toggle';
import './FormSection.scss';

export interface FormSectionProps {
    title: string;
    description?: string;
    /** Optional leading icon (rendered next to the title). Should be a span or svg, sized 1em. */
    icon?: JSX.Element;
    /** Default open state. Default: true. */
    defaultOpen?: boolean;
    /** When set, renders a toggle in the header that controls section
     * "enabled" state. When toggled off, the body collapses and inputs
     * inside should not contribute to the install payload. */
    toggleable?: boolean;
    enabled?: boolean;
    onEnabledChange?: (enabled: boolean,) => void;
    /** When true, a small status pill is shown next to the title (e.g. "✓ Detected"). */
    status?: { tone: 'ok' | 'warn' | 'info'; label: string; };
    /** Mark the section as required so validation messages can hint at it. */
    required?: boolean;
    children: JSX.Element;
}

/**
 * Collapsible card used as a wizard section. Two clickable hot zones:
 *   - the entire header collapses/expands the body
 *   - the toggle (when present) does NOT collapse — it only flips the
 *     enabled state, with the body collapsing automatically as a hint
 *
 * The toggle event is stopPropagation'd so a tap on the switch doesn't
 * also collapse the section.
 */
export const FormSection: Component<FormSectionProps> = (props,) => {
    const [openManual, setOpenManual,] = createSignal(props.defaultOpen ?? true,);
    const open = () => {
        // When toggle-controlled and disabled, force-collapse for clarity.
        if (props.toggleable && props.enabled === false) return false;
        return openManual();
    };

    return (
        <section class={`ui-form-section ${open() ? 'is-open' : 'is-collapsed'} ${props.toggleable && props.enabled === false ? 'is-disabled' : ''}`}>
            <header class="ui-form-section__header">
                <button
                    type="button"
                    class="ui-form-section__header-toggle"
                    onClick={() => setOpenManual(!openManual(),)}
                    aria-expanded={open()}
                >
                    <span class="ui-form-section__chevron" aria-hidden="true">
                        <svg viewBox="0 0 12 12" width="10" height="10">
                            <path d="M3 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                    </span>
                    <Show when={props.icon}>
                        <span class="ui-form-section__icon">{props.icon}</span>
                    </Show>
                    <span class="ui-form-section__title-block">
                        <span class="ui-form-section__title">
                            {props.title}
                            <Show when={props.required}>
                                <span class="ui-form-section__required" title="Required">*</span>
                            </Show>
                        </span>
                        <Show when={props.description}>
                            <span class="ui-form-section__description">{props.description}</span>
                        </Show>
                    </span>
                </button>
                <div class="ui-form-section__header-aside">
                    <Show when={props.status}>
                        <span class={`ui-form-section__status ui-form-section__status--${props.status!.tone}`}>
                            {props.status!.label}
                        </span>
                    </Show>
                    <Show when={props.toggleable}>
                        <span class="ui-form-section__toggle" onClick={(e,) => e.stopPropagation()}>
                            <Toggle
                                checked={props.enabled ?? false}
                                onChange={(v,) => {
                                    props.onEnabledChange?.(v,);
                                    if (v) setOpenManual(true,);
                                }}
                                emphasis
                            />
                        </span>
                    </Show>
                </div>
            </header>
            <Show when={open()}>
                <div class="ui-form-section__body">
                    {props.children}
                </div>
            </Show>
        </section>
    );
};

export default FormSection;
