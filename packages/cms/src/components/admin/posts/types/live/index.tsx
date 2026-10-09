/**
 * LIVE SHOW console — the Content section of a `live` post.
 *
 * Parts:
 *   - Camera + microphone preview.
 *   - Broadcast: the camera stream is published to the configured provider
 *     (`services/liveProviders`, WHIP for Cloudflare Stream) and — recording
 *     method `browser` — recorded on this page and uploaded while live
 *     (`services/liveRecording`). Pause blanks the outgoing video and pauses
 *     the recorder; mute disables the microphone track. Both FOLLOW the room
 *     state, so a command from another tab applies here too.
 *   - Show settings, stored in `typeSettings` (`LivePostSettings`).
 *   - Host controls over the live room WebSocket (`connectLiveRoom`), shown
 *     once the post is saved AND published, and never after the show ended.
 *
 * A recording left open by an earlier page (crash / reload) is offered for
 * finishing or discarding; it is never appended to (a new MediaRecorder writes
 * a new container header) — going live again records "part 2".
 */
import { A, } from '@solidjs/router';
import {
    type Component, createEffect, createSignal, For, on, onCleanup, onMount, Show,
} from 'solid-js';
import { createStore, reconcile, } from 'solid-js/store';
import type {
    LiveChatMessage, LiveChatMode, LiveClientCommand, LivePostSettings, LiveRecording, LiveRecordingMethod,
    LiveRoomState, LiveServerEvent, LiveStatus, PostsSettingsResponse,
} from '@sitesurge/types';
import { formatDateTime, formatFileSize, } from '@sitesurge/types';
import { cms, } from '../../../../../services/cmsClient';
import {
    getPublisher, hasBrowserClient, type LiveConnectionState, type LivePublisher,
} from '../../../../../services/liveProviders';
import {
    createRecorder, discardStoredRecording, EMPTY_PROGRESS, finishStoredRecording, isOpenRecording, recordingFormatInfo,
    type LiveRecorder, type RecorderProgress,
} from '../../../../../services/liveRecording';
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

const PUB_LABEL: Record<LiveConnectionState, string> = {
    idle: 'Not broadcasting',
    connecting: 'Connecting…',
    live: 'Broadcasting',
    reconnecting: 'Reconnecting…',
    failed: 'Connection failed',
    closed: 'Stopped',
};

const REC_LABEL: Record<RecorderProgress['state'], string> = {
    idle: 'Not recording',
    recording: 'Recording',
    paused: 'Recording paused',
    finalizing: 'Finishing recording…',
    completed: 'Recording saved',
    aborted: 'Recording discarded',
    error: 'Recording error',
};

