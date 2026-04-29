import { Component, For, JSX, } from 'solid-js';
import './Tabs.scss';

export interface TabItem<T extends string = string,> {
    value: T;
    label: string;
    icon?: JSX.Element;
}

export interface TabsProps<T extends string = string,> {
    items: TabItem<T>[];
    value: T;
    onChange: (value: T,) => void;
    size?: 'sm' | 'md';
}

export function Tabs<T extends string = string,>(props: TabsProps<T>,): ReturnType<Component> {
    return (
        <div class={`ui-tabs ui-tabs--${props.size ?? 'md'}`} role="tablist">
            <For each={props.items}>
                {(item,) => (
                    <button
                        type="button"
                        role="tab"
                        aria-selected={item.value === props.value}
                        class={`ui-tabs__item ${item.value === props.value ? 'is-active' : ''}`}
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
