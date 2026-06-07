import Plyr from 'plyr';
import { Component, createEffect, onCleanup, onMount, } from 'solid-js';
import 'plyr/dist/plyr.css';

interface VideoPlayerProps {
    src: string;
    autoplay?: boolean;
    muted?: boolean;
    loop?: boolean;
    controls?: boolean;
    poster?: string;
    class?: string;
    style?: Record<string, string>;
    onReady?: (player: Plyr,) => void;
}

const VideoPlayer: Component<VideoPlayerProps> = (props,) => {
    let videoRef: HTMLVideoElement | undefined;
    let player: Plyr | undefined;

    onMount(() => {
        if (videoRef) {
            player = new Plyr(videoRef, {
                controls: props.controls !== false ?
                    [
                        'play-large',
                        'play',
                        'progress',
                        'current-time',
                        'mute',
                        'volume',
                        'fullscreen',
                    ] :
                    [],
                autoplay: props.autoplay || false,
                muted: props.muted || false,
                loop: { active: props.loop || false, },
                clickToPlay: true,
                hideControls: true,
                resetOnEnd: false,
                keyboard: { focused: true, global: false, },
            },);

            if (props.onReady) {
                player.on('ready', () => props.onReady?.(player!,),);
            }
        }
    },);

    onCleanup(() => {
        if (player) {
            player.destroy();
        }
    },);

    // Update source when src changes
    createEffect(() => {
        const src = props.src;
        if (player && src) {
            player.source = {
                type: 'video',
                sources: [{ src, type: 'video/mp4', },],
            };
        }
    },);

    return (
        <video
            ref={videoRef}
            src={props.src}
            poster={props.poster}
            playsinline
            preload="metadata"
            class={props.class}
            style={props.style}
        />
    );
};

export default VideoPlayer;
