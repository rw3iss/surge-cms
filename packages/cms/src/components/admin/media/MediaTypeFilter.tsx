import { Component, For, } from 'solid-js';

export type MediaKind = 'image' | 'video' | 'audio' | 'document';

/** Type filter buttons (the API's `types` list; `document` = anything else). */
export const MEDIA_KINDS: { key: MediaKind; label: string; icon: string; }[] = [
    { key: 'image', label: 'Images', icon: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1.5 1.5 0 1 0 0-.01', },
    { key: 'video', label: 'Videos', icon: 'M4 6h12v12H4zM16 10l4-2.5v9L16 14', },
    { key: 'audio', label: 'Audio', icon: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', },
    { key: 'document', label: 'Documents', icon: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6', },
];

interface MediaTypeFilterProps {
    /** Selected kinds; empty = All. */
    value: MediaKind[];
    onChange: (kinds: MediaKind[],) => void;
    /** Kinds offered (default: all four). */
    kinds?: MediaKind[];
}

/** "All / Images / Videos / …" toggle buttons; any combination may be on. Styles: `.media-type-filter` (_media.scss). */
const MediaTypeFilter: Component<MediaTypeFilterProps> = (props,) => {
    const offered = () => MEDIA_KINDS.filter((k,) => !props.kinds || props.kinds.includes(k.key,));
    const toggle = (k: MediaKind,) =>
        props.onChange(props.value.includes(k,) ? props.value.filter((x,) => x !== k) : [...props.value, k,],);
    return (
        <div class="media-type-filter" role="group" aria-label="Media types">
            <button
                type="button"
                class="media-type-filter__btn"
                classList={{ 'is-active': props.value.length === 0, }}
                aria-pressed={props.value.length === 0}
                onClick={() => props.onChange([],)}
            >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></svg>
                All
            </button>
            <For each={offered()}>
                {(k,) => (
                    <button
                        type="button"
                        class="media-type-filter__btn"
                        classList={{ 'is-active': props.value.includes(k.key,), }}
                        aria-pressed={props.value.includes(k.key,)}
                        onClick={() => toggle(k.key,)}
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={k.icon} /></svg>
                        {k.label}
                    </button>
                )}
            </For>
        </div>
    );
};

export default MediaTypeFilter;
