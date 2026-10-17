/**
 * A text input / textarea that keeps a LOCAL draft and lifts it only on blur
 * or Enter (the admin rule: never per keystroke). An outside change is
 * synced in unless the field has focus.
 */
import { createEffect, createSignal, } from 'solid-js';

export interface CommitInputProps {
    value: string;
    onCommit: (v: string,) => void;
    placeholder?: string;
    multiline?: boolean;
    rows?: number;
    type?: 'text' | 'number' | 'url';
    id?: string;
    /** Id of a `<datalist>` of suggestions (single-line only). */
    list?: string;
}

export default function CommitInput(p: CommitInputProps,) {
    const [local, setLocal,] = createSignal(p.value,);
    let el: HTMLInputElement | HTMLTextAreaElement | undefined;
    createEffect(() => {
        const v = p.value;
        if (document.activeElement !== el) setLocal(v,);
    },);
    const commit = () => { if (local() !== p.value) p.onCommit(local(),); };
    return p.multiline
        ? (
            <textarea
                id={p.id}
                ref={(x,) => (el = x)}
                rows={p.rows ?? 3}
                value={local()}
                placeholder={p.placeholder}
                onInput={(e,) => setLocal(e.currentTarget.value,)}
                onBlur={commit}
            />
        )
        : (
            <input
                id={p.id}
                ref={(x,) => (el = x)}
                type={p.type ?? 'text'}
                list={p.list}
                value={local()}
                placeholder={p.placeholder}
                onInput={(e,) => setLocal(e.currentTarget.value,)}
                onBlur={commit}
                onKeyDown={(e,) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            />
        );
}
