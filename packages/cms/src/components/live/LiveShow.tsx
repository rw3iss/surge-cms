/**
 * The PUBLIC body of a live post (`getPostType(post.postType).display ===
 * 'live'`): a 16:9 stage, reactions and a chat panel, driven by the live room
 * WebSocket (`services/liveRoom.ts`).
 *
 * The stream itself is a STUB — no provider is connected yet, so the stage is
 * a placeholder carrying the room's status overlay (not started / LIVE /
 * paused / muted / ended).
 *
 * An ended show has no room, so it never connects: it shows when the show
 * ended (and that a recording is coming when the post archives video). The
 * connection is keyed on the signed-in user, so logging in from "Log in to
 * chat" reconnects with a ticket for that user.
 */
import {
    LIVE_REACTIONS,
    type LiveChatMessage,
    type LivePostSettings,
    type LiveRoomState,
    type LiveServerEvent,
    type Post,
} from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createEffect, createSignal, For, Match, on, onCleanup, Show, Switch, } from 'solid-js';
import { connectLiveRoom, type LiveRoomConnection, type LiveRoomStatus, } from '../../services/liveRoom';
import { useAuth, } from '../../stores/auth';
import LoginModal from '../auth/LoginModal';
import { MEMBERSHIP_TAB_URL, } from '../content/UpgradeTout';
import './LiveShow.scss';

export interface LiveShowProps {
    post: Post;
}

type You = Extract<LiveServerEvent, { type: 'welcome'; }>['you'];
interface FloatingReaction {
    id: number;
    emoji: string;
    left: number;
}

const MAX_MESSAGES = 300;
const MAX_FLOATS = 30;
const FLOAT_MS = 2600;
const TOAST_MS = 4000;
const CHAT_MAX_LENGTH = 500;
/** Errors that belong to the chat panel rather than the stage. */
const CHAT_ERRORS = new Set(['chat_off', 'chat_restricted', 'rate_limited',],);

function formatEndedDate(value: Date | string | null | undefined,): string {
    const d = value ? new Date(value,) : new Date();
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', },);
}

function formatTime(at: string,): string {
    const d = new Date(at,);
    return Number.isNaN(d.getTime(),) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', },);
}

