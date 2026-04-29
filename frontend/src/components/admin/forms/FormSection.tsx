/**
 * FormSection — a labeled group of related controls.
 *
 * Renders a small-bold section title (matching the FormField label
 * style) and an inner grid for its children. `tight` reduces the gap
 * between rows for dense lists like checkbox panels. `padded` adds a
 * little extra breathing room below the section so the next field
 * doesn't feel crowded.
 */
import { Component, JSX, Show, } from 'solid-js';
import Tooltip from '../Tooltip';

export interface FormSectionProps {
    title: string;
    tooltip?: string | JSX.Element;
    tooltipHeader?: string;
    /** Tighten vertical spacing between child rows (e.g. checkbox lists). */
    tight?: boolean;
    /** Add extra bottom padding so the next field has breathing room. */
    padded?: boolean;
    /** Render children in a horizontal flex row that wraps. Default is
     *  vertical stack. Use this for inline checkbox groups. */
    inlineItems?: boolean;
    class?: string;
    children: JSX.Element;
}

const FormSection: Component<FormSectionProps> = (props,) => {
    return (
        <div
            class={`admin-form-section ${props.padded ? 'admin-form-section--padded' : ''} ${props.class || ''}`}
        >
            <div class="admin-form-section__title">
                <span>{props.title}</span>
                <Show when={props.tooltip}>
                    <Tooltip header={props.tooltipHeader || props.title} content={props.tooltip!} />
                </Show>
            </div>
            <div
                class={`admin-form-section__items ${
                    props.tight ? 'admin-form-section__items--tight' : ''
                } ${props.inlineItems ? 'admin-form-section__items--inline' : ''}`}
            >
                {props.children}
            </div>
        </div>
    );
};

export default FormSection;
