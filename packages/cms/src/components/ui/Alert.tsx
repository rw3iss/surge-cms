import { Component, JSX, } from 'solid-js';
import './Alert.scss';

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps {
    tone?: AlertTone;
    title?: string;
    children: JSX.Element;
    icon?: JSX.Element;
}

const DEFAULT_ICONS: Record<AlertTone, string> = {
    info: 'i',
    success: '✓',
    warning: '!',
    error: '×',
};

export const Alert: Component<AlertProps> = (props,) => {
    const tone = () => props.tone ?? 'info';
    return (
        <div class={`ui-alert ui-alert--${tone()}`} role={tone() === 'error' || tone() === 'warning' ? 'alert' : 'status'}>
            <span class="ui-alert__icon" aria-hidden="true">
                {props.icon ?? DEFAULT_ICONS[tone()]}
            </span>
            <div class="ui-alert__body">
                {props.title && <p class="ui-alert__title">{props.title}</p>}
                <div class="ui-alert__content">{props.children}</div>
            </div>
        </div>
    );
};

export default Alert;
