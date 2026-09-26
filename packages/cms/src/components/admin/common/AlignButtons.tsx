/**
 * Left / centre / right as a three-button bar.
 *
 * Extracted from the page editor's title-alignment control so the social
 * block's title alignment is the same control, not a lookalike.
 */
import { Component, For, Show, } from 'solid-js';
import './AlignButtons.scss';

export type HAlign = 'left' | 'center' | 'right';

const OPTIONS: Array<{ value: HAlign; title: string; }> = [
    { value: 'left', title: 'Left', },
    { value: 'center', title: 'Center', },
    { value: 'right', title: 'Right', },
];

interface AlignButtonsProps {
    value: HAlign;
    onChange: (next: HAlign,) => void;
    disabled?: boolean;
    /** Accessible name for the group, e.g. "Title alignment". */
    label?: string;
}

const AlignButtons: Component<AlignButtonsProps> = (props,) => (
    <div
        class={`align-buttons${props.disabled ? ' align-buttons--disabled' : ''}`}
        role="group"
        aria-label={props.label ?? 'Alignment'}
    >
        <For each={OPTIONS}>
            {(a,) => (
                <button
                    type="button"
                    class={`align-buttons__btn${props.value === a.value ? ' align-buttons__btn--active' : ''}`}
                    onClick={() => props.onChange(a.value,)}
                    title={a.title}
                    aria-pressed={props.value === a.value}
                    disabled={props.disabled}
                >
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                        <rect x="1" y="2" width="14" height="2" fill="currentColor" />
                        <Show when={a.value === 'left'}>
                            <rect x="1" y="7" width="10" height="2" fill="currentColor" />
                            <rect x="1" y="12" width="12" height="2" fill="currentColor" />
                        </Show>
                        <Show when={a.value === 'center'}>
                            <rect x="3" y="7" width="10" height="2" fill="currentColor" />
                            <rect x="2" y="12" width="12" height="2" fill="currentColor" />
                        </Show>
                        <Show when={a.value === 'right'}>
                            <rect x="5" y="7" width="10" height="2" fill="currentColor" />
                            <rect x="3" y="12" width="12" height="2" fill="currentColor" />
                        </Show>
                    </svg>
                </button>
            )}
        </For>
    </div>
);

export default AlignButtons;
