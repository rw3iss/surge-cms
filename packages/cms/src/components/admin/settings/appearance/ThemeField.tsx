/** One labelled row in the Appearance settings (label, control, sub-label, tooltip). */
import { Show, } from 'solid-js';
import Tooltip from '../../common/Tooltip';

// Reusable theme field row with label, control, optional sublabel, and tooltip
export default function ThemeField(props: {
    label: string;
    sublabel?: string;
    tooltip?: string;
    children: any;
},) {
    return (
        <div class="theme-field">
            <div class="theme-field__label-group">
                <label class="theme-field__label">
                    {props.label}
                    <Show when={props.tooltip}>
                        <Tooltip content={props.tooltip!} header={props.label} />
                    </Show>
                </label>
                <Show when={props.sublabel}>
                    <span class="theme-field__sublabel">{props.sublabel}</span>
                </Show>
            </div>
            <div class="theme-field__control">
                {props.children}
            </div>
        </div>
    );
}
