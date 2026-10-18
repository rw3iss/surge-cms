/**
 * The admin's ONE "draft input that commits on blur" (CLAUDE.md → Admin styles:
 * text inputs commit on BLUR, never per keystroke).
 *
 * Keeps a LOCAL draft and lifts it via `onCommit` on blur, or Enter on a
 * single-line field (Shift+Enter / Enter in a textarea is a newline). An
 * outside change is synced in only while the field does NOT have focus, so a
 * parent re-render can never yank the caret.
 *
 * Optional:
 *  - `validate(v)` returning a message keeps the draft, shows the message under
 *    the field and does not commit;
 *  - `trim` (default true for single-line) trims before committing;
 *  - `type="number"` commits the string — parse it in `onCommit`.
 */
import { type Component, createEffect, createSignal, type JSX, Show, } from 'solid-js';
import './CommitInput.scss';

export interface CommitInputProps {
    value: string | number | null | undefined;
    onCommit: (v: string,) => void;
    validate?: (v: string,) => string | null;
    /** Called with the validation message (null = valid) on each commit attempt. */
    onError?: (msg: string | null,) => void;
    placeholder?: string;
    multiline?: boolean;
    /** Textarea only: Enter commits, Shift+Enter is a newline. */
    commitOnEnter?: boolean;
    rows?: number;
    type?: 'text' | 'number' | 'url' | 'date' | 'datetime-local' | 'email';
    id?: string;
    /** Id of a `<datalist>` of suggestions (single-line only). */
    list?: string;
    trim?: boolean;
    class?: string;
    disabled?: boolean;
    min?: number | string;
    max?: number | string;
    step?: number | string;
    'aria-label'?: string;
    style?: JSX.CSSProperties;
}

const str = (v: unknown,): string => (v == null ? '' : String(v,));

export const CommitInput: Component<CommitInputProps> = (p,) => {
    const [local, setLocal,] = createSignal(str(p.value,),);
    const [error, setError,] = createSignal<string | null>(null,);
    let el: HTMLInputElement | HTMLTextAreaElement | undefined;
    createEffect(() => {
        const v = str(p.value,);
        if (typeof document === 'undefined' || document.activeElement !== el) setLocal(v,);
    },);
    const commit = () => {
        const shouldTrim = p.trim ?? !p.multiline;
        const v = shouldTrim ? local().trim() : local();
        const err = p.validate?.(v,) ?? null;
        setError(err,);
        p.onError?.(err,);
        if (err) return;
        if (v !== str(p.value,)) p.onCommit(v,);
    };
    return (
        <>
            {p.multiline
                ? (
                    <textarea
                        id={p.id}
                        class={p.class}
                        ref={(x,) => (el = x)}
                        rows={p.rows ?? 3}
                        value={local()}
                        placeholder={p.placeholder}
                        disabled={p.disabled}
                        aria-label={p['aria-label']}
                        aria-invalid={error() ? true : undefined}
                        style={p.style}
                        onInput={(e,) => setLocal(e.currentTarget.value,)}
                        onBlur={commit}
                        onKeyDown={(e,) => {
                            if (p.commitOnEnter && e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                commit();
                            }
                        }}
                    />
                )
                : (
                    <input
                        id={p.id}
                        class={p.class}
                        ref={(x,) => (el = x)}
                        type={p.type ?? 'text'}
                        list={p.list}
                        value={local()}
                        placeholder={p.placeholder}
                        disabled={p.disabled}
                        min={p.min}
                        max={p.max}
                        step={p.step}
                        aria-label={p['aria-label']}
                        aria-invalid={error() ? true : undefined}
                        style={p.style}
                        onInput={(e,) => setLocal(e.currentTarget.value,)}
                        onBlur={commit}
                        onKeyDown={(e,) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                commit();
                            }
                        }}
                    />
                )}
            <Show when={error() && !p.onError}>
                <small class="form-help-muted form-help--error" role="alert">{error()}</small>
            </Show>
        </>
    );
};

export default CommitInput;
