/**
 * Write a comment or reply: Markdown textarea with a Preview tab.
 *
 * Signed out: a "Log in to comment" button (opens the in-page LoginModal), or —
 * where the item allows anonymous comments — name/email fields plus a hidden
 * honeypot. Shared by Comments and the Forum (`target` is any `type:id`).
 */
import type { Comment, CommentTargetRef, } from '@sitesurge/types';
import { renderMarkdown, } from '@sitesurge/types';
import { Component, createSignal, Show, } from 'solid-js';
import LoginModal from '../auth/LoginModal';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import './discussions.scss';

export interface CommentComposerProps {
    target: CommentTargetRef;
    parentId?: string | null;
    allowAnonymous?: boolean;
    placeholder?: string;
    submitLabel?: string;
    /** Max characters (engine setting). */
    maxLength?: number;
    autofocus?: boolean;
    onPosted?: (c: Comment,) => void;
    onCancel?: () => void;
    /** Called after an in-page login (reload anything viewer-specific). */
    onLoggedIn?: () => void;
}

/** A thrown client error → a short sentence for the form. */
export function errorText(e: unknown, fallback = 'Something went wrong. Please try again.',): string {
    const m = (e as { message?: string; })?.message;
    return m && !/^(Request failed|HTTP \d+)/.test(m,) ? m : fallback;
}

const CommentComposer: Component<CommentComposerProps> = (props,) => {
    const auth = useAuth();
    const [body, setBody,] = createSignal('',);
    const [tab, setTab,] = createSignal<'write' | 'preview'>('write',);
    const [guestName, setGuestName,] = createSignal('',);
    const [guestEmail, setGuestEmail,] = createSignal('',);
    const [website, setWebsite,] = createSignal('',);
    const [busy, setBusy,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [notice, setNotice,] = createSignal('',);
    const [loginOpen, setLoginOpen,] = createSignal(false,);

    const signedIn = () => auth.isAuthenticated;
    const canWrite = () => signedIn() || Boolean(props.allowAnonymous,);
    const max = () => props.maxLength ?? 10_000;

    const submit = async (e: Event,) => {
        e.preventDefault();
        if (busy() || !body().trim()) return;
        setBusy(true,);
        setError('',);
        setNotice('',);
        try {
            const c = await cms.discussions.create({
                target: props.target,
                parentId: props.parentId ?? null,
                body: body(),
                ...(signedIn() ? {} : { guestName: guestName().trim() || undefined, guestEmail: guestEmail().trim() || undefined, website: website(), }),
            },);
            setBody('',);
            setTab('write',);
            if (c.status === 'pending') setNotice('Thanks! Your comment will appear once it is approved.',);
            props.onPosted?.(c,);
        } catch (err) {
            setError(errorText(err,),);
        } finally {
            setBusy(false,);
        }
    };

    return (
        <div class="comment-composer">
            <Show
                when={canWrite()}
                fallback={
                    <div class="comment-composer__signin">
                        <button type="button" class="btn btn--primary" onClick={() => setLoginOpen(true,)}>Log in to comment</button>
                    </div>
                }
            >
                <form class="comment-composer__form" onSubmit={submit}>
                    <div class="comment-composer__tabs" role="tablist">
                        <button type="button" role="tab" aria-selected={tab() === 'write'} classList={{ 'is-active': tab() === 'write', }} onClick={() => setTab('write',)}>
                            Write
                        </button>
                        <button type="button" role="tab" aria-selected={tab() === 'preview'} classList={{ 'is-active': tab() === 'preview', }} onClick={() => setTab('preview',)}>
                            Preview
                        </button>
                    </div>
                    <Show
                        when={tab() === 'write'}
                        fallback={
                            <div class="comment-composer__preview rich-text" innerHTML={renderMarkdown(body(),) || '<p class="comment-composer__empty">Nothing to preview.</p>'} />
                        }
                    >
                        <textarea
                            class="comment-composer__input"
                            value={body()}
                            onInput={(e,) => setBody(e.currentTarget.value,)}
                            placeholder={props.placeholder ?? 'Write a comment… (Markdown supported)'}
                            maxLength={max()}
                            rows={props.parentId ? 3 : 4}
                            autofocus={props.autofocus}
                            aria-label={props.parentId ? 'Reply' : 'Comment'}
                        />
                    </Show>
                    <Show when={!signedIn()}>
                        <div class="comment-composer__guest">
                            <input
                                type="text"
                                placeholder="Your name (optional)"
                                maxLength={80}
                                value={guestName()}
                                onInput={(e,) => setGuestName(e.currentTarget.value,)}
                                aria-label="Your name"
                            />
                            <input
                                type="email"
                                placeholder="Email (optional, never shown)"
                                maxLength={255}
                                value={guestEmail()}
                                onInput={(e,) => setGuestEmail(e.currentTarget.value,)}
                                aria-label="Email"
                            />
                            {/* Honeypot: hidden from people, filled in by bots. */}
                            <input
                                class="comment-composer__hp"
                                type="text"
                                name="website"
                                tabindex="-1"
                                autocomplete="off"
                                aria-hidden="true"
                                value={website()}
                                onInput={(e,) => setWebsite(e.currentTarget.value,)}
                            />
                            <button type="button" class="comment-composer__login" onClick={() => setLoginOpen(true,)}>
                                or log in
                            </button>
                        </div>
                    </Show>
                    <Show when={error()}>
                        <p class="comment-composer__error" role="alert">{error()}</p>
                    </Show>
                    <div class="comment-composer__actions">
                        <span class="comment-composer__count">{body().length > max() * 0.9 ? `${body().length}/${max()}` : ''}</span>
                        <Show when={props.onCancel}>
                            <button type="button" class="btn btn--outline btn--sm" onClick={() => props.onCancel?.()}>Cancel</button>
                        </Show>
                        <button type="submit" class="btn btn--primary btn--sm" disabled={busy() || !body().trim()}>
                            {busy() ? 'Posting…' : (props.submitLabel ?? (props.parentId ? 'Reply' : 'Post comment'))}
                        </button>
                    </div>
                </form>
            </Show>
            <Show when={notice()}>
                <p class="comment-composer__notice" role="status">{notice()}</p>
            </Show>
            <Show when={loginOpen()}>
                <LoginModal
                    title="Log in to comment"
                    onClose={() => setLoginOpen(false,)}
                    onSuccess={() => props.onLoggedIn?.()}
                />
            </Show>
        </div>
    );
};

export default CommentComposer;
