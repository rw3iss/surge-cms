/**
 * The live console's host connection to the room WebSocket: room state,
 * viewer count, chat history (a store, patched in place), who the console is
 * connected as, and `command()`. Connects while the post is saved, published
 * and not ended; disconnects on cleanup (its own `onCleanup`).
 */
import { createEffect, createSignal, on, onCleanup, } from 'solid-js';
import { createStore, reconcile, } from 'solid-js/store';
import type { LiveChatMessage, LiveClientCommand, LiveRoomState, LiveServerEvent, LiveStatus, } from '@sitesurge/types';
import { useToast, } from '../../../../../common/toast';
import type { LiveChatMe, } from '../../../../../live/chat/LiveChat';
import type { MentionCandidate, } from '../../../../../live/chat/mentions';
import {
    connectLiveRoom, type DistributiveOmit, type LiveRoomStatus as ConnStatus,
} from '../../../../../../services/liveRoom';

export type HostCommand = DistributiveOmit<LiveClientCommand, 'token'>;

export interface LiveRoomHostOptions {
    postId: () => string | null | undefined;
    status: () => string | undefined;
    liveEndedAt: () => string | Date | null | undefined;
}

export function useLiveRoomHost(props: LiveRoomHostOptions,) {
    const toast = useToast();
    const [room, setRoom,] = createSignal<LiveRoomState | null>(null,);
    const [conn, setConn,] = createSignal<ConnStatus>('closed',);
    const [viewers, setViewers,] = createSignal(0,);
    const [messages, setMessages,] = createStore<LiveChatMessage[]>([],);
    /** Who the console is connected as (from `welcome`) — the chat posts under this name. */
    const [chatMe, setChatMe,] = createSignal<LiveChatMe | null>(null,);
    /** Right-column panel: show settings, or the Viewers list (opened from the header count). */
    const [panel, setPanel,] = createSignal<'settings' | 'viewers'>('settings',);
    const [viewerMentions, setViewerMentions,] = createSignal<MentionCandidate[]>([],);
    const [confirmEnd, setConfirmEnd,] = createSignal(false,);
    const [endedAt, setEndedAt,] = createSignal<string | null>(null,);
    let send: ((cmd: HostCommand,) => void) | null = null;

    const ended = () => !!(props.liveEndedAt() || endedAt());
    const canHost = () => !!props.postId() && props.status() === 'published' && !ended();
    const roomStatus = (): LiveStatus => (ended() ? 'ended' : room()?.status ?? 'idle');

    const onEvent = (e: LiveServerEvent,) => {
        switch (e.type) {
            case 'welcome':
                setRoom(e.state,);
                setViewers(e.state.viewers,);
                setMessages(reconcile(e.history ?? [], { key: 'id', },),);
                setChatMe({ ...e.you, canModerate: e.you.canModerate ?? e.you.isHost, },);
                if (!e.you.isHost) toast.error('You are connected as a viewer — host controls need the posts:write permission.',);
                break;
            case 'state':
                setRoom(e.state,);
                setViewers(e.state.viewers,);
                break;
            case 'viewers':
                setViewers(e.count,);
                break;
            case 'chat':
                setMessages(messages.length, e.message,);
                break;
            case 'chat_deleted':
                setMessages(reconcile(messages.filter((m,) => m.id !== e.id), { key: 'id', },),);
                break;
            case 'chat_reactions':
                setMessages((m,) => m.id === e.id, 'reactions', e.reactions,);
                break;
            case 'ended':
                setRoom(e.state,);
                setEndedAt(e.state.endedAt ?? new Date().toISOString(),);
                break;
            case 'error':
                toast.error(e.message || `Live room error (${e.code})`,);
                break;
            default:
                break;
        }
    };

    createEffect(on(canHost, (ok,) => {
        const postId = props.postId();
        if (!ok || !postId) return;
        const handle = connectLiveRoom(postId, { onEvent, onStatus: setConn, },);
        send = handle.send;
        onCleanup(() => {
            send = null;
            handle.close();
            setConn('closed',);
        },);
    },),);

    const command = (cmd: HostCommand,) => {
        if (!send) { toast.error('Not connected to the live room.',); return; }
        send(cmd,);
    };

    return {
        room, conn, viewers, messages, chatMe, panel, setPanel, viewerMentions, setViewerMentions,
        confirmEnd, setConfirmEnd, endedAt, ended, canHost, roomStatus, command,
        isConnected: () => send !== null,
    };
}