const LIVE_SETTINGS_URL = '/admin/posts/settings?tab=live';

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

    // ─── Provider (Posts → Settings → Live Show) ───
    const [providerInfo, setProviderInfo,] = createSignal<PostsSettingsResponse | null>(null,);
    const [providerError, setProviderError,] = createSignal('',);
    onMount(() => {
        cms.posts.settings()
            .then(setProviderInfo,)
            .catch((err: Error,) => setProviderError(err?.message || 'Could not read the live provider settings.',),);
    },);
    const providerKey = () => providerInfo()?.settings.live.provider ?? null;
    const descriptor = () => providerInfo()?.liveProviders.find((p,) => p.key === providerKey());
    const providerConfig = (): Record<string, unknown> => {
        const key = providerKey();
        return key ? providerInfo()?.settings.live.providers[key] ?? {} : {};
    };
    /** OBS / RTMPS mode: the host streams from OBS, not this page. */
    const externalEncoder = () => providerConfig().recordingMode === 'rtmps';
    const providerStatus = (): { kind: 'loading' | 'unknown' | 'none' | 'unimplemented' | 'unconfigured' | 'ready'; text: string; } => {
        if (providerError()) return { kind: 'unknown', text: providerError(), };
        if (!providerInfo()) return { kind: 'loading', text: 'Checking…', };
        const d = descriptor();
        if (!providerKey() || !d) return { kind: 'none', text: 'No provider — viewers see a placeholder stage.', };
        if (!d.implemented || !hasBrowserClient(d.key,)) return { kind: 'unimplemented', text: 'Integration not built yet — nothing is broadcast.', };
        const missing = d.fields.filter((f,) => f.required && !String(providerConfig()[f.key] ?? '',).trim());
        if (missing.length) return { kind: 'unconfigured', text: `Not configured (${missing.map((f,) => f.label).join(', ',)}).`, };
        return { kind: 'ready', text: externalEncoder() ? 'Connected — OBS / RTMPS mode.' : 'Connected.', };
    };
    /** This page publishes the camera when going live. */
    const publishesFromBrowser = () => providerStatus().kind === 'ready' && !externalEncoder();
    /** What this browser records — H.264 gets the instant (quick) replay. */
    const recFormat = () => recordingFormatInfo();
    const recordingMethod = (): LiveRecordingMethod =>
        !settings().archiveVideo ? 'none' : externalEncoder() ? 'server' : 'browser';

    // ─── Broadcast + recording ───
    let publisher: LivePublisher | null = null;
    let recorder: LiveRecorder | null = null;
    let statsTimer: ReturnType<typeof setInterval> | undefined;
    const [pubState, setPubState,] = createSignal<LiveConnectionState>('idle',);
    const [pubError, setPubError,] = createSignal('',);
    const [bitrate, setBitrate,] = createSignal<number | null>(null,);
    const [rec, setRec,] = createSignal<RecorderProgress>(EMPTY_PROGRESS,);
    const [busy, setBusy,] = createSignal<'starting' | 'ending' | 'finishing' | null>(null,);
    const [saved, setSaved,] = createSignal<LiveRecording | null>(null,);
    const [finishError, setFinishError,] = createSignal('',);
    const [unfinished, setUnfinished,] = createSignal<LiveRecording | null>(null,);
    const [confirmDiscard, setConfirmDiscard,] = createSignal(false,);
    /** Recording number within this show (a reload finishes one and starts the next). */
    const [recordingPart, setRecordingPart,] = createSignal(1,);
    const broadcasting = () => ['connecting', 'live', 'reconnecting',].includes(pubState(),);
    const recordingActive = () => ['recording', 'paused', 'finalizing',].includes(rec().state,);

    // A recording left open by an earlier page (crash / reload).
    createEffect(on(() => props.postId, (id,) => {
        if (!id) return;
        cms.posts.liveRecording.get(id,)
            .then((r,) => { if (r && isOpenRecording(r,) && !recorder) setUnfinished(r,); },)
            .catch(() => {},);
    },),);

    const startStats = () => {
        clearInterval(statsTimer,);
        statsTimer = setInterval(() => {
            void publisher?.getBitrate?.().then((b,) => { if (b !== null) setBitrate(b,); },).catch(() => {},);
        }, 2000,);
    };

    /** Publish the camera (+ start recording). `sendStart`: also open the room. */
    const startBroadcast = async (sendStart: boolean,) => {
        const postId = props.postId;
        if (!postId) return;
        if (publishesFromBrowser()) {
            const s = stream();
            if (!s) {
                toast.error('Turn on the camera first.',);
                return;
            }
            setBusy('starting',);
            setPubError('',);
            // A publisher that gave up (`failed`) is replaced, not reused.
            const old = publisher;
            publisher = null;
            await old?.stop().catch(() => {},);
            try {
                const info = await cms.posts.livePublish(postId,);
                const pub = getPublisher(info.provider,);
                if (!pub) throw new Error(`This browser has no client for the "${info.provider}" provider.`,);
                pub.onState((st, err,) => {
                    setPubState(st,);
                    if (err) setPubError(err,);
                    else if (st === 'live') setPubError('',);
                },);
                await pub.start(s, info,);
                publisher = pub;
                startStats();
            } catch (err) {
                setBusy(null,);
                setPubState('failed',);
                setPubError((err as Error)?.message || 'Could not connect to the stream provider.',);
                toast.error(`Could not go live: ${(err as Error)?.message || 'stream provider error'}`,);
                return;
            }
            // ONE recorder for the whole page session: a re-connected broadcast
            // keeps recording into the same upload.
            if (recordingMethod() === 'browser' && !recorder) {
                // An open recording from an earlier page is finished by the
                // recorder's start (never appended to) — this one is the next part.
                if (unfinished()) {
                    setUnfinished(null,);
                    setRecordingPart((n,) => n + 1,);
                }
                const r = createRecorder('browser',);
                r.onProgress(setRec,);
                try {
                    await r.start(postId, s,);
                    recorder = r;
                } catch (err) {
                    toast.error(`Live, but NOT recording: ${(err as Error)?.message || 'recorder error'}`,);
                }
            }
            setBusy(null,);
            applyRoomToMedia();
        }
        if (sendStart) command({ type: 'start', },);
    };

    /** Pause / mute follow the ROOM state (also when changed from another tab). */
    const applyRoomToMedia = () => {
        const s = stream();
        const paused = roomStatus() === 'paused';
        const muted = !!room()?.muted;
        if (s) for (const t of s.getAudioTracks()) t.enabled = !muted;
        if (publisher && s) {
            const video = s.getVideoTracks()[0] ?? null;
            if (publisher.replaceTrack) void publisher.replaceTrack('video', paused ? null : video,).catch(() => {},);
            else if (video) video.enabled = !paused;
        }
        if (paused) recorder?.pause();
        else recorder?.resume();
    };
    createEffect(on(() => [roomStatus(), room()?.muted,] as const, () => applyRoomToMedia(),),);

    /** Finish the recording (or retry finishing it). */
    const finalizeRecording = async () => {
        const r = recorder;
        if (!r) return;
        setBusy('finishing',);
        setFinishError('',);
        try {
            const result = await r.stop();
            recorder = null;
            if (result) setSaved(result,);
        } catch (err) {
            setFinishError((err as Error)?.message || 'Could not finish the recording.',);
        } finally {
            setBusy(null,);
        }
    };

    let stopping: Promise<void> | null = null;
    /** Stop publishing, then finalise the recording. Idempotent. */
    const stopBroadcast = () => {
        stopping ??= (async () => {
            clearInterval(statsTimer,);
            setBitrate(null,);
            const pub = publisher;
            publisher = null;
            setBusy('ending',);
            await pub?.stop().catch(() => {},);
            setPubState('idle',);
            setBusy(null,);
            await finalizeRecording();
        })().finally(() => { stopping = null; },);
        return stopping;
    };

    // The show ended (here or from another tab) → stop and save.
    createEffect(on(ended, (isEnded,) => {
        if (isEnded && (publisher || recorder)) void stopBroadcast();
    },),);

    const endShow = () => {
        setConfirmEnd(false,);
        command({ type: 'end', confirm: true, },);
        void stopBroadcast();
    };

    /** "Finish now" on a recording left open by an earlier page. */
    const finishUnfinished = async () => {
        const r = unfinished();
        if (!r || !props.postId) return;
        setBusy('finishing',);
        setFinishError('',);
        try {
            const done = await finishStoredRecording(props.postId, r,);
            setUnfinished(null,);
            setRecordingPart((n,) => n + 1,);
            if (done.status !== 'aborted') setSaved(done,);
            else toast.success('The unfinished recording had no uploaded video and was discarded.',);
        } catch (err) {
            setFinishError((err as Error)?.message || 'Could not finish the recording.',);
        } finally {
            setBusy(null,);
        }
    };

    const discardUnfinished = async () => {
        setConfirmDiscard(false,);
        const r = unfinished();
        if (!r || !props.postId) return;
        try {
            await discardStoredRecording(props.postId, r.id,);
            setUnfinished(null,);
        } catch (err) {
            toast.error((err as Error)?.message || 'Could not discard the recording.',);
        }
    };

    // Leaving the page while live drops the broadcast — ask first.
    const onBeforeUnload = (e: BeforeUnloadEvent,) => {
        if (!publisher && !recordingActive()) return;
        e.preventDefault();
        e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload,);
    onCleanup(() => {
        window.removeEventListener('beforeunload', onBeforeUnload,);
        clearInterval(statsTimer,);
        // SPA navigation away: stop sending; the recording finishes in the
        // background (or is offered for finishing next time).
        void publisher?.stop().catch(() => {},);
        publisher = null;
        void recorder?.stop().catch(() => {},);
    },);

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
                                disabled={!cameras().length || broadcasting()}
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
                                disabled={!mics().length || broadcasting()}
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
                            <button
                                type="button"
                                class="ui-button ui-button--ghost ui-button--sm"
                                disabled={broadcasting()}
                                title={broadcasting() ? 'The camera is being broadcast' : undefined}
                                onClick={stopStream}
                            >
                                Turn off camera
                            </button>
                        </div>
                    </Show>
                    <Show when={broadcasting()}>
                        <p class="form-help-muted">Devices cannot be changed while broadcasting.</p>
                    </Show>
                    <div class={`live-console__provider live-console__provider--${providerStatus().kind}`}>
                        <div class="live-console__provider-head">
                            <strong>Provider: {descriptor()?.label ?? (providerKey() || 'none')}</strong>
                            <span class="live-console__provider-status">{providerStatus().text}</span>
                            <A href={LIVE_SETTINGS_URL}>Live settings</A>
                        </div>
                        <Show when={providerStatus().kind === 'ready' && externalEncoder()}>
                            <span class="form-help-muted">Stream from OBS to the provider's RTMPS ingest; this preview stays local.</span>
                        </Show>
                        <Show when={publishesFromBrowser()}>
                            <div class="live-console__stat">
                                <span>Broadcast</span>
                                <span class={`live-console__state live-console__state--${pubState()}`}>{PUB_LABEL[pubState()]}</span>
                                <Show when={bitrate() !== null && pubState() === 'live'}>
                                    <span class="live-console__stat-value">
                                        {bitrate()! >= 1000 ? `${(bitrate()! / 1000).toFixed(1,)} Mbps` : `${bitrate()} kbps`}
                                    </span>
                                </Show>
                            </div>
                            <Show when={pubError()}>
                                <span class="live-console__stat-error">{pubError()}</span>
                            </Show>
                            <div class="live-console__stat">
                                <span>Recording{recordingPart() > 1 ? ` (part ${recordingPart()})` : ''}</span>
                                <Show
                                    when={recordingMethod() === 'browser'}
                                    fallback={<span class="form-help-muted">Off — archive video is disabled.</span>}
                                >
                                    <span class={`live-console__state live-console__state--rec-${rec().state}`}>{REC_LABEL[rec().state]}</span>
                                    <span
                                        class={`live-console__stat-value${recFormat().quickReplay ? '' : ' live-console__stat-error'}`}
                                        title={recFormat().mime || 'browser default'}
                                    >
                                        {recFormat().label}
                                        {recFormat().quickReplay
                                            ? ' · instant replay'
                                            : ' · no instant replay (replay after encoding, ~10–15 min) — use Chrome, Edge or Safari to record H.264'}
                                    </span>
                                    <Show when={rec().state !== 'idle'}>
                                        <span class="live-console__stat-value">
                                            {formatFileSize(rec().uploadedBytes,)} uploaded
                                            {rec().pendingBytes ? ` · ${formatFileSize(rec().pendingBytes,)} waiting` : ''}
                                        </span>
                                    </Show>
                                </Show>
                            </div>
                            <Show when={rec().error && recordingActive()}>
                                <span class="live-console__stat-error">{rec().error} — retrying.</span>
                            </Show>
                        </Show>
                    </div>

                    <Show when={unfinished()}>
                        {(u,) => (
                            <div class="alert alert--warning live-console__recording-notice">
                                <strong>Unfinished recording</strong>
                                <span>
                                    A recording from an earlier session was not finished ({u().uploadedParts.length} parts,{' '}
                                    {formatFileSize(u().uploadedBytes,)} uploaded). Finish it to keep that video; if the show goes
                                    on, going live again records a new part.
                                </span>
                                <div class="live-console__preview-actions">
                                    <button
                                        type="button"
                                        class="ui-button ui-button--primary ui-button--sm"
                                        disabled={!!busy()}
                                        onClick={() => void finishUnfinished()}
                                    >
                                        {busy() === 'finishing' ? 'Finishing…' : 'Finish now'}
                                    </button>
                                    <button
                                        type="button"
                                        class="ui-button ui-button--ghost ui-button--sm"
                                        disabled={!!busy()}
                                        onClick={() => setConfirmDiscard(true,)}
                                    >
                                        Discard
                                    </button>
                                </div>
                            </div>
                        )}
                    </Show>
                    <Show when={finishError()}>
                        <div class="alert alert--error live-console__recording-notice">
                            <span>The recording could not be finished: {finishError()}</span>
                            <div class="live-console__preview-actions">
                                <button
                                    type="button"
                                    class="ui-button ui-button--primary ui-button--sm"
                                    disabled={!!busy()}
                                    onClick={() => void (recorder ? finalizeRecording() : finishUnfinished())}
                                >
                                    {busy() === 'finishing' ? 'Finishing…' : 'Finish recording'}
                                </button>
                            </div>
                        </div>
                    </Show>
                    <Show when={saved()}>
                        {(r,) => (
                            <div class="alert alert--success live-console__recording-notice">
                                <strong>Recording saved — processing replay.</strong>
                                <span>
                                    The video is being encoded; the replay appears on the post when ready.{' '}
                                    <Show when={r().mediaId}>
                                        <A href="/admin/media">Open the Media library</A> (media {r().mediaId}).
                                    </Show>
                                </span>
                            </div>
                        )}
                    </Show>
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
                                        <button
                                            type="button"
                                            class="ui-button ui-button--primary ui-button--sm"
                                            disabled={!!busy() || (publishesFromBrowser() && !stream())}
                                            title={publishesFromBrowser() && !stream() ? 'Turn on the camera first' : undefined}
                                            onClick={() => void startBroadcast(true,)}
                                        >
                                            {busy() === 'starting' ? 'Connecting…' : 'Go live'}
                                        </button>
                                    </Show>
                                    <Show when={(roomStatus() === 'live' || roomStatus() === 'paused') && publishesFromBrowser() && !broadcasting()}>
                                        <button
                                            type="button"
                                            class="ui-button ui-button--primary ui-button--sm"
                                            disabled={!!busy() || !stream()}
                                            title={!stream() ? 'Turn on the camera first' : 'The show is live but this page is not sending video'}
                                            onClick={() => void startBroadcast(false,)}
                                        >
                                            {busy() === 'starting' ? 'Connecting…' : 'Start broadcasting'}
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
                                    <button
                                        type="button"
                                        class="ui-button ui-button--danger ui-button--sm"
                                        disabled={busy() === 'ending' || busy() === 'finishing'}
                                        onClick={() => setConfirmEnd(true,)}
                                    >
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
            <ConfirmModal
                open={confirmDiscard()}
                title="Discard the recording?"
                message="The unfinished recording and everything uploaded for it are deleted. This cannot be undone."
                confirmLabel="Discard"
                danger
                onConfirm={() => void discardUnfinished()}
                onCancel={() => setConfirmDiscard(false,)}
            />
        </section>
    );
};

export default LivePostEditor;
