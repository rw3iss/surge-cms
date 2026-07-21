import { A, useNavigate, useSearchParams, } from '@solidjs/router';
import { Component, createEffect, createMemo, createResource, createSignal, For, Show, } from 'solid-js';
import { formatCurrency, } from '@sitesurge/types';
import type { ContactMessage, ShopOrder, } from '@sitesurge/types';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import { useAuth, } from '../stores/auth';
import { isFeatureEnabled, siteSettings, } from '../stores/siteSettings';
import './Profile.scss';

const BIO_MAX = 250;

type Tab = 'profile' | 'membership' | 'orders' | 'messages';

/**
 * Self-service user profile (`/profile`). Tabbed: Profile (edit details),
 * Membership, Orders (shop feature), Messages (messages feature). Requires
 * login (else → /login?redirect=profile) and the `users` feature (else → home).
 */
const Profile: Component = () => {
    const auth = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams,] = useSearchParams<{ tab?: string, }>();

    const [firstName, setFirstName,] = createSignal('',);
    const [lastName, setLastName,] = createSignal('',);
    const [bio, setBio,] = createSignal('',);
    const [city, setCity,] = createSignal('',);
    const [stateRegion, setStateRegion,] = createSignal('',);
    const [avatarUrl, setAvatarUrl,] = createSignal<string | undefined>(undefined,);
    const [status, setStatus,] = createSignal<'idle' | 'saving' | 'success' | 'error'>('idle',);
    const [error, setError,] = createSignal('',);
    const [initialized, setInitialized,] = createSignal(false,);
    let avatarInput: HTMLInputElement | undefined;

    const showOrders = () => isFeatureEnabled('shop',);
    const showMessages = () => isFeatureEnabled('messages',);

    const TABS = (): { key: Tab; label: string; }[] => [
        { key: 'profile', label: 'Profile', },
        { key: 'membership', label: 'Membership', },
        ...(showOrders() ? [{ key: 'orders' as Tab, label: 'Orders', },] : []),
        ...(showMessages() ? [{ key: 'messages' as Tab, label: 'Messages', },] : []),
    ];

    const validTab = (t: string | undefined,): Tab => {
        if (t === 'membership') return 'membership';
        if (t === 'orders' && showOrders()) return 'orders';
        if (t === 'messages' && showMessages()) return 'messages';
        return 'profile';
    };
    const tab = (): Tab => validTab(searchParams.tab,);
    const setTab = (t: Tab,) => setSearchParams({ tab: t, },);

    // ── Guards: redirect once auth + settings have settled ──
    const settingsReady = () => siteSettings() != null;
    createEffect(() => {
        if (auth.isLoading) return;
        if (!auth.isAuthenticated) {
            navigate('/login?redirect=profile', { replace: true, },);
            return;
        }
        if (settingsReady() && !isFeatureEnabled('users',)) {
            navigate('/', { replace: true, },);
        }
    },);

    // Seed the form from the current user the first time it's available.
    createEffect(() => {
        const u = auth.user;
        if (u && !initialized()) {
            setFirstName(u.firstName ?? '',);
            setLastName(u.lastName ?? '',);
            setBio(u.bio ?? '',);
            setCity(u.locationCity ?? '',);
            setStateRegion(u.locationState ?? '',);
            setAvatarUrl(u.avatarUrl,);
            setInitialized(true,);
        }
    },);

    const initials = createMemo(() => {
        const u = auth.user;
        const base = `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() || u?.displayName || u?.email || '';
        return base.split(/\s+/,).slice(0, 2,).map((p,) => p[0]?.toUpperCase() ?? '',).join('',) || '?';
    },);

    const save = async (e: Event,) => {
        e.preventDefault();
        setStatus('saving',);
        setError('',);
        try {
            await cms.auth.updateProfile({
                firstName: firstName().trim() || null,
                lastName: lastName().trim() || null,
                bio: bio().trim() || null,
                locationCity: city().trim() || null,
                locationState: stateRegion().trim() || null,
            },);
            await auth.refreshUser();
            setStatus('success',);
            setTimeout(() => setStatus('idle',), 2500,);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save your profile.',);
            setStatus('error',);
        }
    };

    const onAvatarChange = async (e: Event,) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        setError('',);
        try {
            const res = await cms.auth.uploadAvatar(file,);
            setAvatarUrl(res.user.avatarUrl,);
            await auth.refreshUser();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Avatar upload failed.',);
        }
    };

    // ── Orders (loaded only when the Orders tab is opened) ──
    const [orders] = createResource(
        () => (tab() === 'orders' && auth.isAuthenticated ? 'load' : null),
        async () => {
            try {
                const res = await cms.shop.orders.list({ limit: 50, },);
                return res.data as ShopOrder[];
            } catch {
                return [] as ShopOrder[];
            }
        },
    );

    // ── Messages (loaded only when the Messages tab is opened) ──
    const [messages, { refetch: refetchMessages, },] = createResource(
        () => (tab() === 'messages' && auth.isAuthenticated ? 'load' : null),
        async () => {
            try {
                return await cms.messages.listMine() as ContactMessage[];
            } catch {
                return [] as ContactMessage[];
            }
        },
    );
    const [openMessageId, setOpenMessageId,] = createSignal<string | null>(null,);
    const [msgSubject, setMsgSubject,] = createSignal('',);
    const [msgBody, setMsgBody,] = createSignal('',);
    const [msgSending, setMsgSending,] = createSignal(false,);
    const [msgSent, setMsgSent,] = createSignal(false,);

    const sendMessage = async (e: Event,) => {
        e.preventDefault();
        if (!msgBody().trim()) return;
        setMsgSending(true,);
        setMsgSent(false,);
        try {
            await cms.messages.submit({
                name: auth.user?.displayName || auth.user?.email || 'Member',
                email: auth.user?.email || '',
                subject: msgSubject().trim() || undefined,
                message: msgBody().trim(),
            },);
            setMsgSubject('',);
            setMsgBody('',);
            setMsgSent(true,);
            void refetchMessages();
            setTimeout(() => setMsgSent(false,), 3000,);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not send your message.',);
        } finally {
            setMsgSending(false,);
        }
    };

    const fmtDate = (d: string | Date,) => new Date(d,).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', },);

    return (
        <div class="profile page-wrapper">
            <SeoHead title="My Profile" description="Manage your profile and account details." noindex />
            <Show
                when={!auth.isLoading && auth.isAuthenticated}
                fallback={<div class="profile__loading">Loading…</div>}
            >
                <div class="profile__container">
                    <nav class="profile__tabs" aria-label="Profile sections">
                        <For each={TABS()}>
                            {(t,) => (
                                <button
                                    type="button"
                                    class={`profile__tab ${tab() === t.key ? 'is-active' : ''}`}
                                    onClick={() => setTab(t.key,)}
                                >
                                    {t.label}
                                </button>
                            )}
                        </For>
                    </nav>

                    {/* ── Profile tab ── */}
                    <Show when={tab() === 'profile'}>
                        <form class="profile__card" onSubmit={save}>
                            <div class="profile__avatar-row">
                                <button
                                    type="button"
                                    class="profile__avatar"
                                    onClick={() => avatarInput?.click()}
                                    title="Change your avatar"
                                    aria-label="Change your avatar"
                                >
                                    <Show
                                        when={avatarUrl()}
                                        fallback={<span class="profile__avatar-initials">{initials()}</span>}
                                    >
                                        <img src={avatarUrl()} alt="Your avatar" class="profile__avatar-img" />
                                    </Show>
                                    <span class="profile__avatar-edit">Change</span>
                                </button>
                                <input
                                    ref={avatarInput}
                                    type="file"
                                    accept="image/*"
                                    style={{ display: 'none', }}
                                    onChange={onAvatarChange}
                                />
                                <div class="profile__identity">
                                    <span class="profile__display-name">{auth.user?.displayName}</span>
                                    <span class="profile__email">{auth.user?.email}</span>
                                </div>
                            </div>

                            <div class="profile__row">
                                <label class="profile__field">
                                    <span class="profile__label">First name</span>
                                    <input
                                        class="profile__input"
                                        type="text"
                                        maxLength={100}
                                        value={firstName()}
                                        onInput={(ev,) => setFirstName(ev.currentTarget.value,)}
                                        placeholder="First name"
                                    />
                                </label>
                                <label class="profile__field">
                                    <span class="profile__label">Last name</span>
                                    <input
                                        class="profile__input"
                                        type="text"
                                        maxLength={100}
                                        value={lastName()}
                                        onInput={(ev,) => setLastName(ev.currentTarget.value,)}
                                        placeholder="Last name"
                                    />
                                </label>
                            </div>

                            <label class="profile__field">
                                <span class="profile__label">About you</span>
                                <textarea
                                    class="profile__textarea"
                                    rows={4}
                                    maxLength={BIO_MAX}
                                    value={bio()}
                                    onInput={(ev,) => setBio(ev.currentTarget.value,)}
                                    placeholder="A short summary about yourself…"
                                />
                                <span class="profile__counter">{bio().length}/{BIO_MAX}</span>
                            </label>

                            <div class="profile__row">
                                <label class="profile__field">
                                    <span class="profile__label">City</span>
                                    <input
                                        class="profile__input"
                                        type="text"
                                        maxLength={100}
                                        value={city()}
                                        onInput={(ev,) => setCity(ev.currentTarget.value,)}
                                        placeholder="City"
                                    />
                                </label>
                                <label class="profile__field">
                                    <span class="profile__label">State / Region</span>
                                    <input
                                        class="profile__input"
                                        type="text"
                                        maxLength={100}
                                        value={stateRegion()}
                                        onInput={(ev,) => setStateRegion(ev.currentTarget.value,)}
                                        placeholder="State or region"
                                    />
                                </label>
                            </div>

                            <Show when={error()}>
                                <div class="profile__error">{error()}</div>
                            </Show>

                            <div class="profile__actions">
                                <button type="submit" class="profile__save" disabled={status() === 'saving'}>
                                    {status() === 'saving' ? 'Saving…' : 'Save changes'}
                                </button>
                                <Show when={status() === 'success'}>
                                    <span class="profile__saved">Saved ✓</span>
                                </Show>
                            </div>
                        </form>
                    </Show>

                    {/* ── Membership tab ── */}
                    <Show when={tab() === 'membership'}>
                        <div class="profile__card">
                            <span class="profile__label">Membership</span>
                            <p class="profile__membership-note">
                                You're on the free plan. Paid membership tiers are coming soon.
                            </p>
                        </div>
                    </Show>

                    {/* ── Orders tab ── */}
                    <Show when={tab() === 'orders'}>
                        <div class="profile__card">
                            <Show
                                when={!orders.loading}
                                fallback={<p class="profile__muted">Loading your orders…</p>}
                            >
                                <Show
                                    when={(orders() ?? []).length}
                                    fallback={<p class="profile__muted">You haven't placed any orders yet.</p>}
                                >
                                    <ul class="profile__orders">
                                        <For each={orders()}>
                                            {(o,) => (
                                                <A href={`/shop/orders/${o.orderNumber}`} class="profile__order">
                                                    <div class="profile__order-main">
                                                        <span class="profile__order-number">{o.orderNumber}</span>
                                                        <span class="profile__order-date">{fmtDate(o.createdAt,)}</span>
                                                    </div>
                                                    <div class="profile__order-meta">
                                                        <span class={`profile__order-status profile__order-status--${o.status}`}>{o.status}</span>
                                                        <span class="profile__order-total">{formatCurrency(o.totalCents, o.currency,)}</span>
                                                    </div>
                                                </A>
                                            )}
                                        </For>
                                    </ul>
                                </Show>
                            </Show>
                        </div>
                    </Show>

                    {/* ── Messages tab ── */}
                    <Show when={tab() === 'messages'}>
                        <div class="profile__card">
                            <Show
                                when={!messages.loading}
                                fallback={<p class="profile__muted">Loading your messages…</p>}
                            >
                                <Show
                                    when={(messages() ?? []).length}
                                    fallback={<p class="profile__muted">You have no messages yet.</p>}
                                >
                                    <ul class="profile__messages">
                                        <For each={messages()}>
                                            {(m,) => (
                                                <li class="profile__message">
                                                    <button
                                                        type="button"
                                                        class="profile__message-head"
                                                        onClick={() => setOpenMessageId(openMessageId() === m.id ? null : m.id,)}
                                                    >
                                                        <span class="profile__message-subject">{m.subject || '(no subject)'}</span>
                                                        <span class="profile__message-date">{fmtDate(m.createdAt,)}</span>
                                                        <Show when={m.repliedAt}>
                                                            <span class="profile__message-badge">Replied</span>
                                                        </Show>
                                                    </button>
                                                    <Show when={openMessageId() === m.id}>
                                                        <div class="profile__message-body">{m.message}</div>
                                                    </Show>
                                                </li>
                                            )}
                                        </For>
                                    </ul>
                                </Show>

                                {/* Compose a new message to staff */}
                                <form class="profile__compose" onSubmit={sendMessage}>
                                    <span class="profile__label">Send a message</span>
                                    <input
                                        class="profile__input"
                                        type="text"
                                        placeholder="Subject (optional)"
                                        value={msgSubject()}
                                        onInput={(e,) => setMsgSubject(e.currentTarget.value,)}
                                    />
                                    <textarea
                                        class="profile__textarea"
                                        rows={3}
                                        placeholder="Write a message to our team…"
                                        value={msgBody()}
                                        onInput={(e,) => setMsgBody(e.currentTarget.value,)}
                                    />
                                    <div class="profile__actions">
                                        <button type="submit" class="profile__save" disabled={msgSending() || !msgBody().trim()}>
                                            {msgSending() ? 'Sending…' : 'Send message'}
                                        </button>
                                        <Show when={msgSent()}>
                                            <span class="profile__saved">Sent ✓</span>
                                        </Show>
                                    </div>
                                </form>
                            </Show>
                        </div>
                    </Show>
                </div>
            </Show>
        </div>
    );
};

export default Profile;
