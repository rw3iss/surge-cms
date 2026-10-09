/**
 * Reactive mirror of an HTMLVideoElement: one signal per piece of playback
 * state, kept current by the element's own media events. `currentTime` is
 * driven by requestAnimationFrame while playing (timeupdate fires only ~4×/s,
 * which makes the seek bar stutter).
 */
import { createSignal, } from 'solid-js';

export type BufferedRange = readonly [start: number, end: number,];

export function formatTime(seconds: number,): string {
    const s = Number.isFinite(seconds,) && seconds > 0 ? Math.floor(seconds,) : 0;
    const h = Math.floor(s / 3600,);
    const m = Math.floor((s % 3600) / 60,);
    const sec = String(s % 60,).padStart(2, '0',);
    return h ? `${h}:${String(m,).padStart(2, '0',)}:${sec}` : `${m}:${sec}`;
}

function errorMessage(err: MediaError | null,): string {
    switch (err?.code) {
        case 2:
            return 'A network error stopped the video.';
        case 3:
            return 'The video could not be decoded.';
        case 4:
            return 'This video format is not supported in this browser.';
        default:
            return 'This video could not be played.';
    }
}

export function useVideoState() {
    const [paused, setPaused,] = createSignal(true,);
    const [started, setStarted,] = createSignal(false,);
    const [ended, setEnded,] = createSignal(false,);
    const [waiting, setWaiting,] = createSignal(false,);
    const [currentTime, setCurrentTime,] = createSignal(0,);
    const [duration, setDuration,] = createSignal(0,);
    const [buffered, setBuffered,] = createSignal<BufferedRange[]>([],);
    const [volume, setVolume,] = createSignal(1,);
    const [muted, setMuted,] = createSignal(false,);
    const [rate, setRate,] = createSignal(1,);
    const [error, setError,] = createSignal<string | null>(null,);

    /** Attach to `video`; returns the detach. */
    const bind = (video: HTMLVideoElement,): (() => void) => {
        const offs: Array<() => void> = [];
        const on = (ev: string, fn: () => void,) => {
            video.addEventListener(ev, fn,);
            offs.push(() => video.removeEventListener(ev, fn,));
        };

        let raf = 0;
        const tick = () => {
            setCurrentTime(video.currentTime,);
            raf = requestAnimationFrame(tick,);
        };
        const startTick = () => {
            if (!raf) raf = requestAnimationFrame(tick,);
        };
        const stopTick = () => {
            if (raf) cancelAnimationFrame(raf,);
            raf = 0;
            setCurrentTime(video.currentTime,);
        };

        const readDuration = () => setDuration(Number.isFinite(video.duration,) ? video.duration : 0,);
        const readBuffered = () => {
            const b = video.buffered;
            const out: BufferedRange[] = [];
            for (let i = 0; i < b.length; i++) out.push([b.start(i,), b.end(i,),],);
            setBuffered(out,);
        };
        const readVolume = () => {
            setVolume(video.volume,);
            setMuted(video.muted,);
        };

        on('play', () => {
            setPaused(false,);
            setStarted(true,);
            setEnded(false,);
        },);
        on('playing', () => {
            setWaiting(false,);
            setError(null,);
            startTick();
        },);
        on('pause', () => {
            setPaused(true,);
            stopTick();
        },);
        on('ended', () => {
            setEnded(true,);
            setPaused(true,);
            stopTick();
        },);
        on('waiting', () => setWaiting(true,),);
        on('canplay', () => setWaiting(false,),);
        on('seeked', () => {
            setWaiting(false,);
            setCurrentTime(video.currentTime,);
        },);
        on('seeking', () => setCurrentTime(video.currentTime,),);
        on('timeupdate', () => {
            if (!raf) setCurrentTime(video.currentTime,);
            readBuffered();
        },);
        on('progress', readBuffered,);
        on('loadedmetadata', readDuration,);
        on('durationchange', readDuration,);
        on('volumechange', readVolume,);
        on('ratechange', () => setRate(video.playbackRate,),);
        on('error', () => setError(errorMessage(video.error,),),);
        on('emptied', () => {
            stopTick();
            setStarted(!video.paused,);
            setEnded(false,);
            setWaiting(false,);
            setError(null,);
            setDuration(0,);
            setBuffered([],);
        },);

        // Sync whatever already happened before we attached.
        setPaused(video.paused,);
        setStarted(!video.paused || video.currentTime > 0,);
        readDuration();
        readVolume();
        setRate(video.playbackRate,);
        if (!video.paused) startTick();

        return () => {
            for (const off of offs) off();
            if (raf) cancelAnimationFrame(raf,);
            raf = 0;
        };
    };

    return {
        paused,
        started,
        ended,
        waiting,
        currentTime,
        duration,
        buffered,
        volume,
        muted,
        rate,
        error,
        setError,
        bind,
    };
}

export type VideoState = ReturnType<typeof useVideoState>;
