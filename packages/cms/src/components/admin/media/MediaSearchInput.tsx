/**
 * Search box with a clear (×) button, shared by the media library and the
 * media select modal.
 *
 * This is a genuine SEARCH-AS-YOU-TYPE box, the documented exception to the
 * "commit on blur" rule: the local draft updates per keystroke and `onSearch`
 * fires after `debounce` ms of quiet (and at once on Enter / clear). The draft
 * is local, so a parent re-render never steals the caret.
 */
import { type Component, createEffect, createSignal, on, onCleanup, Show, } from 'solid-js';

export interface MediaSearchInputProps {
    /** The committed search (syncs the box when changed from outside). */
    value: string;
    onSearch: (value: string,) => void;
    placeholder?: string;
    /** ms of quiet before `onSearch` fires (default 300). */
    debounce?: number;
    class?: string;
}

const MediaSearchInput: Component<MediaSearchInputProps> = (props,) => {
    const [draft, setDraft,] = createSignal(props.value,);
    let inputEl: HTMLInputElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    createEffect(on(() => props.value, (v,) => {
        if (document.activeElement !== inputEl) setDraft(v,);
    }, { defer: true, },),);
    onCleanup(() => clearTimeout(timer,));

    const commit = (v: string,) => {
        clearTimeout(timer,);
        if (v !== props.value) props.onSearch(v,);
    };

    const onInput = (v: string,) => {
        setDraft(v,);
        clearTimeout(timer,);
        timer = setTimeout(() => commit(v,), props.debounce ?? 300,);
    };

    return (
        <div class={`media-search ${props.class ?? ''}`}>
            <input
                ref={inputEl}
                type="search"
                class="media-search__input"
                placeholder={props.placeholder ?? 'Search media...'}
                aria-label={props.placeholder ?? 'Search media'}
                value={draft()}
                onInput={(e,) => onInput(e.currentTarget.value,)}
                onKeyDown={(e,) => { if (e.key === 'Enter') commit(e.currentTarget.value,); }}
            />
            <Show when={draft()}>
                <button
                    type="button"
                    class="media-search__clear"
                    title="Clear search"
                    aria-label="Clear search"
                    onClick={() => { setDraft('',); commit('',); inputEl?.focus(); }}
                >
                    &times;
                </button>
            </Show>
        </div>
    );
};

export default MediaSearchInput;
