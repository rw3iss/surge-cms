import { isAdminRole, } from '@sitesurge/types';
import { useNavigate, useSearchParams, } from '@solidjs/router';
import { Component, } from 'solid-js';
import LoginForm from '../components/auth/LoginForm';
import SeoHead from '../components/common/seo/SeoHead';
import { useAuth, } from '../stores/auth';
import { siteName, } from '../stores/siteSettings';
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
        const target = returnTarget();
        const a = auth.access;
        if (a?.restricted && a.reason === 'subscription' && !isAdminRole(role,)) {
            return target.startsWith('/subscribe',) ? target : '/profile?tab=membership';
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
        if (!raw || raw.startsWith('//',)) return '';
        return raw.startsWith('/',) ? raw : `/${raw}`;
    };

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
                <h1 class="login__title">Sign In</h1>
                <LoginForm
                    initialError={authError()}
                    returnTo={returnTarget() || undefined}
                    onSuccess={(user,) => navigate(afterLogin(user?.role,),)}
                />
            </div>
        </div>
    );
};

export default Login;
