import { Component, } from 'solid-js';

export const JsonLd: Component<{ data: Record<string, any>; }> = (props,) => {
    return <script type="application/ld+json" innerHTML={JSON.stringify(props.data,)} />;
};
