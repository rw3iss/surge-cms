/**
 * Camera + microphone for the live console: the preview stream, device
 * lists + pickers, the mic level meter and a preview mute. Owns its own
 * cleanup (tracks stopped, AudioContext closed, devicechange listener off).
 *
 * `attachVideo` is the `<video>` ref — the hook sets `srcObject` on it.
 */
import { createSignal, onCleanup, } from 'solid-js';

export function useMediaDevices() {
    let videoEl: HTMLVideoElement | undefined;
    const attachVideo = (el: HTMLVideoElement,) => { videoEl = el; };
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


    return {
        attachVideo, stream, cameras, mics, cameraId, micId, previewMuted, micLevel, mediaError, starting,
        startCamera, stopStream, pickDevice, togglePreviewMute,
    };
}
