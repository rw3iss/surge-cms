/**
 * The Forum widget's writing box, in two looks:
 *   inline  one rounded chat-style input + a send button. Enter sends,
 *           Shift+Enter is a new line; the box grows with the text.
 *   form    optional title + a Markdown textarea + Post / Cancel.
 * A guest (anonymous posting allowed) also gets an optional name field and
 * the hidden `website` honeypot. Posting itself is the caller's
 * `onSubmit` — new threads and replies share this one box. A thrown error is
 * shown under the box; the text is kept so nothing typed is lost.
 */
import { Component, createEffect, createSignal, on, onMount, Show, } from 'solid-js';
import { errorText, } from '../discussions/CommentComposer';

export interface ForumComposerInput {
    title?: string;
    body: string;
    guestName?: string;
    website?: string;
}

export interface ForumComposerProps {
    variant: 'inline' | 'form';
    /** Form only: ask for a title. */
    withTitle?: boolean;
    placeholder?: string;
    submitLabel?: string;
    maxLength?: number;
    /** Show the guest name field + honeypot. */
    guest?: boolean;
    autofocus?: boolean;
    /** Focus the box whenever this value changes (e.g. "reply to this message"). */
    focusKey?: () => unknown;
    /** Read-only (admin preview). */
    disabled?: boolean;
    disabledHint?: string;
    /** Small chip above the box ("Replying to Sam ×"). */
    context?: string | null;
    onClearContext?: () => void;
    onCancel?: () => void;
    onSubmit: (input: ForumComposerInput,) => Promise<void>;
    class?: string;
}

const SendIcon = () => (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10.2 15 12 3.4 13.8z" />
    </svg>
);

const ForumComposer: Component<ForumComposerProps> = (props,) => {
    const [title, setTitle,] = createSignal('',);
    const [body, setBody,] = createSignal('',);
    const [guestName, setGuestName,] = createSignal('',);
    const [website, setWebsite,] = createSignal('',);
    const [busy, setBusy,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    let input: HTMLTextAreaElement | undefined;

    const max = () => props.maxLength ?? 10_000;
    const ready = () => !busy() && !props.disabled && body().trim() !== '' && (!props.withTitle || title().trim() !== '');

    /** Inline: grow with the text up to ~6 lines, then scroll. */
    const grow = () => {
        if (!input || props.variant !== 'inline') return;
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 160,)}px`;
    };

    onMount(() => {
        if (props.autofocus && input && !props.disabled) input.focus({ preventScroll: true, },);
    },);

    createEffect(on(() => props.focusKey?.(), (k,) => {
        if (k && input && !props.disabled) input.focus({ preventScroll: true, },);
    }, { defer: true, },),);

    const submit = async (e?: Event,) => {
        e?.preventDefault();
        if (!ready()) return;
        setBusy(true,);
        setError('',);
        try {
            await props.onSubmit({
                ...(props.withTitle ? { title: title().trim(), } : {}),
                body: body(),
                ...(props.guest ? { guestName: guestName().trim() || undefined, website: website(), } : {}),
            },);
            setBody('',);
            setTitle('',);
            requestAnimationFrame(grow,);
        } catch (err) {
            setError(errorText(err,),);
        } finally {
            setBusy(false,);
        }
    };

    const onKeyDown = (e: KeyboardEvent,) => {
        if (e.key === 'Escape' && props.onCancel && !body().trim()) {
            props.onCancel();
            return;
        }
        if (props.variant !== 'inline' || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
        e.preventDefault();
        void submit();
    };

    return (
        <form
            class={`forum-composer forum-composer--${props.variant}${props.class ? ` ${props.class}` : ''}`}
            classList={{ 'is-disabled': Boolean(props.disabled,), }}
            onSubmit={submit}
        >
            <Show when={props.context}>
                <div class="forum-composer__context">
                    <span>{props.context}</span>
                    <Show when={props.onClearContext}>
                        <button type="button" class="forum-composer__context-x" aria-label="Cancel reply" onClick={() => props.onClearContext?.()}>×</button>
                    </Show>
                </div>
            </Show>
            <Show when={props.guest}>
                <div class="forum-composer__guest">
                    <input
                        type="text"
                        class="forum-composer__field"
                        placeholder="Your name (optional)"
                        maxLength={80}
                        value={guestName()}
                        disabled={props.disabled}
                        onInput={(e,) => setGuestName(e.currentTarget.value,)}
                        aria-label="Your name"
                    />
                    {/* Honeypot: hidden from people, filled in by bots. */}
                    <input
                        class="forum-composer__hp"
                        type="text"
                        name="website"
                        tabindex="-1"
                        autocomplete="off"
                        aria-hidden="true"
                        value={website()}
                        onInput={(e,) => setWebsite(e.currentTarget.value,)}
                    />
                </div>
            </Show>
            <Show when={props.variant === 'form' && props.withTitle}>
                <input
                    type="text"
                    class="forum-composer__field forum-composer__title"
                    placeholder="Title"
                    maxLength={200}
                    value={title()}
                    disabled={props.disabled}
                    onInput={(e,) => setTitle(e.currentTarget.value,)}
                    aria-label="Title"
                />
            </Show>
            <div class="forum-composer__box">
                <textarea
                    ref={input}
                    class="forum-composer__input"
                    rows={props.variant === 'inline' ? 1 : 4}
                    value={body()}
                    maxLength={max()}
                    disabled={props.disabled}
                    placeholder={props.disabled ? (props.disabledHint ?? props.placeholder) : props.placeholder}
                    aria-label={props.placeholder || 'Message'}
                    onInput={(e,) => {
                        setBody(e.currentTarget.value,);
                        grow();
                    }}
                    onKeyDown={onKeyDown}
                />
                <Show when={props.variant === 'inline'}>
                    <button type="submit" class="forum-composer__send" disabled={!ready()} aria-label={props.submitLabel ?? 'Send'} title={props.submitLabel ?? 'Send'}>
                        <Show when={!busy()} fallback={<span class="forum-composer__spinner" aria-hidden="true" />}>
                            <SendIcon />
                        </Show>
                    </button>
                </Show>
            </div>
            <Show when={error()}>
                <p class="forum-composer__error" role="alert">{error()}</p>
            </Show>
            <Show when={props.variant === 'form'}>
                <div class="forum-composer__actions">
                    <span class="forum-composer__hint">Markdown supported{body().length > max() * 0.9 ? ` · ${body().length}/${max()}` : ''}</span>
                    <Show when={props.onCancel}>
                        <button type="button" class="forum-composer__btn forum-composer__btn--ghost" onClick={() => props.onCancel?.()}>Cancel</button>
                    </Show>
                    <button type="submit" class="forum-composer__btn" disabled={!ready()}>
                        {busy() ? 'Posting…' : (props.submitLabel ?? 'Post')}
                    </button>
                </div>
            </Show>
        </form>
    );
};

export default ForumComposer;
