/**
 * 404 page — used by the catch-all route, DynamicPage (unknown slug) and the
 * shop guard. Styled entirely from the operator's appearance tokens
 * (`--site-primary`, fonts, text/border/background colours, radius), so it
 * matches the site whatever theme is configured. The brand (logo, else the
 * site name) links home; "Go back" uses browser history when there is any.
 */
import { A, useLocation, useNavigate, } from '@solidjs/router';
import { Component, Show, } from 'solid-js';
import SeoHead from '../components/common/seo/SeoHead';
import { siteLogo, siteName, } from '../stores/siteSettings';
import './NotFound.scss';

/** A 404 is exactly where malformed URLs land — decodeURI throws on those. */
function safePath(p: string,): string {
    try {
        return decodeURI(p,);
    } catch {
        return p;
    }
}

export interface NotFoundProps {
    /** Heading, e.g. "Post not found" (default "Page not found"). */
    title?: string;
    /** Explanation under the heading. */
    message?: string;
    /** A related place to go, shown under the buttons (e.g. "All posts" → /posts). */
    link?: { href: string; label: string; };
}

const NotFoundPage: Component<NotFoundProps> = (props,) => {
    const location = useLocation();
    const navigate = useNavigate();
    // A direct visit (no in-site history) has nowhere to go "back" to.
    const canGoBack = () => typeof window !== 'undefined' && window.history.length > 1 && !!document.referrer;
    const goBack = () => (canGoBack() ? window.history.back() : navigate('/',));

    return (
        <main class="not-found" aria-labelledby="not-found-title">
            <SeoHead title={props.title ?? 'Page Not Found'} description="The page you're looking for doesn't exist." noindex={true} nofollow={true} />
            <div class="not-found__glow" aria-hidden="true" />

            <div class="not-found__card">
                <A href="/" class="not-found__brand" aria-label={`${siteName()} — home`}>
                    <Show when={siteLogo()} fallback={<span class="not-found__site-name">{siteName()}</span>}>
                        <img src={siteLogo()} alt={siteName()} class="not-found__logo" />
                    </Show>
                </A>

                <p class="not-found__code" aria-hidden="true">404</p>
                <h1 id="not-found-title" class="not-found__title">{props.title ?? 'Page not found'}</h1>
                <p class="not-found__detail">
                    {props.message ?? "We couldn't find the page you were looking for. It may have been moved, renamed, or never existed."}
                </p>
                <Show when={location.pathname && location.pathname !== '/'}>
                    <p class="not-found__path">
                        <code>{safePath(location.pathname,)}</code>
                    </p>
                </Show>

                <div class="not-found__actions">
                    <button type="button" class="not-found__btn not-found__btn--ghost" onClick={goBack}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
                        Go back
                    </button>
                    <A href="/" class="not-found__btn not-found__btn--primary">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" /></svg>
                        Go home
                    </A>
                </div>
                <Show when={props.link}>
                    {(l,) => <A href={l().href} class="not-found__link">{l().label} →</A>}
                </Show>
            </div>
        </main>
    );
};

export default NotFoundPage;
