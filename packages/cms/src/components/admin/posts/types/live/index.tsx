/**
 * LIVE SHOW console — the Content section of a `live` post.
 *
 * Three parts:
 *   - Camera + microphone preview (local only — the stream provider is a stub
 *     until the 100ms integration lands, so nothing leaves the browser).
 *   - Show settings, stored in `typeSettings` (`LivePostSettings`).
 *   - Host controls over the live room WebSocket (`connectLiveRoom`), shown
 *     once the post is saved AND published, and never after the show ended.
 */
import {
    type Component, createEffect, createSignal, For, on, onCleanup, Show,
} from 'solid-js';
import { createStore, reconcile, } from 'solid-js/store';
import type {
    LiveChatMessage, LiveChatMode, LiveClientCommand, LivePostSettings, LiveRoomState, LiveServerEvent, LiveStatus,
} from '@sitesurge/types';
import { formatDateTime, } from '@sitesurge/types';
import ConfirmModal from '../../../common/ConfirmModal';
import Toggle from '../../../common/Toggle';
import { FormField, } from '../../../forms';
import { useToast, } from '../../../../common/toast';
import {
    connectLiveRoom, type DistributiveOmit, type LiveRoomStatus as ConnStatus,
} from '../../../../../services/liveRoom';
import type { PostTypeEditorProps, } from '../types';

type HostCommand = DistributiveOmit<LiveClientCommand, 'token'>;

const STATUS_LABEL: Record<LiveStatus, string> = {
    idle: 'Not started',
    live: 'Live',
    paused: 'Paused',
    ended: 'Ended',
};

const CHAT_OPTIONS: { value: LiveChatMode; label: string; }[] = [
    { value: 'off', label: 'Off', },
    { value: 'public', label: 'Public — anyone signed in', },
    { value: 'members', label: 'Members', },
    { value: 'subscribers', label: 'Subscribers', },
];

/** `typeSettings` with the live defaults filled in. */
function readSettings(raw: Record<string, unknown>,): LivePostSettings {
    const chat = raw.chatMode as LiveChatMode;
    return {
        archiveVideo: raw.archiveVideo !== false,
        chatMode: CHAT_OPTIONS.some((o,) => o.value === chat) ? chat : 'public',
        reactionsEnabled: raw.reactionsEnabled !== false,
        provider: (raw.provider as string | null | undefined) ?? null,
        providerRoomId: (raw.providerRoomId as string | null | undefined) ?? null,
    };
}

