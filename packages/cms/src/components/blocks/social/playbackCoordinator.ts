/**
 * One social post plays at a time, page-wide.
 *
 * Starting a video pauses whatever was already playing — across posts in the
 * same block, across separate social blocks, and across providers. Two videos
 * talking over each other is never what the visitor asked for, and on a feed of
 * autoplaying-looking thumbnails it is easy to do by accident.
 *
 * PROVIDER-AGNOSTIC BY DESIGN: the coordinator knows nothing about YouTube. A
 * player is anything that can pause itself, so adding a provider means writing
 * an adapter that calls `register` and `notifyPlaying` — see
 * `attachYouTubePlayer` below for the shape. Today YouTube is the only embed
 * that plays inline (the other providers render a thumbnail card that links
 * out), so it is the only adapter that exists.
 *
 * WHY postMessage AND NOT YOUTUBE'S IFRAME API: the site's CSP is
 * `script-src 'self' https://js.stripe.com`, so `https://www.youtube.com/iframe_api`
 * is blocked outright — loading it fails silently and no player is ever
 * constructed. `postMessage` is not governed by script-src, and the embed's
 * own frame is already allowed by `frame-src`. So the adapter speaks the
 * player's wire protocol directly instead of through its library.
 */

/** Anything that can stop itself. */
export interface CoordinatedPlayer {
    /** Stop playback. Must be safe to call when already paused. */
    pause(): void;
}

const players = new Set<CoordinatedPlayer>();

/** Add a player to the page's set. Returns the unregister function. */
export function register(player: CoordinatedPlayer,): () => void {
    players.add(player,);
    return () => { players.delete(player,); };
}

/**
 * Report that `active` has started playing; everything else pauses.
 *
 * Pausing an already-paused player is a no-op for every adapter, so this does
 * not need to track which player was playing — that state lives in the players
 * themselves and asking for it costs a round-trip per embed.
 */
export function notifyPlaying(active: CoordinatedPlayer | null,): void {
    for (const p of players) {
        if (p !== active) p.pause();
    }
}

/** Test seam: drop every registration between cases. */
export function __resetForTest(): void {
    players.clear();
}

// ── YouTube adapter ──────────────────────────────────────────────────────

/**
 * Origins an embed may report from. `youtube-nocookie.com` is in the site's
 * frame-src and may be used by a future privacy-mode toggle, so it is accepted
 * here rather than being a latent bug the day someone flips that switch.
 */
const YT_ORIGINS = ['https://www.youtube.com', 'https://www.youtube-nocookie.com',];

/** The player's `onStateChange` code for "playing". */
const YT_STATE_PLAYING = 1;

/** Stop pinging after this long; a frame that never answers never will. */
const HANDSHAKE_TIMEOUT_MS = 10_000;
const HANDSHAKE_INTERVAL_MS = 300;

/**
 * Wire one YouTube embed into the page's playback set.
 *
 * The iframe must have been rendered with `enablejsapi=1`, without which the
 * player neither accepts commands nor reports state.
 *
 * THE HANDSHAKE IS NOT OPTIONAL: a YouTube embed says nothing until the parent
 * sends it a `listening` message, so without this the coordinator would be able
 * to pause players but would never learn that one had STARTED — which is the
 * event the whole feature turns on. The frame can also take a while to be
 * ready, and messages sent before then are dropped silently, so it is polled
 * until it answers rather than sent once and hoped for.
 *
 * @returns cleanup — removes the listener, stops the handshake, unregisters.
 */
export function attachYouTubePlayer(iframe: HTMLIFrameElement,): () => void {
    const post = (message: object,) => {
        // Targeted at the frame's own origin rather than '*': these messages
        // are addressed to one player, and a wildcard target would broadcast
        // them to whatever else happens to be framed on the page.
        const target = iframe.src.includes('youtube-nocookie',)
            ? YT_ORIGINS[1]
            : YT_ORIGINS[0];
        try {
            iframe.contentWindow?.postMessage(JSON.stringify(message,), target,);
        } catch {
            // A cross-origin frame that has gone away throws here. Nothing to
            // recover — the cleanup below will unregister it.
        }
    };

    const player: CoordinatedPlayer = {
        pause: () => post({ event: 'command', func: 'pauseVideo', args: [], },),
    };
    const unregister = register(player,);

    let handshake: ReturnType<typeof setInterval> | undefined;
    const stopHandshake = () => {
        if (handshake !== undefined) {
            clearInterval(handshake,);
            handshake = undefined;
        }
    };

    const startHandshake = () => {
        stopHandshake();
        const startedAt = Date.now();
        handshake = setInterval(() => {
            if (Date.now() - startedAt > HANDSHAKE_TIMEOUT_MS) { stopHandshake(); return; }
            post({ event: 'listening', channel: 'widget', },);
        }, HANDSHAKE_INTERVAL_MS,);
    };

    const onMessage = (e: MessageEvent,) => {
        if (!YT_ORIGINS.includes(e.origin,)) return;
        // Identify the sender by its window, not by any id we passed in: the id
        // travels through the player and back, so trusting it would let any
        // allowed frame claim to be this one.
        if (e.source !== iframe.contentWindow) return;

        let data: unknown;
        try {
            data = typeof e.data === 'string' ? JSON.parse(e.data,) : e.data;
        } catch {
            return; // Not ours — the player also emits non-JSON chatter.
        }

        // It answered, so it is listening; stop pinging.
        stopHandshake();

        const msg = data as { event?: string; info?: unknown; };
        // State arrives two ways depending on the message: `onStateChange`
        // carries the code directly, `infoDelivery` nests it under playerState.
        const state = msg.event === 'onStateChange'
            ? msg.info
            : (msg.info as { playerState?: unknown; } | undefined)?.playerState;

        if (state === YT_STATE_PLAYING) notifyPlaying(player,);
    };

    window.addEventListener('message', onMessage,);
    // `load` covers the normal case; the immediate call covers a frame that is
    // already loaded by the time this runs (a re-render, or a cached frame).
    iframe.addEventListener('load', startHandshake,);
    startHandshake();

    return () => {
        window.removeEventListener('message', onMessage,);
        iframe.removeEventListener('load', startHandshake,);
        stopHandshake();
        unregister();
    };
}
