import { Component, For, JSX, } from 'solid-js';
import './Tabs.scss';

export interface TabItem<T extends string = string,> {
    value: T;
    label: string;
    icon?: JSX.Element;
}

export interface TabsProps<T extends string = string,> {
    items: TabItem<T>[];
    /** Active tab. `active` is an alias for `value`; either may be used
     * (controlled). `active` wins when both are supplied. */
    value?: T;
    active?: T;
    onChange: (value: T,) => void;
    size?: 'sm' | 'md';
}

export function Tabs<T extends string = string,>(props: TabsProps<T>,): ReturnType<Component> {
    const current = () => props.active ?? props.value;
    return (
        <div class={`ui-tabs ui-tabs--${props.size ?? 'md'}`} role="tablist">
            <For each={props.items}>
                {(item,) => (
                    <button
                        type="button"
                        role="tab"
                        aria-selected={item.value === current()}
                        class={`ui-tabs__item ${item.value === current() ? 'is-active' : ''}`}
                        onClick={() => props.onChange(item.value,)}
                    >
                        {item.icon && <span class="ui-tabs__icon">{item.icon}</span>}
                        <span>{item.label}</span>
                    </button>
                )}
            </For>
        </div>
    );
}

export default Tabs;