const LiveShow: Component<LiveShowProps> = (props,) => {
    const auth = useAuth();
    const settings = () => (props.post.typeSettings ?? {}) as Partial<LivePostSettings>;

    const [ended, setEnded,] = createSignal(!!props.post.liveEndedAt,);
    const [endedAt, setEndedAt,] = createSignal<Date | string | null>(props.post.liveEndedAt ?? null,);
    const [room, setRoom,] = createSignal<LiveRoomState | null>(null,);
    const [you, setYou,] = createSignal<You | null>(null,);
    const [messages, setMessages,] = createSignal<LiveChatMessage[]>([],);
    const [connStatus, setConnStatus,] = createSignal<LiveRoomStatus>('connecting',);
    const [floats, setFloats,] = createSignal<FloatingReaction[]>([],);
    const [chatError, setChatError,] = createSignal<string | null>(null,);
    const [toast, setToast,] = createSignal<string | null>(null,);
    /** The server refused our chat because the room is subscribers-only. */
    const [restricted, setRestricted,] = createSignal(false,);
    const [draft, setDraft,] = createSignal('',);
    const [loginOpen, setLoginOpen,] = createSignal(false,);

    let conn: LiveRoomConnection | null = null;
    let listEl: HTMLDivElement | undefined;
    let floatSeq = 0;
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    const floatTimers = new Set<ReturnType<typeof setTimeout>>();

    const showToast = (text: string,) => {
        setToast(text,);
        clearTimeout(toastTimer,);
        toastTimer = setTimeout(() => setToast(null,), TOAST_MS,);
    };

    const markEnded = (state?: LiveRoomState,) => {
        if (state) setRoom(state,);
        setEndedAt(state?.endedAt ?? endedAt() ?? new Date().toISOString(),);
        setEnded(true,);
    };

    const scrollChatToEnd = () => {
        const el = listEl;
        if (!el) return;
        // Only follow when the reader is already at (or near) the bottom.
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
            queueMicrotask(() => {
                el.scrollTop = el.scrollHeight;
            },);
        }
    };

    const addFloat = (emoji: string,) => {
        const f: FloatingReaction = { id: ++floatSeq, emoji, left: 8 + Math.random() * 84, };
        setFloats((prev,) => [...prev.slice(-(MAX_FLOATS - 1),), f,],);
        const t = setTimeout(() => {
            floatTimers.delete(t,);
            setFloats((prev,) => prev.filter((x,) => x.id !== f.id),);
        }, FLOAT_MS,);
        floatTimers.add(t,);
    };

    const onEvent = (e: LiveServerEvent,) => {
        switch (e.type) {
            case 'welcome':
                setRoom(e.state,);
                setYou(e.you,);
                setMessages(e.history.slice(-MAX_MESSAGES,),);
                setRestricted(e.state.chatMode === 'subscribers' && !e.you.canChat && !e.you.isHost,);
                if (e.state.status === 'ended') markEnded(e.state,);
                scrollChatToEnd();
                break;
            case 'state':
                setRoom(e.state,);
                if (e.state.status === 'ended') markEnded(e.state,);
                break;
            case 'chat':
                setMessages((prev,) => [...prev.slice(-(MAX_MESSAGES - 1),), e.message,],);
                scrollChatToEnd();
                break;
            case 'chat_deleted':
                setMessages((prev,) => prev.filter((m,) => m.id !== e.id),);
                break;
            case 'reaction':
                addFloat(e.emoji,);
                break;
            case 'viewers':
                setRoom((r,) => (r ? { ...r, viewers: e.count, } : r),);
                break;
            case 'ended':
                markEnded(e.state,);
                break;
            case 'error':
                if (e.code === 'ended') {
                    markEnded();
                } else if (e.code === 'chat_restricted') {
                    setRestricted(true,);
                    setChatError(e.message,);
                } else if (CHAT_ERRORS.has(e.code,) || e.command === 'chat') {
                    setChatError(e.message,);
                } else {
                    showToast(e.message,);
                }
                break;
            default:
                break;
        }
    };

    // One connection per (not ended, viewer). Re-runs on login/logout; the
    // cleanup closes the socket on change AND on unmount.
    createEffect(on(
        () => [ended(), auth.user?.id ?? null,] as const,
        ([isEnded,],) => {
            if (isEnded) return;
            setRestricted(false,);
            const c = connectLiveRoom(props.post.id, { onEvent, onStatus: setConnStatus, },);
            conn = c;
            onCleanup(() => {
                c.close();
                if (conn === c) conn = null;
            },);
        },
    ),);

    onCleanup(() => {
        clearTimeout(toastTimer,);
        for (const t of floatTimers) clearTimeout(t,);
        floatTimers.clear();
    },);

    const status = () => room()?.status;
    const reactionsOn = () => !!room()?.reactionsEnabled && status() === 'live';
    const archive = () => room()?.archiveVideo ?? settings().archiveVideo ?? true;

    /** Why chat is disabled right now, or null when the viewer may chat. */
    const chatBlock = (): { kind: 'text' | 'login' | 'upgrade'; text: string; } | null => {
        const r = room();
        if (!r) return { kind: 'text', text: connStatus() === 'reconnecting' ? 'Reconnecting…' : 'Connecting…', };
        if (r.chatMode === 'off') return { kind: 'text', text: 'Chat is off.', };
        if (you()?.isHost) return null;
        if (!auth.isAuthenticated) {
            return { kind: 'login', text: r.chatMode === 'public' ? 'Log in to chat' : 'Chat is for members. Log in to chat', };
        }
        if (r.chatMode === 'subscribers' && restricted()) return { kind: 'upgrade', text: 'Chat is for subscribers only.', };
        return null;
    };

    const sendChat = (e?: Event,) => {
        e?.preventDefault();
        const text = draft().trim();
        if (!text || chatBlock() || !conn) return;
        setChatError(null,);
        conn.send({ type: 'chat', text: text.slice(0, CHAT_MAX_LENGTH,), },);
        setDraft('',);
    };

    const react = (emoji: string,) => {
        if (!reactionsOn() || !conn) return;
        conn.send({ type: 'react', emoji, },);
    };

    return (
        <Show
            when={!ended()}
            fallback={
                <section class="live-show live-show--ended">
                    <div class="live-show__stage live-show__stage--ended">
                        <div class="live-show__placeholder">
                            <p class="live-show__ended-title">This live show ended on {formatEndedDate(endedAt(),)}.</p>
                            <Show when={archive()}>
                                <p class="live-show__ended-sub">Recording coming soon.</p>
                            </Show>
                        </div>
                    </div>
                </section>
            }
        >
            <section class="live-show">
                <div class="live-show__main">
                    <div class="live-show__stage">
                        <div class="live-show__placeholder">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M4 5h16v14H4zM10 9l5 3-5 3z" />
                            </svg>
                            <p>Live video coming soon</p>
                        </div>

                        <div class="live-show__overlay">
                            <Switch fallback={<span class="live-show__status">Connecting…</span>}>
                                <Match when={status() === 'live'}>
                                    <span class="live-show__status live-show__status--live">
                                        <span class="live-show__dot" aria-hidden="true" />LIVE
                                    </span>
                                </Match>
                                <Match when={status() === 'paused'}>
                                    <span class="live-show__status">Paused</span>
                                </Match>
                                <Match when={status() === 'idle'}>
                                    <span class="live-show__status">Not started yet</span>
                                </Match>
                            </Switch>
                            <Show when={room()?.muted && (status() === 'live' || status() === 'paused')}>
                                <span class="live-show__status live-show__status--muted">Stream muted</span>
                            </Show>
                            <Show when={room()}>
                                <span class="live-show__viewers" title="Watching now">
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                                        <circle cx="12" cy="12" r="3" />
                                    </svg>
                                    {room()!.viewers}
                                </span>
                            </Show>
                        </div>

                        <Show when={status() === 'paused'}>
                            <div class="live-show__paused">
                                <p>The show is paused. It will resume shortly.</p>
                            </div>
                        </Show>

                        <Show when={connStatus() === 'reconnecting'}>
                            <span class="live-show__conn">Reconnecting…</span>
                        </Show>

                        <div class="live-show__floats" aria-hidden="true">
                            <For each={floats()}>
                                {(f,) => <span class="live-show__float" style={{ left: `${f.left}%`, }}>{f.emoji}</span>}
                            </For>
                        </div>

                        <Show when={toast()}>
                            <div class="live-show__toast" role="status">{toast()}</div>
                        </Show>
                    </div>

                    <Show when={room()?.reactionsEnabled}>
                        <div class="live-show__reactions" role="group" aria-label="Reactions">
                            <For each={[...LIVE_REACTIONS,]}>
                                {(emoji,) => (
                                    <button
                                        type="button"
                                        class="live-show__reaction"
                                        disabled={!reactionsOn()}
                                        title={reactionsOn() ? `React ${emoji}` : 'Reactions open when the show is live'}
                                        onClick={() => react(emoji,)}
                                    >
                                        {emoji}
                                    </button>
                                )}
                            </For>
                        </div>
                    </Show>
                </div>

                <aside class="live-show__chat" aria-label="Live chat">
                    <header class="live-show__chat-head">
                        <span>Live chat</span>
                        <Show when={room() && room()!.chatMode !== 'public' && room()!.chatMode !== 'off'}>
                            <span class="live-show__chat-mode">
                                {room()!.chatMode === 'members' ? 'Members' : 'Subscribers'}
                            </span>
                        </Show>
                    </header>

                    <div class="live-show__messages" ref={listEl} aria-live="polite">
                        <Show when={messages().length} fallback={<p class="live-show__empty">No messages yet.</p>}>
                            <For each={messages()}>
                                {(m,) => (
                                    <div class="live-show__message">
                                        <span class="live-show__message-name">{m.name}</span>
                                        <span class="live-show__message-time">{formatTime(m.at,)}</span>
                                        {/* Text node, never innerHTML: chat is visitor-supplied. */}
                                        <p class="live-show__message-text">{m.text}</p>
                                    </div>
                                )}
                            </For>
                        </Show>
                    </div>

                    <Show when={chatError()}>
                        <p class="live-show__chat-error" role="alert">
                            {chatError()}
                            <button type="button" aria-label="Dismiss" onClick={() => setChatError(null,)}>×</button>
                        </p>
                    </Show>

                    <Switch>
                        <Match when={chatBlock()?.kind === 'login'}>
                            <div class="live-show__chat-gate">
                                <button type="button" class="btn live-show__chat-login" onClick={() => setLoginOpen(true,)}>
                                    {chatBlock()!.text}
                                </button>
                            </div>
                        </Match>
                        <Match when={chatBlock()?.kind === 'upgrade'}>
                            <div class="live-show__chat-gate live-show__chat-gate--upgrade">
                                <span>{chatBlock()!.text}</span>
                                <A href={MEMBERSHIP_TAB_URL}>Upgrade account</A>
                            </div>
                        </Match>
                        <Match when={true}>
                            <form class="live-show__chat-form" onSubmit={sendChat}>
                                <input
                                    type="text"
                                    class="live-show__chat-input"
                                    maxLength={CHAT_MAX_LENGTH}
                                    placeholder={chatBlock()?.text ?? 'Say something…'}
                                    aria-label="Chat message"
                                    disabled={!!chatBlock()}
                                    value={draft()}
                                    // A chat box is a genuine type-then-send field: the
                                    // draft is its own state, sent on submit.
                                    onInput={(e,) => setDraft(e.currentTarget.value,)}
                                />
                                <button
                                    type="submit"
                                    class="btn live-show__chat-send"
                                    disabled={!!chatBlock() || !draft().trim()}
                                    title={chatBlock()?.text}
                                >
                                    Send
                                </button>
                            </form>
                        </Match>
                    </Switch>
                </aside>

                <Show when={loginOpen()}>
                    <LoginModal title="Log in to chat" onClose={() => setLoginOpen(false,)} />
                </Show>
            </section>
        </Show>
    );
};

export default LiveShow;
