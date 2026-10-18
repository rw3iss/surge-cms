/**
 * The live chat panel — ONE component for the public live show
 * (`components/live/LiveShow`, `variant="public"`) and the admin live console
 * (`components/admin/posts/types/live`, `variant="host"`). The parent owns the
 * room socket and the message list; this renders it and sends commands back
 * through `props.send`.
 *
 *   - Messages: name (linked to `/members/<handle>` on the public variant),
 *     a "Staff" badge for staff roles, time, text with `@mentions` highlighted;
 *     a message that mentions the reader is highlighted as a whole.
 *   - Reply: quotes the original above the text; clicking the quote scrolls
 *     to it while it is still in the list. Sends `chat` with `replyTo`.
 *   - Reactions: counts as pills under the message + a picker of
 *     `LIVE_REACTIONS`; sends `react_message` (the server toggles and answers
 *     with `chat_reactions`). Signed-in only.
 *   - Composer: Enter sends, Shift+Enter is a new line, `@` autocompletes from
 *     the chat's authors + `mentionCandidates`.
 *   - Disabled states: `props.block` (sign in / chat off / subscribers only /
 *     removed), and the reader's own moderation (`me.moderation`: muted, or
 *     silenced with a live countdown) — moderation wins.
 *
 * Chat text is visitor-supplied: it is rendered as text nodes, never HTML.
 */
import {
    isStaffRole,
    LIVE_REACTIONS,
    type LiveChatMessage,
    type LiveClientCommand,
    type LiveModerationState,
} from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { type Component, createEffect, createMemo, createSignal, For, type JSX, Match, on, onCleanup, onMount, Show, Switch, } from 'solid-js';
import {
    collectCandidates,
    insertMention,
    matchCandidates,
    type MentionCandidate,
    type MentionQuery,
    mentionQueryAt,
    mentionsMe,
    mentionToken,
    parseMentions,
} from './mentions';
import type { DistributiveOmit, } from '../../../services/liveRoom';
import './LiveChat.scss';

/** Commands this panel sends (the connection adds the ticket). */
export type LiveChatCommand = DistributiveOmit<
    Extract<LiveClientCommand, { type: 'chat' | 'react_message' | 'delete_message'; }>,
    'token'
>;

export interface LiveChatMe {
    userId: string | null;
    name: string | null;
    handle?: string | null;
    isHost?: boolean;
    canModerate?: boolean;
    moderation?: LiveModerationState | null;
}

/** Why the composer is unavailable (null = may chat). */
export type LiveChatBlock =
    | { kind: 'text'; text: string; }
    | { kind: 'login'; text: string; }
    | { kind: 'upgrade'; text: string; href: string; }
    | { kind: 'removed'; text: string; }
    | null;

export interface LiveChatProps {
    variant: 'public' | 'host';
    messages: readonly LiveChatMessage[];
    me: LiveChatMe | null;
    /** Signed in (reactions on messages need an account). */
    signedIn: boolean;
    block: LiveChatBlock;
    send: (cmd: LiveChatCommand,) => void;
    /** Last chat error from the server (rate limit, …). */
    error?: string | null;
    onDismissError?: () => void;
    /** `block.kind === 'login'` button. */
    onLogin?: () => void;
    /** Extra @mention candidates (the host variant passes the viewer list). */
    mentionCandidates?: readonly MentionCandidate[];
    /** Header title (default "Live chat"). */
    title?: JSX.Element;
    /** Extra header content (right side). */
    headerExtra?: JSX.Element;
    class?: string;
}

export const CHAT_MAX_LENGTH = 500;
const COUNTER_FROM = 400;
const EXCERPT = 90;
/** How close to the bottom still counts as "at the bottom", px. */
const BOTTOM_SLACK = 80;

function formatTime(at: string,): string {
    const d = new Date(at,);
    return Number.isNaN(d.getTime(),) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', },);
}

function excerpt(text: string, n = EXCERPT,): string {
    const t = text.replace(/\s+/g, ' ',).trim();
    return t.length > n ? `${t.slice(0, n - 1,)}…` : t;
}

