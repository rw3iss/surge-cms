/**
 * A button (or buttons) placed in a ROW of fields — e.g. "Key | Label | Based on
 * | Description | [+ Add role]". Renders an invisible spacer with the exact
 * metrics of a FormField label above its children, so the buttons line up with
 * the INPUTS while the row stays top-aligned (a field's hint then hangs below
 * its input instead of lifting it). See ADMIN_STYLES.md → "Sections and field rows".
 */
import type { Component, JSX, } from 'solid-js';

const FormRowAction: Component<{ children: JSX.Element; class?: string; }> = (props,) => (
    <div class={`admin-form-row__action ${props.class ?? ''}`}>
        <span class="admin-form-field__label" aria-hidden="true"><span class="admin-form-field__label-text">&nbsp;</span></span>
        <div class="admin-form-row__action-buttons">{props.children}</div>
    </div>
);

export default FormRowAction;
