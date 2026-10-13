/**
 * `/invite/:token` — finish an account an admin invited you to (e.g. as a brand
 * ambassador). Shows the invited email + the roles, takes name / email /
 * password, then the backend creates the account, gives it the roles and signs
 * it in (full-page navigation so the AuthProvider picks up the session).
 * An expired / used / revoked link says so, with a way forward.
 */
import { A, useParams, } from '@solidjs/router';
import type { UserInvitePublic, } from '@sitesurge/types';
import { Component, createResource, createSignal, Show, } from 'solid-js';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import { siteName, } from '../stores/siteSettings';
import './Join.scss';

const AcceptInvite: Component = () => {
    const params = useParams<{ token: string; }>();
    const [invite,] = createResource(() => params.token, async (t,): Promise<UserInvitePublic | { error: string; }> => {
        try {
            return await cms.auth.invite(t,);
        } catch (e) {
            return { error: e instanceof Error ? e.message : 'This invite could not be found.', };
        }
    },);
    const ok = () => { const v = invite(); return v && !('error' in v) ? v : null; };

    const [name, setName,] = createSignal('',);
    const [email, setEmail,] = createSignal('',);
    const [password, setPassword,] = createSignal('',);
    const [confirm, setConfirm,] = createSignal('',);
    const [error, setError,] = createSignal('',);
    const [busy, setBusy,] = createSignal(false,);
    const [done, setDone,] = createSignal(false,);

    // Pre-fill once the invite has loaded (the fields stay editable).
    const nameValue = () => name() || ok()?.name || '';
    const emailValue = () => email() || ok()?.email || '';

    const submit = async (e: Event,) => {
        e.preventDefault();
        setError('',);
        if (password() !== confirm()) return setError('Passwords do not match.',);
        if (password().length < 8) return setError('Password must be at least 8 characters.',);
        setBusy(true,);
        try {
            await cms.auth.acceptInvite(params.token, { name: nameValue().trim(), email: emailValue().trim(), password: password(), },);
            setDone(true,);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Your account could not be created.',);
        } finally {
            setBusy(false,);
        }
    };

    return (
        <div class="join">
            <SeoHead title="Accept invite" noindex={true} nofollow={true} />
            <div class="join__container">
                <Show when={!invite.loading} fallback={<p class="join__subtitle">Loading your invite…</p>}>
                    <Show
                        when={ok()}
                        fallback={
                            <div class="join__success">
                                <h2>This invite can't be used</h2>
                                <p>{(invite() as { error?: string; } | undefined)?.error ?? 'This invite could not be found.'}</p>
                                <p>Ask the person who invited you for a new link — or sign in if you already have an account.</p>
                                <A href="/login" class="join__btn join__btn--primary">Go to Sign In</A>
                            </div>
                        }
                    >
                        <Show
                            when={!done()}
                            fallback={
                                <div class="join__success">
                                    <h2>Welcome to {siteName()}!</h2>
                                    <p>Your account is ready{ok()!.roles ? <> — you're signed in as a <strong>{ok()!.roles}</strong></> : ''}.</p>
                                    <button type="button" class="join__btn join__btn--primary" onClick={() => window.location.assign('/',)}>Continue</button>
                                </div>
                            }
                        >
                            <h1 class="join__title">Join {siteName()}</h1>
                            <p class="join__subtitle">
                                You've been invited{ok()!.roles ? <> as a <strong>{ok()!.roles}</strong></> : ''}. Set up your account below.
                            </p>
                            <Show when={error()}><div class="join__error">{error()}</div></Show>
                            <form class="join__form" onSubmit={submit}>
                                <div class="join__field">
                                    <label for="inv-name" class="join__label">Name</label>
                                    <input id="inv-name" class="join__input" type="text" required autocomplete="name" value={nameValue()} onInput={(e,) => setName(e.currentTarget.value,)} />
                                </div>
                                <div class="join__field">
                                    <label for="inv-email" class="join__label">Email</label>
                                    <input id="inv-email" class="join__input" type="email" required autocomplete="email" value={emailValue()} onInput={(e,) => setEmail(e.currentTarget.value,)} />
                                </div>
                                <div class="join__field">
                                    <label for="inv-password" class="join__label">Password</label>
                                    <input id="inv-password" class="join__input" type="password" required minLength={8} autocomplete="new-password" value={password()} onInput={(e,) => setPassword(e.currentTarget.value,)} />
                                </div>
                                <div class="join__field">
                                    <label for="inv-confirm" class="join__label">Confirm password</label>
                                    <input id="inv-confirm" class="join__input" type="password" required minLength={8} autocomplete="new-password" value={confirm()} onInput={(e,) => setConfirm(e.currentTarget.value,)} />
                                </div>
                                <button type="submit" class="join__btn join__btn--primary" disabled={busy()}>
                                    {busy() ? 'Creating your account…' : 'Create my account'}
                                </button>
                                <p class="join__subtitle" style={{ 'font-size': '0.85rem', 'margin-top': '0.75rem', }}>
                                    This link works until {new Date(ok()!.expiresAt,).toLocaleDateString(undefined, { dateStyle: 'long', },)}.
                                    {' '}Changing the email means you'll need to verify the new address.
                                </p>
                            </form>
                        </Show>
                    </Show>
                </Show>
            </div>
        </div>
    );
};

export default AcceptInvite;
