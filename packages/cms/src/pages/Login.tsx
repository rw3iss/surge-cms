import { isAdminRole, } from '@sitesurge/types';
import { A, useNavigate, useSearchParams, } from '@solidjs/router';
import { Component, createEffect, createSignal, on, Show, } from 'solid-js';
import LoginForm from '../components/auth/LoginForm';
import SeoHead from '../components/common/seo/SeoHead';
import { useAuth, } from '../stores/auth';
import { siteName, } from '../stores/siteSettings';
import { type AccessDeniedReason, deniedMessage, parseDeniedReason, safeReturnPath, shouldRetryAfterSignin, } from '../utils/accessDenied';
import { choiceTarget, takeChoice, } from '../utils/membershipChoice';
import './Login.scss';

/** `/login` — the page frame around the shared `LoginForm`. */
const Login: Component = () => {
    const [searchParams,] = useSearchParams();
    const navigate = useNavigate();
    const auth = useAuth();

    /**
     * Where to go after signing in. A member who must still get (or fix) a
     * membership goes straight to Profile → Membership — where an unfinished
     * payment is explained and retried — unless they were on their way to the
     * plans page.
     */
    const afterLogin = (role: string | undefined,): string => {
        // A level chosen on /subscribe before signing up (remembered by /join).
        const chosen = takeChoice();
        const target = returnTarget() || (chosen ? choiceTarget(chosen,) : '');
        const a = auth.access;
        if (a?.restricted && a.reason === 'subscription' && !isAdminRole(role,)) {
            return target.startsWith('/subscribe',) || target.startsWith('/profile?tab=membership',) ? target : '/profile?tab=membership';
        }
        return target || (isAdminRole(role,) ? '/admin' : '/');
    };

    /** Post-login destination from `?redirect=` or `?return=` (either works).
     *  A bare name (`profile`) is normalized to an absolute path (`/profile`);
     *  protocol-relative / external values are rejected (returns ''). */
    const returnTarget = (): string => {
        const raw = (typeof searchParams.redirect === 'string' && searchParams.redirect) ||
            (typeof searchParams.return === 'string' && searchParams.return) ||
            '';
        return safeReturnPath(raw,);
    };

    /*
     * `?reason=` — set by the access-denied fallback (`utils/accessDenied`)
     * when a link led somewhere this visitor may not go. Signed out: the
     * reason shows above the form and signing in returns to the item. Signed
     * in: never bounce back (that would loop) — show why, with an upgrade
     * link and a way to switch accounts. One exception: `signin` for a
     * visitor who IS signed in means their session had lapsed when the item
     * was checked, so they go back once (`shouldRetryAfterSignin`).
     */
    const reason = (): AccessDeniedReason | null => parseDeniedReason(searchParams.reason,);
    const tierName = () => (typeof searchParams.tier === 'string' ? searchParams.tier.slice(0, 80,) : '');
    const [signinRetryDone, setSigninRetryDone,] = createSignal(false,);
    createEffect(on(() => [auth.isLoading, auth.user?.id, reason(),] as const, ([loading, uid, r,],) => {
        if (loading || !uid || r !== 'signin') return;
        const target = returnTarget();
        if (target && shouldRetryAfterSignin(target,)) navigate(target, { replace: true, },);
        else setSigninRetryDone(true,);
    },),);
    /** The reason as shown to a SIGNED-IN visitor (`signin` no longer applies to them). */
    const signedInReason = (): AccessDeniedReason | null => {
        const r = reason();
        if (!r || !auth.user) return null;
        if (r === 'signin') return signinRetryDone() ? 'forbidden' : null;
        return r;
    };
    // Signing out leaves this URL (redirect + reason) in place, so the form shows and leads back to the item.
    const switchAccount = () => auth.logout();

    const authError = () => {
        const errorParam = searchParams.error;
        if (errorParam === 'patreon_denied') return 'Patreon login was cancelled';
        if (errorParam === 'auth_failed') return 'Authentication failed. Please try again.';
        return null;
    };

    return (
        <div class="login">
            <SeoHead
                title="Sign In"
                description={`Sign in to your ${siteName()} account.`}
                noindex={true}
                nofollow={true}
            />
            <div class="login__container">
                <Show
                    when={signedInReason()}
                    fallback={
                        <>
                            <h1 class="login__title">Sign In</h1>
                            <Show when={reason() && !auth.user}>
                                <p class="login__reason" role="alert">{deniedMessage(reason()!, tierName(),)}</p>
                            </Show>
                            <LoginForm
                                initialError={authError()}
                                returnTo={returnTarget() || undefined}
                                onSuccess={(user,) => navigate(afterLogin(user?.role,),)}
                            />
                        </>
                    }
                >
                    {(r,) => (
                        <div class="login__denied">
                            <h1 class="login__title">Access restricted</h1>
                            <p class="login__reason" role="alert">{deniedMessage(r(), tierName(),)}</p>
                            <A href="/profile?tab=membership" class="login__btn login__btn--primary login__denied-upgrade">Upgrade your membership</A>
                            <button type="button" class="login__denied-switch" onClick={() => void switchAccount()}>
                                Sign in with a different account
                            </button>
                        </div>
                    )}
                </Show>
            </div>
        </div>
    );
};

export default Login;
