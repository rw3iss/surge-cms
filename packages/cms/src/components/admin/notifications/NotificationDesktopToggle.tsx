/**
 * "Desktop notifications on this browser" — the user's own switch for Web
 * Push. On: browser permission → the PWA service worker's push subscription
 * (VAPID key from the server) → saved for this user. Off: unsubscribed here
 * and on the server. Desktop notifications go to the IN-APP recipients of a
 * type whose "desktop" switch is on (Settings → Notifications).
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

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration(): Promise<ServiceWorkerRegistration> {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    await navigator.serviceWorker.register('/sw.js',);
    return navigator.serviceWorker.ready;
}

const NotificationDesktopToggle: Component<{ size?: 'sm' | 'md'; }> = (props,) => {
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
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        setOn(!!sub && Notification.permission === 'granted',);
    },);

    const enable = async () => {
        if (!publicKey) return;
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
            setNote(perm === 'denied' ? 'Blocked in your browser settings.' : 'Permission was not given.',);
            return;
        }
        const reg = await registration();
        const sub = (await reg.pushManager.getSubscription())
            ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey,) as BufferSource, },);
        const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string; }; };
        await cms.notifications.pushSubscribe({ endpoint: json.endpoint, keys: json.keys, },);
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
                label="Desktop notifications on this browser"
            />
            <Show when={note()}><span class="notification-desktop-toggle__note">{note()}</span></Show>
        </div>
    );
};

export default NotificationDesktopToggle;
