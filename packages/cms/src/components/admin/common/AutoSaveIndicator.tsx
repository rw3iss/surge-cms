import { Component, Show, } from 'solid-js';
import { AutoSaveStatus, } from '../../../hooks/useAutoSave';

export interface AutoSaveIndicatorProps {
    status: AutoSaveStatus;
    lastSavedAt: number | null;
}

function formatTime(ts: number,): string {
    const d = new Date(ts,);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', },);
}

const AutoSaveIndicator: Component<AutoSaveIndicatorProps> = (props,) => {
    const label = () => {
        switch (props.status) {
            case 'saving': return 'Saving draft…';
            case 'saved':
                return props.lastSavedAt ? `Draft saved ${formatTime(props.lastSavedAt,)}` : 'Draft saved';
            case 'error': return 'Draft save failed';
            default: return '';
        }
    };

    return (
        <Show when={props.status !== 'idle'}>
            <span class={`autosave-indicator autosave-indicator--${props.status}`}>
                <span class="autosave-indicator__dot" />
                {label()}
            </span>
        </Show>
    );
};

export default AutoSaveIndicator;