const LivePostEditor: Component<PostTypeEditorProps> = (props,) => {
    const toast = useToast();
    const settings = () => readSettings(props.typeSettings ?? {},);
    const patchSettings = (patch: Partial<LivePostSettings>,) =>
        props.onTypeSettingsChange({ ...(props.typeSettings ?? {}), ...patch, },);

    // ─── Camera / microphone preview ───
    let videoEl: HTMLVideoElement | undefined;
    const [stream, setStream,] = createSignal<MediaStream | null>(null,);
    const [cameras, setCameras,] = createSignal<MediaDeviceInfo[]>([],);
    const [mics, setMics,] = createSignal<MediaDeviceInfo[]>([],);
    const [cameraId, setCameraId,] = createSignal('',);
    const [micId, setMicId,] = createSignal('',);
    const [previewMuted, setPreviewMuted,] = createSignal(true,);
    const [micLevel, setMicLevel,] = createSignal(0,);
    const [mediaError, setMediaError,] = createSignal('',);
    const [starting, setStarting,] = createSignal(false,);

    let audioCtx: AudioContext | null = null;
    let meterFrame = 0;

    const stopMeter = () => {
        if (meterFrame) cancelAnimationFrame(meterFrame,);
        meterFrame = 0;
        void audioCtx?.close().catch(() => {},);
        audioCtx = null;
        setMicLevel(0,);
    };

    const stopStream = () => {
        stopMeter();
        stream()?.getTracks().forEach((t,) => t.stop());
        setStream(null,);
        if (videoEl) videoEl.srcObject = null;
    };

    const startMeter = (s: MediaStream,) => {
        stopMeter();
        if (!s.getAudioTracks().length || typeof AudioContext === 'undefined') return;
        audioCtx = new AudioContext();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        audioCtx.createMediaStreamSource(s,).connect(analyser,);
        const buf = new Uint8Array(analyser.fftSize,);
        const tick = () => {
            analyser.getByteTimeDomainData(buf,);
            let sum = 0;
            for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
            // RMS → 0..1, boosted so normal speech reads mid-scale.
            setMicLevel(Math.min(1, Math.sqrt(sum / buf.length,) * 3,),);
            meterFrame = requestAnimationFrame(tick,);
        };
        tick();
    };

    const refreshDevices = async () => {
        const all = await navigator.mediaDevices.enumerateDevices();
        setCameras(all.filter((d,) => d.kind === 'videoinput'),);
        setMics(all.filter((d,) => d.kind === 'audioinput'),);
    };

    const startCamera = async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
            setMediaError('This browser cannot open a camera (a secure https connection is required).',);
            return;
        }
        setStarting(true,);
        setMediaError('',);
        try {
            const next = await navigator.mediaDevices.getUserMedia({
                video: cameraId() ? { deviceId: { exact: cameraId(), }, } : true,
                audio: micId() ? { deviceId: { exact: micId(), }, } : true,
            },);
            stopStream();
            setStream(next,);
            if (videoEl) {
                videoEl.srcObject = next;
                videoEl.muted = previewMuted();
                void videoEl.play().catch(() => {},);
            }
            // Labels are only exposed once permission is granted.
            await refreshDevices();
            const v = next.getVideoTracks()[0]?.getSettings().deviceId;
            const a = next.getAudioTracks()[0]?.getSettings().deviceId;
            if (v) setCameraId(v,);
            if (a) setMicId(a,);
            startMeter(next,);
        } catch (err) {
            const name = (err as DOMException)?.name;
            setMediaError(
                name === 'NotAllowedError'
                    ? 'Camera or microphone access was refused. Allow it in the browser\'s site settings.'
                    : name === 'NotFoundError'
                        ? 'No camera or microphone was found.'
                        : `Could not open the camera: ${(err as Error)?.message || name || 'unknown error'}`,
            );
        } finally {
            setStarting(false,);
        }
    };

    const pickDevice = (kind: 'camera' | 'mic', id: string,) => {
        if (kind === 'camera') setCameraId(id,);
        else setMicId(id,);
        if (stream()) void startCamera();
    };

    const togglePreviewMute = () => {
        const next = !previewMuted();
        setPreviewMuted(next,);
        if (videoEl) videoEl.muted = next;
    };

    const onDeviceChange = () => { if (stream()) void refreshDevices().catch(() => {},); };
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange,);
    onCleanup(() => {
        navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange,);
        stopStream();
    },);

    // ─── Live room (host controls) ───
    const [room, setRoom,] = createSignal<LiveRoomState | null>(null,);
    const [conn, setConn,] = createSignal<ConnStatus>('closed',);
    const [viewers, setViewers,] = createSignal(0,);
    const [messages, setMessages,] = createStore<LiveChatMessage[]>([],);
    const [confirmEnd, setConfirmEnd,] = createSignal(false,);
    const [endedAt, setEndedAt,] = createSignal<string | null>(null,);
    let send: ((cmd: HostCommand,) => void) | null = null;

    const ended = () => !!(props.liveEndedAt || endedAt());
    const canHost = () => !!props.postId && props.status === 'published' && !ended();
    const roomStatus = (): LiveStatus => (ended() ? 'ended' : room()?.status ?? 'idle');

    const onEvent = (e: LiveServerEvent,) => {
        switch (e.type) {
            case 'welcome':
                setRoom(e.state,);
                setViewers(e.state.viewers,);
                setMessages(reconcile(e.history ?? [], { key: 'id', },),);
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
        if (!ok || !props.postId) return;
        const handle = connectLiveRoom(props.postId, { onEvent, onStatus: setConn, },);
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

    // A settings change while connected applies to the room at once; the
    // stored value is saved with the post as usual.
    const setChatMode = (mode: LiveChatMode,) => {
        patchSettings({ chatMode: mode, },);
        if (send) command({ type: 'chat_mode', mode, },);
    };
    const setReactions = (enabled: boolean,) => {
        patchSettings({ reactionsEnabled: enabled, },);
        if (send) command({ type: 'reactions', enabled, },);
    };

    const endShow = () => {
        setConfirmEnd(false,);
        command({ type: 'end', confirm: true, },);
    };

    const endedLabel = () => {
        const at = props.liveEndedAt || endedAt();
        return at ? `Ended ${formatDateTime(at,)}` : 'Ended';
    };

    return (
        <section class="live-console">
            <header class="live-console__header">
                <h2 class="live-console__title">Live Show</h2>
                <span class={`live-pill live-pill--${roomStatus()}`}>
                    {roomStatus() === 'ended' ? endedLabel() : STATUS_LABEL[roomStatus()]}
                </span>
                <Show when={canHost()}>
                    <span class="live-console__viewers" title="Viewers connected now">
                        {viewers()} {viewers() === 1 ? 'viewer' : 'viewers'}
                    </span>
                    <span class={`live-console__conn live-console__conn--${conn()}`}>{conn()}</span>
                </Show>
            </header>

            <div class="live-console__grid">
                {/* ─── Preview ─── */}
                <div class="live-console__preview">
                    <div class="live-console__video-wrap">
                        <video ref={videoEl} class="live-console__video" autoplay playsinline muted />
                        <Show when={!stream()}>
                            <div class="live-console__video-empty">
                                <button
                                    type="button"
                                    class="ui-button ui-button--secondary ui-button--sm"
                                    disabled={starting()}
                                    onClick={() => void startCamera()}
                                >
                                    {starting() ? 'Opening camera…' : 'Turn on camera'}
                                </button>
                            </div>
                        </Show>
                    </div>
                    <Show when={mediaError()}>
                        <div class="alert alert--error">{mediaError()}</div>
                    </Show>
                    <div class="live-console__meter" aria-label="Microphone level">
                        <div class="live-console__meter-fill" style={{ width: `${Math.round(micLevel() * 100,)}%`, }} />
                    </div>
                    <div class="live-console__devices">
                        <FormField label="Camera">
                            <select
                                value={cameraId()}
                                disabled={!cameras().length}
                                onChange={(e,) => pickDevice('camera', e.currentTarget.value,)}
                            >
                                <Show when={!cameras().length}><option value="">Turn on the camera to list devices</option></Show>
                                <For each={cameras()}>
                                    {(d, i,) => <option value={d.deviceId}>{d.label || `Camera ${i() + 1}`}</option>}
                                </For>
                            </select>
                        </FormField>
                        <FormField label="Microphone">
                            <select
                                value={micId()}
                                disabled={!mics().length}
                                onChange={(e,) => pickDevice('mic', e.currentTarget.value,)}
                            >
                                <Show when={!mics().length}><option value="">Turn on the camera to list devices</option></Show>
                                <For each={mics()}>
                                    {(d, i,) => <option value={d.deviceId}>{d.label || `Microphone ${i() + 1}`}</option>}
                                </For>
                            </select>
                        </FormField>
                    </div>
                    <Show when={stream()}>
                        <div class="live-console__preview-actions">
                            <button type="button" class="ui-button ui-button--ghost ui-button--sm" onClick={togglePreviewMute}>
                                {previewMuted() ? 'Unmute preview' : 'Mute preview'}
                            </button>
                            <button type="button" class="ui-button ui-button--ghost ui-button--sm" onClick={stopStream}>
                                Turn off camera
                            </button>
                        </div>
                    </Show>
                    <div class="live-console__provider">
                        <strong>Stream provider: not connected</strong>
                        <span class="form-help-muted">100ms integration coming. The preview stays in this browser — nothing is broadcast yet.</span>
                    </div>
                </div>

                {/* ─── Settings + host controls ─── */}
                <div class="live-console__side">
                    <div class="live-console__card">
                        <h3 class="live-console__card-title">Show settings</h3>
                        <Toggle
                            checked={settings().archiveVideo}
                            onChange={(v,) => patchSettings({ archiveVideo: v, },)}
                            label="Archive video (record for watching later)"
                        />
                        <FormField label="Chat" tooltip="Who may post in the live chat. Staff can always post and moderate.">
                            <select
                                value={settings().chatMode}
                                onChange={(e,) => setChatMode(e.currentTarget.value as LiveChatMode,)}
                            >
                                <For each={CHAT_OPTIONS}>{(o,) => <option value={o.value}>{o.label}</option>}</For>
                            </select>
                        </FormField>
                        <Toggle
                            checked={settings().reactionsEnabled}
                            onChange={setReactions}
                            label="Reactions"
                            hint="Viewers can send emoji reactions during the show."
                        />
                    </div>

                    <div class="live-console__card">
                        <h3 class="live-console__card-title">Host controls</h3>
                        <Show
                            when={!ended()}
                            fallback={<p class="form-help-muted">{endedLabel()}. A show cannot be restarted.</p>}
                        >
                            <Show
                                when={canHost()}
                                fallback={
                                    <p class="form-help-muted">
                                        {props.postId
                                            ? 'Publish the post (and save) to open the live room.'
                                            : 'Save and publish the post to open the live room.'}
                                    </p>
                                }
                            >
                                <div class="live-console__controls">
                                    <Show when={roomStatus() === 'idle'}>
                                        <button type="button" class="ui-button ui-button--primary ui-button--sm" onClick={() => command({ type: 'start', },)}>
                                            Go live
                                        </button>
                                    </Show>
                                    <Show when={roomStatus() === 'live'}>
                                        <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={() => command({ type: 'pause', },)}>
                                            Pause
                                        </button>
                                    </Show>
                                    <Show when={roomStatus() === 'paused'}>
                                        <button type="button" class="ui-button ui-button--primary ui-button--sm" onClick={() => command({ type: 'resume', },)}>
                                            Resume
                                        </button>
                                    </Show>
                                    <Show when={roomStatus() === 'live' || roomStatus() === 'paused'}>
                                        <button
                                            type="button"
                                            class="ui-button ui-button--secondary ui-button--sm"
                                            onClick={() => command(room()?.muted ? { type: 'unmute', } : { type: 'mute', },)}
                                        >
                                            {room()?.muted ? 'Unmute stream' : 'Mute stream'}
                                        </button>
                                    </Show>
                                    <button type="button" class="ui-button ui-button--danger ui-button--sm" onClick={() => setConfirmEnd(true,)}>
                                        End show
                                    </button>
                                </div>
                            </Show>
                        </Show>
                    </div>

                    <Show when={canHost()}>
                        <div class="live-console__card live-console__chat">
                            <h3 class="live-console__card-title">Chat ({messages.length})</h3>
                            <Show when={messages.length} fallback={<p class="form-help-muted">No messages yet.</p>}>
                                <ul class="live-console__messages">
                                    <For each={messages}>
                                        {(m,) => (
                                            <li class="live-console__message">
                                                <div class="live-console__message-head">
                                                    <strong>{m.name}</strong>
                                                    <Show when={m.role}><span class="live-console__message-role">{m.role}</span></Show>
                                                    <span class="live-console__message-time">{new Date(m.at,).toLocaleTimeString()}</span>
                                                </div>
                                                <p class="live-console__message-text">{m.text}</p>
                                                <button
                                                    type="button"
                                                    class="live-console__message-delete"
                                                    title="Delete message"
                                                    aria-label="Delete message"
                                                    onClick={() => command({ type: 'delete_message', id: m.id, },)}
                                                >
                                                    ×
                                                </button>
                                            </li>
                                        )}
                                    </For>
                                </ul>
                            </Show>
                        </div>
                    </Show>
                </div>
            </div>

            <ConfirmModal
                open={confirmEnd()}
                title="End the show?"
                message="End the show? Viewers are disconnected and it cannot be restarted."
                confirmLabel="End show"
                danger
                onConfirm={endShow}
                onCancel={() => setConfirmEnd(false,)}
            />
        </section>
    );
};

export default LivePostEditor;