function formatRemaining(ms: number,): string {
    const s = Math.max(0, Math.ceil(ms / 1000,),);
    const h = Math.floor(s / 3600,);
    const m = Math.floor((s % 3600) / 60,);
    const sec = s % 60;
    const mm = String(m,).padStart(h ? 2 : 1, '0',);
    return h ? `${h}:${mm}:${String(sec,).padStart(2, '0',)}` : `${mm}:${String(sec,).padStart(2, '0',)}`;
}

const LiveChat: Component<LiveChatProps> = (props,) => {
    const [draft, setDraft,] = createSignal('',);
    const [replyTo, setReplyTo,] = createSignal<LiveChatMessage | null>(null,);
    const [pickerFor, setPickerFor,] = createSignal<string | null>(null,);
    const [atBottom, setAtBottom,] = createSignal(true,);
    const [unseen, setUnseen,] = createSignal(false,);
    const [mq, setMq,] = createSignal<MentionQuery | null>(null,);
    const [mqIndex, setMqIndex,] = createSignal(0,);
    const [now, setNow,] = createSignal(Date.now(),);
    const [flash, setFlash,] = createSignal<string | null>(null,);

    let listEl: HTMLDivElement | undefined;
    let inputEl: HTMLTextAreaElement | undefined;
    let flashTimer: ReturnType<typeof setTimeout> | undefined;

    // ─── Moderation state (own) ───
    const silencedUntilMs = () => {
        const until = props.me?.moderation?.silencedUntil;
        const t = until ? new Date(until,).getTime() : 0;
        return Number.isFinite(t,) ? t : 0;
    };
    // Tick once a second while silenced so the countdown (and its expiry) shows.
    createEffect(() => {
        const until = silencedUntilMs();
        setNow(Date.now(),);
        if (until <= Date.now()) return;
        const id = setInterval(() => {
            setNow(Date.now(),);
            if (Date.now() >= until) clearInterval(id,);
        }, 1000,);
        onCleanup(() => clearInterval(id,),);
    },);
    const silenced = () => silencedUntilMs() > now();
    const muted = () => !!props.me?.moderation?.muted;

    /** What the composer shows instead of the input, if anything. */
    const effectiveBlock = (): LiveChatBlock | { kind: 'muted' | 'silenced'; text: string; } => {
        if (props.block?.kind === 'removed') return props.block;
        if (silenced()) {
            const until = new Date(silencedUntilMs(),).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', },);
            return { kind: 'silenced', text: `You are silenced until ${until} (${formatRemaining(silencedUntilMs() - now(),)}).`, };
        }
        if (muted()) return { kind: 'muted', text: 'You are muted by a moderator.', };
        return props.block;
    };
    const canReact = () => props.signedIn && !silenced() && props.block?.kind !== 'removed';
    const canModerate = () => props.variant === 'host' || !!props.me?.canModerate;

    // ─── Scrolling ───
    const scrollToEnd = () => {
        const el = listEl;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        setAtBottom(true,);
        setUnseen(false,);
    };
    const onScroll = () => {
        const el = listEl;
        if (!el) return;
        const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK;
        setAtBottom(bottom,);
        if (bottom) setUnseen(false,);
    };
    onMount(() => queueMicrotask(scrollToEnd,),);
    createEffect(on(
        () => [props.messages.length, props.messages[props.messages.length - 1]?.id,] as const,
        (_, prev,) => {
            if (!prev) return;
            if (atBottom()) queueMicrotask(scrollToEnd,);
            else if (props.messages.length) setUnseen(true,);
        },
    ),);

    // Screen readers: the list is a `role="log"` with live announcements OFF
    // (a busy chat would read without stopping); only a NEW message that
    // @mentions this viewer is announced, through a hidden polite region.
    const [announce, setAnnounce,] = createSignal('',);
    let lastSeenId: string | undefined;
    createEffect(on(
        () => props.messages[props.messages.length - 1]?.id,
        (lastId,) => {
            const prevId = lastSeenId;
            lastSeenId = lastId;
            if (!prevId || !lastId) return;
            const from = props.messages.findIndex((m,) => m.id === prevId,);
            const fresh = from >= 0 ? props.messages.slice(from + 1,) : [];
            const me = props.me ? { name: props.me.name, handle: props.me.handle, } : null;
            const hit = [...fresh,].reverse().find((m,) => !(props.me?.userId && m.userId === props.me.userId) && mentionsMe(m.text, me,));
            if (hit) setAnnounce(`${hit.name} mentioned you: ${hit.text}`,);
        },
    ),);

    const jumpTo = (id: string,) => {
        const el = listEl?.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(id,)}"]`,);
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth', },);
        setFlash(id,);
        clearTimeout(flashTimer,);
        flashTimer = setTimeout(() => setFlash(null,), 1600,);
    };
    onCleanup(() => clearTimeout(flashTimer,),);

    // Close the reaction picker on an outside click / Escape.
    const onDocClick = (e: MouseEvent,) => {
        if (!pickerFor()) return;
        const t = e.target as HTMLElement | null;
        if (!t?.closest('.live-chat__picker, .live-chat__react-add',)) setPickerFor(null,);
    };
    const onDocKey = (e: KeyboardEvent,) => { if (e.key === 'Escape') setPickerFor(null,); };
    document.addEventListener('click', onDocClick,);
    document.addEventListener('keydown', onDocKey,);
    onCleanup(() => {
        document.removeEventListener('click', onDocClick,);
        document.removeEventListener('keydown', onDocKey,);
    },);

    // A deleted original drops the pending reply.
    createEffect(() => {
        const r = replyTo();
        if (r && !props.messages.some((m,) => m.id === r.id)) setReplyTo(null,);
    },);

    // ─── Mentions ───
    const candidates = createMemo(() => collectCandidates(props.messages, props.mentionCandidates ?? [], props.me?.userId,),);
    const suggestions = createMemo(() => {
        const q = mq();
        return q ? matchCandidates(candidates(), q.query,) : [];
    },);
    const refreshMention = () => {
        const el = inputEl;
        if (!el) return;
        const q = el.selectionStart === el.selectionEnd ? mentionQueryAt(el.value, el.selectionStart ?? el.value.length,) : null;
        setMq(q,);
        setMqIndex(0,);
    };
    const pickMention = (c: MentionCandidate,) => {
        const q = mq();
        const el = inputEl;
        if (!q || !el) return;
        const next = insertMention(draft(), q, mentionToken(c,),);
        setDraft(next.text.slice(0, CHAT_MAX_LENGTH,),);
        el.value = draft();
        el.focus();
        el.setSelectionRange(next.caret, next.caret,);
        setMq(null,);
    };

    // ─── Sending ───
    const send = () => {
        const text = draft().trim();
        if (!text || effectiveBlock()) return;
        const reply = replyTo();
        props.onDismissError?.();
        props.send(reply ? { type: 'chat', text: text.slice(0, CHAT_MAX_LENGTH,), replyTo: reply.id, } : { type: 'chat', text: text.slice(0, CHAT_MAX_LENGTH,), },);
        setDraft('',);
        setReplyTo(null,);
        setMq(null,);
        if (inputEl) inputEl.value = '';
        queueMicrotask(scrollToEnd,);
    };

    const onKeyDown = (e: KeyboardEvent,) => {
        const list = suggestions();
        if (mq() && list.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setMqIndex((i,) => (i + 1) % list.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setMqIndex((i,) => (i - 1 + list.length) % list.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(list[Math.min(mqIndex(), list.length - 1,)],); return; }
            if (e.key === 'Escape') { e.preventDefault(); setMq(null,); return; }
        }
        if (e.key === 'Escape' && replyTo()) { setReplyTo(null,); return; }
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            send();
        }
    };

    const startReply = (m: LiveChatMessage,) => {
        setReplyTo(m,);
        inputEl?.focus();
    };

    const react = (m: LiveChatMessage, emoji: string,) => {
        setPickerFor(null,);
        if (!canReact()) return;
        props.send({ type: 'react_message', id: m.id, emoji, },);
    };

    const renderText = (text: string,) => (
        <For each={parseMentions(text,)}>
            {(p,) => (p.kind === 'mention' ? <span class="live-chat__mention">{p.value}</span> : p.value)}
        </For>
    );

    const nameOf = (m: LiveChatMessage,) => (
        <Show
            when={props.variant === 'public' && m.handle}
            fallback={<span class="live-chat__name">{m.name}</span>}
        >
            <A class="live-chat__name" href={`/members/${encodeURIComponent(m.handle!,)}`}>{m.name}</A>
        </Show>
    );

    const reactionEntries = (m: LiveChatMessage,) => Object.entries(m.reactions ?? {},).filter(([, n,],) => n > 0);

    return (
        <aside class={`live-chat live-chat--${props.variant} ${props.class ?? ''}`} aria-label="Live chat">
            <header class="live-chat__head">
                <span class="live-chat__title">{props.title ?? 'Live chat'}</span>
                {props.headerExtra}
            </header>

            <div class="sr-only" aria-live="polite" aria-atomic="true">{announce()}</div>
            <div class="live-chat__body">
                <div class="live-chat__messages" ref={listEl} onScroll={onScroll} role="log" aria-live="off" aria-label="Chat messages">
                    <Show when={props.messages.length} fallback={<p class="live-chat__empty">No messages yet.</p>}>
                        <For each={props.messages}>
                            {(m,) => {
                                const mine = () => !!props.me?.userId && m.userId === props.me.userId;
                                const forMe = () => !mine() && mentionsMe(m.text, props.me ? { name: props.me.name, handle: props.me.handle, } : null,);
                                return (
                                    <div
                                        class="live-chat__message"
                                        classList={{
                                            'live-chat__message--mentions-me': forMe(),
                                            'live-chat__message--mine': mine(),
                                            'live-chat__message--flash': flash() === m.id,
                                        }}
                                        data-msg-id={m.id}
                                    >
                                        <Show when={m.replyTo}>
                                            {(r,) => (
                                                <button
                                                    type="button"
                                                    class="live-chat__quote"
                                                    title="Show the original message"
                                                    onClick={() => jumpTo(r().id,)}
                                                >
                                                    <span class="live-chat__quote-name">{r().name}</span> {excerpt(r().text,)}
                                                </button>
                                            )}
                                        </Show>
                                        <div class="live-chat__meta">
                                            {nameOf(m,)}
                                            <Show when={isStaffRole(m.role ?? undefined,)}>
                                                <span class="live-chat__staff">Staff</span>
                                            </Show>
                                            <span class="live-chat__time">{formatTime(m.at,)}</span>
                                            <span class="live-chat__actions">
                                                <Show when={!effectiveBlock()}>
                                                    <button type="button" class="live-chat__action" title="Reply" aria-label="Reply" onClick={() => startReply(m,)}>
                                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" /></svg>
                                                    </button>
                                                </Show>
                                                <Show when={canReact()}>
                                                    <button
                                                        type="button"
                                                        class="live-chat__action live-chat__react-add"
                                                        title="Add reaction"
                                                        aria-label="Add reaction"
                                                        aria-expanded={pickerFor() === m.id}
                                                        onClick={() => setPickerFor((id,) => (id === m.id ? null : m.id))}
                                                    >
                                                        <svg viewBox="0 0 24 24" aria-hidden="true">
                                                            <circle cx="12" cy="12" r="9" />
                                                            <path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8M9 9.5h.01M15 9.5h.01" />
                                                        </svg>
                                                    </button>
                                                </Show>
                                                <Show when={canModerate()}>
                                                    <button
                                                        type="button"
                                                        class="live-chat__action live-chat__action--danger"
                                                        title="Delete message"
                                                        aria-label="Delete message"
                                                        onClick={() => props.send({ type: 'delete_message', id: m.id, },)}
                                                    >
                                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                                                    </button>
                                                </Show>
                                            </span>
                                        </div>
                                        {/* Text nodes, never innerHTML: chat is visitor-supplied. */}
                                        <p class="live-chat__text">{renderText(m.text,)}</p>
                                        <Show when={pickerFor() === m.id}>
                                            <div class="live-chat__picker" role="group" aria-label="Reactions">
                                                <For each={[...LIVE_REACTIONS,]}>
                                                    {(emoji,) => (
                                                        <button type="button" class="live-chat__picker-btn" onClick={() => react(m, emoji,)}>{emoji}</button>
                                                    )}
                                                </For>
                                            </div>
                                        </Show>
                                        <Show when={reactionEntries(m,).length}>
                                            <div class="live-chat__reactions">
                                                <For each={reactionEntries(m,)}>
                                                    {([emoji, n,],) => (
                                                        <button
                                                            type="button"
                                                            class="live-chat__reaction"
                                                            disabled={!canReact()}
                                                            title={canReact() ? `React ${emoji}` : undefined}
                                                            onClick={() => react(m, emoji,)}
                                                        >
                                                            {emoji} <span>{n}</span>
                                                        </button>
                                                    )}
                                                </For>
                                            </div>
                                        </Show>
                                    </div>
                                );
                            }}
                        </For>
                    </Show>
                </div>
                <Show when={unseen() && !atBottom()}>
                    <button type="button" class="live-chat__new" onClick={scrollToEnd}>New messages ↓</button>
                </Show>
            </div>

            <Show when={props.error}>
                <p class="live-chat__error" role="alert">
                    <span>{props.error}</span>
                    <Show when={props.onDismissError}>
                        <button type="button" aria-label="Dismiss" onClick={() => props.onDismissError?.()}>×</button>
                    </Show>
                </p>
            </Show>

            <Switch>
                <Match when={effectiveBlock()?.kind === 'login'}>
                    <div class="live-chat__gate">
                        <button type="button" class="btn live-chat__login" onClick={() => props.onLogin?.()}>
                            {effectiveBlock()!.text}
                        </button>
                    </div>
                </Match>
                <Match when={effectiveBlock()?.kind === 'upgrade'}>
                    <div class="live-chat__gate live-chat__gate--upgrade">
                        <span>{effectiveBlock()!.text}</span>
                        <A href={(effectiveBlock() as { href: string; }).href}>Upgrade account</A>
                    </div>
                </Match>
                <Match when={effectiveBlock()}>
                    {(b,) => (
                        <div class={`live-chat__gate live-chat__gate--${b().kind}`} role="status">
                            <span>{b().text}</span>
                        </div>
                    )}
                </Match>
                <Match when={true}>
                    <div class="live-chat__composer">
                        <Show when={replyTo()}>
                            {(r,) => (
                                <div class="live-chat__replying">
                                    <span>
                                        Replying to <strong>{r().name}</strong>: {excerpt(r().text, 60,)}
                                    </span>
                                    <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null,)}>×</button>
                                </div>
                            )}
                        </Show>
                        <Show when={mq() && suggestions().length}>
                            <ul class="live-chat__suggest" role="listbox" aria-label="Mention">
                                <For each={suggestions()}>
                                    {(c, i,) => (
                                        <li
                                            role="option"
                                            aria-selected={i() === mqIndex()}
                                            class="live-chat__suggest-item"
                                            classList={{ 'live-chat__suggest-item--active': i() === mqIndex(), }}
                                            // mousedown, so the textarea keeps focus.
                                            onMouseDown={(e,) => { e.preventDefault(); pickMention(c,); }}
                                            onMouseEnter={() => setMqIndex(i(),)}
                                        >
                                            <span class="live-chat__suggest-name">{c.name}</span>
                                            <span class="live-chat__suggest-token">@{mentionToken(c,)}</span>
                                        </li>
                                    )}
                                </For>
                            </ul>
                        </Show>
                        <form class="live-chat__form" onSubmit={(e,) => { e.preventDefault(); send(); }}>
                            <textarea
                                ref={inputEl}
                                class="live-chat__input"
                                rows={1}
                                maxLength={CHAT_MAX_LENGTH}
                                placeholder="Say something… (@ to mention)"
                                aria-label="Chat message"
                                value={draft()}
                                // A chat box is a genuine type-then-send field: the
                                // draft is its own state, sent on submit.
                                onInput={(e,) => { setDraft(e.currentTarget.value,); refreshMention(); }}
                                onKeyDown={onKeyDown}
                                onKeyUp={(e,) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') refreshMention(); }}
                                onClick={refreshMention}
                                onBlur={() => setMq(null,)}
                            />
                            <button type="submit" class="btn live-chat__send" disabled={!draft().trim()}>Send</button>
                        </form>
                        <Show when={draft().length >= COUNTER_FROM}>
                            <span class="live-chat__count" classList={{ 'live-chat__count--max': draft().length >= CHAT_MAX_LENGTH, }}>
                                {draft().length}/{CHAT_MAX_LENGTH}
                            </span>
                        </Show>
                    </div>
                </Match>
            </Switch>
        </aside>
    );
};

export default LiveChat;
