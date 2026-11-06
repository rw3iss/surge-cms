/**
 * "Desktop notifications on this browser" — the user's own switch for Web
 * Push. On: browser permission → the PWA service worker's push subscription
 * (VAPID key from the server) → saved for this user. Off: unsubscribed here
 * and on the server. Desktop notifications go to the IN-APP recipients of a
 * type whose "desktop" switch is on (Settings → Notifications).
 *
 * On mount an existing subscription is re-sent to the server (an upsert): the
 * server may have pruned it, or another account signed in on this browser may
 * own it now. One made with an OLD server key (keys changed) is replaced.
 */
import { createSignal, onMount, Show, type Component, } from 'solid-js';
import Toggle from '../../ui/Toggle';
import { cms, } from '../../../services/cmsClient';

/** VAPID public key (base64url) → the bytes `pushManager.subscribe` wants. */
function urlBase64ToUint8Array(base64: string,): Uint8Array {
    const pad = '='.repeat((4 - (base64.length % 4)) % 4,);
    const raw = atob((base64 + pad).replace(/-/g, '+',).replace(/_/g, '/',),);
    return Uint8Array.from([...raw,].map((c,) => c.charCodeAt(0,),),);
}

/** Same bytes? (an existing subscription's key vs the server's current key) */
function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array,): boolean {
    if (!a) return true; // unknown → assume it matches
    const x = new Uint8Array(a,);
    return x.length === b.length && x.every((v, i,) => v === b[i],);
}

const toBody = (sub: PushSubscription,) => {
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string; }; };
    return { endpoint: json.endpoint, keys: json.keys, };
};

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration(): Promise<ServiceWorkerRegistration> {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    await navigator.serviceWorker.register('/sw.js',);
    return navigator.serviceWorker.ready;
}

const NotificationDesktopToggle: Component<{ size?: 'sm' | 'md'; /** Default: "Desktop notifications on this browser". */ label?: string; }> = (props,) => {
    const [on, setOn,] = createSignal(false,);
    const [busy, setBusy,] = createSignal(false,);
    const [note, setNote,] = createSignal('',);
    const [available, setAvailable,] = createSignal(true,);
    let publicKey: string | null = null;

    onMount(async () => {
        if (!supported()) { setAvailable(false,); setNote('This browser does not support desktop notifications.',); return; }
        try {
            const info = await cms.notifications.pushInfo();
            publicKey = info.publicKey;
            if (!info.available) { setAvailable(false,); setNote('Not available on this server.',); return; }
        } catch {
            setAvailable(false,);
            return;
        }
        if (Notification.permission === 'denied') setNote('Blocked in your browser settings.',);
        try {
            const reg = await navigator.serviceWorker.getRegistration();
            let sub = await reg?.pushManager.getSubscription();
            if (sub && Notification.permission === 'granted' && publicKey) {
                const key = urlBase64ToUint8Array(publicKey,);
                if (!sameKey(sub.options?.applicationServerKey, key,)) {
                    // Made with an old server key — the push service would refuse every send.
                    await sub.unsubscribe().catch(() => undefined,);
                    sub = await reg!.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource, },);
                }
                await cms.notifications.pushSubscribe(toBody(sub,),);
            }
            setOn(!!sub && Notification.permission === 'granted',);
        } catch {
            setOn(false,);
        }
    },);

    const enable = async () => {
        if (!publicKey) return;
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
            setNote(perm === 'denied' ? 'Blocked in your browser settings.' : 'Permission was not given.',);
            return;
        }
        const reg = await registration();
        const key = urlBase64ToUint8Array(publicKey,);
        let sub = await reg.pushManager.getSubscription();
        if (sub && !sameKey(sub.options?.applicationServerKey, key,)) {
            await sub.unsubscribe().catch(() => undefined,);
            sub = null;
        }
        sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource, },);
        await cms.notifications.pushSubscribe(toBody(sub,),);
        setOn(true,);
        setNote('',);
    };

    const disable = async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
            const endpoint = sub.endpoint;
            await sub.unsubscribe().catch(() => undefined,);
            await cms.notifications.pushUnsubscribe(endpoint,).catch(() => undefined,);
        }
        setOn(false,);
    };

    const change = async (next: boolean,) => {
        setBusy(true,);
        try {
            if (next) await enable();
            else await disable();
        } catch (e) {
            setNote(e instanceof Error ? e.message : 'Could not change desktop notifications.',);
        } finally {
            setBusy(false,);
        }
    };

    return (
        <div class="notification-desktop-toggle">
            <Toggle
                checked={on()}
                disabled={busy() || !available()}
                size={props.size ?? 'sm'}
                onChange={(v,) => void change(v,)}
                label={props.label ?? 'Desktop notifications on this browser'}
            />
            <Show when={note()}><span class="notification-desktop-toggle__note">{note()}</span></Show>
        </div>
    );
};

export default NotificationDesktopToggle;
